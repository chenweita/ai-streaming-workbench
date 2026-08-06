import { config } from '../config';
import { OpenAIToolFunction, LLMToolCall } from '../agent/tools/ToolProtocol';

/**
 * LLM客户端服务
 * 负责与大模型API进行通信，封装请求逻辑
 * 支持流式对话 + Function Calling（tool_calls 流式分片重组）
 */

/** LLM消息格式（扩展支持 tool 角色与 tool_calls 字段） */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** assistant 消息携带的工具调用（回填时使用） */
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  /** tool 角色消息关联的工具调用 ID */
  tool_call_id?: string;
}

/** LLM流式请求体 */
interface LLMStreamRequest {
  model: string;
  messages: LLMMessage[];
  stream: true;
  temperature?: number;
  max_tokens?: number;
  /** Function Calling 工具定义 */
  tools?: OpenAIToolFunction[];
  /** 工具选择策略：auto 由模型自主决定 */
  tool_choice?: 'auto' | 'none';
}

/** LLM流式响应回调 */
export interface StreamCallbacks {
  onDelta: (content: string) => void;
  /** 工具调用回调：流式分片重组完成后触发一次 */
  onToolCalls?: (toolCalls: LLMToolCall[]) => void;
  /**
   * 流式结束回调
   * @param usage Token 用量
   * @param toolCalls 本次响应中重组的工具调用（若 onToolCalls 已处理，此处仍会传入）
   */
  onDone: (usage?: { promptTokens: number; completionTokens: number; totalTokens: number }, toolCalls?: LLMToolCall[]) => void;
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
   * @param messages 消息列表（含可能的 tool 结果消息）
   * @param callbacks 流式回调
   * @param options 模型配置 + 工具定义
   */
  async streamChat(
    messages: LLMMessage[],
    callbacks: StreamCallbacks,
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      /** 工具定义（OpenAI tools 格式），传入后启用 Function Calling */
      tools?: OpenAIToolFunction[];
    }
  ): Promise<void> {
    this.abortController = new AbortController();

    const requestBody: LLMStreamRequest = {
      model: options?.model || config.llm.modelName,
      messages,
      stream: true,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    };

    // 注入工具定义（启用 Function Calling）
    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = 'auto';
    }

    const startTime = performance.now();
    console.log(`[LLM] ${new Date().toISOString()} 发送请求到:`, `${this.apiBaseUrl}/chat/completions`);
    console.log('[LLM] 使用模型:', requestBody.model);
    console.log('[LLM] 消息数量:', messages.length);
    console.log('[LLM] 启用工具:', requestBody.tools ? `${requestBody.tools.length} 个` : '否');
    console.log('[LLM] API Key 前20字符:', this.apiKey.substring(0, 20) + '...');

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

      console.log(`[LLM] ${new Date().toISOString()} 响应状态:`, response.status, response.ok);
      console.log(`[LLM] 响应耗时: ${performance.now() - startTime}ms`);
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
   * 支持文本增量 + tool_calls 分片重组
   */
  private async parseStreamResponse(
    body: ReadableStream<Uint8Array>,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const streamStartTs = performance.now();
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullContent = '';
    let hasError = false;

    // tool_calls 分片重组缓存：按 index 累积 arguments 分片
    // OpenAI 流式协议：delta.tool_calls[].index 标识分片归属
    const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

    /** 将累积的 tool_calls 转换为最终结构 */
    const buildToolCalls = (): LLMToolCall[] => {
      const indices = Array.from(toolCallAccumulator.keys()).sort((a, b) => a - b);
      return indices.map((idx) => {
        const acc = toolCallAccumulator.get(idx)!;
        return { id: acc.id, name: acc.name, arguments: acc.arguments };
      });
    };

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
              const finalToolCalls = buildToolCalls();
              if (finalToolCalls.length > 0 && callbacks.onToolCalls) {
                callbacks.onToolCalls(finalToolCalls);
              }
              callbacks.onDone(undefined, finalToolCalls.length > 0 ? finalToolCalls : undefined);
              return;
            }

            try {
              const jsonData = JSON.parse(data) as Record<string, unknown>;

              // 错误检查
              if (jsonData.error) {
                hasError = true;
                const errObj = jsonData.error as { message?: string };
                const errorMsg = errObj.message || 'LLM返回错误';
                callbacks.onError(new Error(errorMsg));
                return;
              }

              const choices = jsonData.choices as Array<{
                delta?: { content?: string; tool_calls?: Array<{
                  index: number; id?: string; function?: { name?: string; arguments?: string };
                }> };
                finish_reason?: string | null;
              }> | undefined;

              const choice = choices?.[0];
              if (!choice) {
                continue;
              }

              // 1. 处理文本增量
              const deltaContent = choice.delta?.content;
              if (deltaContent) {
                fullContent += deltaContent;
                if (fullContent.length <= 10) {
                  console.log(`[LLM] ${new Date().toISOString()} 首字到达 (累计${fullContent.length}字)`);
                }
                callbacks.onDelta(deltaContent);
              }

              // 2. 处理 tool_calls 分片
              const deltaToolCalls = choice.delta?.tool_calls;
              if (deltaToolCalls && deltaToolCalls.length > 0) {
                for (const tc of deltaToolCalls) {
                  const existing = toolCallAccumulator.get(tc.index);
                  if (existing) {
                    // 累积 arguments 分片
                    if (tc.function?.arguments) {
                      existing.arguments += tc.function.arguments;
                    }
                  } else {
                    // 首次出现：记录 id 和 name
                    toolCallAccumulator.set(tc.index, {
                      id: tc.id ?? `call_${tc.index}_${Date.now()}`,
                      name: tc.function?.name ?? '',
                      arguments: tc.function?.arguments ?? '',
                    });
                  }
                }
              }

              // 3. 检查是否完成
              if (choice.finish_reason) {
                const finalToolCalls = buildToolCalls();
                console.log(`[LLM] finish_reason=${choice.finish_reason}, tool_calls=${finalToolCalls.length}个`);

                if (finalToolCalls.length > 0 && callbacks.onToolCalls) {
                  callbacks.onToolCalls(finalToolCalls);
                }

                const usage = jsonData.usage as {
                  prompt_tokens: number; completion_tokens: number; total_tokens: number;
                } | undefined;

                if (usage) {
                  callbacks.onDone(
                    { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens },
                    finalToolCalls.length > 0 ? finalToolCalls : undefined
                  );
                } else {
                  callbacks.onDone(undefined, finalToolCalls.length > 0 ? finalToolCalls : undefined);
                }
                return;
              }
            } catch (e) {
              console.warn('[LLM] SSE数据解析失败:', data, e);
            }
          }
        }
      }

      // 流自然结束（无 finish_reason）
      if (!hasError) {
        const finalToolCalls = buildToolCalls();
        if (finalToolCalls.length > 0 && callbacks.onToolCalls) {
          callbacks.onToolCalls(finalToolCalls);
        }
        console.log(`[LLM] ${new Date().toISOString()} 流式解析完成，耗时=${performance.now() - streamStartTs}ms`);
        callbacks.onDone(undefined, finalToolCalls.length > 0 ? finalToolCalls : undefined);
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
