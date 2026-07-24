import { config } from '../config';
import { ApiErrorResponse } from '../types/shared';

/**
 * LLM客户端服务
 * 负责与大模型API进行通信，封装请求逻辑
 */

/** LLM消息格式 */
interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** LLM流式请求体 */
interface LLMStreamRequest {
  model: string;
  messages: LLMMessage[];
  stream: true;
  temperature?: number;
  max_tokens?: number;
}

/** LLM流式响应回调 */
export interface StreamCallbacks {
  onDelta: (content: string) => void;
  onDone: (usage?: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  onError: (error: Error) => void;
}

/**
 * LLM客户端类
 * 提供流式对话能力，支持中断
 */
export class LLMClient {
  private abortController: AbortController | null = null;

  constructor(private readonly apiKey: string, private readonly apiBaseUrl: string) {}

  /**
   * 发送流式请求到LLM
   */
  async streamChat(
    messages: LLMMessage[],
    callbacks: StreamCallbacks,
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): Promise<void> {
    this.abortController = new AbortController();

    const requestBody: LLMStreamRequest = {
      model: options?.model || config.llm.modelName,
      messages,
      stream: true,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    };

    console.log('[LLM] 发送请求到:', `${this.apiBaseUrl}/chat/completions`);
    console.log('[LLM] 使用模型:', requestBody.model);
    console.log('[LLM] 消息数量:', messages.length);
    console.log('[LLM] API Key 前20字符:', this.apiKey.substring(0, 20) + '...');
    console.log('[LLM] Authorization Header:', `Bearer ${this.apiKey.substring(0, 10)}...${this.apiKey.substring(this.apiKey.length - 4)}`);

    try {
      const response = await fetch(`${this.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      console.log('[LLM] 响应状态:', response.status, response.ok);

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[LLM] API错误响应:', errorBody);
        
        let errorMessage = 'LLM API请求失败';
        try {
          const errorData = JSON.parse(errorBody);
          if (errorData.message) {
            errorMessage = errorData.message;
          } else if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch {
          // 解析失败，使用默认消息
        }
        
        const error = new Error(`${errorMessage} (HTTP ${response.status})`);
        callbacks.onError(error);
        return;
      }

      if (!response.body) {
        callbacks.onError(new Error('响应体为空'));
        return;
      }

      // 解析流式响应
      await this.parseStreamResponse(response.body, callbacks);
    } catch (error) {
      // 如果是主动中断，不触发错误回调
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[LLM] 请求已被中断');
        return;
      }
      console.error('[LLM] 请求异常:', error);
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 解析SSE流式响应
   */
  private async parseStreamResponse(
    body: ReadableStream<Uint8Array>,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullContent = '';
    let hasError = false;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();

          if (!trimmedLine || trimmedLine.startsWith(':')) {
            continue;
          }

          if (trimmedLine.startsWith('data:')) {
            const data = trimmedLine.slice(5).trim();

            if (data === '[DONE]') {
              callbacks.onDone();
              return;
            }

            try {
              const jsonData = JSON.parse(data);
              
              // 检查是否有错误
              if (jsonData.error) {
                hasError = true;
                const errorMsg = jsonData.error.message || 'LLM返回错误';
                callbacks.onError(new Error(errorMsg));
                return;
              }

              const delta = this.extractDelta(jsonData);

              if (delta) {
                fullContent += delta;
                callbacks.onDelta(delta);
              }

              // 检查是否完成
              if (jsonData.choices?.[0]?.finish_reason) {
                const usage = jsonData.usage;
                if (usage) {
                  callbacks.onDone({
                    promptTokens: usage.prompt_tokens,
                    completionTokens: usage.completion_tokens,
                    totalTokens: usage.total_tokens,
                  });
                } else {
                  callbacks.onDone();
                }
                return;
              }
            } catch (e) {
              console.warn('[LLM] SSE数据解析失败:', data, e);
            }
          }
        }
      }

      // 处理剩余buffer
      if (buffer.trim()) {
        const trimmedLine = buffer.trim();
        if (trimmedLine.startsWith('data:')) {
          const data = trimmedLine.slice(5).trim();
          if (data !== '[DONE]') {
            try {
              const jsonData = JSON.parse(data);
              const delta = this.extractDelta(jsonData);
              if (delta) {
                fullContent += delta;
                callbacks.onDelta(delta);
              }
            } catch {
              // 忽略
            }
          }
        }
      }

      // 只有没有出错才调用 onDone
      if (!hasError) {
        callbacks.onDone();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error('[LLM] 流式解析错误:', error);
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 从LLM响应中提取增量内容
   */
  private extractDelta(data: Record<string, unknown>): string {
    const choices = (data as { choices?: Array<{ delta?: { content?: string } }> }).choices;
    if (choices && choices.length > 0 && choices[0]?.delta?.content) {
      return choices[0].delta.content;
    }
    return '';
  }

  /**
   * 中断当前请求
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

/**
 * 创建LLM客户端实例
 */
export function createLLMClient(): LLMClient {
  return new LLMClient(config.llm.apiKey, config.llm.apiBaseUrl);
}
