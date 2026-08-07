/**
 * 工具协议层 - 工具描述结构与执行契约
 * 对标 BearCode 工具系统（轻量化 TS 重构）
 *
 * 核心职责：
 *   1. 定义 ToolDef 工具描述结构，兼容 OpenAI Function Calling 协议
 *   2. 区分并发安全只读工具与有副作用工具
 *   3. 约束工具实现的标准接口
 *
 * 设计原则：
 *   - 严格 TypeScript，禁用 any
 *   - 工具描述与实现分离，便于注册表统一管理
 *   - 参数使用 JSON Schema 描述，与 OpenAI tools 字段直接对齐
 */

/* -------------------------------------------------------------------------- */
/*                          JSON Schema 类型（精简版）                          */
/* -------------------------------------------------------------------------- */

/**
 * JSON Schema 基础类型枚举
 * 仅覆盖工具参数常用的类型，避免引入完整 json-schema 包
 */
export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

/**
 * JSON Schema 参数描述（精简版，对齐 OpenAI function calling 的 parameters 字段）
 */
export interface JsonSchemaProperty {
  /** 参数类型 */
  type: JsonSchemaType;
  /** 参数描述 */
  description?: string;
  /** 枚举可选值（type 为 string/number 时生效） */
  enum?: Array<string | number>;
  /** 数组元素 schema（type 为 array 时生效） */
  items?: JsonSchemaProperty;
  /** 对象属性（type 为 object 时生效） */
  properties?: Record<string, JsonSchemaProperty>;
  /** 必填字段列表（type 为 object 时生效） */
  required?: string[];
}

/**
 * 工具参数 schema（顶层为 object 类型）
 */
export interface ToolParametersSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/* -------------------------------------------------------------------------- */
/*                              工具元数据                                      */
/* -------------------------------------------------------------------------- */

/**
 * 工具安全级别
 * - ReadOnly      只读无副作用，可并发执行（如 list_files、read_file、grep_search）
 * - Edit          文件编辑/写入/删除类，需串行执行并触发权限确认（如 write_file、edit_file）
 */
export enum ToolSafety {
  /** 只读无副作用，并发安全 */
  ReadOnly = 'readOnly',
  /** 文件编辑类，需串行执行并触发权限确认 */
  Edit = 'edit',
}

/* -------------------------------------------------------------------------- */
/*                              工具描述结构                                     */
/* -------------------------------------------------------------------------- */

/**
 * 工具定义（对标 BearCode ToolDef）
 *
 * 描述一个可被 LLM 调用的工具，包含：
 *   - name: 工具唯一标识（LLM 调用时使用）
 *   - description: 工具功能描述（影响 LLM 选择准确度）
 *   - parameters: 参数 JSON Schema（对齐 OpenAI function.parameters）
 *   - safety: 安全级别（决定并发策略与权限处理）
 *   - execute: 实际执行函数
 *
 * @typeParam TParams 工具参数类型（与 parameters schema 对应）
 * @typeParam TResult 工具返回类型
 */
export interface ToolDef<TParams = Record<string, unknown>, TResult = string> {
  /** 工具唯一标识，建议使用 snake_case（与 OpenAI 习惯一致） */
  name: string;
  /** 工具功能描述，供 LLM 理解工具用途 */
  description: string;
  /** 参数 JSON Schema，对齐 OpenAI function calling 的 parameters 字段 */
  parameters: ToolParametersSchema;
  /** 安全级别：决定是否可并发、是否需要权限确认 */
  safety: ToolSafety;
  /**
   * 工具执行函数
   * @param params LLM 传入的参数（已通过 schema 校验）
   * @param context 执行上下文（工作目录、中断信号等）
   * @returns 工具执行结果（字符串形式，将回填到对话上下文）
   */
  execute: (params: TParams, context: ToolContext) => Promise<TResult>;
}

/* -------------------------------------------------------------------------- */
/*                              执行上下文                                      */
/* -------------------------------------------------------------------------- */

/**
 * 工具执行上下文
 * 提供工具运行所需的环境信息与控制信号
 */
export interface ToolContext {
  /** 工作目录（工具执行的相对路径基准） */
  cwd: string;
  /** 中断信号（用户主动中止时触发） */
  signal: AbortSignal;
  /** 执行超时时间（毫秒），超时后工具应主动中止 */
  timeoutMs: number;
}

/* -------------------------------------------------------------------------- */
/*                          工具执行结果契约                                     */
/* -------------------------------------------------------------------------- */

/**
 * 工具执行结果（标准化封装）
 * 统一成功/失败的结构，便于 AgentLoop 处理与回填
 */
export interface ToolExecutionResult {
  /** 工具名 */
  toolName: string;
  /** 调用 ID（与 LLM 返回的 tool_call_id 对应） */
  toolCallId: string;
  /** 是否执行成功 */
  ok: boolean;
  /** 执行结果文本（成功时为工具输出，失败时为错误信息） */
  content: string;
  /** 执行耗时（毫秒） */
  durationMs: number;
}

/* -------------------------------------------------------------------------- */
/*                      OpenAI Function Calling 协议适配                        */
/* -------------------------------------------------------------------------- */

/**
 * OpenAI tools 字段中的单个 function 描述
 * 用于将 ToolDef 转换为 LLM API 请求体格式
 */
export interface OpenAIToolFunction {
  /** 固定为 function */
  type: 'function';
  /** function 描述 */
  function: {
    name: string;
    description: string;
    parameters: ToolParametersSchema;
  };
}

/**
 * 将内部 ToolDef 转换为 OpenAI tools 字段格式
 * 供 LLMClient 构建请求体时使用
 * @param tool 工具定义
 * @returns OpenAI 协议格式的工具描述
 */
export function toOpenAITool(tool: ToolDef): OpenAIToolFunction {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/**
 * LLM 返回的工具调用（流式分片重组后的完整结构）
 */
export interface LLMToolCall {
  /** 调用 ID（回填 tool 结果时需要） */
  id: string;
  /** 工具名 */
  name: string;
  /** 参数（JSON 字符串，需解析） */
  arguments: string;
}

/* -------------------------------------------------------------------------- */
/*                              权限检查契约                                    */
/* -------------------------------------------------------------------------- */

/**
 * 权限检查结果（注入 ToolExecutor，由 AgentLoop 提供实现）
 * - approved=true  允许执行
 * - approved=false 拒绝执行，reason 回填给 LLM
 */
export interface PermissionDecision {
  approved: boolean;
  /** 拒绝原因（approved=false 时回填到工具结果，引导 LLM 自我修正） */
  reason?: string;
}

/**
 * 权限检查器契约
 * 由 AgentLoop 实现（内部根据 PermissionMode 与 PermissionGate 决策），
 * 注入 ToolExecutor，使执行器不直接依赖权限网关，便于测试与解耦。
 *
 * @param toolCall LLM 返回的工具调用
 * @param tool 工具定义
 * @returns 权限决策
 */
export type PermissionChecker = (
  toolCall: LLMToolCall,
  tool: ToolDef
) => Promise<PermissionDecision>;
