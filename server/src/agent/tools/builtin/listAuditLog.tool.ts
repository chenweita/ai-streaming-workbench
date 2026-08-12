/**
 * list_audit_log 工具 - 查询历史操作记录
 *
 * 安全级别：ReadOnly（查询类操作，自动放行）
 */

import { ToolDef, ToolSafety, ToolContext } from '../ToolProtocol';
import { AuditLog, AuditActionType } from '../../audit/AuditLog';

interface ListAuditLogParams {
  /** 操作类型过滤 */
  action?: AuditActionType;
  /** 操作者过滤 */
  agentId?: string;
  /** 状态过滤 */
  status?: 'success' | 'failed' | 'denied';
  /** 时间范围开始（毫秒时间戳） */
  startTime?: number;
  /** 时间范围结束（毫秒时间戳） */
  endTime?: number;
  /** 最大返回条数 */
  limit?: number;
  /** 关键词搜索 */
  keyword?: string;
}

/**
 * 创建 list_audit_log 工具
 * @param auditLog 审计日志实例
 */
export function createListAuditLogTool(auditLog: AuditLog): ToolDef<ListAuditLogParams, string> {
  return {
    name: 'list_audit_log',
    description:
      '查询历史操作审计日志。可按操作类型、时间范围、操作者等条件过滤。' +
      '操作类型包括：tool_call、file_write、file_edit、skill_create、skill_evolve、memory_save、sub_agent_spawn 等。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型过滤',
          enum: [
            'tool_call',
            'file_write',
            'file_edit',
            'skill_create',
            'skill_evolve',
            'skill_delete',
            'memory_save',
            'memory_delete',
            'sub_agent_spawn',
            'sub_agent_complete',
            'permission_denied',
            'context_trim',
          ],
        },
        agentId: {
          type: 'string',
          description: '操作者 ID 过滤',
        },
        status: {
          type: 'string',
          description: '状态过滤',
          enum: ['success', 'failed', 'denied'],
        },
        startTime: {
          type: 'number',
          description: '开始时间（毫秒时间戳）',
        },
        endTime: {
          type: 'number',
          description: '结束时间（毫秒时间戳）',
        },
        limit: {
          type: 'number',
          description: '最大返回条数（默认 20，最大 100）',
        },
        keyword: {
          type: 'string',
          description: '关键词搜索（在描述和元数据中搜索）',
        },
      },
    },
    safety: ToolSafety.ReadOnly,
    execute: async (params: ListAuditLogParams, _context: ToolContext): Promise<string> => {
      const queryOptions: {
        action?: AuditActionType;
        agentId?: string;
        status?: 'success' | 'failed' | 'denied';
        startTime?: number;
        endTime?: number;
        limit?: number;
        keyword?: string;
      } = {
        ...params,
        limit: Math.min(params.limit ?? 20, 100),
      };

      const entries = auditLog.query(queryOptions);

      if (entries.length === 0) {
        return '未找到符合条件的审计日志记录。';
      }

      const lines = entries.map((e) => {
        const time = new Date(e.timestamp).toLocaleString();
        const statusIcon = e.status === 'success' ? '✅' : e.status === 'denied' ? '🚫' : '❌';
        const agent = e.parentAgentId ? `${e.agentId}(子)` : e.agentId;
        return `${time} ${statusIcon} [${e.action}] ${agent} - ${e.description}`;
      });

      return `审计日志查询结果（共 ${entries.length} 条）：\n\n${lines.join('\n')}`;
    },
  };
}