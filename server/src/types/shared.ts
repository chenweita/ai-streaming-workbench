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

/** SSE事件类型（扩展支持工具调用与权限请求事件） */
export type SSEEventType =
  | 'message_start'
  | 'message_delta'
  | 'message_end'
  | 'tool_call_start'
  | 'tool_result'
  | 'permission_request'
  | 'error'
  | 'done';

/** 工具调用开始事件数据 */
export interface SSEToolCallStart {
  toolCallId: string;
  toolName: string;
  arguments: string;
}

/** 工具执行结果事件数据 */
export interface SSEToolResult {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  content: string;
  durationMs: number;
}

/** 权限决策（用户在弹窗的选择） */
export type PermissionDecision =
  | { approved: true }
  | { approved: false; reason: string };

/** 权限请求事件数据（SSE permission_request 的 payload） */
export interface SSEPermissionRequest {
  /** 权限请求 ID，等于 toolCallId，前端回传用 */
  permissionId: string;
  /** 关联的 requestId（前端回传用，定位 gate） */
  requestId: string;
  /** 工具名（write_file / edit_file） */
  toolName: string;
  /** 工具调用 ID（与 tool_call_start 对齐） */
  toolCallId: string;
  /** 工具参数原始 JSON 字符串（前端解析后展示） */
  arguments: string;
  /** 请求创建时间戳 */
  createdAt: number;
  /** 自动拒绝超时时间戳（前端倒计时用） */
  expiresAt: number;
}

/** 权限决策回传请求体 */
export interface PermissionResponseBody {
  requestId: string;
  permissionId: string;
  approved: boolean;
  reason?: string;
}

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
