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
  // 当前流式消息ID的引用
  const streamingMsgIdRef = useRef<string | null>(null);
  // 防止重复提交的锁
  const submittingLockRef = useRef<boolean>(false);
  // 消息引用（用于回调中获取最新消息）
  const messagesRef = useRef<ChatMessage[]>(initialMessages);
  // 后端是否可用的缓存
  const backendAvailableRef = useRef<boolean | null>(null);
  // 流式输出缓存（用于批量更新）
  const pendingContentRef = useRef<string>('');
  const flushTimerRef = useRef<number | null>(null);
  // 外部消息同步锁（防止循环更新）
  const isInternalUpdateRef = useRef<boolean>(false);

  /**
   * 同步消息引用
   */
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /**
   * 同步外部消息变化到内部状态
   * 使用 isInternalUpdateRef 防止循环更新：
   * - 当内部更新消息时，设置 isInternalUpdateRef = true
   * - 外部同步 effect 检测到标记后跳过更新
   */
  useEffect(() => {
    // 如果是内部更新导致的变化，跳过同步
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }

    // 流式输出或加载中时不同步
    if (isStreaming || isLoading) {
      return;
    }

    // 比较是否真的需要更新（长度或最后一条消息内容不同）
    const currentLen = messagesRef.current.length;
    const initialLen = initialMessages.length;
    
    if (initialLen !== currentLen || 
        (initialLen > 0 && initialMessages[initialLen - 1].content !== messagesRef.current[currentLen - 1]?.content)) {
      setMessages(initialMessages);
      setError(null);
    }
  }, [initialMessages, isStreaming, isLoading]);

  /**
   * 内部更新消息（设置标记防止外部同步回来）
   */
  const internalSetMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]): void => {
      isInternalUpdateRef.current = true;
      setMessages((prev) => updater(prev));
    },
    []
  );

  /**
   * 批量更新流式消息内容（防抖）
   */
  const flushPendingContent = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
    }

    flushTimerRef.current = window.setTimeout(() => {
      const content = pendingContentRef.current;
      const msgId = streamingMsgIdRef.current;

      if (content && msgId) {
        isInternalUpdateRef.current = true;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === msgId
              ? { ...msg, content: msg.content + content }
              : msg
          )
        );
        pendingContentRef.current = '';
      }
      flushTimerRef.current = null;
    }, 16); // 约60fps的更新频率
  }, []);

  /**
   * 更新消息列表的辅助函数
   */
  const updateMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]): void => {
      isInternalUpdateRef.current = true;
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
   * 立即刷新待处理的内容
   */
  const flushNow = useCallback(() => {
    if (pendingContentRef.current && streamingMsgIdRef.current) {
      const remainingContent = pendingContentRef.current;
      const msgId = streamingMsgIdRef.current;
      isInternalUpdateRef.current = true;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === msgId
            ? { ...msg, content: msg.content + remainingContent }
            : msg
        )
      );
      pendingContentRef.current = '';
    }
  }, []);

  /**
   * 发送消息
   */
  const sendMessage = useCallback(
    async (content: string, conversationIdOverride?: string): Promise<void> => {
      if (submittingLockRef.current) {
        console.warn('消息正在提交中，请稍候...');
        return;
      }

      if (!content.trim()) {
        console.warn('消息内容不能为空');
        return;
      }

      submittingLockRef.current = true;
      setError(null);
      setIsLoading(true);
      setIsStreaming(false);

      try {
        const userMessage: ChatMessage = {
          id: generateId('msg'),
          role: 'user',
          content: content.trim(),
          createdAt: Date.now(),
          status: 'completed',
        };

        const assistantMessageId = generateId('msg');
        streamingMsgIdRef.current = assistantMessageId;

        const assistantMessage: ChatMessage = {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          status: 'pending',
        };

        const newMessages = [...messagesRef.current, userMessage, assistantMessage];
        updateMessages(() => newMessages);

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

        const callbacks: StreamCallbacks = {
          onMessageStart: () => {
            setIsLoading(false);
            setIsStreaming(true);
            if (streamingMsgIdRef.current) {
              updateMessageById(streamingMsgIdRef.current, {
                status: 'streaming',
              });
            }
          },

          onMessageDelta: (data) => {
            pendingContentRef.current += data.content;
            flushPendingContent();
          },

          onMessageEnd: (data) => {
            flushNow();
            setIsStreaming(false);
            if (data.messageId) {
              updateMessageById(data.messageId, {
                status: 'completed',
                usage: data.usage,
              });
            }
          },

          onDone: () => {
            flushNow();
            setIsStreaming(false);
            setIsLoading(false);
            streamingMsgIdRef.current = null;
          },

          onError: (err) => {
            console.error('流式请求错误:', err);
            flushNow();
            setError(err);
            setIsStreaming(false);
            setIsLoading(false);

            if (streamingMsgIdRef.current) {
              const msgId = streamingMsgIdRef.current;
              isInternalUpdateRef.current = true;
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
              streamingMsgIdRef.current = null;
            }
          },
        };

        const isBackendOk = await checkBackend();
        const url = '/api/chat/stream';

        if (isBackendOk) {
          abortControllerRef.current = createStreamRequest(
            url,
            requestParams,
            callbacks
          );
        } else {
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
        setTimeout(() => {
          submittingLockRef.current = false;
        }, 300);
      }
    },
    [options, updateMessages, updateMessageById, checkBackend, flushPendingContent, flushNow]
  );

  /**
   * 中断当前请求
   */
  const abortRequest = useCallback((): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      flushNow();
      setIsStreaming(false);
      setIsLoading(false);

      if (streamingMsgIdRef.current) {
        updateMessageById(streamingMsgIdRef.current, {
          status: 'completed' as MessageStatus,
        });
        streamingMsgIdRef.current = null;
      }

      console.log('请求已被用户中断');
    }
  }, [updateMessageById, flushNow]);

  /**
   * 清空消息
   */
  const clearMessages = useCallback((): void => {
    abortRequest();
    isInternalUpdateRef.current = true;
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
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
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
