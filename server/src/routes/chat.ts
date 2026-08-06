import path from 'path';
import { Router, Request, Response } from 'express';
import { createLLMClient, LLMMessage } from '../services/llmClient';
import { ChatMessage, SSEEventType } from '../types/shared';
import { createDefaultRegistry } from '../agent/tools/ToolRegistry';
import { ToolExecutor } from '../agent/tools/ToolExecutor';
import { AgentLoop, AgentLoopCallbacks } from '../agent/runtime/AgentLoop';
import { PermissionMode } from '../agent/config';

const router = Router();

/** 存储活动的 AgentLoop 实例（用于中断） */
const activeLoops = new Map<string, AgentLoop>();

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
- list_files: 列出目录内容，浏览项目结构
- read_file: 读取文件内容
- grep_search: 正则搜索文件内容

使用原则：
1. 当用户询问项目结构、文件内容、代码位置时，主动调用工具获取信息，不要凭空猜测
2. 工具调用后，基于真实结果给出回答
3. 普通对话问题（如知识问答、文本生成）直接回答，无需调用工具
4. 工具调用失败时，告知用户失败原因，不要编造结果`;

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

    // 发送消息开始事件
    writeSSEEvent(res, 'message_start', { messageId: assistantMessageId });

    // 装配 Agent 组件
    // 工具工作目录指向项目根目录（server/ 的上一级），确保能访问完整项目结构
    const projectRoot = path.resolve(process.cwd(), '..');
    const llmClient = createLLMClient();
    const registry = createDefaultRegistry();
    const executor = new ToolExecutor(registry, projectRoot);
    const agentLoop = new AgentLoop(llmClient, registry, executor, {
      cwd: projectRoot,
      maxRounds: 8,
      permission: PermissionMode.BypassPermissions, // 当前阶段只读工具直接放行
      model,
      temperature,
      maxTokens,
    });
    activeLoops.set(requestId, agentLoop);

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
      onDone: (info) => {
        console.log(`[SSE] ${new Date().toISOString()} 流结束: requestId=${requestId} 耗时=${Date.now() - streamStartTs}ms 轮次=${info.iterations}`);
        writeSSEEvent(res, 'message_end', {
          messageId: assistantMessageId,
          iterations: info.iterations,
          maxReached: info.maxReached,
        });
        writeSSEEvent(res, 'done', { conversationId: requestId });
        res.end();
        activeLoops.delete(requestId);
      },
      onError: (error: Error) => {
        console.error('[SSE] AgentLoop 错误:', error.message);
        writeSSEEvent(res, 'error', {
          code: 'AGENT_ERROR',
          message: error.message || 'AI 服务暂时不可用',
        });
        res.end();
        activeLoops.delete(requestId);
      },
    };

    // 启动 Agent 主循环
    await agentLoop.run(AGENT_SYSTEM_PROMPT, llmMessages, loopCallbacks);
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
  if (loop) {
    loop.abort();
    activeLoops.delete(requestId);
    res.json({ success: true, message: '请求已中断' });
  } else {
    res.json({ success: false, message: '未找到活动的请求' });
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
  });
});

export default router;
