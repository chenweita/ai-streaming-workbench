/**
 * execute_skill 工具 - 执行已创建的技能
 *
 * 安全级别：Edit（执行用户定义代码，需权限确认）
 */

import { ToolDef, ToolSafety, ToolContext } from '../ToolProtocol';
import { SkillStore } from '../../skill/SkillStore';

interface ExecuteSkillParams {
  /** 技能名称或 ID */
  skillNameOrId: string;
  /** 传递给技能的参数 */
  params?: Record<string, unknown>;
}

/**
 * 创建 execute_skill 工具
 * @param store 技能存储实例
 */
export function createExecuteSkillTool(store: SkillStore): ToolDef<ExecuteSkillParams, string> {
  return {
    name: 'execute_skill',
    description:
      '执行已创建的自定义技能。传入技能名称或 ID，以及需要的参数。' +
      '技能将在沙箱环境中执行，结果以字符串形式返回。',
    parameters: {
      type: 'object',
      properties: {
        skillNameOrId: {
          type: 'string',
          description: '要执行的技能名称或 ID',
        },
        params: {
          type: 'object',
          description: '传递给技能的参数对象（可选）',
        },
      },
      required: ['skillNameOrId'],
    },
    safety: ToolSafety.Edit,
    execute: async (params: ExecuteSkillParams, _context: ToolContext): Promise<string> => {
      const { skillNameOrId, params: skillParams = {} } = params;

      if (!skillNameOrId || skillNameOrId.trim().length === 0) {
        return '❌ 技能名称或 ID 不能为空';
      }

      const skill = store.get(skillNameOrId.trim());
      if (!skill) {
        return `❌ 技能不存在: ${skillNameOrId}。使用 list_skills 查看已创建的技能。`;
      }

      const result = store.execute(skill, skillParams);
      if (result.ok) {
        const output =
          typeof result.result === 'object'
            ? JSON.stringify(result.result, null, 2)
            : String(result.result);
        return `✅ 技能 ${skill.name} (v${skill.version}) 执行结果：\n${output}`;
      }
      return `❌ 技能 ${skill.name} 执行失败: ${result.error}`;
    },
  };
}