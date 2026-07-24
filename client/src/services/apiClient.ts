/**
 * API客户端封装
 * - 封装@microsoft/fetch-event-source实现SSE通信
 * - 统一错误处理
 * - 请求超时控制
 */
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { ApiConfig, StreamChatParams } from '../types';

/** 默认API配置 */
const DEFAULT_CONFIG: ApiConfig = {
  baseURL: '/api',
  timeout: 120000, // 2分钟超时
  retryAttempts: 2,
  retryDelay: 1000,
};

/**
 * SSE事件回调接口
 */
export interface StreamCallbacks {
  onMessageStart?: (data: { messageId: string }) => void;
  onMessageDelta?: (data: { content: string }) => void;
  onMessageEnd?: (data: { messageId: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }) => void;
  onDone?: (data: { conversationId: string }) => void;
  onError?: (error: Error) => void;
}

/**
 * 创建SSE请求
 * @param url 请求URL
 * @param body 请求体
 * @param callbacks 事件回调
 * @param config API配置
 * @returns AbortController用于中断
 */
export function createStreamRequest(
  url: string,
  body: StreamChatParams,
  callbacks: StreamCallbacks,
  config: Partial<ApiConfig> = {}
): AbortController {
  const finalConfig: ApiConfig = { ...DEFAULT_CONFIG, ...config };
  const abortController = new AbortController();

  // 使用 ref 追踪 timeout ID
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * 设置超时定时器
   */
  const setNewTimeout = (): void => {
    // 清除之前的定时器
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    // 设置新的定时器
    timeoutId = setTimeout(() => {
      abortController.abort();
      callbacks.onError?.(new Error('请求超时'));
    }, finalConfig.timeout);
  };

  /**
   * 清除超时定时器
   */
  const clearCurrentTimeout = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  // 初始化超时
  setNewTimeout();

  let retryCount = 0;
  let shouldRetry = false;

  fetchEventSource(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: abortController.signal,

    // SSE事件处理
    onmessage(ev) {
      // 收到消息说明连接正常，重置超时
      setNewTimeout();

      try {
        const eventData = JSON.parse(ev.data);
        const eventType = eventData.type;
        const eventPayload = eventData.data;

        switch (eventType) {
          case 'message_start':
            callbacks.onMessageStart?.(eventPayload as { messageId: string });
            break;
          case 'message_delta':
            callbacks.onMessageDelta?.(eventPayload as { content: string });
            break;
          case 'message_end':
            callbacks.onMessageEnd?.(eventPayload as { messageId: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } });
            break;
          case 'done':
            callbacks.onDone?.(eventPayload as { conversationId: string });
            break;
          case 'error':
            const errorData = eventPayload as { code: string; message: string };
            callbacks.onError?.(new Error(errorData.message || '未知错误'));
            break;
        }
      } catch {
        // JSON解析失败，忽略该事件
        console.warn('SSE事件解析失败:', ev.data);
      }
    },

    // 错误处理
    onerror(err) {
      // 清除超时
      clearCurrentTimeout();

      // 检查是否是中断
      if (err instanceof Error && err.name === 'AbortError') {
        throw err; // 重新抛出以停止重试
      }

      // 检查是否应该重试
      if (shouldRetry && retryCount < finalConfig.retryAttempts) {
        retryCount++;
        console.log(`SSE请求重试 ${retryCount}/${finalConfig.retryAttempts}`);
        setNewTimeout();
        return;
      }

      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      throw err;
    },

    // 请求初始化
    onopen() {
      shouldRetry = true;
      retryCount = 0;
      setNewTimeout();
    },

    // 关闭时重置重试标志
    onclose() {
      shouldRetry = false;
      clearCurrentTimeout();
    },

    // 重试间隔
    reconnectionTime: finalConfig.retryDelay,
  });

  return abortController;
}

/**
 * 中断指定的请求
 * @param requestId 请求ID
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
 * 创建完整的SSE流URL
 * @param path API路径
 * @returns 完整URL
 */
export function getStreamUrl(path: string): string {
  return `${DEFAULT_CONFIG.baseURL}${path}`;
}
