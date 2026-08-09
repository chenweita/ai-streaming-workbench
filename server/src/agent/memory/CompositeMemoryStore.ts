/**
 * 组合记忆存储
 * 根据记忆分类自动路由到全局/项目存储
 *
 * 路由规则：
 * - user_preference → 全局记忆（user_profile.md）
 * - project_info / convention / general → 项目记忆（project_memory.md）
 */

import { MemoryStore, MemoryCategory, MemoryEntry } from './MemoryStore';

export class CompositeMemoryStore {
  constructor(
    private readonly globalStore: MemoryStore,
    private readonly projectStore: MemoryStore
  ) {}

  /**
   * 根据分类选择存储
   * user_preference → 全局，其他 → 项目
   */
  private selectStore(category: MemoryCategory): MemoryStore {
    return category === 'user_preference' ? this.globalStore : this.projectStore;
  }

  /** 添加记忆（自动路由） */
  add(content: string, category: MemoryCategory = 'general'): MemoryEntry {
    return this.selectStore(category).add(content, category);
  }

  /** 删除记忆（在两个存储中查找） */
  remove(id: string): boolean {
    return this.globalStore.remove(id) || this.projectStore.remove(id);
  }

  /** 搜索记忆（跨两个存储） */
  search(keyword: string): MemoryEntry[] {
    return [...this.globalStore.search(keyword), ...this.projectStore.search(keyword)];
  }

  /** 获取所有记忆（合并两个存储） */
  getAll(): MemoryEntry[] {
    return [...this.globalStore.getAll(), ...this.projectStore.getAll()];
  }

  /** 记忆总数 */
  size(): number {
    return this.globalStore.size() + this.projectStore.size();
  }

  /** 获取全局存储 */
  getGlobalStore(): MemoryStore {
    return this.globalStore;
  }

  /** 获取项目存储 */
  getProjectStore(): MemoryStore {
    return this.projectStore;
  }
}