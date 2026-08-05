import express from 'express';
import cors from 'cors';
import { config, validateConfig } from './config';
import { streamTimeoutMiddleware, requestLogger, errorHandler } from './middleware';
import chatRouter from './routes/chat';
import lintRouter from './routes/lint';

/**
 * Express应用初始化
 */
const app = express();

// 中间件配置
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS配置 - 白名单模式
app.use(
  cors({
    origin: (origin, callback) => {
      // 开发环境允许所有来源
      if (config.nodeEnv === 'development') {
        callback(null, true);
        return;
      }

      // 生产环境检查白名单
      if (!origin || config.cors.origin.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS策略不允许此来源'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Type'],
  })
);

// 请求日志
app.use(requestLogger);

// 流式请求超时处理（必须在路由之前）
app.use('/api/chat/stream', streamTimeoutMiddleware);

// API路由
app.use('/api', chatRouter);
app.use('/api', lintRouter);

// 错误处理
app.use(errorHandler);

// 启动服务
const startServer = (): void => {
  // 验证配置
  validateConfig();

  app.listen(config.port, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 AI流式对话工作台 - 后端服务启动');
    console.log('='.repeat(50));
    console.log(`📍 服务地址: http://localhost:${config.port}`);
    console.log(`🌍 环境: ${config.nodeEnv}`);
    console.log(`🤖 模型: ${config.llm.modelName}`);
    console.log(`🔗 API基础: ${config.llm.apiBaseUrl}`);
    console.log('='.repeat(50) + '\n');
  });
};

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在关闭服务...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('收到SIGINT信号，正在关闭服务...');
  process.exit(0);
});

// 启动
startServer();

export default app;
