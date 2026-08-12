/**
 * Agent 主循环（ReAct）
 * 对标 BearCode AgentLoop（轻量化 TS 重构）
 *
 * 核心职责：
 *   1. 执行 ReAct 循环：LLM 推理 → 工具调用 → 结果回填 → 再推理
 *   2. 受最大轮次约束，防止死循环
 *   3. 通过 SSE 回调实时推送文本增量、工具调用、工具结果
 *   4. 工具结果以 tool 角色消息回填到对话上下文
 *
 * 循环终止条件：
 *   - LLM 返回 finish_reason=stop 且无 tool_calls → 输出最终答案
 *   - 达到最大轮次 → 强制终止
 *   - 发生不可恢复错误 → 上抛
 *
 * 设计原则：
 *   - 严格 TypeScript，禁用 any
 *   - 单轮失败不终止循环（工具执行错误会回填给 LLM 让其自我修正）
 *   - 所有 SSE 事件通过回调发射，与 HTTP 层解耦
 */

import { LLMClient, LLMMessage } from '../../services/llmClient';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ToolExecutor } from '../tools/ToolExecutor';
import {
  LLMToolCall,
  ToolExecutionResult,
  OpenAIToolFunction,
  PermissionChecker,
} from '../tools/ToolProtocol';
import { PermissionMode, ContextWindowConfig, DEFAULT_CONTEXT_WINDOW } from '../config';
import { PermissionGate, PermissionRequestPayload } from '../permission/PermissionGate';
import { ContextManager, TrimInfo } from '../context/ContextManager';
import { AuditLog } from '../audit/AuditLog';

/**
 * AgentLoop 回调接口
 * 由 AgentRuntime 实现，用于将循环内的事件桥接到 SSE
 */
export interface AgentLoopCallbacks {
  /** 文本增量（LLM 输出的思考/回答内容） */
  onDelta: (content: string) => void;
  /** 工具调用开始（LLM 决定调用工具时触发） */
  onToolCallStart: (toolCall: LLMToolCall) => void;
  /** 工具执行完成（含结果） */
  onToolResult: (result: ToolExecutionResult) => void;
  /** 权限请求（编辑类工具执行前触发，前端弹出确认框） */
  onPermissionRequest?: (req: PermissionRequestPayload) => void;
  /** 上下文裁剪事件（用于前端展示裁剪信息或日志） */
  onContextTrim?: (info: TrimInfo) => void;
  /** 循环结束（正常完成或达到最大轮次） */
  onDone: (info: { iterations: number; finalAnswer: string; maxReached: boolean }) => void;
  /** 不可恢复错误 */
  onError: (error: Error) => void;
}

/**
 * AgentLoop 配置
 */
export interface AgentLoopConfig {
  /** 工作目录（工具执行相对路径基准） */
  cwd: string;
  /** 最大迭代轮次（兜底防死循环） */
  maxRounds: number;
  /** 权限模式（当前阶段全部放行，预留扩展） */
  permission: PermissionMode;
  /** 上下文窗口配置（token 限制与裁剪策略） */
  contextWindow?: Partial<ContextWindowConfig>;
  /** 模型配置 */
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Agent 主循环
 */
export class AgentLoop {
  /** 对话上下文（含 system、user、assistant、tool 消息） */
  private messages: LLMMessage[] = [];
  /** 中断信号 */
  private abortController = new AbortController();
  /** 当前迭代轮次 */
  private iteration = 0;
  /** 上下文管理器（token 估算与自动裁剪） */
  private readonly contextManager: ContextManager;
  /** 审计日志（可选，注入后自动记录关键操作） */
  private readonly auditLog?: AuditLog;
  /** Agent 实例 ID（用于审计追踪） */
  private readonly agentId: string;

  constructor(
    private readonly llmClient: LLMClient,
    private readonly registry: ToolRegistry,
    private readonly executor: ToolExecutor,
    private readonly config: AgentLoopConfig,
    /** 权限网关（处理 Edit 类工具的 Suspend/Resume，由 chat.ts 注入） */
    private readonly permissionGate?: PermissionGate,
    /** 审计日志实例 */
    auditLog?: AuditLog
  ) {
    this.auditLog = auditLog;
    this.agentId = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // 初始化上下文管理器，使用配置的上下文窗口参数
    const ctxConfig = {
      ...DEFAULT_CONTEXT_WINDOW,
      ...config.contextWindow,
    };
    this.contextManager = new ContextManager(ctxConfig);
    console.log(
      `[AgentLoop] ContextManager 配置: maxTokens=${ctxConfig.maxContextTokens}, ` +
      `trimRatio=${ctxConfig.trimRatio}, perMsgOverhead=${ctxConfig.perMessageOverhead}`
    );
  }

  /**
   * 运行 Agent 主循环
   * @param systemPrompt 系统提示词
   * @param userMessages 用户历史消息（含当前提问）
   * @param callbacks 事件回调
   */
  async run(
    systemPrompt: string,
    userMessages: LLMMessage[],
    callbacks: AgentLoopCallbacks
  ): Promise<void> {
    // 初始化对话上下文：system + 历史消息
    this.messages = [
      { role: 'system', content: systemPrompt },
      ...userMessages,
    ];

    // 装配权限检查器并注入 executor
    // 必须在 run() 内构造：依赖 config.permission / permissionGate / abortController
    this.executor.setPermissionChecker(this.buildPermissionChecker());

    const openaiTools: OpenAIToolFunction[] = this.registry.toOpenAITools();

    try {
      while (this.iteration < this.config.maxRounds) {
        this.iteration++;
        console.log(`[AgentLoop] === 第 ${this.iteration}/${this.config.maxRounds} 轮 ===`);

        // 0. 上下文裁剪（每轮 LLM 调用前检查并裁剪）
        const estimatedTokens = this.contextManager.estimateTotalTokens(this.messages);
        console.log(
          `[AgentLoop] 上下文状态: ${this.messages.length} 条消息, 约 ${Math.round(estimatedTokens)} tokens`
        );

        if (this.contextManager.shouldTrim(this.messages)) {
          console.log('[AgentLoop] 上下文接近阈值，执行裁剪...');
          const { trimmed, info } = this.contextManager.trimMessages(this.messages);

          // 更新内部消息列表为裁剪后的版本
          this.messages = trimmed;

          // 打印裁剪详情
          console.log(
            `[AgentLoop] 上下文裁剪: ${info.beforeMessageCount}→${info.afterMessageCount} 条, ` +
            `${Math.round(info.beforeEstimatedTokens)}→${Math.round(info.afterEstimatedTokens)} tokens, ` +
            `移除 ${info.trimmedCount} 条消息`
          );

          // 触发裁剪事件回调（通知前端/日志）
          callbacks.onContextTrim?.(info);

          // 写入审计日志
          if (this.auditLog) {
            this.auditLog.logContextTrim(
              this.agentId,
              info.beforeMessageCount,
              info.afterMessageCount,
              info.beforeEstimatedTokens,
              info.afterEstimatedTokens
            );
          }
        }

        // 1. 调用 LLM
        const loopResult = await this.callLLM(this.messages, openaiTools, callbacks);

        if (!loopResult) {
          // LLM 调用失败（错误已通过 onError 上报）
          return;
        }

        // 2. 判断是否需要执行工具
        if (loopResult.toolCalls.length === 0) {
          // 无工具调用 → 最终答案，循环结束
          console.log(`[AgentLoop] 循环正常结束，共 ${this.iteration} 轮，最终答案长度 ${loopResult.content.length}`);
          callbacks.onDone({
            iterations: this.iteration,
            finalAnswer: loopResult.content,
            maxReached: false,
          });
          return;
        }

        // 3. 执行工具调用
        await this.executeTools(loopResult.toolCalls, callbacks);

        // 4. 工具结果已回填到 this.messages，进入下一轮 LLM 推理
      }

      // 达到最大轮次仍未结束
      console.warn(`[AgentLoop] 达到最大轮次 ${this.config.maxRounds}，强制终止`);
      callbacks.onDone({
        iterations: this.iteration,
        finalAnswer: '',
        maxReached: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AgentLoop] 循环异常:', msg);
      callbacks.onError(err instanceof Error ? err : new Error(msg));
    }
  }

  /**
   * 调用 LLM（单轮）
   * 返回本轮 LLM 输出的文本内容与工具调用
   */
  private async callLLM(
    messages: LLMMessage[],
    tools: OpenAIToolFunction[],
    callbacks: AgentLoopCallbacks
  ): Promise<{ content: string; toolCalls: LLMToolCall[] } | null> {
    let accumulatedContent = '';
    let receivedToolCalls: LLMToolCall[] = [];

    return new Promise<{ content: string; toolCalls: LLMToolCall[] } | null>((resolve) => {
      this.llmClient.streamChat(
        messages,
        {
          onDelta: (content) => {
            accumulatedContent += content;
            callbacks.onDelta(content);
          },
          onToolCalls: (toolCalls) => {
            receivedToolCalls = toolCalls;
            // 通知每个工具调用开始
            for (const tc of toolCalls) {
              console.log(`[AgentLoop] LLM 请求调用工具: ${tc.name}(${tc.arguments})`);
              callbacks.onToolCallStart(tc);
            }
          },
          onDone: (_usage, toolCalls) => {
            // 如果 onToolCalls 未触发（部分模型只在 onDone 传 toolCalls），补充通知
            const finalToolCalls = toolCalls ?? receivedToolCalls;
            if (finalToolCalls.length > 0 && receivedToolCalls.length === 0) {
              receivedToolCalls = finalToolCalls;
              for (const tc of finalToolCalls) {
                callbacks.onToolCallStart(tc);
              }
            }

            // 如果本轮有内容输出，将 assistant 消息（含 tool_calls）回填到上下文
            if (accumulatedContent || receivedToolCalls.length > 0) {
              const assistantMsg: LLMMessage = {
                role: 'assistant',
                content: accumulatedContent,
              };
              if (receivedToolCalls.length > 0) {
                assistantMsg.tool_calls = receivedToolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: { name: tc.name, arguments: tc.arguments },
                }));
              }
              this.messages.push(assistantMsg);
            }

            resolve({ content: accumulatedContent, toolCalls: receivedToolCalls });
          },
          onError: (error) => {
            callbacks.onError(error);
            resolve(null);
          },
        },
        {
          model: this.config.model,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          tools,
        }
      );
    });
  }

  /**
   * 构造权限检查器
   *
   * 决策策略（对标 BearCode PermissionMode）：
   *   - BypassPermissions / AcceptEdits → 直接放行（向后兼容，不弹窗）
   *   - Plan / DontAsk → 直接拒绝（只读规划模式，静默拦截编辑）
   *   - Default → 走 PermissionGate，发 SSE 请求前端弹窗，挂起等待用户决策
   *
   * 权限状态单次有效：每次 Edit 工具调用都触发一次独立的 gate.request，
   * 不缓存授权结果。
   */
  private buildPermissionChecker(): PermissionChecker {
    return async (toolCall, _tool): Promise<{ approved: boolean; reason?: string }> => {
      // 1. 按 PermissionMode 短路（无需弹窗的模式）
      if (
        this.config.permission === PermissionMode.BypassPermissions ||
        this.config.permission === PermissionMode.AcceptEdits
      ) {
        return { approved: true };
      }
      if (
        this.config.permission === PermissionMode.Plan ||
        this.config.permission === PermissionMode.DontAsk
      ) {
        return { approved: false, reason: `当前权限模式（${this.config.permission}）不允许编辑操作` };
      }

      // 2. Default 模式：走 PermissionGate 挂起等待用户决策
      //    SSE permission_request 由 gate.onPending 回调发出（chat.ts 装配时注入）
      if (!this.permissionGate) {
        // 未注入 gate 时安全起见拒绝
        return { approved: false, reason: '权限网关未初始化' };
      }

      console.log(`[AgentLoop] 请求权限: ${toolCall.name}(${toolCall.arguments})`);
      // gate.request 内部同步触发 onPending（发 SSE），随后挂起等待 resolve
      const decision = await this.permissionGate.request(
        {
          permissionId: toolCall.id,
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          arguments: toolCall.arguments,
        },
        this.abortController.signal
      );
      return decision;
    };
  }

  /**
   * 执行工具调用并将结果回填到对话上下文
   */
  private async executeTools(
    toolCalls: LLMToolCall[],
    callbacks: AgentLoopCallbacks
  ): Promise<void> {
    console.log(`[AgentLoop] 执行 ${toolCalls.length} 个工具调用`);

    // 批量执行（只读工具并发，副作用工具串行）
    const results = await this.executor.executeBatch(toolCalls, this.abortController.signal);

    // 推送每个工具结果，并回填到对话上下文
    for (const result of results) {
      console.log(`[AgentLoop] 工具 ${result.toolName} 完成: ok=${result.ok}, 耗时=${result.durationMs}ms`);
      callbacks.onToolResult(result);

      // 写入审计日志
      if (this.auditLog) {
        this.auditLog.logToolCall(
          this.agentId,
          result.toolName,
          `工具调用 ${result.toolCallId}${result.ok ? '' : ' (失败)'}`,
          result.ok ? 'success' : 'failed',
          {
            toolCallId: result.toolCallId,
            resultLength: result.content.length,
            durationMs: result.durationMs,
          }
        );
      }

      // 回填 tool 角色消息到对话上下文
      this.messages.push({
        role: 'tool',
        content: result.content,
        tool_call_id: result.toolCallId,
      });
    }
  }

  /**
   * 中断当前循环
   */
  abort(): void {
    this.abortController.abort();
    this.llmClient.abort();
  }
}
