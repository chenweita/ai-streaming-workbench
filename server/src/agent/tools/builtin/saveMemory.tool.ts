/**
 * save_memory 工具 - 保存长期记忆
 * 将重要信息持久化存储，跨会话保留
 *
 * 安全级别：Edit（写入类操作，需权限确认）
 * 使用场景：用户明确要求记住某信息（如偏好、约定、项目规范等）
 *
 * 存储路由：
 * - user_preference → 全局记忆（跨项目保留）
 * - 其他分类 → 项目记忆（绑定当前项目）
 */

import { ToolDef, ToolSafety, ToolContext } from '../ToolProtocol';
import { CompositeMemoryStore } from '../../memory/CompositeMemoryStore';
import { MemoryCategory } from '../../memory/MemoryStore';

interface SaveMemoryParams {
  /** 要保存的记忆内容 */
  content: string;
  /** 记忆分类标签 */
  category?: MemoryCategory;
}

/**
 * 创建 save_memory 工具
 * @param store 组合记忆存储实例
 */
export function createSaveMemoryTool(store: CompositeMemoryStore): ToolDef<SaveMemoryParams, string> {
  return {
    name: 'save_memory',
    description:
      '将重要信息保存到长期记忆中，跨会话保留。当用户要求"记住"、"记下来"、"保存这个信息"等时使用。' +
      '适合保存：用户偏好、项目规范、重要约定、个人信息等。' +
      '注意：用户偏好类信息会存入全局记忆（跨项目保留），项目相关信息存入项目记忆。',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '要保存的记忆内容，应该是有意义的信息片段',
        },
        category: {
          type: 'string',
          description:
            '记忆分类：user_preference（用户偏好，全局保存）/ project_info（项目信息）/ convention（约定规范）/ general（通用）。默认为 general',
          enum: ['user_preference', 'project_info', 'convention', 'general'],
        },
      },
      required: ['content'],
    },
    safety: ToolSafety.Edit,
    execute: async (params: SaveMemoryParams, _context: ToolContext): Promise<string> => {
      const { content, category = 'general' } = params;
      if (!content || content.trim().length === 0) {
        return '❌ 记忆内容不能为空';
      }
      const entry = store.add(content.trim(), category);
      const scope = category === 'user_preference' ? '全局记忆' : '项目记忆';
      return `✅ 记忆已保存到${scope}（id: ${entry.id}，分类: ${category}）。该信息将在后续对话中自动注入上下文。`;
    },
  };
}