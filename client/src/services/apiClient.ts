/**
 * API客户端封装
 * - 封装@microsoft/fetch-event-source实现SSE通信
 * - 统一错误处理
 * - 请求超时控制
 */
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { ApiConfig, StreamChatParams, PermissionRequest, PermissionResponse } from '../types';

/** 默认API配置 */
const DEFAULT_CONFIG: ApiConfig = {
  baseURL: '/api',
  timeout: 60000, // 60秒超时
  retryAttempts: 1,
  retryDelay: 2000,
};

/**
 * SSE事件回调接口
 * 扩展支持 Agent 工具调用事件与权限请求事件
 */
export interface StreamCallbacks {
  onMessageStart?: (data: { messageId: string; requestId: string }) => void;
  onMessageDelta?: (data: { content: string }) => void;
  onMessageEnd?: (data: { messageId: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; iterations?: number; maxReached?: boolean }) => void;
  /** 工具调用开始事件 */
  onToolCallStart?: (data: { toolCallId: string; toolName: string; arguments: string }) => void;
  /** 工具执行结果事件 */
  onToolResult?: (data: { toolCallId: string; toolName: string; ok: boolean; content: string; durationMs: number }) => void;
  /** 权限请求事件（编辑类工具执行前触发，前端弹出确认框） */
  onPermissionRequest?: (data: PermissionRequest) => void;
  onDone?: (data: { conversationId: string }) => void;
  onError?: (error: Error) => void;
}

/**
 * 创建SSE请求
 */
export function createStreamRequest(
  url: string,
  body: StreamChatParams,
  callbacks: StreamCallbacks,
  config: Partial<ApiConfig> = {}
): AbortController {
  const finalConfig: ApiConfig = { ...DEFAULT_CONFIG, ...config };
  const abortController = new AbortController();

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let hasReceivedMessage = false;
  let retryCount = 0;

  const setNewTimeout = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      if (!hasReceivedMessage) {
        console.error('[SSE] 请求超时，未收到任何消息');
        abortController.abort();
        callbacks.onError?.(new Error('请求超时，请检查网络或稍后重试'));
      }
    }, finalConfig.timeout);
  };

  const clearCurrentTimeout = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  setNewTimeout();

  fetchEventSource(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: abortController.signal,
    // 确保流式传输的正确性
    onopen(): Promise<void> {
      console.log('[SSE] 连接已建立');
      retryCount = 0;
      setNewTimeout();
      return Promise.resolve();
    },

    onmessage(ev) {
      hasReceivedMessage = true;
      setNewTimeout();

      try {
        const eventType = ev.event;
        const eventData = JSON.parse(ev.data);

        console.log(`[SSE] ${new Date().toISOString()} 收到事件:`, eventType);

        switch (eventType) {
          case 'message_start':
            callbacks.onMessageStart?.(eventData as { messageId: string; requestId: string });
            break;
          case 'message_delta':
            callbacks.onMessageDelta?.(eventData as { content: string });
            break;
          case 'message_end':
            callbacks.onMessageEnd?.(eventData as { messageId: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; iterations?: number; maxReached?: boolean });
            break;
          case 'tool_call_start':
            callbacks.onToolCallStart?.(eventData as { toolCallId: string; toolName: string; arguments: string });
            break;
          case 'tool_result':
            callbacks.onToolResult?.(eventData as { toolCallId: string; toolName: string; ok: boolean; content: string; durationMs: number });
            break;
          case 'permission_request':
            callbacks.onPermissionRequest?.(eventData as PermissionRequest);
            break;
          case 'done':
            callbacks.onDone?.(eventData as { conversationId: string });
            break;
          case 'error':
            callbacks.onError?.(new Error(eventData.message || '未知错误'));
            break;
          default:
            console.warn('[SSE] 未知事件类型:', eventType);
        }
      } catch (e) {
        console.warn('[SSE] 事件解析失败:', ev.data);
      }
    },

    onerror(err) {
      clearCurrentTimeout();

      if (err instanceof Error && err.name === 'AbortError') {
        console.log('[SSE] 请求已被用户中断');
        throw err;
      }

      console.error('[SSE] 连接错误:', err);

      // 有消息接收过则不重试（已在流式输出中）
      if (retryCount < finalConfig.retryAttempts && !hasReceivedMessage) {
        retryCount++;
        console.log(`[SSE] 准备重试 ${retryCount}/${finalConfig.retryAttempts}`);
        setNewTimeout();
        return;
      }

      // 通知上层错误，但不再 throw —— 让 fetchEventSource 内部正常收尾
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    },

    onclose() {
      clearCurrentTimeout();
      console.log('[SSE] 连接已关闭');
    },
  });

  return abortController;
}

/**
 * 中断指定的请求
 */
export async function abortStreamRequest(requestId: string): Promise<void> {
  try {
    const response = await fetch(`${DEFAULT_CONFIG.baseURL}/chat/abort`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requestId }),
    });

    if (!response.ok) {
      throw new Error(`中断请求失败: ${response.status}`);
    }
  } catch (error) {
    console.error('中断请求失败:', error);
  }
}

/**
 * 回传权限决策（弹窗用户点击同意/拒绝后调用）
 * 唤醒后端挂起的 AgentLoop
 */
export async function respondPermissionRequest(req: PermissionResponse): Promise<void> {
  try {
    const response = await fetch(`${DEFAULT_CONFIG.baseURL}/chat/permission`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    });

    if (!response.ok) {
      throw new Error(`权限决策回传失败: ${response.status}`);
    }
  } catch (error) {
    console.error('权限决策回传失败:', error);
  }
}

/**
 * 创建完整的SSE流URL
 */
export function getStreamUrl(path: string): string {
  return `${DEFAULT_CONFIG.baseURL}${path}`;
}
