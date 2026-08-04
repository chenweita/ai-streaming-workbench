/**
 * list_skills 工具 - 列出所有已创建的技能
 *
 * 安全级别：ReadOnly（查询类操作，自动放行）
 */

import { ToolDef, ToolSafety, ToolContext } from '../ToolProtocol';
import { SkillStore } from '../../skill/SkillStore';

interface ListSkillsParams {
  /** 可选：过滤关键词 */
  keyword?: string;
}

/**
 * 创建 list_skills 工具
 * @param store 技能存储实例
 */
export function createListSkillsTool(store: SkillStore): ToolDef<ListSkillsParams, string> {
  return {
    name: 'list_skills',
    description: '列出所有已创建的自定义技能。可选按关键词过滤。',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '过滤关键词（可选，匹配名称或描述）',
        },
      },
    },
    safety: ToolSafety.ReadOnly,
    execute: async (params: ListSkillsParams, _context: ToolContext): Promise<string> => {
      const { keyword } = params;
      let skills = store.list();

      if (keyword && keyword.trim().length > 0) {
        const lower = keyword.toLowerCase();
        skills = skills.filter(
          (s) =>
            s.name.toLowerCase().includes(lower) ||
            s.description.toLowerCase().includes(lower)
        );
      }

      if (skills.length === 0) {
        return '暂无已创建的技能。使用 create_skill 创建新技能。';
      }

      const lines = skills.map(
        (s) =>
          `- ${s.name} (v${s.version}): ${s.description.substring(0, 100)}${s.description.length > 100 ? '...' : ''}`
      );
      return `已创建 ${skills.length} 个技能：\n${lines.join('\n')}`;
    },
  };
}