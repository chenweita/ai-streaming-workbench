/**
 * Mock API服务
 * 当后端不可用时，提供模拟的流式响应
 * 用于开发测试和演示
 */
import { StreamChatParams } from '../types';
import { StreamCallbacks } from './apiClient';
import { generateId } from '../utils/helpers';

/**
 * 模拟的AI响应模板
 */
const MOCK_RESPONSES: string[] = [
  `你好！我是AI助手，很高兴为你提供帮助。

我可以协助你完成以下任务：
- 📝 内容创作：文章、文案、邮件等
- 💻 代码编写：编程、调试、优化建议
- 📊 数据分析：解读数据、生成报告
- 💡 创意思考：头脑风暴、方案设计

请告诉我你具体需要什么帮助？`,

  `这是一个很好的问题！让我为你详细解答：

## 主要观点

1. **首先**，需要理解问题的核心本质
2. **其次**，考虑可行的解决方案
3. **最后**，评估方案的优缺点

## 建议

我建议你从以下几个方面入手：
- 明确目标和约束条件
- 收集相关信息和数据
- 制定详细的执行计划

希望这些建议对你有帮助！`,

  `好的，我来帮你写一段代码：

\`\`\`javascript
// 一个简单的示例函数
function processData(data) {
  // 验证输入
  if (!data || !Array.isArray(data)) {
    throw new Error('输入必须是非空数组');
  }

  // 处理数据
  const result = data
    .filter(item => item != null)
    .map(item => ({
      ...item,
      processed: true,
      timestamp: Date.now()
    }))
    .sort((a, b) => b.timestamp - a.timestamp);

  return result;
}

// 使用示例
const input = [
  { id: 1, name: '张三' },
  { id: 2, name: '李四' },
  null,
  { id: 3, name: '王五' }
];

const output = processData(input);
console.log(output);
\`\`\`

这段代码展示了数据处理的基本模式，包括验证、转换和排序。`,

  `让我为你提供一些实用的建议：

## 提升效率的5个技巧

### 1. 制定优先级
- 区分紧急和重要的任务
- 使用四象限分析法
- 集中精力处理高价值任务

### 2. 批量处理
- 将相似任务集中处理
- 减少上下文切换成本
- 利用时间块工作法

### 3. 自动化重复工作
- 识别可自动化的流程
- 使用工具和脚本
- 建立标准操作流程

### 4. 定期回顾和总结
- 每日回顾进度
- 每周总结经验
- 持续优化方法

### 5. 保持身心健康
- 合理安排休息时间
- 保持运动和学习
- 维护良好的工作环境

希望这些建议能帮助你提升效率！`,
];

/**
 * 从模板中选择一个响应
 */
function selectMockResponse(params: StreamChatParams): string {
  // 根据消息内容选择合适的响应
  const lastMessage = params.messages[params.messages.length - 1];
  const content = lastMessage?.content || '';

  // 简单的关键词匹配
  if (/代码|编程|函数|程序|bug/i.test(content)) {
    return MOCK_RESPONSES[2];
  } else if (/效率|管理|时间|计划/i.test(content)) {
    return MOCK_RESPONSES[3];
  } else if (/你好|hi|hello|介绍/i.test(content)) {
    return MOCK_RESPONSES[0];
  } else {
    return MOCK_RESPONSES[1];
  }
}

/**
 * Mock SSE请求
 * 模拟流式响应
 * @param url 请求URL（用于日志）
 * @param body 请求体
 * @param callbacks 事件回调
 * @returns AbortController用于中断
 */
export function createMockStreamRequest(
  url: string,
  body: StreamChatParams,
  callbacks: StreamCallbacks
): AbortController {
  const abortController = new AbortController();
  const assistantMessageId = generateId('msg');
  const requestId = body.conversationId || generateId('req');

  // 选择响应模板
  const response = selectMockResponse(body);

  // 计算token使用量（模拟）
  const promptTokens = body.messages.reduce((acc, msg) => acc + msg.content.length, 0);
  const completionTokens = response.length;

  // 模拟消息开始
  console.log('[Mock] SSE连接:', url);
  setTimeout(() => {
    if (abortController.signal.aborted) return;

    callbacks.onMessageStart?.({ messageId: assistantMessageId, requestId });

    // 逐字输出模拟
    let index = 0;
    const chunkSize = 2; // 每次输出2个字符，更自然

    const timer = setInterval(() => {
      if (abortController.signal.aborted) {
        clearInterval(timer);
        return;
      }

      // 输出一个chunk
      const chunk = response.slice(index, index + chunkSize);
      if (chunk) {
        callbacks.onMessageDelta?.({ content: chunk });
        index += chunkSize;
      } else {
        // 输出完成
        clearInterval(timer);

        setTimeout(() => {
          if (abortController.signal.aborted) return;

          callbacks.onMessageEnd?.({
            messageId: assistantMessageId,
            usage: {
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
            },
          });

          callbacks.onDone?.({ conversationId: requestId });
          console.log('[Mock] SSE响应完成');
        }, 300);
      }
    }, 30); // 每30ms输出一个chunk，模拟打字机效果
  }, 500); // 500ms延迟模拟思考时间

  // 监听中断信号
  abortController.signal.addEventListener('abort', () => {
    console.log('[Mock] 请求已中断');
  });

  return abortController;
}
