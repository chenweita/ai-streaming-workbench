/**
 * useStreamChat Hook
 * 核心流式对话Hook，封装SSE通信逻辑
 * 功能：
 * - 发送消息（触发流式请求）
 * - 实时接收流式输出（打字机效果）
 * - 中断请求
 * - 加载状态控制
 * - 错误处理与重试
 * - 自动降级到Mock模式
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ChatMessage,
  MessageStatus,
  StreamChatParams,
  UseStreamChatReturn,
} from '../types';
import { createStreamRequest, StreamCallbacks } from '../services/apiClient';
import { createMockStreamRequest } from '../services/mockApi';
import { generateId } from '../utils/helpers';

/**
 * useStreamChat Hook
 * @param initialMessages 初始消息列表
 * @param options 可选配置
 * @returns UseStreamChatReturn
 */
export function useStreamChat(
  initialMessages: ChatMessage[] = [],
  options?: {
    conversationId?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }
): UseStreamChatReturn {
  // 消息列表
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  // 加载状态
  const [isLoading, setIsLoading] = useState<boolean>(false);
  // 流式输出状态
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  // 错误信息
  const [error, setError] = useState<Error | null>(null);

  // 存储当前的AbortController引用
  const abortControllerRef = useRef<AbortController | null>(null);
  // 存储当前流式消息的ID引用
  const currentMessageIdRef = useRef<string | null>(null);
  // 防止重复提交的锁
  const submittingLockRef = useRef<boolean>(false);
  // 消息引用（用于回调中获取最新消息）
  const messagesRef = useRef<ChatMessage[]>(initialMessages);
  // 外部同步标记（防止循环更新）
  const isExternalSyncRef = useRef<boolean>(false);
  // 后端是否可用的缓存
  const backendAvailableRef = useRef<boolean | null>(null);

  /**
   * 同步消息引用
   */
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /**
   * 同步外部消息变化到内部状态
   * 当切换会话时，需要更新消息列表
   */
  useEffect(() => {
    // 只在非流式输出状态下同步，避免打断正在进行的对话
    if (!isStreaming && !isLoading) {
      // 设置外部同步标记，防止循环更新
      isExternalSyncRef.current = true;
      setMessages(initialMessages);
      setError(null);
      // 下一个微任务中重置标记
      queueMicrotask(() => {
        isExternalSyncRef.current = false;
      });
    }
  }, [initialMessages, isStreaming, isLoading]);

  /**
   * 更新消息列表的辅助函数
   */
  const updateMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]): void => {
      setMessages((prev) => updater(prev));
    },
    []
  );

  /**
   * 根据ID更新特定消息
   */
  const updateMessageById = useCallback(
    (id: string, updates: Partial<ChatMessage>): void => {
      updateMessages((prev) =>
        prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg))
      );
    },
    [updateMessages]
  );

  /**
   * 检测后端是否可用
   */
  const checkBackend = useCallback(async (): Promise<boolean> => {
    if (backendAvailableRef.current !== null) {
      return backendAvailableRef.current;
    }

    try {
      const response = await fetch('/api/health', { method: 'GET', signal: AbortSignal.timeout(2000) });
      backendAvailableRef.current = response.ok;
      return response.ok;
    } catch {
      backendAvailableRef.current = false;
      return false;
    }
  }, []);

  /**
   * 发送消息
   * @param content 消息内容
   * @param conversationIdOverride 可选的会话ID覆盖
   */
  const sendMessage = useCallback(
    async (content: string, conversationIdOverride?: string): Promise<void> => {
      // 检查提交锁，防止重复提交
      if (submittingLockRef.current) {
        console.warn('消息正在提交中，请稍候...');
        return;
      }

      if (!content.trim()) {
        console.warn('消息内容不能为空');
        return;
      }

      // 设置提交锁
      submittingLockRef.current = true;
      setError(null);
      setIsLoading(true);
      setIsStreaming(false);

      try {
        // 1. 创建用户消息
        const userMessage: ChatMessage = {
          id: generateId('msg'),
          role: 'user',
          content: content.trim(),
          createdAt: Date.now(),
          status: 'completed',
        };

        // 2. 创建AI消息占位符（先添加，后续流式更新）
        const assistantMessageId = generateId('msg');
        currentMessageIdRef.current = assistantMessageId;

        const assistantMessage: ChatMessage = {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          status: 'pending',
        };

        // 3. 更新消息列表
        const newMessages = [...messagesRef.current, userMessage, assistantMessage];
        updateMessages(() => newMessages);

        // 4. 准备请求参数（使用最新的消息引用）
        const historyMessages = [...messagesRef.current, userMessage];
        const requestParams: StreamChatParams = {
          conversationId: conversationIdOverride || options?.conversationId,
          messages: historyMessages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          })),
          model: options?.model,
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
        };

        // 5. 设置SSE回调
        const callbacks: StreamCallbacks = {
          onMessageStart: () => {
            setIsLoading(false);
            setIsStreaming(true);
            // 更新消息状态为流式输出中
            if (currentMessageIdRef.current) {
              updateMessageById(currentMessageIdRef.current, {
                status: 'streaming',
              });
            }
          },

          onMessageDelta: (data) => {
            // 增量更新消息内容
            if (currentMessageIdRef.current) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === currentMessageIdRef.current
                    ? { ...msg, content: msg.content + data.content }
                    : msg
                )
              );
            }
          },

          onMessageEnd: (data) => {
            setIsStreaming(false);
            // 更新消息状态为已完成
            if (data.messageId) {
              updateMessageById(data.messageId, {
                status: 'completed',
                usage: data.usage,
              });
            }
          },

          onDone: () => {
            setIsStreaming(false);
            setIsLoading(false);
            currentMessageIdRef.current = null;
          },

          onError: (err) => {
            console.error('流式请求错误:', err);
            setError(err);
            setIsStreaming(false);
            setIsLoading(false);

            // 使用函数式更新获取最新状态
            if (currentMessageIdRef.current) {
              const msgId = currentMessageIdRef.current;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === msgId
                    ? {
                        ...msg,
                        status: 'error',
                        content: msg.content || '抱歉，出现了错误，请重试。',
                      }
                    : msg
                )
              );
              currentMessageIdRef.current = null;
            }
          },
        };

        // 6. 检测后端可用性并发送请求
        const isBackendOk = await checkBackend();
        const url = '/api/chat/stream';

        if (isBackendOk) {
          // 后端可用，使用真实请求
          abortControllerRef.current = createStreamRequest(
            url,
            requestParams,
            callbacks
          );
        } else {
          // 后端不可用，使用Mock模式
          console.warn('[Chat] 后端不可用，使用Mock模式');
          abortControllerRef.current = createMockStreamRequest(
            url,
            requestParams,
            callbacks
          );
        }
      } catch (err) {
        console.error('发送消息异常:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
        setIsStreaming(false);
      } finally {
        // 释放提交锁
        setTimeout(() => {
          submittingLockRef.current = false;
        }, 300); // 短暂延迟防止快速重复点击
      }
    },
    [options, updateMessages, updateMessageById, checkBackend]
  );

  /**
   * 中断当前请求
   */
  const abortRequest = useCallback((): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      setIsLoading(false);

      // 更新当前消息状态为已中断（作为完成状态处理）
      if (currentMessageIdRef.current) {
        updateMessageById(currentMessageIdRef.current, {
          status: 'completed' as MessageStatus,
        });
        currentMessageIdRef.current = null;
      }

      console.log('请求已被用户中断');
    }
  }, [updateMessageById]);

  /**
   * 清空消息
   */
  const clearMessages = useCallback((): void => {
    abortRequest();
    setMessages([]);
    messagesRef.current = [];
    setError(null);
  }, [abortRequest]);

  /**
   * 组件卸载时清理
   */
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    messages,
    isLoading,
    isStreaming,
    error,
    sendMessage,
    abortRequest,
    clearMessages,
  };
}
