/**
 * 工具注册表
 * 对标 BearCode 工具注册中心（轻量化 TS 重构）
 *
 * 核心职责：
 *   1. 注册工具（按 name 索引）
 *   2. 按名查找工具定义
 *   3. 批量导出 OpenAI tools 字段格式
 *   4. 区分只读工具集（用于并发执行优化）
 *
 * 设计原则：
 *   - 注册表为运行时单例，AgentLoop 启动时一次性装配
 *   - 查找为 O(1)，避免遍历开销
 *   - 未找到工具时返回 undefined，由 Executor 决定如何处理
 *   - 内部存储用宽松契约类型 RegisteredToolDef，注册时安全断言
 */

import {
  ToolDef,
  OpenAIToolFunction,
  toOpenAITool,
  ToolSafety,
} from './ToolProtocol';
import { listFilesTool } from './builtin/listFiles.tool';
import { readFileTool } from './builtin/readFile.tool';
import { grepSearchTool } from './builtin/grepSearch.tool';
import { writeFileTool } from './builtin/writeFile.tool';
import { editFileTool } from './builtin/editFile.tool';
import { createSaveMemoryTool } from './builtin/saveMemory.tool';
import { createDeleteMemoryTool } from './builtin/deleteMemory.tool';
import { createCreateSkillTool } from './builtin/createSkill.tool';
import { createListSkillsTool } from './builtin/listSkills.tool';
import { createExecuteSkillTool } from './builtin/executeSkill.tool';
import { createEvolveSkillTool } from './builtin/evolveSkill.tool';
import { createSpawnSubAgentTool } from './builtin/spawnSubAgent.tool';
import { createListAuditLogTool } from './builtin/listAuditLog.tool';
import { CompositeMemoryStore } from '../memory/CompositeMemoryStore';
import { SkillStore } from '../skill/SkillStore';
import { SubAgentRunner } from '../subagent/SubAgentRunner';
import { AuditLog } from '../audit/AuditLog';

/**
 * 注册表内部存储的工具契约类型
 *
 * 工具定义时 TParams 为具体接口（如 ReadFileParams），
 * 但注册表需统一存储，故用 Record<string, unknown> 作为参数契约。
 * 具体工具注册时通过 as 断言转换，运行时由 Executor 传参。
 */
type RegisteredToolDef = ToolDef<Record<string, unknown>, string>;

/**
 * 工具注册表
 * 管理所有已注册的工具定义
 */
export class ToolRegistry {
  /** 工具映射表：name -> ToolDef */
  private readonly tools = new Map<string, RegisteredToolDef>();

  /**
   * 注册单个工具
   * @param tool 工具定义（具体泛型类型，内部断言为注册表契约）
   * @throws Error 工具名重复时抛出
   */
  register(tool: ToolDef<Record<string, unknown>, string>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 "${tool.name}" 已注册，禁止重复注册`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 批量注册工具
   * @param tools 工具定义数组
   */
  registerAll(tools: Array<ToolDef<Record<string, unknown>, string>>): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 按名查找工具
   * @param name 工具名
   * @returns 工具定义，未找到返回 undefined
   */
  get(name: string): RegisteredToolDef | undefined {
    return this.tools.get(name);
  }

  /**
   * 判断工具是否已注册
   * @param name 工具名
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取所有已注册工具列表
   */
  list(): RegisteredToolDef[] {
    return Array.from(this.tools.values());
  }

  /**
   * 导出所有工具为 OpenAI tools 字段格式
   * 供 LLMClient 构建请求体使用
   */
  toOpenAITools(): OpenAIToolFunction[] {
    return this.list().map(toOpenAITool);
  }

  /**
   * 获取所有只读工具名集合
   * 用于 AgentLoop 决定是否可并发执行
   */
  getReadOnlyToolNames(): Set<string> {
    const result = new Set<string>();
    for (const tool of this.tools.values()) {
      if (tool.safety === ToolSafety.ReadOnly) {
        result.add(tool.name);
      }
    }
    return result;
  }

  /**
   * 获取工具数量
   */
  size(): number {
    return this.tools.size;
  }
}

/**
 * 创建默认工具注册表（预装内置工具）
 * @param memoryStore 组合记忆存储实例（可选，用于创建记忆工具）
 * @param skillStore 技能存储实例（可选，用于创建技能工具）
 * @param subAgentRunner 子 Agent 调度器（可选，用于创建子 Agent 工具）
 * @param auditLog 审计日志实例（可选，用于创建审计工具）
 */
export function createDefaultRegistry(
  memoryStore?: CompositeMemoryStore,
  skillStore?: SkillStore,
  subAgentRunner?: SubAgentRunner,
  auditLog?: AuditLog
): ToolRegistry {
  const registry = new ToolRegistry();
  // 具体工具的 TParams 为具体接口，注册表统一存储为 Record<string, unknown>
  // 此处断言是安全的：Executor 运行时传入的 params 来自 JSON.parse，本身就是 Record
  const tools: Array<ToolDef<Record<string, unknown>, string>> = [
    listFilesTool as unknown as ToolDef<Record<string, unknown>, string>,
    readFileTool as unknown as ToolDef<Record<string, unknown>, string>,
    grepSearchTool as unknown as ToolDef<Record<string, unknown>, string>,
    writeFileTool as unknown as ToolDef<Record<string, unknown>, string>,
    editFileTool as unknown as ToolDef<Record<string, unknown>, string>,
  ];

  // 如果注入了记忆存储，注册记忆工具
  if (memoryStore) {
    tools.push(
      createSaveMemoryTool(memoryStore) as unknown as ToolDef<Record<string, unknown>, string>,
      createDeleteMemoryTool(memoryStore) as unknown as ToolDef<Record<string, unknown>, string>
    );
  }

  // 如果注入了技能存储，注册技能工具
  if (skillStore) {
    tools.push(
      createCreateSkillTool(skillStore) as unknown as ToolDef<Record<string, unknown>, string>,
      createListSkillsTool(skillStore) as unknown as ToolDef<Record<string, unknown>, string>,
      createExecuteSkillTool(skillStore) as unknown as ToolDef<Record<string, unknown>, string>,
      createEvolveSkillTool(skillStore) as unknown as ToolDef<Record<string, unknown>, string>
    );
  }

  // 如果注入了子 Agent 调度器，注册子 Agent 工具
  if (subAgentRunner) {
    tools.push(
      createSpawnSubAgentTool(subAgentRunner) as unknown as ToolDef<Record<string, unknown>, string>
    );
  }

  // 如果注入了审计日志，注册审计查询工具
  if (auditLog) {
    tools.push(
      createListAuditLogTool(auditLog) as unknown as ToolDef<Record<string, unknown>, string>
    );
  }

  registry.registerAll(tools);
  return registry;
}
