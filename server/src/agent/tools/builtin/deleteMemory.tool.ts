/**
 * delete_memory 工具 - 删除长期记忆
 * 按记忆 ID 或关键词删除指定记忆
 *
 * 安全级别：Edit（删除类操作，需权限确认）
 */

import { ToolDef, ToolSafety, ToolContext } from '../ToolProtocol';
import { CompositeMemoryStore } from '../../memory/CompositeMemoryStore';

interface DeleteMemoryParams {
  /** 要删除的记忆 ID（精确删除） */
  memoryId?: string;
  /** 关键词（删除匹配的所有记忆） */
  keyword?: string;
}

/**
 * 创建 delete_memory 工具
 * @param store 组合记忆存储实例
 */
export function createDeleteMemoryTool(store: CompositeMemoryStore): ToolDef<DeleteMemoryParams, string> {
  return {
    name: 'delete_memory',
    description:
      '删除长期记忆。可按记忆 ID 精确删除，或按关键词批量删除。当用户要求"忘记"、"删除"某条记忆时使用。',
    parameters: {
      type: 'object',
      properties: {
        memoryId: {
          type: 'string',
          description: '要删除的记忆 ID（精确匹配删除）',
        },
        keyword: {
          type: 'string',
          description: '关键词（删除内容包含该关键词的所有记忆）',
        },
      },
    },
    safety: ToolSafety.Edit,
    execute: async (params: DeleteMemoryParams, _context: ToolContext): Promise<string> => {
      const { memoryId, keyword } = params;

      if (memoryId) {
        const ok = store.remove(memoryId);
        if (ok) {
          return `✅ 记忆已删除（id: ${memoryId}）`;
        }
        return `❌ 未找到记忆 id: ${memoryId}`;
      }

      if (keyword) {
        const matches = store.search(keyword);
        if (matches.length === 0) {
          return `未找到包含 "${keyword}" 的记忆`;
        }
        const deleted: string[] = [];
        for (const m of matches) {
          store.remove(m.id);
          deleted.push(m.id);
        }
        return `✅ 已删除 ${deleted.length} 条包含 "${keyword}" 的记忆: ${deleted.join(', ')}`;
      }

      return '❌ 请提供 memoryId 或 keyword 参数';
    },
  };
}