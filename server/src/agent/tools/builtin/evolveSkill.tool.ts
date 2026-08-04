/**
 * evolve_skill 工具 - 技能进化（生成新版本）
 *
 * 安全级别：Edit（修改类操作，需权限确认）
 */

import { ToolDef, ToolSafety, ToolContext } from '../ToolProtocol';
import { SkillStore } from '../../skill/SkillStore';

interface EvolveSkillParams {
  /** 要进化的技能名称或 ID */
  skillNameOrId: string;
  /** 新版本的代码 */
  newCode: string;
  /** 变更描述 */
  changeDescription: string;
}

/**
 * 创建 evolve_skill 工具
 * @param store 技能存储实例
 */
export function createEvolveSkillTool(store: SkillStore): ToolDef<EvolveSkillParams, string> {
  return {
    name: 'evolve_skill',
    description:
      '技能进化：基于现有技能逻辑优化，生成新版本。' +
      '适合场景：修复 bug、优化性能、增加功能、调整逻辑等。' +
      '每次进化都会记录变更历史，方便追溯。',
    parameters: {
      type: 'object',
      properties: {
        skillNameOrId: {
          type: 'string',
          description: '要进化的技能名称或 ID',
        },
        newCode: {
          type: 'string',
          description: '新版本的技能代码',
        },
        changeDescription: {
          type: 'string',
          description: '本次变更的描述（如：修复了 xxx bug、新增了 xxx 功能）',
        },
      },
      required: ['skillNameOrId', 'newCode', 'changeDescription'],
    },
    safety: ToolSafety.Edit,
    execute: async (params: EvolveSkillParams, _context: ToolContext): Promise<string> => {
      const { skillNameOrId, newCode, changeDescription } = params;

      if (!skillNameOrId || skillNameOrId.trim().length === 0) {
        return '❌ 技能名称或 ID 不能为空';
      }
      if (!newCode || newCode.trim().length === 0) {
        return '❌ 新代码不能为空';
      }
      if (!changeDescription || changeDescription.trim().length === 0) {
        return '❌ 变更描述不能为空';
      }

      const skill = store.get(skillNameOrId.trim());
      if (!skill) {
        return `❌ 技能不存在: ${skillNameOrId}`;
      }

      try {
        const updated = store.evolve(skill.id, newCode.trim(), changeDescription.trim());
        return `✅ 技能 ${skill.name} 进化成功：v${skill.version} → v${updated.version}。变更：${changeDescription}`;
      } catch (e) {
        return `❌ 技能进化失败: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  };
}