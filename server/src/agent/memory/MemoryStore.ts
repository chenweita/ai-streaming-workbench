/**
 * 长期记忆存储
 * 对标 BearCode Memory 设计中的持久化记忆层
 *
 * 存储策略：
 *   1. 全局记忆（user_profile.md）：存储用户固定偏好、个人信息
 *      路径：~/.trae-cn/memory/user_profile.md
 *   2. 项目记忆（project_memory.md）：存储项目绑定的信息、约定
 *      路径：~/.trae-cn/memory/projects/{项目绝对路径}/project_memory.md
 *
 * 隔离策略：
 *   - 记忆文件存储在用户主目录，不进入项目仓库
 *   - 短期上下文与长期记忆完全隔离
 *   - ContextManager 裁剪只作用短期上下文，不影响持久化记忆
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/** 记忆分类枚举 */
export type MemoryCategory = 'user_preference' | 'project_info' | 'convention' | 'general';

/** 记忆条目 */
export interface MemoryEntry {
  /** 唯一标识 */
  id: string;
  /** 记忆内容 */
  content: string;
  /** 分类标签 */
  category: MemoryCategory;
  /** 创建时间戳（毫秒） */
  createdAt: number;
  /** 更新时间戳（毫秒） */
  updatedAt: number;
}

/** 记忆存储配置 */
export interface MemoryStoreConfig {
  /** 存储类型：global（用户级）/ project（项目级） */
  scope: 'global' | 'project';
  /** 项目根目录绝对路径（仅 project 类型使用） */
  projectPath?: string;
  /** 注入 system prompt 的最大 token 数上限 */
  maxMemoryTokens: number;
}

/** 默认全局记忆路径 */
function getGlobalMemoryDir(): string {
  return path.join(os.homedir(), '.trae-cn', 'memory');
}

/** 默认项目记忆路径 */
function getProjectMemoryDir(projectPath: string): string {
  // 将项目绝对路径转换为安全的目录名
  const safeName = projectPath.replace(/[\\/:*?"<>|]/g, '_');
  return path.join(os.homedir(), '.trae-cn', 'memory', 'projects', safeName);
}

/** 解析记忆文件路径 */
function resolveMemoryFilePath(config: MemoryStoreConfig): string {
  if (config.scope === 'global') {
    return path.join(getGlobalMemoryDir(), 'user_profile.md');
  }
  return path.join(getProjectMemoryDir(config.projectPath ?? ''), 'project_memory.md');
}

/** 生成 UUID v4（兼容旧 Node 版本） */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 解析 Markdown 文件为记忆条目 */
function parseMarkdown(md: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const lines = md.split('\n');
  let currentEntry: Partial<MemoryEntry> | null = null;
  let collectingContent = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 跳过文件头的 # 标题行
    if (i === 0 && line.startsWith('# ')) continue;
    // 跳过空行
    if (line.trim() === '') continue;

    // 新条目开始：## [category]
    const headerMatch = line.match(/^## \[([^\]]+)\]/);
    if (headerMatch) {
      if (currentEntry && currentEntry.content) {
        entries.push(currentEntry as MemoryEntry);
      }
      currentEntry = {
        id: generateId(),
        category: headerMatch[1] as MemoryCategory,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      collectingContent = true;
      continue;
    }

    // 元数据行：> id: xxx | created: xxx | updated: xxx
    if (line.startsWith('> ')) {
      const metaMatch = line.match(/id:\s*([\w-]+).*created:\s*(\d+).*updated:\s*(\d+)/);
      if (metaMatch && currentEntry) {
        currentEntry.id = metaMatch[1];
        currentEntry.createdAt = parseInt(metaMatch[2], 10);
        currentEntry.updatedAt = parseInt(metaMatch[3], 10);
      }
      collectingContent = false;
      continue;
    }

    // 内容行
    if (currentEntry && collectingContent) {
      if (!currentEntry.content) {
        currentEntry.content = '';
      }
      currentEntry.content += (currentEntry.content ? '\n' : '') + line.trim();
    }
  }

  // 最后一条
  if (currentEntry && currentEntry.content) {
    entries.push(currentEntry as MemoryEntry);
  }

  return entries;
}

/** 序列化记忆条目为 Markdown */
function serializeMarkdown(entries: MemoryEntry[], scope: 'global' | 'project'): string {
  const title = scope === 'global' ? '用户全局记忆 (user_profile)' : '项目记忆 (project_memory)';
  const lines: string[] = [`# ${title}`, ''];

  for (const entry of entries) {
    lines.push(`## [${entry.category}]`);
    lines.push('');
    lines.push(entry.content);
    lines.push('');
    lines.push(`> id: ${entry.id} | created: ${entry.createdAt} | updated: ${entry.updatedAt}`);
    lines.push('');
  }

  return lines.join('\n');
}

/** 默认全局配置 */
export const DEFAULT_GLOBAL_MEMORY_CONFIG: Readonly<MemoryStoreConfig> = Object.freeze({
  scope: 'global',
  maxMemoryTokens: 2000,
});

/** 默认项目配置 */
export const DEFAULT_PROJECT_MEMORY_CONFIG: Readonly<MemoryStoreConfig> = Object.freeze({
  scope: 'project',
  maxMemoryTokens: 2000,
});

/** 记忆存储类（Markdown 文件格式） */
export class MemoryStore {
  private readonly filePath: string;
  private readonly scope: 'global' | 'project';
  private readonly maxMemoryTokens: number;
  private memories: Map<string, MemoryEntry> = new Map();

  constructor(config: MemoryStoreConfig) {
    this.scope = config.scope;
    this.maxMemoryTokens = config.maxMemoryTokens;
    this.filePath = resolveMemoryFilePath(config);
    this.load();
  }

  /** 从 Markdown 文件加载记忆 */
  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const entries = parseMarkdown(raw);
        for (const entry of entries) {
          this.memories.set(entry.id, entry);
        }
        console.log(`[MemoryStore] 加载 ${entries.length} 条记忆 from ${this.filePath}`);
      } else {
        console.log(`[MemoryStore] 记忆文件不存在，初始化: ${this.filePath}`);
        this.save();
      }
    } catch (err) {
      console.error(`[MemoryStore] 加载记忆失败:`, err instanceof Error ? err.message : String(err));
    }
  }

  /** 原子写入 Markdown 文件 */
  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const entries = this.getAll();
      const raw = serializeMarkdown(entries, this.scope);
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, raw, 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error(`[MemoryStore] 保存记忆失败:`, err instanceof Error ? err.message : String(err));
    }
  }

  /** 添加记忆 */
  add(content: string, category: MemoryCategory = 'general'): MemoryEntry {
    const now = Date.now();
    // 检查是否已存在相同内容（去重）
    const existing = this.getAll().find(
      (m) => m.content === content && m.category === category
    );
    if (existing) {
      existing.updatedAt = now;
      this.memories.set(existing.id, existing);
      this.save();
      console.log(`[MemoryStore] 更新记忆: id=${existing.id}`);
      return existing;
    }

    const entry: MemoryEntry = {
      id: generateId(),
      content,
      category,
      createdAt: now,
      updatedAt: now,
    };
    this.memories.set(entry.id, entry);
    this.save();
    console.log(`[MemoryStore] 新增记忆: id=${entry.id}, category=${category}`);
    return entry;
  }

  /** 删除指定记忆 */
  remove(id: string): boolean {
    if (!this.memories.has(id)) {
      return false;
    }
    this.memories.delete(id);
    this.save();
    console.log(`[MemoryStore] 删除记忆: id=${id}`);
    return true;
  }

  /** 按关键词搜索 */
  search(keyword: string): MemoryEntry[] {
    const lower = keyword.toLowerCase();
    return this.getAll().filter(
      (m) =>
        m.content.toLowerCase().includes(lower) ||
        m.category.toLowerCase().includes(lower)
    );
  }

  /** 获取所有记忆（按更新时间倒序） */
  getAll(): MemoryEntry[] {
    return Array.from(this.memories.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 按分类获取 */
  getByCategory(category: MemoryCategory): MemoryEntry[] {
    return this.getAll().filter((m) => m.category === category);
  }

  /** 获取记忆数量 */
  size(): number {
    return this.memories.size;
  }

  /**
   * 生成记忆摘要文本（注入 system prompt 用）
   * 格式：【长期记忆】\n- [category] content
   */
  buildMemorySummary(): string {
    const all = this.getAll();
    if (all.length === 0) {
      return '';
    }

    const scopeLabel = this.scope === 'global' ? '全局记忆' : '项目记忆';
    const lines: string[] = [`【${scopeLabel}】`];
    let totalTokens = 0;

    for (const entry of all) {
      const entryText = `- [${entry.category}] ${entry.content}`;
      const estimatedTokens = Math.ceil(entryText.length / 2);
      if (totalTokens + estimatedTokens > this.maxMemoryTokens) {
        console.log(
          `[MemoryStore] 记忆摘要截断: ${all.length} 条 → ${lines.length - 1} 条 (tokens 上限 ${this.maxMemoryTokens})`
        );
        break;
      }
      lines.push(entryText);
      totalTokens += estimatedTokens;
    }

    const summary = lines.join('\n');
    console.log(`[MemoryStore] 生成记忆摘要: ${lines.length - 1} 条, 约 ${totalTokens} tokens`);
    return summary;
  }

  /** 获取存储文件路径 */
  getFilePath(): string {
    return this.filePath;
  }
}