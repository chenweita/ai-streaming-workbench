import { Router, Request, Response } from 'express';
import { createLLMClient, LLMClient } from '../services/llmClient';
import { ChatMessage, SSEEventType } from '../../shared/types';

const router = Router();

/** 存储活动的LLM客户端实例（用于中断） */
const activeClients = new Map<string, LLMClient>();

/**
 * 将内部消息格式转换为LLM API格式
 */
function convertMessagesToLLMFormat(messages: ChatMessage[]): Array<{
  role: 'user' | 'assistant' | 'system';
  content: string;
}> {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

/**
 * SSE响应初始化
 * 设置必要的SSE响应头
 */
function initSSEResponse(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // 禁用代理缓冲，确保SSE能实时推送
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  // 立即刷新响应头
  res.flushHeaders();
}

/**
 * 写入SSE事件
 */
function writeSSEEvent(res: Response, type: SSEEventType, data: unknown): void {
  const event = { type, data };
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * POST /api/chat/stream
 * 流式对话接口
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
      res.status(400).json({
        code: 400,
        message: '参数错误',
        detail: 'messages 不能为空',
      });
      return;
    }

    // 初始化SSE响应
    initSSEResponse(res);

    // 生成请求ID
    const requestId = conversationId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 创建LLM客户端实例
    const llmClient = createLLMClient();
    activeClients.set(requestId, llmClient);

    // 发送开始事件
    const assistantMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    writeSSEEvent(res, 'message_start', {
      messageId: assistantMessageId,
    });

    // 转换消息格式
    const llmMessages = convertMessagesToLLMFormat(messages);

    // 调用LLM流式接口
    await llmClient.streamChat(
      llmMessages,
      {
        onDelta: (content: string) => {
          writeSSEEvent(res, 'message_delta', { content });
        },
        onDone: (usage) => {
          writeSSEEvent(res, 'message_end', {
            messageId: assistantMessageId,
            usage,
          });
          writeSSEEvent(res, 'done', { conversationId: requestId });
          res.end();
          activeClients.delete(requestId);
        },
        onError: (error: Error) => {
          console.error('LLM流式错误:', error.message);
          writeSSEEvent(res, 'error', {
            code: 'LLM_ERROR',
            message: error.message || 'AI服务暂时不可用',
          });
          res.end();
          activeClients.delete(requestId);
        },
      },
      { model, temperature, maxTokens }
    );
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
    res.status(400).json({
      code: 400,
      message: '参数错误',
      detail: 'requestId 不能为空',
    });
    return;
  }

  const client = activeClients.get(requestId);
  if (client) {
    client.abort();
    activeClients.delete(requestId);
    res.json({ success: true, message: '请求已中断' });
  } else {
    res.json({ success: false, message: '未找到活动的请求' });
  }
});

/**
 * GET /api/health
 * 健康检查接口
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeRequests: activeClients.size,
  });
});

export default router;
