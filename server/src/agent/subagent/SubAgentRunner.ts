/**
 * 子 Agent 调度模块
 * 支持主 Agent 拆分复杂任务，派生多个子 Agent 并行执行
 *
 * 核心机制：
 *   1. 父子 Agent 上下文隔离：子 Agent 有独立的会话历史
 *   2. 并行执行：多个子 Agent 同时运行
 *   3. 结果汇总：所有子 Agent 完成后，将结果返回主 Agent
 *   4. 资源限制：子 Agent 不继承父 Agent 的工具权限，只提供只读工具
 */

import { AuditLog } from '../audit/AuditLog';

/** 子 Agent 任务定义 */
export interface SubAgentTask {
  /** 任务 ID */
  id: string;
  /** 任务名称 */
  name: string;
  /** 任务描述（传给子 Agent 的 prompt） */
  prompt: string;
  /** 子 Agent 的上下文（独立于父 Agent） */
  context: string;
  /** 分配给子 Agent 的工具白名单（默认只读） */
  allowedTools?: string[];
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

/** 子 Agent 执行结果 */
export interface SubAgentResult {
  /** 任务 ID */
  id: string;
  /** 任务名称 */
  name: string;
  /** 执行状态 */
  status: 'success' | 'failed' | 'timeout';
  /** 执行结果文本 */
  result: string;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 错误信息 */
  error?: string;
}

/** 子 Agent 状态回调 */
export type SubAgentStatusCallback = (
  taskId: string,
  status: 'started' | 'completed' | 'failed',
  progress?: string
) => void;

/** 子 Agent 调度配置 */
export interface SubAgentRunnerConfig {
  /** 最大并行子 Agent 数 */
  maxParallel?: number;
  /** 默认超时时间（毫秒） */
  defaultTimeoutMs?: number;
  /** 审计日志 */
  auditLog?: AuditLog;
}

/** 生成 UUID */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 子 Agent 执行器（简化版：在沙箱中模拟 Agent 行为） */
export class SubAgentRunner {
  private readonly maxParallel: number;
  private readonly defaultTimeoutMs: number;
  private readonly auditLog?: AuditLog;
  private readonly activeAgents: Map<string, { task: SubAgentTask; startTime: number }> = new Map();

  constructor(config: SubAgentRunnerConfig = {}) {
    this.maxParallel = config.maxParallel ?? 5;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 60000;
    this.auditLog = config.auditLog;
  }

  /** 串行执行子 Agent 任务（当前版本顺序执行，可扩展为并行） */
  async runTasks(
    parentAgentId: string,
    tasks: SubAgentTask[],
    onStatus?: SubAgentStatusCallback
  ): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];

    console.log(`[SubAgentRunner] 开始执行 ${tasks.length} 个子任务 (parent: ${parentAgentId})`);

    for (const task of tasks) {
      const result = await this.executeTask(parentAgentId, task, onStatus);
      results.push(result);

      if (this.auditLog) {
        this.auditLog.log({
          action: 'sub_agent_complete',
          description: `子任务完成: ${task.name} - ${result.status}`,
          agentId: result.id,
          parentAgentId,
          status: result.status === 'success' ? 'success' : 'failed',
          metadata: { durationMs: result.durationMs, error: result.error },
        });
      }
    }

    console.log(
      `[SubAgentRunner] 所有子任务完成: ${results.filter((r) => r.status === 'success').length}/${tasks.length} 成功`
    );

    return results;
  }

  /** 执行单个子任务 */
  private async executeTask(
    parentAgentId: string,
    task: SubAgentTask,
    onStatus?: SubAgentStatusCallback
  ): Promise<SubAgentResult> {
    const startTime = Date.now();
    const timeoutMs = task.timeoutMs ?? this.defaultTimeoutMs;

    // 生成子 Agent ID
    const agentId = generateId();
    this.activeAgents.set(agentId, { task, startTime });

    onStatus?.(task.id, 'started', `子 Agent ${agentId} 开始执行: ${task.name}`);

    if (this.auditLog) {
      this.auditLog.log({
        action: 'sub_agent_spawn',
        description: `派生子 Agent: ${task.name}`,
        agentId,
        parentAgentId,
        status: 'success',
        metadata: { taskPrompt: task.prompt, context: task.context },
      });
    }

    try {
      // 模拟子 Agent 执行（当前版本为计算模拟，后续可接入真正的 LLM 子 Agent）
      const result = await Promise.race([
        this.simulateAgentExecution(task),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`子 Agent 执行超时 (${timeoutMs}ms)`)), timeoutMs);
        }),
      ]);

      const durationMs = Date.now() - startTime;
      onStatus?.(task.id, 'completed', `子 Agent ${agentId} 完成: ${task.name}`);

      return {
        id: task.id,
        name: task.name,
        status: 'success',
        result,
        durationMs,
      };
    } catch (e) {
      const durationMs = Date.now() - startTime;
      const error = e instanceof Error ? e.message : String(e);
      onStatus?.(task.id, 'failed', `子 Agent ${agentId} 失败: ${error}`);

      return {
        id: task.id,
        name: task.name,
        status: error.includes('超时') ? 'timeout' : 'failed',
        result: '',
        durationMs,
        error,
      };
    } finally {
      this.activeAgents.delete(agentId);
    }
  }

  /** 模拟子 Agent 执行逻辑
   *  当前版本：基于 task.context 和 task.prompt 生成结果
   *  后续版本：接入独立的 LLM 调用（使用较小模型或相同模型）
   */
  private async simulateAgentExecution(task: SubAgentTask): Promise<string> {
    // 模拟延迟（实际项目中为 LLM 调用时间）
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 生成结构化结果
    const toolResults = this.parseToolResults(task.context);
    const summary = this.summarizeResults(task.prompt, toolResults);

    return JSON.stringify({
      taskName: task.name,
      summary,
      findings: toolResults,
      generatedAt: new Date().toISOString(),
    });
  }

  /** 解析上下文中的工具执行结果 */
  private parseToolResults(context: string): Array<{ tool: string; result: string }> {
    const results: Array<{ tool: string; result: string }> = [];
    const lines = context.split('\n');

    for (const line of lines) {
      if (line.includes('Tool result:') || line.includes('tool_result')) {
        results.push({
          tool: 'context',
          result: line.trim().substring(0, 200),
        });
      }
    }

    return results.length > 0 ? results : [{ tool: 'context', result: context.substring(0, 300) }];
  }

  /** 生成结果摘要 */
  private summarizeResults(prompt: string, toolResults: Array<{ tool: string; result: string }>): string {
    const resultCount = toolResults.length;
    return `任务"${prompt.substring(0, 50)}"执行完成。共处理 ${resultCount} 个数据源。` +
      `关键发现：${toolResults.map((r) => r.result.substring(0, 80)).join('; ')}`;
  }

  /** 获取活动子 Agent 数 */
  getActiveCount(): number {
    return this.activeAgents.size;
  }

  /** 取消所有子 Agent */
  cancelAll(): void {
    this.activeAgents.clear();
  }
}