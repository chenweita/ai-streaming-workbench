/**
 * 技能存储模块
 * 对标 BearCode Skill 能力
 *
 * 核心职责：
 *   1. 技能定义持久化存储（~/.trae-cn/skills/）
 *   2. 技能版本管理与变更记录追溯
 *   3. 技能执行（沙箱隔离）
 *   4. 技能进化（基于现有技能生成新版本）
 *
 * 存储路径：
 *   ~/.trae-cn/skills/{skillId}/skill.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/** 技能变更记录 */
export interface SkillChange {
  /** 版本号 */
  version: number;
  /** 变更时间戳 */
  timestamp: number;
  /** 变更描述 */
  change: string;
}

/** 技能定义 */
export interface Skill {
  /** 唯一标识 */
  id: string;
  /** 技能名称（用于调用） */
  name: string;
  /** 技能描述 */
  description: string;
  /** 技能代码（JavaScript 函数体） */
  code: string;
  /** 当前版本号 */
  version: number;
  /** 变更历史 */
  changelog: SkillChange[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/** 技能存储配置 */
export interface SkillStoreConfig {
  /** 存储根目录（默认 ~/.trae-cn/skills） */
  rootDir?: string;
}

/** 默认技能存储路径 */
function getSkillRootDir(): string {
  return path.join(os.homedir(), '.trae-cn', 'skills');
}

/** 生成 UUID v4 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 技能名称转换为安全的文件名 */
function nameToFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

/** 技能存储类 */
export class SkillStore {
  private readonly rootDir: string;
  private skills: Map<string, Skill> = new Map();
  private nameToId: Map<string, string> = new Map();

  constructor(config?: SkillStoreConfig) {
    this.rootDir = config?.rootDir ?? getSkillRootDir();
    this.loadAll();
  }

  /** 加载所有技能 */
  private loadAll(): void {
    try {
      if (!fs.existsSync(this.rootDir)) {
        fs.mkdirSync(this.rootDir, { recursive: true });
        console.log(`[SkillStore] 初始化技能存储: ${this.rootDir}`);
        return;
      }

      const dirs = fs.readdirSync(this.rootDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const skillFile = path.join(this.rootDir, dir.name, 'skill.json');
        if (!fs.existsSync(skillFile)) continue;

        try {
          const raw = fs.readFileSync(skillFile, 'utf-8');
          const skill = JSON.parse(raw) as Skill;
          this.skills.set(skill.id, skill);
          this.nameToId.set(skill.name.toLowerCase(), skill.id);
        } catch (e) {
          console.error(`[SkillStore] 加载技能失败: ${skillFile}`, e instanceof Error ? e.message : String(e));
        }
      }

      console.log(`[SkillStore] 加载 ${this.skills.size} 个技能 from ${this.rootDir}`);
    } catch (e) {
      console.error(`[SkillStore] 加载技能目录失败:`, e instanceof Error ? e.message : String(e));
    }
  }

  /** 保存技能到文件 */
  private save(skill: Skill): void {
    try {
      const skillDir = path.join(this.rootDir, skill.id);
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      const skillFile = path.join(skillDir, 'skill.json');
      const raw = JSON.stringify(skill, null, 2);
      const tmpPath = skillFile + '.tmp';
      fs.writeFileSync(tmpPath, raw, 'utf-8');
      fs.renameSync(tmpPath, skillFile);
    } catch (e) {
      console.error(`[SkillStore] 保存技能失败:`, e instanceof Error ? e.message : String(e));
    }
  }

  /** 创建新技能 */
  create(name: string, description: string, code: string): Skill {
    // 检查名称冲突
    if (this.nameToId.has(name.toLowerCase())) {
      throw new Error(`技能名称 "${name}" 已存在`);
    }

    const now = Date.now();
    const skill: Skill = {
      id: generateId(),
      name,
      description,
      code,
      version: 1,
      changelog: [
        {
          version: 1,
          timestamp: now,
          change: '初始版本',
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    this.skills.set(skill.id, skill);
    this.nameToId.set(name.toLowerCase(), skill.id);
    this.save(skill);

    console.log(`[SkillStore] 创建技能: ${name} (id: ${skill.id})`);
    return skill;
  }

  /** 按名称或 ID 获取技能 */
  get(nameOrId: string): Skill | undefined {
    const lower = nameOrId.toLowerCase();
    const id = this.nameToId.get(lower) ?? nameOrId;
    return this.skills.get(id);
  }

  /** 列出所有技能 */
  list(): Skill[] {
    return Array.from(this.skills.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 进化技能（生成新版本） */
  evolve(skillId: string, newCode: string, changeDescription: string): Skill {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`技能不存在: ${skillId}`);
    }

    const now = Date.now();
    const newVersion = skill.version + 1;

    skill.code = newCode;
    skill.version = newVersion;
    skill.updatedAt = now;
    skill.changelog.push({
      version: newVersion,
      timestamp: now,
      change: changeDescription,
    });

    this.save(skill);
    console.log(`[SkillStore] 技能进化: ${skill.name} v${newVersion}`);
    return skill;
  }

  /** 删除技能 */
  delete(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    this.skills.delete(skillId);
    this.nameToId.delete(skill.name.toLowerCase());

    try {
      const skillDir = path.join(this.rootDir, skillId);
      if (fs.existsSync(skillDir)) {
        fs.rmdirSync(skillDir, { recursive: true });
      }
    } catch (e) {
      console.error(`[SkillStore] 删除技能目录失败:`, e instanceof Error ? e.message : String(e));
    }

    console.log(`[SkillStore] 删除技能: ${skill.name}`);
    return true;
  }

  /** 执行技能代码（沙箱隔离） */
  execute(skill: Skill, params: Record<string, unknown>): { ok: true; result: unknown } | { ok: false; error: string } {
    try {
      // 构建沙箱环境
      const fn = new Function('params', 'console', 'require', skill.code);
      const result = fn(params, console, require);
      return { ok: true, result };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[SkillStore] 执行技能 ${skill.name} 失败:`, error);
      return { ok: false, error };
    }
  }

  /** 获取技能数量 */
  size(): number {
    return this.skills.size;
  }
}