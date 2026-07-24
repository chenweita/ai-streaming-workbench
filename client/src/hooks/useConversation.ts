/**
 * useConversation Hook
 * 会话管理Hook，支持：
 * - 新建会话
 * - 删除会话
 * - 切换会话
 * - LocalStorage持久化
 */
import { useState, useEffect, useCallback } from 'react';
import { Conversation, UseConversationReturn } from '../types';
import { storageService } from '../services/storage';
import { generateId, truncateString } from '../utils/helpers';

/**
 * useConversation Hook
 * @returns UseConversationReturn
 */
export function useConversation(): UseConversationReturn {
  // 所有会话列表
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // 当前活动会话ID
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);

  /**
   * 初始化加载会话
   */
  useEffect(() => {
    // 检查存储版本并迁移
    storageService.checkAndMigrate();

    // 加载会话列表
    const savedConversations = storageService.getConversations();
    setConversations(savedConversations);

    // 加载当前会话ID
    const savedCurrentId = storageService.getCurrentConversationId();
    if (savedCurrentId && savedConversations.some((c) => c.id === savedCurrentId)) {
      setCurrentConversationId(savedCurrentId);
    } else if (savedConversations.length > 0) {
      // 如果没有当前会话，选择最新的一个
      const sorted = [...savedConversations].sort(
        (a, b) => b.updatedAt - a.updatedAt
      );
      setCurrentConversationId(sorted[0].id);
    }
  }, []);

  /**
   * 保存会话到LocalStorage
   */
  const saveConversations = useCallback(
    (convs: Conversation[]): void => {
      storageService.saveConversations(convs);
    },
    []
  );

  /**
   * 创建新会话
   */
  const createConversation = useCallback((): Conversation => {
    const newConversation: Conversation = {
      id: generateId('conv'),
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setConversations((prev) => {
      const updated = [newConversation, ...prev];
      saveConversations(updated);
      return updated;
    });

    setCurrentConversationId(newConversation.id);
    storageService.setCurrentConversationId(newConversation.id);

    return newConversation;
  }, [saveConversations]);

  /**
   * 切换会话
   */
  const switchConversation = useCallback(
    (id: string): void => {
      setCurrentConversationId(id);
      storageService.setCurrentConversationId(id);
    },
    []
  );

  /**
   * 删除会话
   */
  const deleteConversation = useCallback(
    (id: string): void => {
      setConversations((prev) => {
        const updated = prev.filter((conv) => conv.id !== id);
        saveConversations(updated);

        // 如果删除的是当前会话，切换到下一个
        if (id === currentConversationId) {
          if (updated.length > 0) {
            const sorted = [...updated].sort(
              (a, b) => b.updatedAt - a.updatedAt
            );
            setCurrentConversationId(sorted[0].id);
            storageService.setCurrentConversationId(sorted[0].id);
          } else {
            setCurrentConversationId(null);
            storageService.setCurrentConversationId(null);
          }
        }

        return updated;
      });

      storageService.deleteConversation(id);
    },
    [currentConversationId, saveConversations]
  );

  /**
   * 更新会话
   */
  const updateConversation = useCallback(
    (id: string, updates: Partial<Conversation>): void => {
      setConversations((prev) => {
        const updated = prev.map((conv) =>
          conv.id === id
            ? { ...conv, ...updates, updatedAt: Date.now() }
            : conv
        );
        saveConversations(updated);
        return updated;
      });

      // 如果有消息更新，自动生成标题
      if (updates.messages && updates.messages.length > 0) {
        const userMessage = updates.messages.find((m) => m.role === 'user');
        if (userMessage) {
          const title = truncateString(userMessage.content, 20);
          setConversations((prev) => {
            const updated = prev.map((conv) =>
              conv.id === id
                ? { ...conv, title, updatedAt: Date.now() }
                : conv
            );
            saveConversations(updated);
            return updated;
          });
        }
      }
    },
    [saveConversations]
  );

  /**
   * 获取单个会话
   */
  const getConversation = useCallback(
    (id: string): Conversation | undefined => {
      return conversations.find((conv) => conv.id === id);
    },
    [conversations]
  );

  /**
   * 当前活动会话
   */
  const currentConversation =
    conversations.find((c) => c.id === currentConversationId) || null;

  return {
    conversations,
    currentConversationId,
    currentConversation,
    createConversation,
    switchConversation,
    deleteConversation,
    updateConversation,
    getConversation,
  };
}
