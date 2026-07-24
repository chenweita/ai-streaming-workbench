/**
 * 后端环境配置接口
 */
export interface ServerConfig {
  port: number;
  nodeEnv: string;
  llm: {
    apiKey: string;
    apiBaseUrl: string;
    modelName: string;
  };
  cors: {
    origin: string[];
  };
  request: {
    timeout: number;
  };
}
