/**
 * Agent 调度内核 - CLI 入口
 * 对标 BearCode agents/main.py（轻量化 TS 重构）
 *
 * 核心职责：
 *   1. 解析命令行参数（极简自实现，避免引入 commander 等依赖）
 *   2. 加载配置（入参 > 环境变量 > 默认值）
 *   3. 提供工厂方法 createAgent 装配 Agent 实例
 *   4. main 入口可独立运行（npx ts-node src/agent/cli.ts --prompt "..."）
 *
 * 阶段说明：
 *   当前为【阶段1：入口配置调度】。Agent 类为骨架，run() 仅返回配置摘要，
 *   用于验证入口链路通畅。AgentLoop 主循环将在阶段2填充并迁移至
 *   runtime/AgentLoop.ts，本文件届时仅保留入口与工厂方法。
 */

import {
  loadAgentConfig,
  validateAgentConfig,
  parsePermissionMode,
  PermissionMode,
  type AgentConfig,
  type ConfigOverrides,
  type ModelConfig,
  type BudgetConfig,
  type ProjectConfig,
} from './config';

/* -------------------------------------------------------------------------- */
/*                          命令行参数解析（极简实现）                            */
/* -------------------------------------------------------------------------- */

/** CLI 解析结果 */
interface ParsedArgs {
  /** 解析出的配置覆盖项（优先级最高，将合并到 env 之上） */
  overrides: ConfigOverrides;
  /** 用户输入的提示文本（来自 --prompt / -p） */
  prompt: string | undefined;
  /** 是否请求帮助 */
  help: boolean;
}

/** boolean 类型标志位（无值，出现即为 true） */
const BOOLEAN_FLAGS = new Set<string>(['--debug', '--help', '-h']);

/**
 * 极简 argv 解析器
 * 支持两种语法：
 *   --key value
 *   --key=value
 * 不支持的语法会被静默忽略（保持容错）
 * @param argv 进程参数（已剔除 node 与脚本路径）
 */
function parseArgs(argv: string[]): ParsedArgs {
  // 分组覆盖项，便于判断是否有字段被设置
  const model: Partial<ModelConfig> = {};
  const budget: Partial<BudgetConfig> = {};
  const project: Partial<ProjectConfig> = {};
  let permission: PermissionMode | undefined;
  let debug: boolean | undefined;
  let prompt: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // 拆分 --key=value 形式
    const eqIdx = arg.indexOf('=');
    let key: string;
    let inlineValue: string | undefined;
    if (eqIdx > -1) {
      key = arg.slice(0, eqIdx);
      inlineValue = arg.slice(eqIdx + 1);
    } else {
      key = arg;
    }

    // boolean 标志位
    if (BOOLEAN_FLAGS.has(key)) {
      switch (key) {
        case '--debug':
          debug = true;
          break;
        case '--help':
        case '-h':
          help = true;
          break;
      }
      continue;
    }

    // 取值：优先用行内 =value，否则取下一个 argv
    const value = inlineValue ?? argv[++i];
    if (value === undefined) {
      continue;
    }

    switch (key) {
      // 模型相关
      case '--model':
        model.modelName = value;
        break;
      case '--base-url':
        model.apiBaseUrl = value;
        break;
      case '--api-key':
        model.apiKey = value;
        break;
      case '--temperature':
        model.temperature = Number(value);
        break;
      case '--max-tokens':
        model.maxTokens = Number(value);
        break;
      // 权限
      case '--permission':
        permission = parsePermissionMode(value);
        break;
      // 预算
      case '--max-rounds':
        budget.maxRounds = Number(value);
        break;
      case '--max-cost':
        budget.maxCostUsd = Number(value);
        break;
      // 项目
      case '--cwd':
        project.cwd = value;
        break;
      case '--project-root':
        project.projectRoot = value;
        break;
      // 提示
      case '--prompt':
      case '-p':
        prompt = value;
        break;
      default:
        // 未知参数忽略
        break;
    }
  }

  // 仅在分组有字段时挂到 overrides，避免空对象污染合并
  const overrides: ConfigOverrides = {
    model: Object.keys(model).length > 0 ? model : undefined,
    budget: Object.keys(budget).length > 0 ? budget : undefined,
    project: Object.keys(project).length > 0 ? project : undefined,
    permission,
    debug,
  };

  return { overrides, prompt, help };
}

/* -------------------------------------------------------------------------- */
/*                              Agent 实例（阶段1骨架）                          */
/* -------------------------------------------------------------------------- */

/**
 * Agent 实例（阶段1骨架）
 *
 * 当前仅持有配置，run() 返回占位响应以验证入口链路。
 * 阶段2将注入 AgentLoop（主循环）、ToolRegistry、PromptBuilder、Memory 等组件，
 * 届时本类迁移至 runtime/AgentRuntime.ts，run() 实现 ReAct 主循环。
 */
export class Agent {
  constructor(private readonly agentConfig: AgentConfig) {}

  /** 获取完整配置（只读引用） */
  getConfig(): AgentConfig {
    return this.agentConfig;
  }

  /** 获取权限模式 */
  getPermission(): PermissionMode {
    return this.agentConfig.permission;
  }

  /**
   * 运行 Agent（阶段1骨架）
   *
   * 阶段2将替换为：
   *   while iter < maxRounds and not finished:
   *     prompt = PromptBuilder(memory, tools)
   *     resp   = LLMClient.streamChat(prompt, tools)
   *     if resp.tool_calls: ToolExecutor.run() → 回灌 memory
   *     else: return final answer
   *
   * @param userInput 用户输入文本
   * @returns Agent 响应（当前为配置摘要占位）
   */
  async run(userInput: string): Promise<string> {
    const preview =
      userInput.length > 40 ? `${userInput.slice(0, 40)}...` : userInput;
    return [
      `[Agent 骨架 · 阶段1]`,
      `已接收输入：${preview}（共 ${userInput.length} 字符）`,
      `当前权限模式：${this.agentConfig.permission}`,
      `最大轮次预算：${this.agentConfig.budget.maxRounds}`,
      `主循环（AgentLoop）待阶段2实现。`,
    ].join('\n');
  }
}

/* -------------------------------------------------------------------------- */
/*                              工厂方法                                        */
/* -------------------------------------------------------------------------- */

/**
 * Agent 实例工厂方法（对标 BearCode main.py 中的 Agent 装配）
 *
 * 流程：加载配置（入参 > env > 默认）→ 校验 → 装配 Agent 实例
 *
 * @param overrides 配置覆盖项（CLI 参数 / API 入参 / 测试夹具）
 * @throws Error 配置校验失败时抛出，由调用方捕获处理
 */
export function createAgent(overrides?: ConfigOverrides): Agent {
  const config = loadAgentConfig(overrides);
  const errors = validateAgentConfig(config);
  if (errors.length > 0) {
    const detail = errors.map((e) => `  - ${e}`).join('\n');
    throw new Error(`Agent 配置校验失败:\n${detail}`);
  }
  return new Agent(config);
}

/* -------------------------------------------------------------------------- */
/*                              输出格式化                                      */
/* -------------------------------------------------------------------------- */

/**
 * 脱敏 API Key：保留前 6 位与后 4 位，中间用 **** 替代
 * @param apiKey 原始 Key
 */
function maskApiKey(apiKey: string): string {
  if (!apiKey) {
    return '(未配置)';
  }
  if (apiKey.length <= 10) {
    return '****';
  }
  return `${apiKey.slice(0, 6)}****${apiKey.slice(-4)}`;
}

/**
 * 打印 Agent 就绪横幅（配置摘要）
 * @param agent 已装配的 Agent 实例
 */
function printBanner(agent: Agent): void {
  const cfg = agent.getConfig();
  const line = '='.repeat(56);
  console.log(`\n${line}`);
  console.log('🤖 Agent 调度内核已就绪（阶段1：入口配置调度）');
  console.log(line);
  console.log(`📁 项目: ${cfg.project.name} (${cfg.project.cwd})`);
  console.log(`🧠 模型/接入点: ${cfg.model.modelName}`);
  console.log(`🌐 API 基础地址: ${cfg.model.apiBaseUrl}`);
  console.log(`🔑 API Key: ${maskApiKey(cfg.model.apiKey)}`);
  console.log(
    `🌡️  采样温度: ${cfg.model.temperature} | 最大输出Token: ${cfg.model.maxTokens}`
  );
  console.log(`🛡️  权限模式: ${cfg.permission}`);
  console.log(
    `⏱️  预算: 最大轮次=${cfg.budget.maxRounds} | 最大成本=$${cfg.budget.maxCostUsd} | 单轮Token=${cfg.budget.maxTokensPerRound}`
  );
  console.log(`🐛 调试模式: ${cfg.debug ? '开启' : '关闭'}`);
  console.log(line);
}

/** 打印帮助信息 */
function printHelp(): void {
  const helpText = `
Agent 调度内核 CLI（阶段1：入口配置调度）

用法:
  npx ts-node src/agent/cli.ts [选项] [--prompt "用户输入"]

模型配置（优先级：入参 > 环境变量 > 默认值）:
  --model <name>          模型名 / 推理接入点 ID（火山引擎 ep-xxxxxxxx）
  --base-url <url>        API 基础地址（OpenAI 兼容）
  --api-key <key>         API Key（生产环境请用 .env 配置，勿用此参数）
  --temperature <n>       采样温度（默认 0.7）
  --max-tokens <n>        单次最大输出 token（默认 4096）

权限与预算:
  --permission <mode>     权限模式: default | plan | acceptEdits | bypassPermissions | dontAsk
  --max-rounds <n>        最大迭代轮次（默认 8）
  --max-cost <n>          最大累计成本 USD（默认 1.0）

项目环境:
  --cwd <path>            Agent 工作目录
  --project-root <path>   项目根目录（用于读取 package.json 名称）

其他:
  -p, --prompt <text>     用户输入文本（执行后调用 agent.run）
  --debug                 开启调试日志
  -h, --help              显示本帮助

示例:
  npx ts-node src/agent/cli.ts --permission plan --max-rounds 5
  npx ts-node src/agent/cli.ts -p "帮我算下 23*17" --model ep-20250101xxxx
`;
  console.log(helpText);
}

/* -------------------------------------------------------------------------- */
/*                              main 入口                                      */
/* -------------------------------------------------------------------------- */

/**
 * CLI 主入口
 * 流程：解析参数 → 帮助分支 → 装配 Agent → 打印横幅 → 可选执行 run
 */
async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help) {
    printHelp();
    return;
  }

  // 工厂方法内部会校验配置，失败时抛异常
  const agent = createAgent(parsed.overrides);
  printBanner(agent);

  if (parsed.prompt) {
    console.log(`\n📤 用户输入: ${parsed.prompt}`);
    const result = await agent.run(parsed.prompt);
    console.log(`\n🤖 Agent 响应:\n${result}\n`);
  } else {
    console.log(
      '\n💡 未提供 --prompt，仅完成配置加载与 Agent 装配。使用 --help 查看可用参数。\n'
    );
  }
}

/**
 * 仅当本文件作为入口直接运行时触发 main
 * （被其他模块 import 时不执行，便于 Express 路由复用 createAgent）
 */
if (require.main === module) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Agent 启动失败:\n${message}\n`);
    process.exit(1);
  });
}
