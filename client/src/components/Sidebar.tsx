/**
 * Sidebar组件
 * 左侧会话侧边栏
 * - 显示会话列表
 * - 新建会话按钮
 * - 会话切换
 * - 会话删除
 * - 移动端响应式支持
 */
import React from 'react';
import { Conversation } from '../types';
import { formatTimestamp } from '../utils/helpers';

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  onNewConversation: () => void;
  onSwitchConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Sidebar组件
 */
export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  currentConversationId,
  onNewConversation,
  onSwitchConversation,
  onDeleteConversation,
  isOpen,
  onClose,
}) => {
  return (
    <>
      {/* 移动端遮罩层 */}
      {isOpen && (
        <div
          className="sidebar-overlay md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* 侧边栏主体 - 桌面端使用flex布局，移动端使用抽屉 */}
      <aside
        className={`md:sidebar ${isOpen ? 'sidebar-mobile translate-x-0' : 'sidebar-mobile -translate-x-full'} md:translate-x-0`}
        aria-label="会话列表"
      >
        {/* 头部 - Logo和新建按钮 */}
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <h1 className="text-lg font-bold text-white">AI 对话工作台</h1>
            <button
              className="p-2 rounded-lg hover:bg-gray-700 transition-colors"
              onClick={onClose}
              aria-label="关闭侧边栏"
            >
              <svg
                className="w-5 h-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* 新建会话按钮 */}
          <div className="p-3">
            <button
              className="w-full py-2.5 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              onClick={onNewConversation}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              新建对话
            </button>
          </div>

          {/* 会话列表 */}
          <div className="flex-1 overflow-y-auto px-3 space-y-1 scroll-smooth-custom">
            {conversations.length === 0 ? (
              <div className="text-center text-gray-500 py-8 px-4 text-sm">
                <p>暂无对话记录</p>
                <p className="mt-2">点击上方按钮开始新对话</p>
              </div>
            ) : (
              conversations
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    isActive={conv.id === currentConversationId}
                    onSelect={() => onSwitchConversation(conv.id)}
                    onDelete={() => onDeleteConversation(conv.id)}
                  />
                ))
            )}
          </div>

          {/* 底部信息 */}
          <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
            <p>共 {conversations.length} 个对话</p>
          </div>
        </div>
      </aside>
    </>
  );
};

/**
 * 单个会话项组件
 */
interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  onSelect,
  onDelete,
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);

  const handleDelete = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (showDeleteConfirm) {
      onDelete();
      setShowDeleteConfirm(false);
    } else {
      setShowDeleteConfirm(true);
      // 3秒后自动重置
      setTimeout(() => setShowDeleteConfirm(false), 3000);
    }
  };

  return (
    <div
      className={`group relative p-3 rounded-lg cursor-pointer transition-colors ${
        isActive
          ? 'bg-gray-700 text-white'
          : 'hover:bg-gray-800 text-gray-300'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate">
            {conversation.title || '新对话'}
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            {conversation.messages.length} 条消息 ·{' '}
            {formatTimestamp(conversation.updatedAt, 'relative')}
          </p>
        </div>

        {/* 删除按钮 */}
        <button
          className={`p-1.5 rounded transition-colors ${
            showDeleteConfirm
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'text-gray-500 hover:text-red-400 hover:bg-gray-600 opacity-0 group-hover:opacity-100'
          }`}
          onClick={handleDelete}
          aria-label="删除会话"
        >
          {showDeleteConfirm ? (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          ) : (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
};
