/**
 * MessageBubble组件
 * 单条消息气泡
 * - 支持用户/AI消息样式区分
 * - Markdown渲染
 * - 代码块高亮
 * - 流式输出打字机效果
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ChatMessage } from '../types';
import { formatTimestamp } from '../utils/helpers';

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

/**
 * MessageBubble组件
 */
export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isStreaming = false,
}) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // 系统消息样式
  if (isSystem) {
    return (
      <div className="flex justify-center my-4">
        <div className="message-bubble bg-chat-system text-gray-700 text-xs py-2 px-4">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2 my-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* 头像 */}
      <div
        className={`flex-shrink-0 w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-white text-sm font-medium ${
          isUser ? 'bg-primary-500' : 'bg-gray-700'
        }`}
      >
        {isUser ? '我' : 'AI'}
      </div>

      {/* 消息内容 */}
      <div
        className={`message-bubble ${
          isUser ? 'message-bubble-user' : 'message-bubble-assistant'
        }`}
      >
        {/* 消息元信息 */}
        <div
          className={`flex items-center gap-2 text-xs mb-1 ${
            isUser ? 'text-primary-200' : 'text-gray-500'
          }`}
        >
          <span>{isUser ? '我' : 'AI助手'}</span>
          <span>{formatTimestamp(message.createdAt, 'time')}</span>
          {message.status === 'error' && (
            <span className="text-red-500">错误</span>
          )}
        </div>

        {/* 消息内容 - Markdown或纯文本 */}
        <div
          className={`markdown-content ${
            isStreaming && !isUser ? 'typing-cursor' : ''
          }`}
        >
          {isUser ? (
            // 用户消息使用纯文本
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            // AI消息使用Markdown渲染
            <MarkdownRenderer content={message.content} isStreaming={isStreaming} />
          )}
        </div>

        {/* Token使用量显示 */}
        {message.usage && (
          <div
            className={`text-xs mt-2 pt-2 border-t ${
              isUser ? 'border-primary-400 text-primary-200' : 'border-gray-200 text-gray-400'
            }`}
          >
            <span>Token用量: </span>
            <span>输入 {message.usage.promptTokens}</span>
            <span> · </span>
            <span>输出 {message.usage.completionTokens}</span>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Markdown渲染器组件
 */
interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  if (!content) {
    return (
      <div className="flex items-center gap-1 py-2">
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    );
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const codeString = String(children).replace(/\n$/, '');

          // react-markdown v9 不再传递 inline 属性
          // 通过检查是否有 language- 类名来判断是否为代码块
          if (match) {
            return (
              <div className="code-block">
                <div className="code-block-header">
                  <span>{match[1]}</span>
                  <span className="text-xs">代码块</span>
                </div>
                <SyntaxHighlighter
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: '0 0 0.5rem 0.5rem',
                    fontSize: '0.875rem',
                  }}
                  {...props}
                >
                  {codeString}
                </SyntaxHighlighter>
              </div>
            );
          }

          // 行内代码
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        // 自定义表格样式
        table({ children, ...props }) {
          return (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full border-collapse" {...props}>
                {children}
              </table>
            </div>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
};
