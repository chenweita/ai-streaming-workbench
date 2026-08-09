import path from 'path';
import { Router, Request, Response } from 'express';
import { createLLMClient, LLMMessage } from '../services/llmClient';
import {
  ChatMessage,
  SSEEventType,
  SSEPermissionRequest,
  PermissionResponseBody,
} from '../types/shared';
import { createDefaultRegistry } from '../agent/tools/ToolRegistry';
import { ToolExecutor } from '../agent/tools/ToolExecutor';
import { AgentLoop, AgentLoopCallbacks } from '../agent/runtime/AgentLoop';
import { PermissionMode } from '../agent/config';
import { PermissionGate } from '../agent/permission/PermissionGate';
import { MemoryStore } from '../agent/memory/MemoryStore';
import { CompositeMemoryStore } from '../agent/memory/CompositeMemoryStore';

const router = Router();

/** 存储活动的 AgentLoop 实例（用于中断） */
const activeLoops = new Map<string, AgentLoop>();

/** 存储活动的权限网关实例（用于权限决策回传） */
const activeGates = new Map<string, PermissionGate>();

/**
 * 将内部 ChatMessage 转换为 LLM 消息格式
 * 仅保留 user/assistant/system 角色，丢弃 tool 角色（由 AgentLoop 内部管理）
 */
function convertMessagesToLLMFormat(messages: ChatMessage[]): LLMMessage[] {
  return messages
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system')
    .map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
}

/**
 * Agent 系统提示词
 * 引导 LLM 使用工具完成任务，而非直接拒绝
 */
const AGENT_SYSTEM_PROMPT = `你是一个能力强大的 AI 助手，可以使用以下工具帮助用户完成任务。

可用工具：
- list_files: 列出目录内容，浏览项目结构（只读）
- read_file: 读取文件内容（只读）
- grep_search: 正则搜索文件内容（只读）
- write_file: 将完整内容写入文件，覆盖已有内容或创建新文件（编辑，需用户授权）
- edit_file: 通过旧字符串替换为新字符串，局部编辑文件（编辑，需用户授权）
- save_memory: 将重要信息保存到长期记忆中，跨会话保留（编辑，需用户授权）
- delete_memory: 删除指定的长期记忆（编辑，需用户授权）

使用原则：
1. 当用户询问项目结构、文件内容、代码位置时，主动调用只读工具获取信息，不要凭空猜测
2. 当用户要求创建、修改文件时，使用 write_file 或 edit_file。这些操作会触发用户授权确认，被拒绝时应告知用户并停止
3. 当用户要求"记住"、"记下来"某条信息（如偏好、约定、重要信息）时，使用 save_memory 保存
4. 当用户要求"忘记"、"删除"某条记忆时，使用 delete_memory
5. 工具调用后，基于真实结果给出回答
6. 普通对话问题（如知识问答、文本生成）直接回答，无需调用工具
7. 工具调用失败时，告知用户失败原因，不要编造结果
8. edit_file 的 oldString 必须能唯一匹配文件内容，提供足够长的上下文避免歧义

⚠️ 重要：关于用户拒绝授权
- 如果用户拒绝了 save_memory 或 delete_memory 的授权，你必须：
  1. 立即停止调用任何记忆相关工具，不要重试
  2. 告知用户"已取消记忆操作，本次不会保存相关信息"
  3. 可以继续回答用户的其他问题，但不要再尝试记忆操作
- 同样的规则适用于 write_file / edit_file 等所有被拒绝的编辑工具

路径确认规则（重要）：
- 当用户指定的路径不存在时（如 list_files / read_file 返回"目录不存在"或"文件不存在"），必须先向用户确认正确路径，禁止自行假设路径并直接调用 write_file / edit_file
- 例如：用户说"在 src 下创建文件"但 src 目录不存在，你应该先问"根目录下没有 src 目录，你是指 client/src/ 还是 server/src/？"，而不是直接在根目录创建文件
- 不确定用户意图时，宁可多问一句，也不要猜测路径并执行写入操作`;

/**
 * SSE响应初始化
 * 设置必要的SSE响应头，关闭 TCP Nagle 算法与 HTTP 缓冲
 */
function initSSEResponse(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  // 关闭 TCP Nagle 算法
  const rawSocket: unknown = res.socket;
  if (rawSocket && typeof (rawSocket as { setNoDelay?: (n?: boolean) => void }).setNoDelay === 'function') {
    (rawSocket as { setNoDelay: (n?: boolean) => void }).setNoDelay(true);
  }
  res.flushHeaders();
}

/**
 * 写入SSE事件
 */
function writeSSEEvent(res: Response, type: SSEEventType, data: unknown): void {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * POST /api/chat/stream
 * 流式对话接口（接入 Agent 主循环，支持工具调用）
 */
router.post('/chat/stream', async (req: Request, res: Response) => {
  try {
    const { messages, conversationId, model, temperature, maxTokens } = req.body as {
      messages: ChatMessage[];
      conversationId?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    };

    // 参数校验
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ code: 400, message: '参数错误', detail: 'messages 不能为空' });
      return;
    }

    // 初始化SSE响应
    initSSEResponse(res);
    const requestId = conversationId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const assistantMessageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const streamStartTs = Date.now();

    console.log(`[SSE] ${new Date().toISOString()} 开始流: requestId=${requestId}`);

    // 发送消息开始事件（携带 requestId，前端回传权限决策时需要）
    writeSSEEvent(res, 'message_start', { messageId: assistantMessageId, requestId });

    // 初始化长期记忆存储（全局 + 项目双层）
    const projectRoot = path.resolve(process.cwd(), '..');

    // 全局记忆：~/.trae-cn/memory/user_profile.md
    const globalMemoryStore = new MemoryStore({
      scope: 'global',
      maxMemoryTokens: 1000,
    });
    console.log(
      `[Chat] 全局记忆: ${globalMemoryStore.getFilePath()}, 已有 ${globalMemoryStore.size()} 条`
    );

    // 项目记忆：~/.trae-cn/memory/projects/{path}/project_memory.md
    const projectMemoryStore = new MemoryStore({
      scope: 'project',
      projectPath: projectRoot,
      maxMemoryTokens: 1000,
    });
    console.log(
      `[Chat] 项目记忆: ${projectMemoryStore.getFilePath()}, 已有 ${projectMemoryStore.size()} 条`
    );

    // 组合记忆存储：自动路由 user_preference → 全局，其他 → 项目
    const compositeMemory = new CompositeMemoryStore(globalMemoryStore, projectMemoryStore);

    // 合并记忆摘要注入系统提示词
    const globalSummary = globalMemoryStore.buildMemorySummary();
    const projectSummary = projectMemoryStore.buildMemorySummary();
    const memorySummary = [globalSummary, projectSummary].filter(Boolean).join('\n');
    const finalSystemPrompt = memorySummary
      ? `${AGENT_SYSTEM_PROMPT}\n\n${memorySummary}`
      : AGENT_SYSTEM_PROMPT;

    const llmClient = createLLMClient();
    const registry = createDefaultRegistry(compositeMemory);
    const executor = new ToolExecutor(registry, projectRoot);

    // 权限网关：onPending 在挂起前同步触发，发 SSE permission_request 到前端
    const permissionGate = new PermissionGate({
      timeoutMs: 120000,
      onPending: (reqPayload) => {
        const ssePayload: SSEPermissionRequest = {
          ...reqPayload,
          requestId,
        };
        console.log(`[SSE] 推送 permission_request: ${reqPayload.toolName} permissionId=${reqPayload.permissionId}`);
        writeSSEEvent(res, 'permission_request', ssePayload);
      },
    });

    const agentLoop = new AgentLoop(llmClient, registry, executor, {
      cwd: projectRoot,
      maxRounds: 8,
      // Default 模式：编辑类工具触发权限确认弹窗
      // （只读工具在 executor 中不触发权限检查，自动放行）
      permission: PermissionMode.Default,
      model,
      temperature,
      maxTokens,
    }, permissionGate);
    activeLoops.set(requestId, agentLoop);
    activeGates.set(requestId, permissionGate);

    // SSE 连接断开清理（幂等）：用户关页面 / 网络中断时
    // 必须拒绝所有 pending 权限请求并中止 AgentLoop，防止内存泄漏与烧 token
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      permissionGate.cancelAll('SSE 连接已关闭');
      agentLoop.abort();
      activeLoops.delete(requestId);
      activeGates.delete(requestId);
      console.log(`[SSE] 清理完成: requestId=${requestId}`);
    };
    res.on('close', cleanup);

    // 转换消息格式
    const llmMessages = convertMessagesToLLMFormat(messages);

    // AgentLoop 回调：桥接到 SSE
    const loopCallbacks: AgentLoopCallbacks = {
      onDelta: (content: string) => {
        writeSSEEvent(res, 'message_delta', { content });
      },
      onToolCallStart: (toolCall) => {
        console.log(`[SSE] 推送 tool_call_start: ${toolCall.name}`);
        writeSSEEvent(res, 'tool_call_start', {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          arguments: toolCall.arguments,
        });
      },
      onToolResult: (result) => {
        console.log(`[SSE] 推送 tool_result: ${result.toolName} ok=${result.ok}`);
        writeSSEEvent(res, 'tool_result', {
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          ok: result.ok,
          content: result.content,
          durationMs: result.durationMs,
        });
      },
      onPermissionRequest: (reqPayload) => {
        // 备用钩子：实际 SSE 由 gate.onPending 发出，此处仅打日志
        console.log(`[AgentLoop] 权限请求通知: ${reqPayload.toolName}`);
      },
      onDone: (info) => {
        console.log(`[SSE] ${new Date().toISOString()} 流结束: requestId=${requestId} 耗时=${Date.now() - streamStartTs}ms 轮次=${info.iterations}`);
        writeSSEEvent(res, 'message_end', {
          messageId: assistantMessageId,
          iterations: info.iterations,
          maxReached: info.maxReached,
        });
        writeSSEEvent(res, 'done', { conversationId: requestId });
        res.end();
        cleanup();
      },
      onError: (error: Error) => {
        console.error('[SSE] AgentLoop 错误:', error.message);
        writeSSEEvent(res, 'error', {
          code: 'AGENT_ERROR',
          message: error.message || 'AI 服务暂时不可用',
        });
        res.end();
        cleanup();
      },
    };

    // 启动 Agent 主循环
    await agentLoop.run(finalSystemPrompt, llmMessages, loopCallbacks);
  } catch (error) {
    console.error('流式请求处理错误:', error);
    if (!res.headersSent) {
      res.status(500).json({
        code: 500,
        message: '服务器内部错误',
        detail: error instanceof Error ? error.message : String(error),
      });
    } else {
      writeSSEEvent(res, 'error', {
        code: 'SERVER_ERROR',
        message: error instanceof Error ? error.message : '服务器内部错误',
      });
      res.end();
    }
  }
});

/**
 * POST /api/chat/abort
 * 中断流式请求接口
 */
router.post('/chat/abort', (req: Request, res: Response) => {
  const { requestId } = req.body as { requestId?: string };
  if (!requestId) {
    res.status(400).json({ code: 400, message: '参数错误', detail: 'requestId 不能为空' });
    return;
  }
  const loop = activeLoops.get(requestId);
  const gate = activeGates.get(requestId);
  if (loop) {
    // 中断时同时拒绝所有 pending 权限请求
    gate?.cancelAll('用户主动中断');
    loop.abort();
    activeLoops.delete(requestId);
    activeGates.delete(requestId);
    res.json({ success: true, message: '请求已中断' });
  } else {
    res.json({ success: false, message: '未找到活动的请求' });
  }
});

/**
 * POST /api/chat/permission
 * 权限决策回传接口（前端弹窗用户点击同意/拒绝后调用）
 *
 * 请求体：{ requestId, permissionId, approved, reason? }
 * 响应：{ success: true } 成功唤醒；{ success: false, reason } 已决或不存在
 */
router.post('/chat/permission', (req: Request, res: Response) => {
  const { requestId, permissionId, approved, reason } = req.body as PermissionResponseBody;
  if (!requestId || !permissionId) {
    res.status(400).json({
      code: 400,
      message: '参数错误',
      detail: 'requestId 和 permissionId 不能为空',
    });
    return;
  }

  const gate = activeGates.get(requestId);
  if (!gate) {
    res.json({ success: false, reason: 'session-not-found' });
    return;
  }

  // 幂等：已决或不存在的 permissionId 返回 false
  const ok = gate.resolve(permissionId, {
    approved: !!approved,
    reason: reason || (approved ? '' : '用户拒绝'),
  });
  console.log(`[Permission] 决策回传: requestId=${requestId} permissionId=${permissionId} approved=${approved} ok=${ok}`);

  if (ok) {
    res.json({ success: true });
  } else {
    res.json({ success: false, reason: 'already-resolved-or-not-found' });
  }
});

/**
 * GET /api/health
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeRequests: activeLoops.size,
    pendingPermissions: activeGates.size,
  });
});

export default router;
