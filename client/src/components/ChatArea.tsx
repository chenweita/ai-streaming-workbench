/**
 * ChatArea组件
 * 主聊天区域
 * - 消息列表显示
 * - 自动滚动到底部（使用requestAnimationFrame优化）
 * - 加载状态显示
 * - 空状态提示
 */
import React, { useEffect, useRef, useCallback } from 'react';
import { ChatMessage } from '../types';
import { MessageBubble } from './MessageBubble';

interface ChatAreaProps {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  onSendMessage?: (content: string) => void;
}

/**
 * ChatArea组件
 */
export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  isLoading,
  isStreaming,
  onSendMessage,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);

  /**
   * 平滑滚动到底部（使用requestAnimationFrame）
   */
  const scrollToBottom = useCallback(() => {
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
    }

    scrollRafRef.current = requestAnimationFrame(() => {
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({
          behavior: isStreaming ? 'auto' : 'smooth',
          block: 'end',
        });
      }
      scrollRafRef.current = null;
    });
  }, [isStreaming]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  // 空状态
  if (messages.length === 0) {
    return (
      <div className="chat-area flex flex-col items-center justify-center">
        <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-4">
          <svg
            className="w-8 h-8 text-primary-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">
          开始你的AI对话
        </h2>
        <p className="text-gray-500 max-w-sm text-center">
          输入你的问题，AI助手将为你提供专业、准确的回答。支持多轮对话、代码生成、文案创作等多种场景。
        </p>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-md">
          <SuggestionCard
            title="代码生成"
            description="帮助你编写、调试和优化代码"
            icon="💻"
            onClick={() => onSendMessage?.('帮我写一段JavaScript代码，实现一个防抖函数')}
          />
          <SuggestionCard
            title="文案创作"
            description="撰写文章、邮件、文案等内容"
            icon="✍️"
            onClick={() => onSendMessage?.('帮我写一封正式的商务邮件')}
          />
          <SuggestionCard
            title="知识问答"
            description="解答技术问题、提供学习建议"
            icon="📚"
            onClick={() => onSendMessage?.('解释一下什么是React Hooks？')}
          />
          <SuggestionCard
            title="数据分析"
            description="解读数据、生成报告和洞察"
            icon="📊"
            onClick={() => onSendMessage?.('分析一下如何提升工作效率')}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className="chat-area"
    >
      {/* 使用25px左右边距，让聊天区域铺满 */}
      <div className="w-full px-[25px] md:px-[32px]">
        {/* 消息列表 */}
        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            isStreaming={
              isStreaming && index === messages.length - 1 && message.role === 'assistant'
            }
          />
        ))}

        {/* 正在输入指示器 */}
        {isLoading && !isStreaming && (
          <div className="flex gap-2 my-3">
            <div className="flex-shrink-0 w-8 h-8 md:w-10 md:h-10 rounded-full bg-gray-700 flex items-center justify-center text-white text-sm font-medium">
              AI
            </div>
            <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm border border-gray-100">
              <div className="loading-dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}

        {/* 滚动锚点 */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

/**
 * 建议卡片组件
 */
interface SuggestionCardProps {
  title: string;
  description: string;
  icon: string;
  onClick?: () => void;
}

const SuggestionCard: React.FC<SuggestionCardProps> = ({
  title,
  description,
  icon,
  onClick,
}) => {
  return (
    <div
      className="p-4 bg-white rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-md transition-all cursor-pointer text-left"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="text-2xl mb-2">{icon}</div>
      <h3 className="font-medium text-gray-800">{title}</h3>
      <p className="text-sm text-gray-500 mt-1">{description}</p>
    </div>
  );
};
