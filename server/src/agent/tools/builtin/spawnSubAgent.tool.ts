/**
 * spawn_sub_agent 工具 - 派生子 Agent 并行执行任务
 *
 * 安全级别：Edit（派生新进程/执行子任务，需权限确认）
 *
 * 使用场景：
 *   - 拆分复杂任务为多个子任务并行执行
 *   - 独立处理不同模块/文件的分析
 *   - 批量扫描代码库
 */

import { ToolDef, ToolSafety, ToolContext } from '../ToolProtocol';
import { SubAgentRunner, SubAgentTask, SubAgentResult } from '../../subagent/SubAgentRunner';

interface SpawnSubAgentParams {
  /** 子任务列表 */
  tasks: Array<{
    name: string;
    prompt: string;
    context: string;
  }>;
}

/**
 * 创建 spawn_sub_agent 工具
 * @param runner 子 Agent 调度器
 */
export function createSpawnSubAgentTool(runner: SubAgentRunner): ToolDef<SpawnSubAgentParams, string> {
  return {
    name: 'spawn_sub_agent',
    description:
      '派生多个子 Agent 并行执行任务。适合将复杂任务拆分为多个独立子任务同时执行。' +
      '每个子任务需要提供：name（任务名）、prompt（指令）、context（上下文）。' +
      '所有子任务完成后会汇总结果返回。',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: '子任务列表（最多 5 个）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '子任务名称' },
              prompt: { type: 'string', description: '子任务指令' },
              context: { type: 'string', description: '子任务上下文信息' },
            },
            required: ['name', 'prompt', 'context'],
          },
        },
      },
      required: ['tasks'],
    },
    safety: ToolSafety.Edit,
    execute: async (params: SpawnSubAgentParams, _context: ToolContext): Promise<string> => {
      const { tasks } = params;

      if (!tasks || tasks.length === 0) {
        return '❌ 请提供至少一个子任务';
      }

      if (tasks.length > 5) {
        return '❌ 最多支持 5 个并行子任务';
      }

      // 构建 SubAgentTask 列表
      const subTasks: SubAgentTask[] = tasks.map((t, i) => ({
        id: `task_${Date.now()}_${i}`,
        name: t.name,
        prompt: t.prompt,
        context: t.context,
        timeoutMs: 60000,
      }));

      const parentAgentId = `parent_${Date.now()}`;

      try {
        const results: SubAgentResult[] = await runner.runTasks(parentAgentId, subTasks);

        const successCount = results.filter((r) => r.status === 'success').length;
        const failedCount = results.length - successCount;

        const summary = results
          .map((r) => {
            const status = r.status === 'success' ? '✅' : '❌';
            const time = (r.durationMs / 1000).toFixed(1);
            return `${status} ${r.name} (${time}s): ${r.result.substring(0, 200)}${r.result.length > 200 ? '...' : ''}`;
          })
          .join('\n');

        return `子 Agent 并行执行完成：${successCount}/${results.length} 成功，${failedCount} 失败\n\n结果汇总：\n${summary}`;
      } catch (e) {
        return `❌ 子 Agent 调度失败: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  };
}