/**
 * 工具执行器
 * 对标 BearCode 工具执行层（轻量化 TS 重构）
 *
 * 核心职责：
 *   1. 接收 LLM 返回的工具调用，执行对应工具
 *   2. 异常捕获：工具不存在、参数非法、执行超时、运行时错误均不崩溃
 *   3. 超时控制：通过 AbortSignal + Promise.race 实现
 *   4. 并发策略：只读工具可并发执行，有副作用工具串行
 *
 * 设计原则：
 *   - 执行器不决定权限（暂时全部放行，由上层 PermissionGate 控制）
 *   - 所有异常封装为 ToolExecutionResult.ok=false，不向上抛出
 *   - 参数 JSON 解析失败时返回友好错误，不崩溃
 */

import { ToolRegistry } from './ToolRegistry';
import {
  ToolDef,
  ToolContext,
  ToolExecutionResult,
  ToolSafety,
  LLMToolCall,
} from './ToolProtocol';

/** 默认工具执行超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * 工具执行器
 */
export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    /** 默认工作目录（工具相对路径基准） */
    private readonly cwd: string
  ) {}

  /**
   * 执行单个工具调用
   *
   * 异常处理策略：
   *   - 工具不存在：返回 ok=false，content 提示可用工具列表
   *   - 参数 JSON 解析失败：返回 ok=false，content 提示参数格式错误
   *   - 执行超时：返回 ok=false，content 提示超时
   *   - 执行抛错：返回 ok=false，content 包含错误信息
   *
   * @param toolCall LLM 返回的工具调用
   * @param parentSignal 父级中断信号（用户主动中止时触发）
   */
  async execute(
    toolCall: LLMToolCall,
    parentSignal?: AbortSignal
  ): Promise<ToolExecutionResult> {
    const startTs = performance.now();
    const toolName = toolCall.name;
    const toolCallId = toolCall.id;

    // 1. 查找工具
    const tool = this.registry.get(toolName);
    if (!tool) {
      const available = this.registry.list().map((t) => t.name).join(', ');
      return {
        toolName,
        toolCallId,
        ok: false,
        content: `错误: 工具 "${toolName}" 不存在。可用工具: ${available}`,
        durationMs: Math.round(performance.now() - startTs),
      };
    }

    // 2. 解析参数 JSON
    let params: Record<string, unknown>;
    try {
      params = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolName,
        toolCallId,
        ok: false,
        content: `错误: 参数 JSON 解析失败 - ${msg}。原始参数: ${toolCall.arguments}`,
        durationMs: Math.round(performance.now() - startTs),
      };
    }

    // 3. 构建执行上下文（含超时控制）
    const controller = new AbortController();
    const timeoutMs = DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // 父级中断信号联动
    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort();
      } else {
        parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    const context: ToolContext = {
      cwd: this.cwd,
      signal: controller.signal,
      timeoutMs,
    };

    // 4. 执行工具（带异常捕获）
    try {
      const result = await this.executeWithTimeout(tool, params, context, controller);
      clearTimeout(timeoutId);
      return {
        toolName,
        toolCallId,
        ok: true,
        content: typeof result === 'string' ? result : JSON.stringify(result),
        durationMs: Math.round(performance.now() - startTs),
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);

      // 区分超时与普通错误
      if (controller.signal.aborted) {
        return {
          toolName,
          toolCallId,
          ok: false,
          content: `错误: 工具 "${toolName}" 执行超时（${timeoutMs}ms）`,
          durationMs: Math.round(performance.now() - startTs),
        };
      }

      return {
        toolName,
        toolCallId,
        ok: false,
        content: `错误: 工具 "${toolName}" 执行失败 - ${msg}`,
        durationMs: Math.round(performance.now() - startTs),
      };
    }
  }

  /**
   * 带超时的工具执行
   * 通过 Promise.race 实现：工具执行 vs 超时拒绝
   */
  private async executeWithTimeout(
    tool: ToolDef,
    params: Record<string, unknown>,
    context: ToolContext,
    controller: AbortController
  ): Promise<unknown> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(new Error('工具执行超时')),
        { once: true }
      );
    });

    return Promise.race([
      tool.execute(params, context),
      timeoutPromise,
    ]);
  }

  /**
   * 并发执行多个工具调用
   *
   * 策略：
   *   - 只读工具（safety=ReadOnly）可并发
   *   - 有副作用工具（safety=SideEffect）串行执行
   *   - 混合场景：先并发执行所有只读工具，再串行执行副作用工具
   *
   * @param toolCalls LLM 返回的工具调用列表
   * @param parentSignal 父级中断信号
   */
  async executeBatch(
    toolCalls: LLMToolCall[],
    parentSignal?: AbortSignal
  ): Promise<ToolExecutionResult[]> {
    if (toolCalls.length === 0) {
      return [];
    }

    // 分组：只读工具 vs 副作用工具
    const readOnlyCalls: LLMToolCall[] = [];
    const sideEffectCalls: LLMToolCall[] = [];

    for (const call of toolCalls) {
      const tool = this.registry.get(call.name);
      if (tool && tool.safety === ToolSafety.ReadOnly) {
        readOnlyCalls.push(call);
      } else {
        sideEffectCalls.push(call);
      }
    }

    const results: ToolExecutionResult[] = [];

    // 1. 并发执行只读工具
    if (readOnlyCalls.length > 0) {
      const readOnlyResults = await Promise.all(
        readOnlyCalls.map((call) => this.execute(call, parentSignal))
      );
      results.push(...readOnlyResults);
    }

    // 2. 串行执行副作用工具
    for (const call of sideEffectCalls) {
      const result = await this.execute(call, parentSignal);
      results.push(result);
      // 串行执行中如果某个工具失败，继续执行后续工具（不中断批次）
    }

    return results;
  }
}
