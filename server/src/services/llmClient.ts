import { config } from '../config';
import { ApiErrorResponse } from '../../shared/types';

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
   * @param messages 对话历史
   * @param callbacks 流式回调函数
   */
  async streamChat(
    messages: LLMMessage[],
    callbacks: StreamCallbacks,
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): Promise<void> {
    // 创建新的中断控制器
    this.abortController = new AbortController();

    const requestBody: LLMStreamRequest = {
      model: options?.model || config.llm.modelName,
      messages,
      stream: true,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    };

    try {
      const response = await fetch(`${this.apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const errorResponse: ApiErrorResponse = {
          code: response.status,
          message: 'LLM API请求失败',
          detail: errorBody,
        };
        throw new Error(JSON.stringify(errorResponse));
      }

      if (!response.body) {
        throw new Error('响应体为空');
      }

      // 解析流式响应
      await this.parseStreamResponse(response.body, callbacks);
    } catch (error) {
      // 如果是主动中断，不触发错误回调
      // Node.js 中断错误的 name 属性为 'AbortError'
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 解析SSE流式响应
   * @param body 响应体ReadableStream
   * @param callbacks 回调函数
   */
  private async parseStreamResponse(
    body: ReadableStream<Uint8Array>,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // 解码chunk
        buffer += decoder.decode(value, { stream: true });

        // 按行解析SSE数据
        const lines = buffer.split('\n');
        // 保留最后一行（可能不完整）
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();

          // 跳过空行和注释
          if (!trimmedLine || trimmedLine.startsWith(':')) {
            continue;
          }

          // 解析data: 行
          if (trimmedLine.startsWith('data:')) {
            const data = trimmedLine.slice(5).trim();

            // 处理 [DONE] 标记
            if (data === '[DONE]') {
              callbacks.onDone();
              return;
            }

            try {
              const jsonData = JSON.parse(data);
              const delta = this.extractDelta(jsonData);

              if (delta) {
                fullContent += delta;
                callbacks.onDelta(delta);
              }

              // 检查是否有完成信息
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
              }
            } catch {
              // 忽略解析错误，继续处理
            }
          }
        }
      }

      // 处理剩余buffer中的数据
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
              // 忽略解析错误
            }
          }
        }
      }

      // 确保完成回调被触发
      callbacks.onDone();
    } catch (error) {
      // Node.js 中断错误检查
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 从LLM响应中提取增量内容
   * @param data LLM响应数据
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
