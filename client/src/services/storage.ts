/**
 * 本地存储服务
 * - 封装LocalStorage操作
 * - 会话持久化
 * - 应用设置持久化
 */
import { Conversation, AppSettings } from '../types';

/** 存储键名常量 */
const STORAGE_KEYS = {
  CONVERSATIONS: 'ai_chat_conversations',
  CURRENT_CONVERSATION_ID: 'ai_chat_current_conversation_id',
  SETTINGS: 'ai_chat_settings',
  VERSION: 'ai_chat_storage_version',
} as const;

/** 存储版本号，用于数据迁移 */
const STORAGE_VERSION = '1.0.0';

/**
 * 检查LocalStorage是否可用
 */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * 安全的JSON解析
 */
function safeJSONParse<T>(value: string | null, defaultValue: T): T {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    console.error('JSON解析失败:', value);
    return defaultValue;
  }
}

/**
 * 会话存储服务
 */
export const storageService = {
  /**
   * 获取所有会话
   */
  getConversations(): Conversation[] {
    if (!isLocalStorageAvailable()) return [];
    return safeJSONParse<Conversation[]>(
      localStorage.getItem(STORAGE_KEYS.CONVERSATIONS),
      []
    );
  },

  /**
   * 保存所有会话
   */
  saveConversations(conversations: Conversation[]): void {
    if (!isLocalStorageAvailable()) return;
    localStorage.setItem(
      STORAGE_KEYS.CONVERSATIONS,
      JSON.stringify(conversations)
    );
  },

  /**
   * 获取单个会话
   */
  getConversation(id: string): Conversation | undefined {
    const conversations = this.getConversations();
    return conversations.find((conv) => conv.id === id);
  },

  /**
   * 保存单个会话
   */
  saveConversation(conversation: Conversation): void {
    const conversations = this.getConversations();
    const index = conversations.findIndex((conv) => conv.id === conversation.id);

    if (index >= 0) {
      conversations[index] = conversation;
    } else {
      conversations.push(conversation);
    }

    this.saveConversations(conversations);
  },

  /**
   * 删除会话
   */
  deleteConversation(id: string): void {
    const conversations = this.getConversations();
    const filtered = conversations.filter((conv) => conv.id !== id);
    this.saveConversations(filtered);
  },

  /**
   * 清空所有会话
   */
  clearAllConversations(): void {
    if (!isLocalStorageAvailable()) return;
    localStorage.removeItem(STORAGE_KEYS.CONVERSATIONS);
    localStorage.removeItem(STORAGE_KEYS.CURRENT_CONVERSATION_ID);
  },

  /**
   * 获取当前会话ID
   */
  getCurrentConversationId(): string | null {
    if (!isLocalStorageAvailable()) return null;
    return localStorage.getItem(STORAGE_KEYS.CURRENT_CONVERSATION_ID);
  },

  /**
   * 设置当前会话ID
   */
  setCurrentConversationId(id: string | null): void {
    if (!isLocalStorageAvailable()) return;
    if (id) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_CONVERSATION_ID, id);
    } else {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_CONVERSATION_ID);
    }
  },

  /**
   * 获取应用设置
   */
  getSettings(): AppSettings {
    if (!isLocalStorageAvailable()) {
      return this.getDefaultSettings();
    }
    return safeJSONParse<AppSettings>(
      localStorage.getItem(STORAGE_KEYS.SETTINGS),
      this.getDefaultSettings()
    );
  },

  /**
   * 保存应用设置
   */
  saveSettings(settings: AppSettings): void {
    if (!isLocalStorageAvailable()) return;
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },

  /**
   * 获取默认设置
   */
  getDefaultSettings(): AppSettings {
    return {
      theme: 'light',
      language: 'zh-CN',
      autoSave: true,
      maxHistoryLength: 50,
    };
  },

  /**
   * 获取存储版本
   */
  getStorageVersion(): string {
    if (!isLocalStorageAvailable()) return '0.0.0';
    return localStorage.getItem(STORAGE_KEYS.VERSION) || '0.0.0';
  },

  /**
   * 设置存储版本
   */
  setStorageVersion(): void {
    if (!isLocalStorageAvailable()) return;
    localStorage.setItem(STORAGE_KEYS.VERSION, STORAGE_VERSION);
  },

  /**
   * 数据迁移检查
   */
  checkAndMigrate(): void {
    const currentVersion = this.getStorageVersion();
    if (currentVersion !== STORAGE_VERSION) {
      // 未来版本迁移逻辑
      this.setStorageVersion();
    }
  },
};
