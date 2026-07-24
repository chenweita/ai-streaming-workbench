import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vite配置文件
 * - React插件支持
 * - 路径别名配置 (@/ 指向 src/)
 * - 开发环境代理配置（转发到后端服务）
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // 开发环境API代理
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // SSE请求特殊处理
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, req) => {
            // 为SSE请求禁用代理缓冲
            if (req.headers.accept?.includes('text/event-stream')) {
              req.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
  // 构建配置
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
  },
});
