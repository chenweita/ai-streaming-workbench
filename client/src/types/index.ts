/**
 * 前端核心类型定义
 * 所有接口和类型都在此定义，严格TS类型，禁用any
 */

/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system';

/** 消息状态 */
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'error' | 'aborted';

/** 单条聊天消息 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  status?: MessageStatus;
  /** 消息使用的Token数量 */
  usage?: TokenUsage;
  /** 工具调用记录列表（Agent 模式下使用） */
  toolCalls?: ToolCallRecord[];
}

/** Token使用量 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 会话对象 */
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** 流式请求参数 */
export interface StreamChatParams {
  conversationId?: string;
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** SSE事件类型（扩展支持工具调用事件） */
export type SSEEventType =
  | 'message_start'
  | 'message_delta'
  | 'message_end'
  | 'tool_call_start'
  | 'tool_result'
  | 'error'
  | 'done';

/** 工具调用状态 */
export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error';

/** 工具调用记录（存储在 ChatMessage.toolCalls 中） */
export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  arguments: string;
  status: ToolCallStatus;
  result?: string;
  durationMs?: number;
  /** 结果是否被截断（超过 200 字符时截断显示） */
  truncated?: boolean;
}

/** 工具调用开始事件数据 */
export interface ToolCallStartData {
  toolCallId: string;
  toolName: string;
  arguments: string;
}

/** 工具执行结果事件数据 */
export interface ToolResultData {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  content: string;
  durationMs: number;
}

/** SSE事件结构 */
export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}

/** 消息开始事件数据 */
export interface MessageStartData {
  messageId: string;
}

/** 消息增量事件数据 */
export interface MessageDeltaData {
  content: string;
}

/** 消息结束事件数据 */
export interface MessageEndData {
  messageId: string;
  usage?: TokenUsage;
  /** Agent 模式：总迭代轮次 */
  iterations?: number;
  /** Agent 模式：是否达到最大轮次 */
  maxReached?: boolean;
}

/** 完成事件数据 */
export interface DoneData {
  conversationId: string;
}

/** 错误事件数据 */
export interface ErrorData {
  code: string;
  message: string;
}

/** useStreamChat Hook返回值 */
export interface UseStreamChatReturn {
  /** 当前会话的消息列表 */
  messages: ChatMessage[];
  /** 是否正在加载 */
  isLoading: boolean;
  /** 是否正在流式输出 */
  isStreaming: boolean;
  /** 错误信息 */
  error: Error | null;
  /** 发送消息（触发流式请求） */
  sendMessage: (content: string) => Promise<void>;
  /** 中断当前流式请求 */
  abortRequest: () => void;
  /** 清空当前会话消息 */
  clearMessages: () => void;
}

/** useConversation Hook返回值 */
export interface UseConversationReturn {
  /** 所有会话列表 */
  conversations: Conversation[];
  /** 当前活动会话ID */
  currentConversationId: string | null;
  /** 当前活动会话 */
  currentConversation: Conversation | null;
  /** 创建新会话 */
  createConversation: () => Conversation;
  /** 切换会话 */
  switchConversation: (id: string) => void;
  /** 删除会话 */
  deleteConversation: (id: string) => void;
  /** 更新会话 */
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  /** 获取会话 */
  getConversation: (id: string) => Conversation | undefined;
}

/** API请求配置 */
export interface ApiConfig {
  baseURL: string;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
}

/** 网络状态 */
export type NetworkStatus = 'online' | 'offline';

/** 应用设置 */
export interface AppSettings {
  /** 主题 */
  theme: 'light' | 'dark';
  /** 语言 */
  language: 'zh-CN' | 'en-US';
  /** 自动保存 */
  autoSave: boolean;
  /** 消息最大历史长度 */
  maxHistoryLength: number;
}
