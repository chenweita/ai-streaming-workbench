/**
 * 共享类型定义 - 服务器端本地副本
 * 从 ../../shared/types.ts 复制，保持类型一致
 */

/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system';

/** 单条消息 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
}

/** 会话对象 */
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** 流式请求体 */
export interface StreamChatRequest {
  conversationId?: string;
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** SSE事件类型 */
export type SSEEventType =
  | 'message_start'
  | 'message_delta'
  | 'message_end'
  | 'error'
  | 'done';

/** SSE事件结构 */
export interface SSEEvent {
  type: SSEEventType;
  data: SSEMessageDelta | SSEMessageEnd | SSEError | SSEDone;
}

/** 消息增量数据 */
export interface SSEMessageDelta {
  content: string;
}

/** 消息结束数据 */
export interface SSEMessageEnd {
  messageId: string;
  usage?: TokenUsage;
}

/** Token使用量 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 错误事件数据 */
export interface SSEError {
  code: string;
  message: string;
}

/** 完成事件数据 */
export interface SSEDone {
  conversationId: string;
}

/** API错误响应 */
export interface ApiErrorResponse {
  code: number;
  message: string;
  detail?: string;
}
