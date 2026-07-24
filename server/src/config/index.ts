import dotenv from 'dotenv';
import { ServerConfig } from '../types';

// 加载环境变量
dotenv.config();

/**
 * 服务端配置 - 从环境变量读取
 * 环境变量在 .env 文件中配置，不暴露到前端
 */
export const config: ServerConfig = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    apiBaseUrl:
      process.env.LLM_API_BASE_URL ||
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelName: process.env.LLM_MODEL_NAME || 'qwen-turbo',
  },
  cors: {
    origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(
      (origin) => origin.trim()
    ),
  },
  request: {
    timeout: Number(process.env.REQUEST_TIMEOUT) || 60000,
  },
};

/**
 * 验证必要的环境变量
 */
export function validateConfig(): boolean {
  const warnings: string[] = [];

  if (!config.llm.apiKey || config.llm.apiKey === 'your_api_key_here') {
    warnings.push(
      '⚠️  LLM_API_KEY 未配置或使用默认值，请在 .env 文件中设置真实的 API Key'
    );
  }

  if (warnings.length > 0) {
    console.warn('\n' + warnings.join('\n') + '\n');
    return false;
  }

  return true;
}
