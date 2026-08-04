/**
 * create_skill 工具 - 创建自定义技能
 *
 * 安全级别：Edit（创建类操作，需权限确认）
 */

import { ToolDef, ToolSafety, ToolContext } from '../ToolProtocol';
import { SkillStore } from '../../skill/SkillStore';

interface CreateSkillParams {
  /** 技能名称（唯一标识） */
  name: string;
  /** 技能描述 */
  description: string;
  /** 技能代码（JavaScript 函数体，接收 params 参数） */
  code: string;
}

/**
 * 创建 create_skill 工具
 * @param store 技能存储实例
 */
export function createCreateSkillTool(store: SkillStore): ToolDef<CreateSkillParams, string> {
  return {
    name: 'create_skill',
    description:
      '创建自定义技能。技能是一段可复用的 JavaScript 代码，可以被 Agent 反复调用执行。' +
      '适合场景：封装常用操作、自动化流程、复杂任务编排等。' +
      '代码格式：接收一个 params 对象参数，可以访问 console 和 require（仅限安全模块）。',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '技能名称（唯一标识，建议使用英文/数字/下划线）',
        },
        description: {
          type: 'string',
          description: '技能描述（用途说明、参数说明、返回值说明）',
        },
        code: {
          type: 'string',
          description:
            '技能代码（JavaScript 函数体）。例如：return params.x + params.y;',
        },
      },
      required: ['name', 'description', 'code'],
    },
    safety: ToolSafety.Edit,
    execute: async (params: CreateSkillParams, _context: ToolContext): Promise<string> => {
      const { name, description, code } = params;

      if (!name || name.trim().length === 0) {
        return '❌ 技能名称不能为空';
      }
      if (!code || code.trim().length === 0) {
        return '❌ 技能代码不能为空';
      }

      try {
        const skill = store.create(name.trim(), description.trim(), code.trim());
        return `✅ 技能创建成功（id: ${skill.id}，名称: ${name}，版本: v${skill.version}）。使用 execute_skill 调用此技能。`;
      } catch (e) {
        return `❌ 创建技能失败: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  };
}