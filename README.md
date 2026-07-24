# AI 流式对话工作台

基于 SSE (Server-Sent Events) 的实时流式 AI 对话系统。

## ✨ 特性

- 🚀 **实时流式输出** - 打字机逐字输出效果
- 💬 **多轮对话** - 完整上下文记忆
- 📝 **Markdown 渲染** - 代码高亮、表格、列表支持
- 💾 **会话持久化** - LocalStorage 自动保存
- 📱 **移动端适配** - vw 自适应布局
- 🔒 **安全设计** - API Key 隐藏在服务端
- ⚡ **异常容错** - 网络重连、超时捕获

## 🛠 技术栈

- **前端**: Vite + React 18 + TypeScript + Tailwind CSS
- **后端**: Node.js + Express
- **流式通信**: @microsoft/fetch-event-source (SSE)

## 🚀 快速开始

```bash
# 1. 克隆项目
git clone <repo-url>
cd ai-streaming-workbench

# 2. 安装依赖
npm install

# 3. 配置环境变量
cd server && cp .env.example .env
# 编辑 .env 设置你的 API Key

# 4. 启动开发
cd ../ && npm run dev

# 5. 访问应用
# 前端: http://localhost:5173
# 后端: http://localhost:3001
```

## 📁 项目结构

```
├── client/          # 前端 React 应用
├── server/          # 后端 Express 代理
├── shared/          # 共享类型定义
└── DEVELOPMENT.md   # 开发说明文档
```

## 📚 文档

详细开发说明请查看 [DEVELOPMENT.md](./DEVELOPMENT.md)

## 📝 License

MIT
