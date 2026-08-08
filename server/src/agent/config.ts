/**
 * Agent 调度内核 - 配置模块
 * 对标 BearCode agents/main.py 中的配置加载逻辑（轻量化 TS 重构）
 *
 * 核心职责：
 *   1. 读取 .env 环境变量，兼容 OpenAI 兼容接口
 *      （火山引擎 Ark / 阿里 DashScope / OpenAI 等均遵循 OpenAI 协议）
 *   2. 模型配置三级优先级：入参 overrides > 环境变量 > 默认值
 *   3. 权限模式枚举定义（default / plan / acceptEdits / bypassPermissions / dontAsk）
 *   4. 项目运行环境配置 + 预算参数（最大轮次、最大成本）解析
 *
 * 设计原则：
 *   - 严格 TypeScript，禁用 any（noImplicitAny + noExplicitAny）
 *   - 配置加载为纯函数，无副作用，便于测试
 *   - 与现有 server/src/config/index.ts 解耦，互不依赖
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

/**
 * 显式指定 .env 位置为 server/.env
 * （dotenv 默认从 cwd 读取，显式化可避免运行目录不同导致的读取失败）
 */
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/* -------------------------------------------------------------------------- */
/*                               默认值常量                                     */
/* -------------------------------------------------------------------------- */

/**
 * 默认 API 基础地址
 * 遵循项目硬约束：火山引擎 Ark OpenAI 兼容接入点
 */
const DEFAULT_API_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

/**
 * 默认模型名（推理接入点 ID）
 * 火山引擎必须使用 ep-xxxxxxxx 格式，禁止直接写模型名（会 404）
 */
const DEFAULT_MODEL_NAME = 'ep-xxxxxxxx';

/** 默认采样温度 */
const DEFAULT_TEMPERATURE = 0.7;

/** 默认单次最大输出 token */
const DEFAULT_MAX_TOKENS = 4096;

/** 默认最大迭代轮次（防止 Agent 主循环死循环） */
const DEFAULT_MAX_ROUNDS = 8;

/** 默认最大累计成本（美元），超出则 AgentLoop 中止 */
const DEFAULT_MAX_COST_USD = 1.0;

/** 默认单轮最大 token */
const DEFAULT_MAX_TOKENS_PER_ROUND = 4096;

/**
 * 默认最大上下文 token 数（模型窗口上限预留空间）
 * 按常见 128K 窗口预留 32K 给输出，剩余 96K 作为输入上限
 */
const DEFAULT_MAX_CONTEXT_TOKENS = 96000;

/**
 * 裁剪安全系数：当上下文逼近阈值时，提前裁剪避免超限
 * 例如阈值 96000 * 0.8 = 76800 token 时触发裁剪
 */
const DEFAULT_CONTEXT_TRIM_RATIO = 0.8;

/* -------------------------------------------------------------------------- */
/*                               权限模式枚举                                   */
/* -------------------------------------------------------------------------- */

/**
 * 权限模式枚举（对标 BearCode 的 PermissionMode）
 *
 * - Default            危险操作逐项询问用户确认
 * - Plan               仅规划不执行（只读模式，安全预览）
 * - AcceptEdits        自动允许文件编辑类操作，其他仍询问
 * - BypassPermissions  跳过所有权限检查（危险，仅限隔离沙箱使用）
 * - DontAsk            不询问但拒绝危险操作（静默拦截，记录日志）
 */
export enum PermissionMode {
  Default = 'default',
  Plan = 'plan',
  AcceptEdits = 'acceptEdits',
  BypassPermissions = 'bypassPermissions',
  DontAsk = 'dontAsk',
}

/** 全部合法权限模式字符串值集合，用于环境变量与 CLI 参数校验 */
const VALID_PERMISSION_MODES = new Set<string>(Object.values(PermissionMode));

/* -------------------------------------------------------------------------- */
/*                               配置类型定义                                   */
/* -------------------------------------------------------------------------- */

/** 模型配置（OpenAI 兼容接口） */
export interface ModelConfig {
  /** API Key（服务端保密，从 LLM_API_KEY 读取，禁止下发前端） */
  apiKey: string;
  /** API 基础地址，兼容 OpenAI 协议 */
  apiBaseUrl: string;
  /** 模型名或推理接入点 ID（火山引擎 ep-xxxxxxxx） */
  modelName: string;
  /** 采样温度，越高越发散 */
  temperature: number;
  /** 单次请求最大输出 token */
  maxTokens: number;
}

/** 预算参数（限制 Agent 运行成本与轮次，防失控） */
export interface BudgetConfig {
  /** 最大迭代轮次（AgentLoop 兜底中止条件） */
  maxRounds: number;
  /** 最大累计成本（美元），超出则中止 */
  maxCostUsd: number;
  /** 单轮最大 token 上限 */
  maxTokensPerRound: number;
}

/** 上下文窗口配置（会话短期记忆管控） */
export interface ContextWindowConfig {
  /** 最大上下文 token 数（输入上限） */
  maxContextTokens: number;
  /** 裁剪触发比率：当 token 数达到 max * ratio 时裁剪 */
  trimRatio: number;
  /** 每条消息的估算开销（role + metadata 等，单位 token） */
  perMessageOverhead: number;
}

/** 默认上下文窗口配置常量 */
export const DEFAULT_CONTEXT_WINDOW: Readonly<ContextWindowConfig> = Object.freeze({
  maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
  trimRatio: DEFAULT_CONTEXT_TRIM_RATIO,
  perMessageOverhead: 4,
});

/** 项目运行环境配置 */
export interface ProjectConfig {
  /** Agent 工作目录（工具执行的相对路径基准） */
  cwd: string;
  /** 项目根目录 */
  projectRoot: string;
  /** 项目名（从 package.json 读取，失败则取目录名） */
  name: string;
}

/** Agent 运行配置（聚合根） */
export interface AgentConfig {
  /** 模型与 API 配置 */
  model: ModelConfig;
  /** 权限模式 */
  permission: PermissionMode;
  /** 预算约束 */
  budget: BudgetConfig;
  /** 上下文窗口配置 */
  contextWindow: ContextWindowConfig;
  /** 项目环境 */
  project: ProjectConfig;
  /** 调试模式：输出详细日志 */
  debug: boolean;
}

/**
 * 外部传入的配置覆盖项（优先级最高）
 * 所有字段可选，仅覆盖显式传入的字段
 */
export interface ConfigOverrides {
  model?: Partial<ModelConfig>;
  permission?: PermissionMode;
  budget?: Partial<BudgetConfig>;
  contextWindow?: Partial<ContextWindowConfig>;
  project?: Partial<ProjectConfig>;
  debug?: boolean;
}

/* -------------------------------------------------------------------------- */
/*                              内部解析工具函数                                */
/* -------------------------------------------------------------------------- */

/**
 * 安全解析数字环境变量
 * @param envValue 环境变量原始值
 * @param fallback 解析失败时的回落值
 * @returns 解析后的数字
 */
function parseNumber(envValue: string | undefined, fallback: number): number {
  if (envValue === undefined || envValue.trim() === '') {
    return fallback;
  }
  const num = Number(envValue);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * 将字符串安全转换为 PermissionMode
 * 非法值回落到 Default 并打印警告
 * @param raw 原始字符串（来自环境变量或 CLI 参数）
 */
export function parsePermissionMode(raw: string | undefined): PermissionMode {
  if (!raw) {
    return PermissionMode.Default;
  }
  const trimmed = raw.trim();
  if (VALID_PERMISSION_MODES.has(trimmed)) {
    return trimmed as PermissionMode;
  }
  console.warn(`[AgentConfig] 非法权限模式 "${raw}"，回落到 default`);
  return PermissionMode.Default;
}

/**
 * 读取项目名：优先从 projectRoot/package.json 的 name 字段获取
 * 失败（文件不存在/解析异常）则回落到目录名
 * @param projectRoot 项目根目录绝对路径
 */
function resolveProjectName(projectRoot: string): string {
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent) as { name?: string };
      if (pkg.name && pkg.name.trim()) {
        return pkg.name.trim();
      }
    }
  } catch {
    // 读取或解析失败时静默回落到目录名
  }
  return path.basename(projectRoot) || 'unknown-project';
}

/* -------------------------------------------------------------------------- */
/*                              配置加载主逻辑                                  */
/* -------------------------------------------------------------------------- */

/**
 * 从环境变量构建基础配置（优先级最底层：默认值 < 环境变量）
 * 每个字段独立读取，缺失则使用默认值
 */
function loadFromEnv(): AgentConfig {
  const projectRoot = process.env.AGENT_PROJECT_ROOT ?? process.cwd();
  const cwd = process.env.AGENT_CWD ?? process.cwd();

  return {
    model: {
      apiKey: (process.env.LLM_API_KEY ?? '').trim(),
      apiBaseUrl: (process.env.LLM_API_BASE_URL ?? DEFAULT_API_BASE_URL).trim(),
      modelName: (process.env.LLM_MODEL_NAME ?? DEFAULT_MODEL_NAME).trim(),
      temperature: parseNumber(process.env.LLM_TEMPERATURE, DEFAULT_TEMPERATURE),
      maxTokens: parseNumber(process.env.LLM_MAX_TOKENS, DEFAULT_MAX_TOKENS),
    },
    permission: parsePermissionMode(process.env.AGENT_PERMISSION_MODE),
    budget: {
      maxRounds: parseNumber(process.env.AGENT_MAX_ROUNDS, DEFAULT_MAX_ROUNDS),
      maxCostUsd: parseNumber(process.env.AGENT_MAX_COST_USD, DEFAULT_MAX_COST_USD),
      maxTokensPerRound: parseNumber(
        process.env.AGENT_MAX_TOKENS_PER_ROUND,
        DEFAULT_MAX_TOKENS_PER_ROUND
      ),
    },
    contextWindow: {
      maxContextTokens: parseNumber(
        process.env.AGENT_MAX_CONTEXT_TOKENS,
        DEFAULT_MAX_CONTEXT_TOKENS
      ),
      trimRatio: parseNumber(
        process.env.AGENT_CONTEXT_TRIM_RATIO,
        DEFAULT_CONTEXT_TRIM_RATIO
      ),
      perMessageOverhead: DEFAULT_CONTEXT_WINDOW.perMessageOverhead,
    },
    project: {
      cwd,
      projectRoot,
      name: resolveProjectName(projectRoot),
    },
    debug: (process.env.AGENT_DEBUG ?? 'false').toLowerCase() === 'true',
  };
}

/**
 * 深度合并配置：base < overrides
 * 仅覆盖 overrides 中显式定义的字段，undefined 字段保留 base 值
 * @param base 环境变量层配置
 * @param overrides 外部覆盖项（可选）
 */
function mergeConfig(
  base: AgentConfig,
  overrides: ConfigOverrides | undefined
): AgentConfig {
  if (!overrides) {
    return base;
  }
  return {
    model: { ...base.model, ...overrides.model },
    permission: overrides.permission ?? base.permission,
    budget: { ...base.budget, ...overrides.budget },
    contextWindow: { ...base.contextWindow, ...overrides.contextWindow },
    project: { ...base.project, ...overrides.project },
    debug: overrides.debug ?? base.debug,
  };
}

/**
 * 加载 Agent 配置（统一入口）
 *
 * 优先级：入参 overrides > 环境变量 > 默认值
 *
 * @param overrides 外部覆盖项（CLI 参数 / API 入参 / 测试夹具）
 * @returns 完整的 AgentConfig（未校验，需配合 validateAgentConfig 使用）
 */
export function loadAgentConfig(
  overrides?: ConfigOverrides
): AgentConfig {
  const envConfig = loadFromEnv();
  return mergeConfig(envConfig, overrides);
}

/* -------------------------------------------------------------------------- */
/*                              配置校验逻辑                                    */
/* -------------------------------------------------------------------------- */

/**
 * 校验配置完整性，返回错误信息列表
 * 空数组表示校验通过
 *
 * 注意：校验不抛异常，由调用方决定如何处理（CLI 抛异常退出 / API 返回 400）
 * @param config 待校验配置
 */
export function validateAgentConfig(config: AgentConfig): string[] {
  const errors: string[] = [];

  // 模型配置必填项
  if (!config.model.apiKey) {
    errors.push('LLM_API_KEY 未配置（请在 server/.env 中设置）');
  }
  if (!config.model.apiBaseUrl) {
    errors.push('LLM_API_BASE_URL 未配置');
  }
  if (!config.model.modelName) {
    errors.push('LLM_MODEL_NAME（或推理接入点 ID ep-xxxxxxxx）未配置');
  }

  // 火山引擎 Ark 软性提醒：modelName 应为 ep- 开头
  if (
    config.model.apiBaseUrl.includes('volces.com') &&
    !config.model.modelName.startsWith('ep-')
  ) {
    errors.push(
      `火山引擎 Ark 必须使用推理接入点 ID（ep-xxxxxxxx），当前值 "${config.model.modelName}" 可能导致 404`
    );
  }

  // 预算参数合理性
  if (!Number.isFinite(config.budget.maxRounds) || config.budget.maxRounds < 1) {
    errors.push('budget.maxRounds 必须 >= 1');
  }
  if (!Number.isFinite(config.budget.maxCostUsd) || config.budget.maxCostUsd < 0) {
    errors.push('budget.maxCostUsd 必须 >= 0');
  }
  if (!Number.isFinite(config.model.temperature) || config.model.temperature < 0) {
    errors.push('model.temperature 必须 >= 0');
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/*                              默认配置导出                                    */
/* -------------------------------------------------------------------------- */

/** 默认配置常量（供测试与文档引用，不可变快照） */
export const DEFAULT_CONFIG: Readonly<AgentConfig> = Object.freeze({
  model: {
    apiKey: '',
    apiBaseUrl: DEFAULT_API_BASE_URL,
    modelName: DEFAULT_MODEL_NAME,
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
  },
  permission: PermissionMode.Default,
  budget: {
    maxRounds: DEFAULT_MAX_ROUNDS,
    maxCostUsd: DEFAULT_MAX_COST_USD,
    maxTokensPerRound: DEFAULT_MAX_TOKENS_PER_ROUND,
  },
  contextWindow: { ...DEFAULT_CONTEXT_WINDOW },
  project: {
    cwd: process.cwd(),
    projectRoot: process.cwd(),
    name: 'unknown-project',
  },
  debug: false,
});
