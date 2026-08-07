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
  PermissionChecker,
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
    private readonly cwd: string,
    /** 权限检查器（仅对 Edit 类工具生效，由 AgentLoop 注入） */
    private permissionChecker?: PermissionChecker
  ) {}

  /**
   * 运行时设置权限检查器
   * AgentLoop 在 run() 时根据 PermissionMode + PermissionGate 构造 checker 后注入
   */
  setPermissionChecker(checker: PermissionChecker): void {
    this.permissionChecker = checker;
  }

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

    // 3. 权限检查（仅对 Edit 类工具）
    //    必须在构建 AbortController 之前调用：权限等待时间不计入 30s 执行超时，
    //    避免用户思考导致工具未执行就超时。
    if (tool.safety === ToolSafety.Edit && this.permissionChecker) {
      try {
        const decision = await this.permissionChecker(toolCall, tool);
        if (!decision.approved) {
          return {
            toolName,
            toolCallId,
            ok: false,
            content: `用户拒绝授权：${decision.reason || '用户取消'}`,
            durationMs: Math.round(performance.now() - startTs),
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          toolName,
          toolCallId,
          ok: false,
          content: `权限检查异常：${msg}`,
          durationMs: Math.round(performance.now() - startTs),
        };
      }
    }

    // 4. 构建执行上下文（含超时控制）
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

    // 5. 执行工具（带异常捕获）
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
   *   - 编辑工具（safety=Edit）严格串行执行，且后一个等待前一个完成（含权限确认）
   *     契约：前端 pendingPermission 为单态，同时至多一个权限弹窗，依赖此处串行保证
   *   - 混合场景：先并发执行所有只读工具，再串行执行编辑工具
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

    // 分组：只读工具 vs 编辑工具
    const readOnlyCalls: LLMToolCall[] = [];
    const editCalls: LLMToolCall[] = [];

    for (const call of toolCalls) {
      const tool = this.registry.get(call.name);
      if (tool && tool.safety === ToolSafety.ReadOnly) {
        readOnlyCalls.push(call);
      } else {
        editCalls.push(call);
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

    // 2. 串行执行编辑工具（含权限确认，严格串行）
    for (const call of editCalls) {
      const result = await this.execute(call, parentSignal);
      results.push(result);
      // 串行执行中如果某个工具失败/被拒绝，继续执行后续工具（不中断批次）
    }

    return results;
  }
}
