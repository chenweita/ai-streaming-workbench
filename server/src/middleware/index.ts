import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

/**
 * 流式请求超时中间件
 * 用于设置请求超时并正确处理SSE连接
 */
export function streamTimeoutMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 设置超时时间
  const timeout = config.request.timeout;

  const timeoutId = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({
        code: 504,
        message: '请求超时',
        detail: `请求在 ${timeout}ms 内未完成`,
      });
    } else {
      // SSE响应已开始，发送错误事件
      res.write(`data: ${JSON.stringify({ type: 'error', data: { code: 'TIMEOUT', message: '请求超时' } })}\n\n`);
      res.end();
    }
  }, timeout);

  // 请求完成时清除超时
  req.on('close', () => clearTimeout(timeoutId));
  res.on('finish', () => clearTimeout(timeoutId));
  res.on('close', () => clearTimeout(timeoutId));

  next();
}

/**
 * 请求日志中间件
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} ${duration}ms`
    );
  });

  next();
}

/**
 * 错误处理中间件
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error(`[ERROR] ${err.message}`);
  console.error(err.stack);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    detail: config.nodeEnv === 'development' ? err.message : undefined,
  });
}
