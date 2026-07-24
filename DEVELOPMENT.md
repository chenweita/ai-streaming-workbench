# AI流式对话工作台 - 开发说明文档

> 版本: 1.0.0  
> 更新日期: 2026-07-23  
> 适用于面试讲解与二次开发参考

---

## 一、项目概述

**AI流式对话工作台** 是一款基于 SSE (Server-Sent Events) 技术的实时流式对话系统，支持多轮对话、上下文记忆、代码高亮、Markdown渲染等功能。项目采用前后端分离架构，后端使用 Node.js + Express 作为 API 代理层，前端使用 React 18 + TypeScript + Tailwind CSS 构建。

### 核心特性

- ✅ **实时流式输出**：基于 SSE 协议实现打字机逐字输出效果
- ✅ **多轮对话**：完整携带历史上下文，支持上下文记忆
- ✅ **会话管理**：LocalStorage 持久化存储，支持新建/删除/切换会话
- ✅ **Markdown 渲染**：支持代码块高亮、表格、列表等富文本
- ✅ **移动端适配**：vw 自适应布局，一套代码支持 WebView Hybrid 环境
- ✅ **异常容错**：网络重连、请求超时、重复提交拦截
- ✅ **安全设计**：API Key 隐藏在服务端，前端零密钥暴露

---

## 二、技术选型理由

### 2.1 为什么选择 SSE 而非 WebSocket？

| 对比维度 | SSE | WebSocket |
|---------|-----|-----------|
| **协议标准** | HTTP 协议扩展，基于 HTTP/1.1+ | 独立的双向通信协议 |
| **服务端推送** | ✅ 天然支持 | ✅ 支持 |
| **客户端推送** | ❌ 需要额外 HTTP 请求 | ✅ 原生支持 |
| **浏览器兼容** | ✅ 所有现代浏览器支持 | ✅ 所有现代浏览器支持 |
| **代理/CDN 兼容** | ✅ 标准 HTTP 流量，易于穿透 | ❌ 需要专门配置 Upgrade |
| **连接复杂度** | 低，使用现有 HTTP 连接 | 高，需要升级协议 |
| **断线重连** | ✅ 自动重连（event-source 内置） | ❌ 需要手动实现 |
| **适用场景** | 单向服务端推送 | 双向实时通信 |

**SSE 选择理由：**

1. **场景匹配**：AI 对话场景是典型的"客户端发送 → 服务端流式返回"模式，不需要双向通信
2. **基础设施友好**：SSE 基于标准 HTTP，可轻松穿透企业防火墙、CDN、负载均衡
3. **自动重连**：`EventSource` API 内置断线自动重连机制，大幅简化代码
4. **资源占用低**：SSE 连接是 HTTP 长连接，相比 WebSocket 资源占用更少
5. **生态成熟**：`@microsoft/fetch-event-source` 提供了更灵活的控制能力

**为什么不用传统的 `EventSource`？**

原生 `EventSource` 存在以下限制：
- 不支持 POST 请求（AI 对话需要发送大体积消息体）
- 不支持自定义请求头（如 Authorization）
- 无法手动控制请求超时
- 不支持请求中断

`@microsoft/fetch-event-source` 完美解决了这些问题，提供了基于 `fetch` 的 SSE 实现。

### 2.2 前端技术栈选型

| 技术 | 版本 | 选型理由 |
|-----|------|---------|
| **React** | 18.2+ | 组件化开发、Hooks 生态成熟、社区活跃 |
| **TypeScript** | 5.2+ | 类型安全、IDE 智能提示、减少运行时错误 |
| **Vite** | 5.0+ | 极速冷启动、HMR 热更新、原生 ESM 支持 |
| **Tailwind CSS** | 3.4+ | 原子化 CSS、开发效率高、样式一致性好 |
| **React Markdown** | 9.0+ | Markdown 渲染、插件生态丰富 |
| **React Syntax Highlighter** | 15.5+ | 基于 Prism.js 的代码高亮、支持 200+ 语言 |

### 2.3 后端技术栈选型

| 技术 | 版本 | 选型理由 |
|-----|------|---------|
| **Node.js** | 20+ | 异步 I/O 天然适合流式处理、JavaScript 全栈统一 |
| **Express** | 4.18+ | 成熟稳定、社区支持好、灵活的中间件体系 |
| **@microsoft/fetch-event-source** | 3.0+ | 客户端 SSE 处理、支持中断/重试/超时 |

---

## 三、Node 代理层安全设计思路

### 3.1 安全威胁分析

| 威胁类型 | 风险等级 | 说明 |
|---------|---------|------|
| **API Key 泄露** | 🔴 高危 | 前端暴露 API Key 会导致被盗用和费用损失 |
| **CORS 跨域攻击** | 🟠 中危 | 恶意网站可能冒充用户发起请求 |
| **请求重放攻击** | 🟠 中危 | 攻击者重复发送相同请求消耗配额 |
| **中间人攻击** | 🟡 低危 | HTTP 传输过程中数据被窃取或篡改 |
| **请求参数篡改** | 🟡 低危 | 攻击者修改请求参数获取未授权响应 |

### 3.2 安全设计方案

#### 3.2.1 API Key 隔离

```
┌──────────┐     HTTPS     ┌──────────┐    内网     ┌──────────┐
│  前端应用  │ ──────────────> │  Node代理  │ ──────────> │  大模型API  │
└──────────┘                └──────────┘            └──────────┘
                                    │
                              API Key 存储在此
                              （环境变量 / 密钥管理服务）
```

**实现要点：**
- API Key 仅存储在服务端环境变量中（`.env` 文件）
- 前端与大模型 API 无直接通信，所有请求经代理中转
- 代理层对外暴露的是通用接口，不暴露任何大模型平台细节

#### 3.2.2 CORS 白名单策略

```typescript
// 生产环境配置
app.use(cors({
  origin: (origin, callback) => {
    // 检查白名单
    if (config.cors.origin.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS策略不允许此来源'));
    }
  },
  credentials: true,
}));
```

**安全增强：**
- 生产环境严格限制允许的来源域名
- 开发环境（`NODE_ENV=development`）放宽限制便于调试
- 支持携带 Cookie 的跨域请求（`credentials: true`）

#### 3.2.3 请求限流与验证

1. **参数校验**：服务端对所有请求参数进行严格验证
2. **速率限制**：防止单用户频繁请求消耗 API 配额
3. **请求超时**：设置合理的请求超时时间（默认 60s）
4. **错误脱敏**：生产环境不返回详细的错误堆栈信息

#### 3.2.4 HTTPS 强制传输

```
# 生产环境必须启用 HTTPS
server {
  listen 443 ssl http2;
  server_name your-domain.com;
  
  ssl_certificate     /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;
  
  # HTTP 重定向到 HTTPS
  location / {
    proxy_pass http://backend;
  }
}
```

### 3.3 服务端核心中间件

```
请求链路：
Client → [CORS校验] → [参数验证] → [限流检查] → [业务处理] → [SSE流转发] → Client
                                                              ↓
                                                        [超时控制]
                                                        [错误处理]
```

---

## 四、移动端适配方案细节

### 4.1 视口单位策略

本项目采用 **混合单位方案**：

```css
/* 基准设置 */
html {
  font-size: 16px;  /* 基准字号 */
}

body {
  /* 同时设置两种视口高度，兼容不同浏览器 */
  min-height: 100vh;
  min-height: 100dvh;  /* 动态视口高度，更准确 */
}

/* 响应式断点 */
.sidebar {
  width: 72vw;     /* 移动端：使用 vw 单位 */
  max-width: 280px; /* 限制最大宽度 */
}

@media (min-width: 768px) {
  .sidebar {
    width: 256px;   /* 桌面端：固定像素 */
  }
}
```

### 4.2 Safe Area 适配

```css
.safe-area-bottom {
  /* 适配 iPhone 底部安全区（如 Home Indicator） */
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.safe-area-top {
  /* 适配 iPhone 顶部刘海区域 */
  padding-top: env(safe-area-inset-top, 0);
}

/* 实际应用 - 底部输入栏 */
.input-container {
  padding-bottom: env(safe-area-inset-bottom, 0);
}
```

### 4.3 Touch 优化

```css
/* 禁用移动端点击高亮 */
* {
  -webkit-tap-highlight-color: transparent;
}

/* 优化滚动体验 */
.scroll-container {
  -webkit-overflow-scrolling: touch;  /* iOS 惯性滚动 */
  scroll-behavior: smooth;
}

/* 输入框允许文本选择 */
input, textarea {
  -webkit-user-select: text;
  user-select: text;
}
```

### 4.4 响应式布局方案

#### 4.4.1 侧边栏自适应

```
┌─────────────────────────────────────────┐
│           移动端 (< 768px)              │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │
│  │         主聊天区域               │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│  │ 输入栏                          │    │
│  └─────────────────────────────────┘    │
│                                         │
│  侧边栏：抽屉模式，点击按钮展开       │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│           桌面端 (≥ 768px)             │
│  ┌──────────┬──────────────────────┐    │
│  │          │                      │    │
│  │  侧边栏   │     主聊天区域        │    │
│  │  256px   │                      │    │
│  │          │                      │    │
│  └──────────┴──────────────────────┘    │
│  │          │ 输入栏               │    │
│  └──────────┴──────────────────────┘    │
└─────────────────────────────────────────┘
```

#### 4.4.2 消息气泡自适应

```typescript
// 根据屏幕宽度动态调整最大宽度
.message-bubble {
  max-width: 85vw;           // 移动端：85% 视口宽度
}

@media (min-width: 768px) {
  .message-bubble {
    max-width: 70%;          // 平板：70% 容器宽度
  }
}

@media (min-width: 1024px) {
  .message-bubble {
    max-width: 60%;          // 桌面：60% 容器宽度
  }
}
```

### 4.5 WebView Hybrid 环境注意事项

1. **桥接通信**：如需与原生 App 通信，可通过 `window.postMessage` 或特定 JS Bridge
2. **性能优化**：WebView 中避免频繁的 DOM 操作和重排
3. **存储兼容**：iOS Safari 的 LocalStorage 有容量限制（约 5MB），注意清理策略
4. **离线可用**：建议配合 Service Worker 实现离线缓存

---

## 五、项目目录结构

```
ai-streaming-workbench/
├── client/                          # 前端项目
│   ├── src/
│   │   ├── components/              # UI 组件
│   │   │   ├── Sidebar.tsx          # 侧边栏组件
│   │   │   ├── ChatArea.tsx         # 聊天区域组件
│   │   │   ├── MessageBubble.tsx    # 消息气泡组件
│   │   │   ├── InputBar.tsx         # 输入栏组件
│   │   │   ├── NetworkBanner.tsx    # 网络状态提示
│   │   │   └── ErrorToast.tsx       # 错误提示组件
│   │   ├── hooks/                   # 自定义 Hooks
│   │   │   ├── useStreamChat.ts     # 流式对话 Hook
│   │   │   ├── useConversation.ts   # 会话管理 Hook
│   │   │   └── useNetworkStatus.ts  # 网络状态 Hook
│   │   ├── services/                # 服务层
│   │   │   ├── apiClient.ts         # API 客户端封装
│   │   │   └── storage.ts           # 本地存储服务
│   │   ├── types/                   # TypeScript 类型定义
│   │   │   └── index.ts             # 全局接口类型
│   │   ├── utils/                   # 工具函数
│   │   │   └── helpers.ts           # 通用帮助函数
│   │   ├── styles/                  # 样式文件
│   │   │   └── index.css            # 全局样式
│   │   ├── App.tsx                  # 应用主组件
│   │   └── main.tsx                 # 入口文件
│   ├── index.html                   # HTML 模板
│   ├── vite.config.ts               # Vite 配置
│   ├── tailwind.config.js           # Tailwind 配置
│   ├── postcss.config.js            # PostCSS 配置
│   └── package.json                 # 前端依赖
│
├── server/                          # 后端项目
│   ├── src/
│   │   ├── config/                  # 配置层
│   │   │   └── index.ts             # 服务端配置
│   │   ├── middleware/              # 中间件
│   │   │   └── index.ts             # 超时/日志/错误处理
│   │   ├── routes/                  # 路由层
│   │   │   └── chat.ts              # 对话相关路由
│   │   ├── services/               # 业务服务层
│   │   │   └── llmClient.ts        # LLM 客户端
│   │   ├── types/                   # 类型定义
│   │   │   └── index.ts             # 服务端类型
│   │   └── index.ts                 # 服务入口
│   ├── tsconfig.json                # TypeScript 配置
│   └── package.json                 # 后端依赖
│
├── shared/                          # 前后端共享类型
│   └── types.ts                     # 公共接口定义
│
├── .gitignore                       # Git 忽略规则
├── package.json                     # 根目录脚本配置
└── README.md                        # 项目说明
```

---

## 六、快速开始

### 6.1 环境要求

```
Node.js >= 18.0.0
npm >= 9.0.0
```

### 6.2 安装步骤

```bash
# 1. 克隆项目
git clone <repository-url>
cd ai-streaming-workbench

# 2. 安装根目录依赖（用于同时启动前后端）
npm install

# 3. 安装后端依赖
cd server
npm install
# 或返回根目录执行
cd .. && npm run dev:server

# 4. 配置环境变量
cd server
cp .env.example .env
# 编辑 .env 文件，填入真实的 API Key
```

### 6.3 配置 API Key

```bash
# 编辑 server/.env 文件
vim server/.env

# 填入你的 API Key
LLM_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
LLM_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL_NAME=qwen-turbo
```

### 6.4 启动项目

```bash
# 方式一：同时启动前后端（推荐开发使用）
npm run dev

# 方式二：分别启动
# 终端1 - 后端服务
cd server && npm run dev

# 终端2 - 前端服务
cd client && npm run dev
```

### 6.5 访问应用

- 前端：http://localhost:5173
- 后端 API：http://localhost:3001/api/health

### 6.6 构建生产版本

```bash
# 构建前端
cd client && npm run build

# 构建后端
cd server && npm run build

# 运行生产版本
cd server && npm run start
```

---

## 七、核心代码说明

### 7.1 useStreamChat Hook 核心逻辑

```typescript
// 使用示例
const {
  messages,          // 消息列表
  isLoading,         // 加载状态
  isStreaming,       // 流式输出中
  sendMessage,       // 发送消息
  abortRequest,      // 中断请求
  clearMessages,     // 清空消息
} = useStreamChat(initialMessages, {
  conversationId: 'conv_xxx',
  model: 'qwen-turbo',
  temperature: 0.7,
});
```

**内部流程：**
1. 用户发送消息 → 创建用户消息 + AI占位消息（空内容）
2. 调用 SSE 接口 → 设置 loading 状态
3. 接收 `message_start` → 设置 streaming 状态
4. 接收 `message_delta` → 增量更新 AI 消息内容（打字机效果）
5. 接收 `message_end` → 记录 Token 使用量
6. 接收 `done` → 完成，重置状态

### 7.2 SSE 事件协议

```
// 请求
POST /api/chat/stream
Content-Type: application/json

{
  "messages": [...],
  "model": "qwen-turbo",
  "stream": true
}

// 响应事件流
event: message_start
data: {"messageId": "msg_xxx"}

event: message_delta
data: {"content": "你"}

event: message_delta
data: {"content": "好"}

event: message_delta
data: {"content": "！"}

event: message_end
data: {"messageId": "msg_xxx", "usage": {...}}

event: done
data: {"conversationId": "conv_xxx"}
```

### 7.3 异常处理策略

| 异常场景 | 处理方式 |
|---------|---------|
| **网络断开** | 实时监听 `online/offline` 事件，显示网络状态横幅 |
| **请求超时** | 后端设置 60s 超时，触发 504 状态码，前端捕获并提示 |
| **中断请求** | 用户主动点击"停止生成"按钮，调用 AbortController 中断 |
| **重复提交** | 使用 `submittingLockRef` 锁机制，防止消息重复发送 |
| **JSON 解析失败** | try-catch 保护，忽略异常事件继续处理 |
| **API Key 无效** | 后端返回 401/403 状态码，前端显示错误提示 |

---

## 八、国内大模型兼容性

### 8.1 支持的大模型厂商

| 厂商 | API Base URL | 模型示例 |
|-----|-------------|---------|
| **阿里云百炼** | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-turbo, qwen-max |
| **百度千帆** | `https://aip.baidubce.com/rpc/2.0/ai_custom/v1` | ernie-8.0 |
| **腾讯混元** | `https://api.hunyuan.cloud.tencent.com/v1` | hunyuan-lite |
| **字节豆包** | `https://ark.cn-beijing.volces.com/api/v3` | doubao-pro-32k |
| **科大讯飞** | `https://spark-api.xf-yun.com/v3.5` | spark3.5-turbo |

### 8.2 切换模型配置

只需修改 `.env` 文件即可：

```bash
# 阿里云百炼
LLM_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL_NAME=qwen-turbo

# 百度千帆
LLM_API_BASE_URL=https://aip.baidubce.com/rpc/2.0/ai_custom/v1
LLM_MODEL_NAME=ernie-8.0
```

---

## 九、面试讲解要点

### 9.1 技术亮点（面试重点）

1. **SSE vs WebSocket 选型分析**
   - 场景驱动的技术选型，不是为了炫技而炫技
   - SSE 更适合 AI 对话的单向流式输出场景
   - 基础设施兼容性更好，部署成本更低

2. **API Key 安全隔离**
   - 前端零密钥暴露
   - 代理层统一处理请求和响应
   - CORS 白名单 + HTTPS 加密传输

3. **React Hooks 最佳实践**
   - 自定义 Hook 封装业务逻辑
   - `useStreamChat` 封装流式通信
   - `useConversation` 封装会话管理
   - 组件拆分为 Presentational + Container

4. **移动端适配方案**
   - vw + flex 混合布局
   - Safe Area 适配刘海屏
   - Touch 体验优化
   - 响应式断点设计

5. **工程化规范**
   - 严格 TS 类型定义，禁用 `any`
   - 目录结构分层清晰
   - 通用逻辑抽离至 hooks/utils
   - 完整的代码注释

### 9.2 可扩展方向

- [ ] 用户认证与权限管理
- [ ] 多模型切换功能
- [ ] 会话导出（Markdown/PDF）
- [ ] 消息搜索功能
- [ ] RAG 知识库集成
- [ ] 多模态支持（图片理解）
- [ ] 语音输入/输出

---

## 十、常见问题

### Q1: 如何修改默认模型？
修改 `server/.env` 文件中的 `LLM_MODEL_NAME` 配置即可。

### Q2: 如何支持多个用户？
当前使用 LocalStorage 存储，适合单用户场景。多用户需要引入后端数据库和用户认证系统。

### Q3: 会话历史会丢失吗？
会话存储在浏览器 LocalStorage 中，清理浏览器数据会导致丢失。建议定期导出重要会话。

### Q4: 如何部署到生产环境？
1. 构建前端：`cd client && npm run build`
2. 将 `client/dist` 产物部署到静态服务器或 CDN
3. 构建并启动后端：`cd server && npm run build && npm run start`
4. 使用 Nginx 反向代理，配置 HTTPS

### Q5: SSE 连接被代理服务器中断怎么办？
- 确保 Nginx 配置 `proxy_read_timeout 300s;`
- 设置 SSE 响应头 `X-Accel-Buffering: no` 禁用缓冲
- 客户端实现自动重连机制

---

## 附录

### A. 依赖版本清单

**前端依赖：**
```json
{
  "@microsoft/fetch-event-source": "^3.0.1",
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "react-markdown": "^9.0.1",
  "react-syntax-highlighter": "^15.5.0",
  "rehype-highlight": "^7.0.0",
  "remark-gfm": "^4.0.0",
  "clsx": "^2.0.0"
}
```

**后端依赖：**
```json
{
  "cors": "^2.8.5",
  "express": "^4.18.2",
  "dotenv": "^16.3.1"
}
```

### B. 性能优化建议

1. **组件懒加载**：可使用 `React.lazy()` + `Suspense` 实现代码分割
2. **虚拟滚动**：长列表可引入 `react-window` 优化渲染性能
3. **请求缓存**：对重复问题可缓存响应结果
4. **防抖节流**：用户输入可使用 `debounce` 优化

### C. 参考资源

- [MDN SSE 文档](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events)
- [@microsoft/fetch-event-source](https://github.com/Azure/fetch-event-source)
- [React 官方文档](https://react.dev/)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)

---

**文档结束**
