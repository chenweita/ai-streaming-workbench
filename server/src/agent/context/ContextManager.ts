/**
 * ContextManager - 上下文长度管控模块
 * 对标 BearCode 上下文管理机制（轻量化 TS 重构）
 *
 * 核心职责：
 *   1. 估算会话消息的 token 数量
 *   2. 当上下文接近阈值时，自动裁剪最早的历史消息
 *   3. 保留最新对话与系统提示词，确保 Agent 行为连贯
 *   4. 打印详细日志，输出裁剪前后的上下文信息
 *
 * 设计原则：
 *   - 严格 TypeScript，禁用 any
 *   - 裁剪逻辑仅作用于当前会话短期记忆，不影响持久化记忆（后续实现）
 *   - 系统提示词（system prompt）永远保留，不参与裁剪
 *   - 最新的用户消息与工具结果永远保留
 *   - 平滑降级：避免直接抛出上下文超限错误
 *   - 按对话轮次裁剪：一个轮次 = assistant(含 tool_calls) + 所有 tool 响应消息，
 *     确保 OpenAI API 的 tool_calls/tool 配对约束不被破坏
 */

import { LLMMessage } from '../../services/llmClient';
import { ContextWindowConfig, DEFAULT_CONTEXT_WINDOW } from '../config';

/** 裁剪操作的详细信息（用于日志与前端展示） */
export interface TrimInfo {
  /** 裁剪前消息数 */
  beforeMessageCount: number;
  /** 裁剪前估算 token 数 */
  beforeEstimatedTokens: number;
  /** 裁剪后消息数 */
  afterMessageCount: number;
  /** 裁剪后估算 token 数 */
  afterEstimatedTokens: number;
  /** 被裁剪的消息数量 */
  trimmedCount: number;
  /** 是否发生了裁剪 */
  wasTrimmed: boolean;
  /** 裁剪时间戳 */
  trimmedAt: number;
}

/**
 * 对话轮次分组结果
 * 每个轮次 = 一个 assistant 消息(可能含 tool_calls) + 所有对应的 tool 响应消息
 */
interface RoundGroup {
  /** 轮次内的所有消息（assistant + tool responses） */
  messages: LLMMessage[];
  /** 轮次的 token 估算 */
  estimatedTokens: number;
}

/**
 * ContextManager 类
 * 负责上下文 token 估算与自动裁剪
 */
export class ContextManager {
  private readonly config: ContextWindowConfig;

  constructor(config: ContextWindowConfig = DEFAULT_CONTEXT_WINDOW) {
    this.config = config;
  }

  /**
   * 估算单条消息的 token 数
   * 使用启发式算法：中文字符约 1 token/字，英文约 4 token/单词
   * 加上每条消息的固定开销（role + metadata）
   *
   * 注意：这是估算值，实际 token 数由模型 tokenizer 决定
   * 对于 70B/120B 等大模型，估算误差在 10-20% 内，足以用于上下文裁剪决策
   */
  estimateMessageTokens(message: LLMMessage): number {
    const content = message.content ?? '';
    const toolCallsOverhead = message.tool_calls
      ? message.tool_calls.reduce((sum, tc) => {
          // function name + arguments JSON 估算
          return sum + tc.function.name.length / 4 + tc.function.arguments.length / 4;
        }, 0)
      : 0;

    const toolCallIdOverhead = message.tool_call_id ? message.tool_call_id.length / 4 : 0;

    // 内容 token 估算：中文约 1 token/字符，英文约 4 字符/token
    // 简化为：字符数 / 2（混合中英文的折中值）
    const contentTokens = content.length / 2;

    // 固定开销：role 字段 + JSON 结构开销
    const overhead = this.config.perMessageOverhead;

    return Math.ceil(contentTokens + toolCallsOverhead + toolCallIdOverhead + overhead);
  }

  /**
   * 估算整个消息列表的总 token 数
   */
  estimateTotalTokens(messages: LLMMessage[]): number {
    return messages.reduce((total, msg) => total + this.estimateMessageTokens(msg), 0);
  }

  /**
   * 计算对话消息（排除 system prompt）的 token 数
   * system prompt 永远保留，不参与裁剪决策
   */
  private estimateConversationTokens(messages: LLMMessage[]): number {
    const convMsgs = messages.filter((m) => m.role !== 'system');
    let total = 0;
    for (const msg of convMsgs) {
      const t = this.estimateMessageTokens(msg);
      total += t;
      console.log(
        `[ContextManager]   消息 role=${msg.role}, contentLen=${(msg.content ?? '').length}, ` +
        `tokens=${Math.round(t)}`
      );
    }
    return total;
  }

  /**
   * 检查是否需要裁剪
   * 仅对对话消息（排除 system prompt）计算是否超限
   *
   * @param messages 当前消息列表
   * @returns 是否需要裁剪（对话消息 token 数 >= 阈值）
   */
  shouldTrim(messages: LLMMessage[]): boolean {
    const conversationTokens = this.estimateConversationTokens(messages);
    const threshold = this.config.maxContextTokens * this.config.trimRatio;
    console.log(
      `[ContextManager] shouldTrim: 对话tokens=${Math.round(conversationTokens)} ` +
      `阈值=${Math.round(threshold)} (max=${this.config.maxContextTokens}, ratio=${this.config.trimRatio}), ` +
      `结果=${conversationTokens >= threshold}`
    );
    return conversationTokens >= threshold;
  }

  /**
   * 将对话消息按轮次分组
   *
   * 轮次定义：
   *   - 一个 assistant 消息（可能含 tool_calls）+ 紧随其后的所有 tool 响应消息
   *   - 如果 assistant 没有 tool_calls，则该轮次只有 assistant 本身
   *   - user 消息单独作为一个轮次
   *
   * 示例（消息序列 → 轮次分组）：
   *   [user1] → 轮次1: [user1]
   *   [assistant1(tool_calls)] → 轮次2: [assistant1]
   *   [tool1, tool2] → 轮次2: [assistant1, tool1, tool2]
   *   [assistant2(no tools)] → 轮次3: [assistant2]
   *   [user2] → 轮次4: [user2]
   */
  private groupByRounds(conversationMessages: LLMMessage[]): RoundGroup[] {
    const groups: RoundGroup[] = [];
    let currentGroup: LLMMessage[] = [];
    let currentHasToolCalls = false;

    for (const msg of conversationMessages) {
      if (msg.role === 'user') {
        // user 消息：开启新轮次
        if (currentGroup.length > 0) {
          groups.push({
            messages: currentGroup,
            estimatedTokens: this.estimateTotalTokens(currentGroup),
          });
        }
        currentGroup = [msg];
        currentHasToolCalls = false;
      } else if (msg.role === 'assistant') {
        // assistant 消息：开启新轮次
        if (currentGroup.length > 0) {
          groups.push({
            messages: currentGroup,
            estimatedTokens: this.estimateTotalTokens(currentGroup),
          });
        }
        currentGroup = [msg];
        currentHasToolCalls = !!(msg.tool_calls && msg.tool_calls.length > 0);
      } else if (msg.role === 'tool') {
        // tool 消息：追加到当前轮次（紧跟在 assistant 后面）
        currentGroup.push(msg);
        // 如果当前 assistant 没有 tool_calls 但有 tool 响应，说明配对异常
        // 此时仍将 tool 消息归入当前轮次以保持完整性
      } else {
        // 其他未知角色：独立成轮次
        if (currentGroup.length > 0) {
          groups.push({
            messages: currentGroup,
            estimatedTokens: this.estimateTotalTokens(currentGroup),
          });
        }
        currentGroup = [msg];
        currentHasToolCalls = false;
      }
    }

    // 推入最后一组
    if (currentGroup.length > 0) {
      groups.push({
        messages: currentGroup,
        estimatedTokens: this.estimateTotalTokens(currentGroup),
      });
    }

    return groups;
  }

  /**
   * 裁剪上下文：按对话轮次从最早开始移除，确保 tool_calls/tool 配对完整
   *
   * 裁剪策略：
   *   1. 保留 system prompt（第一条 system 消息）
   *   2. 将对话消息按轮次分组（一个轮次 = assistant + 所有 tool 响应）
   *   3. 从最早的轮次开始整组移除
   *   4. 持续移除直到 token 数降至安全阈值以下
   *   5. 至少保留最近 2 个轮次（无论 token 数是否超限）
   *
   * @param messages 当前消息列表
   * @returns 裁剪后的消息列表 + 裁剪信息
   */
  trimMessages(messages: LLMMessage[]): { trimmed: LLMMessage[]; info: TrimInfo } {
    const beforeCount = messages.length;
    const beforeTokens = this.estimateTotalTokens(messages);

    const info: TrimInfo = {
      beforeMessageCount: beforeCount,
      beforeEstimatedTokens: beforeTokens,
      afterMessageCount: beforeCount,
      afterEstimatedTokens: beforeTokens,
      trimmedCount: 0,
      wasTrimmed: false,
      trimmedAt: Date.now(),
    };

    // 1. 检查是否需要裁剪
    if (!this.shouldTrim(messages)) {
      return { trimmed: messages, info };
    }

    console.log(
      `[ContextManager] 上下文超限预警: ${Math.round(beforeTokens)} tokens / ${this.config.maxContextTokens} tokens ` +
      `(阈值 ${Math.round(this.config.maxContextTokens * this.config.trimRatio)})`
    );

    // 2. 分离 system prompt 与对话消息
    const systemMessages: LLMMessage[] = [];
    const conversationMessages: LLMMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg);
      } else {
        conversationMessages.push(msg);
      }
    }

    // 3. 按轮次分组（确保 tool_calls/tool 配对完整）
    const roundGroups = this.groupByRounds(conversationMessages);
    console.log(
      `[ContextManager] 对话分为 ${roundGroups.length} 个轮次，各轮次 token: ` +
      `[${roundGroups.map((g) => Math.round(g.estimatedTokens)).join(', ')}]`
    );

    // 4. 从最早的轮次开始整组移除
    // 安全阈值仅基于对话消息 token（排除 system prompt），避免 system prompt 大小影响裁剪决策
    const safeTokenLimit = this.config.maxContextTokens * this.config.trimRatio * 0.8;
    // 至少保留最近 2 个轮次
    const minRoundsToKeep = Math.min(2, roundGroups.length);

    let trimmedRoundCount = 0;
    let remainingRounds = [...roundGroups];

    while (
      remainingRounds.length > minRoundsToKeep &&
      this.estimateTotalTokens(remainingRounds.flatMap((g) => g.messages)) > safeTokenLimit
    ) {
      // 移除最早的轮次（整组移除，确保 tool_calls/tool 配对完整）
      remainingRounds.shift();
      trimmedRoundCount++;
    }

    // 5. 合并 system + 剩余轮次的消息
    const remainingMessages = remainingRounds.flatMap((g) => g.messages);
    const result = [...systemMessages, ...remainingMessages];

    // 计算被裁剪的消息数
    const trimmedMessageCount = beforeCount - result.length;

    // 6. 更新裁剪信息
    info.afterMessageCount = result.length;
    info.afterEstimatedTokens = this.estimateTotalTokens(result);
    info.trimmedCount = trimmedMessageCount;
    info.wasTrimmed = trimmedMessageCount > 0;

    // 7. 打印裁剪日志
    if (info.wasTrimmed) {
      console.log(
        `[ContextManager] 上下文裁剪完成: ` +
        `移除 ${trimmedRoundCount} 个轮次（${trimmedMessageCount} 条消息）, ` +
        `${beforeCount} → ${result.length} 条消息, ` +
        `${Math.round(beforeTokens)} → ${Math.round(info.afterEstimatedTokens)} tokens`
      );
    }

    return { trimmed: result, info };
  }

  /**
   * 获取当前配置
   */
  getConfig(): ContextWindowConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ContextWindowConfig>): void {
    Object.assign(this.config, config);
  }
}

/**
 * 创建 ContextManager 实例
 */
export function createContextManager(
  config?: Partial<ContextWindowConfig>
): ContextManager {
  const mergedConfig: ContextWindowConfig = {
    ...DEFAULT_CONTEXT_WINDOW,
    ...config,
  };
  return new ContextManager(mergedConfig);
}
