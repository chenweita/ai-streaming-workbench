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
  ToolCallRecord,
  ToolCallStatus,
  PermissionRequest,
} from '../types';
import {
  createStreamRequest,
  StreamCallbacks,
  respondPermissionRequest,
} from '../services/apiClient';
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
  // 当前待决策的权限请求（同时至多一个，因 Edit 工具串行执行）
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);

  // 存储当前的AbortController引用
  const abortControllerRef = useRef<AbortController | null>(null);
  // 当前流式消息ID的引用
  const streamingMsgIdRef = useRef<string | null>(null);
  // 当前请求的 requestId（回传权限决策时需要，从 message_start 事件提取）
  const currentRequestIdRef = useRef<string | null>(null);
  // 防止重复提交的锁
  const submittingLockRef = useRef<boolean>(false);
  // 消息引用（用于回调中获取最新消息）
  const messagesRef = useRef<ChatMessage[]>(initialMessages);
  // 后端是否可用的缓存（30秒有效）
  const backendAvailableRef = useRef<boolean | null>(null);
  // 流式输出缓存（用于批量更新）
  const pendingContentRef = useRef<string>('');
  // 工具调用记录缓存（当前消息的所有工具调用）
  const toolCallsRef = useRef<ToolCallRecord[]>([]);
  // 权限请求引用（回调中获取最新值）
  const pendingPermissionRef = useRef<PermissionRequest | null>(null);
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
   */
  useEffect(() => {
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }
    if (isStreaming || isLoading) {
      return;
    }
    const currentLen = messagesRef.current.length;
    const initialLen = initialMessages.length;
    if (
      initialLen !== currentLen ||
      (initialLen > 0 &&
        initialMessages[initialLen - 1].content !==
          messagesRef.current[currentLen - 1]?.content)
    ) {
      setMessages(initialMessages);
      setError(null);
    }
  }, [initialMessages, isStreaming, isLoading]);

  /** 内部更新消息 */
  const internalSetMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]): void => {
      isInternalUpdateRef.current = true;
      setMessages((prev) => updater(prev));
    },
    []
  );

  /** 批量刷新流式内容（16ms 防抖 ≈ 60fps） */
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
    }, 16);
  }, []);

  /** 更新消息列表 */
  const updateMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]): void => {
      isInternalUpdateRef.current = true;
      setMessages((prev) => updater(prev));
    },
    []
  );

  /** 根据ID更新特定消息 */
  const updateMessageById = useCallback(
    (id: string, updates: Partial<ChatMessage>): void => {
      updateMessages((prev) =>
        prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg))
      );
    },
    [updateMessages]
  );

  /**
   * 检测后端是否可用（带 30 秒缓存，避免每次 sendMessage 阻塞 2 秒）
   */
  const checkBackend = useCallback(async (): Promise<boolean> => {
    if (backendAvailableRef.current !== null) {
      return backendAvailableRef.current;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch('/api/health', {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const ok = response.ok;
      backendAvailableRef.current = ok;
      setTimeout(() => {
        backendAvailableRef.current = null;
      }, 30000);
      return ok;
    } catch {
      backendAvailableRef.current = false;
      setTimeout(() => {
        backendAvailableRef.current = null;
      }, 30000);
      return false;
    }
  }, []);

  /** 立即刷新待处理内容 */
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
   * 发送消息（核心链路）
   * 流程：锁检查 → 状态初始化 → 消息入列 → 后端探测 → 发起 SSE
   */
  const sendMessage = useCallback(
    async (content: string, conversationIdOverride?: string): Promise<void> => {
      if (submittingLockRef.current) {
        console.warn('消息正在提交中，请稍候...');
        const blockedMsg: ChatMessage = {
          id: generateId('msg'),
          role: 'user',
          content: `[消息被阻塞，AI 正在回复中，请稍后重试] ${content.trim()}`,
          createdAt: Date.now(),
          status: 'error',
        };
        isInternalUpdateRef.current = true;
        setMessages((prev) => [...prev, blockedMsg]);
        setError(new Error('AI 正在回复中，请稍候再发送消息'));
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
        toolCallsRef.current = [];

        const assistantMessage: ChatMessage = {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          status: 'pending',
          toolCalls: [],
        };

        const newMessages = [...messagesRef.current, userMessage, assistantMessage];
        updateMessages(() => newMessages);

        const historyMessages = [
          ...messagesRef.current.filter((m) => {
            if (m.status === 'pending' || m.status === 'streaming') return false;
            if (m.status === 'error' || m.status === 'aborted') return false;
            if (m.role === 'assistant' && m.content.startsWith('[已中断')) return false;
            return true;
          }),
          userMessage,
        ];

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
          onMessageStart: (data) => {
            console.log(`[Chat] ${new Date().toISOString()} 消息开始:`, data);
            setIsLoading(false);
            setIsStreaming(true);
            // 提取 requestId（回传权限决策时需要）
            if (data.requestId) {
              currentRequestIdRef.current = data.requestId;
            }
            if (
              data.messageId &&
              data.messageId !== streamingMsgIdRef.current
            ) {
              const oldId = streamingMsgIdRef.current;
              const newId = data.messageId;
              streamingMsgIdRef.current = newId;
              isInternalUpdateRef.current = true;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === oldId
                    ? { ...msg, id: newId, status: 'streaming' as MessageStatus }
                    : msg
                )
              );
            } else if (streamingMsgIdRef.current) {
              updateMessageById(streamingMsgIdRef.current, {
                status: 'streaming',
              });
            }
          },

          onMessageDelta: (data) => {
            pendingContentRef.current += data.content;
            if (pendingContentRef.current.length <= 10) {
              console.log(`[Chat] ${new Date().toISOString()} 首字到达 (累计${pendingContentRef.current.length}字)`);
            }
            flushPendingContent();
          },

          onMessageEnd: (data) => {
            flushNow();
            setIsStreaming(false);
            const finalToolCalls = toolCallsRef.current.length > 0 ? [...toolCallsRef.current] : undefined;
            if (data.messageId) {
              updateMessageById(data.messageId, {
                status: 'completed',
                usage: data.usage,
                toolCalls: finalToolCalls,
              });
            }
          },

          onToolCallStart: (data) => {
            const newRecord: ToolCallRecord = {
              toolCallId: data.toolCallId,
              toolName: data.toolName,
              arguments: data.arguments,
              status: 'running' as ToolCallStatus,
            };
            toolCallsRef.current = [...toolCallsRef.current, newRecord];

            // 实时更新当前消息的 toolCalls
            if (streamingMsgIdRef.current) {
              const msgId = streamingMsgIdRef.current;
              const currentToolCalls = [...toolCallsRef.current];
              isInternalUpdateRef.current = true;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === msgId
                    ? { ...msg, toolCalls: currentToolCalls }
                    : msg
                )
              );
            }
          },

          onToolResult: (data) => {
            const resultContent = data.content;
            const truncated = resultContent.length > 200;

            toolCallsRef.current = toolCallsRef.current.map((tc) =>
              tc.toolCallId === data.toolCallId
                ? {
                    ...tc,
                    status: data.ok ? ('completed' as ToolCallStatus) : ('error' as ToolCallStatus),
                    result: resultContent,
                    durationMs: data.durationMs,
                    truncated,
                  }
                : tc
            );

            // 实时更新当前消息的 toolCalls
            if (streamingMsgIdRef.current) {
              const msgId = streamingMsgIdRef.current;
              const currentToolCalls = [...toolCallsRef.current];
              isInternalUpdateRef.current = true;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === msgId
                    ? { ...msg, toolCalls: currentToolCalls }
                    : msg
                )
              );
            }
          },

          onPermissionRequest: (data) => {
            console.log(`[Chat] 收到权限请求: ${data.toolName} permissionId=${data.permissionId}`);
            pendingPermissionRef.current = data;
            setPendingPermission(data);
          },

          onDone: () => {
            flushNow();
            setIsStreaming(false);
            setIsLoading(false);
            streamingMsgIdRef.current = null;
            currentRequestIdRef.current = null;
            toolCallsRef.current = [];
            // 流结束清空权限状态（超时自动拒绝时后端会发 tool_result 触发 onDone）
            pendingPermissionRef.current = null;
            setPendingPermission(null);
          },

          onError: (err) => {
            console.error('流式请求错误:', err);
            flushNow();
            setError(err);
            setIsStreaming(false);
            setIsLoading(false);
            // 错误时清空权限状态
            pendingPermissionRef.current = null;
            setPendingPermission(null);

            if (streamingMsgIdRef.current) {
              const msgId = streamingMsgIdRef.current;
              isInternalUpdateRef.current = true;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === msgId
                    ? {
                        ...msg,
                        status: 'error' as MessageStatus,
                        content: `⚠️ ${err.message || '抱歉，出现了错误，请重试。'}`,
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
          console.log(`[Chat] ${new Date().toISOString()} 后端可用，发起 SSE 请求`);
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
        submittingLockRef.current = false;
      }
    },
    [options, updateMessages, updateMessageById, checkBackend, flushPendingContent, flushNow]
  );

  /** 中断当前请求 */
  const abortRequest = useCallback((): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    flushNow();
    setIsStreaming(false);
    setIsLoading(false);
    // 中断时清空权限状态
    pendingPermissionRef.current = null;
    setPendingPermission(null);

    if (streamingMsgIdRef.current) {
      const msgId = streamingMsgIdRef.current;
      const currentMsg = messagesRef.current.find((m) => m.id === msgId);
      const currentContent = currentMsg?.content || '';
      updateMessageById(msgId, {
        status: 'aborted' as MessageStatus,
        content: currentContent || '[已中断]',
      });
      streamingMsgIdRef.current = null;
    }
    console.log('请求已被用户中断');
  }, [updateMessageById, flushNow]);

  /** 回传权限决策（弹窗用户点击同意/拒绝后调用） */
  const respondPermission = useCallback(async (approved: boolean, reason?: string): Promise<void> => {
    const req = pendingPermissionRef.current;
    if (!req) {
      console.warn('[Chat] 无待决策的权限请求');
      return;
    }
    // 立即清空状态，防止重复点击
    pendingPermissionRef.current = null;
    setPendingPermission(null);

    try {
      await respondPermissionRequest({
        requestId: req.requestId,
        permissionId: req.permissionId,
        approved,
        reason: reason || (approved ? '' : '用户拒绝'),
      });
      console.log(`[Chat] 权限决策已回传: approved=${approved}`);
    } catch (e) {
      console.error('[Chat] 权限决策回传失败:', e);
    }
  }, []);

  /** 清空消息 */
  const clearMessages = useCallback((): void => {
    abortRequest();
    isInternalUpdateRef.current = true;
    setMessages([]);
    messagesRef.current = [];
    setError(null);
  }, [abortRequest]);

  /** 组件卸载时清理 */
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
    pendingPermission,
    respondPermission,
  };
}
