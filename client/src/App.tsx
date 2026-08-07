/**
 * App组件
 * 应用主入口，整合所有功能模块
 * 
 * 架构说明：
 * 1. 使用useConversation管理会话列表和当前会话
 * 2. 使用useStreamChat处理流式对话逻辑
 * 3. 使用useNetworkStatus监控网络状态
 * 4. 组件拆分：Sidebar | ChatArea | InputBar | NetworkBanner | ErrorToast
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { InputBar } from './components/InputBar';
import { NetworkBanner } from './components/NetworkBanner';
import { ErrorToast } from './components/ErrorToast';
import { PermissionDialog } from './components/PermissionDialog';
import { useConversation } from './hooks/useConversation';
import { useStreamChat } from './hooks/useStreamChat';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { ChatMessage } from './types';

/**
 * App组件
 */
const App: React.FC = () => {
  // 侧边栏开关状态（移动端使用）
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  // 错误提示
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 待处理的会话ID（用于在会话创建完成后发送消息）
  const pendingConversationIdRef = useRef<string | null>(null);
  const pendingMessageRef = useRef<string | null>(null);
  // 上次同步的消息哈希（用于比较是否需要同步）
  const lastSyncHashRef = useRef<string>('');
  // 同步防抖定时器
  const syncTimerRef = useRef<number | null>(null);
  // 最新消息引用（用于setTimeout回调中获取最新值）
  const messagesRef = useRef<ChatMessage[]>([]);
  // 后端检测状态
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  // 是否正在检测中（用于按钮loading状态）
  const [isChecking, setIsChecking] = useState<boolean>(false);

  // 会话管理
  const {
    conversations,
    currentConversationId,
    currentConversation,
    createConversation,
    switchConversation,
    deleteConversation,
    updateConversation,
  } = useConversation();

  // 当前会话的消息列表
  const currentMessages: ChatMessage[] = currentConversation?.messages || [];

  // 流式对话Hook
  const {
    messages,
    isLoading,
    isStreaming,
    sendMessage,
    abortRequest,
    clearMessages,
    pendingPermission,
    respondPermission,
  } = useStreamChat(currentMessages, {
    conversationId: currentConversationId || undefined,
  });

  // 同步消息到ref，供setTimeout回调使用
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /**
   * 检测后端状态
   */
  const checkBackendStatus = useCallback(async (showToast = false) => {
    console.log('[Backend] 开始检测...');
    setIsChecking(true);
    setBackendStatus('checking');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch('/api/health', { 
        method: 'GET',
        cache: 'no-store'
      });
      
      clearTimeout(timeoutId);
      console.log('[Backend] 检测完成:', response.status, response.ok);
      
      if (response.ok) {
        setBackendStatus('online');
        if (showToast) {
          setErrorMessage('✅ 后端已连接，已切换到真实AI模式');
          setTimeout(() => setErrorMessage(null), 3000);
        }
      } else {
        setBackendStatus('offline');
        if (showToast) {
          setErrorMessage('❌ 后端服务异常，请检查后端日志');
          setTimeout(() => setErrorMessage(null), 3000);
        }
      }
    } catch (err) {
      console.log('[Backend] 检测失败:', err);
      setBackendStatus('offline');
      if (showToast) {
        setErrorMessage('❌ 无法连接到后端，请确保后端服务已启动');
        setTimeout(() => setErrorMessage(null), 3000);
      }
    } finally {
      setIsChecking(false);
      console.log('[Backend] 检测结束, isChecking=false');
    }
  }, []);

  // 初始检测后端状态
  useEffect(() => {
    checkBackendStatus(false);
  }, [checkBackendStatus]);

  // 网络状态监听
  const { isOnline, reconnect } = useNetworkStatus(
    useCallback((status: 'online' | 'offline') => {
      if (status === 'online') {
        setErrorMessage('网络已恢复连接');
        // 网络恢复时重新检测后端
        checkBackendStatus(false);
        setTimeout(() => setErrorMessage(null), 3000);
      } else {
        setErrorMessage('网络连接已断开');
        setBackendStatus('offline');
        setTimeout(() => setErrorMessage(null), 3000);
      }
    }, [checkBackendStatus])
  );

  /**
   * 同步消息到会话存储（带防抖和哈希比较）
   * 避免每次messages变化都立即同步，减少循环更新风险
   */
  useEffect(() => {
    // 流式输出中或加载中时不同步
    if (!currentConversationId || messages.length === 0 || isStreaming || isLoading) {
      return;
    }

    // 计算消息哈希（简化版：消息数量 + 最后一条内容）
    const lastMsg = messages[messages.length - 1];
    const newHash = `${messages.length}:${lastMsg?.content.slice(0, 100) || ''}:${lastMsg?.status || ''}`;

    // 如果哈希没变化，跳过同步
    if (newHash === lastSyncHashRef.current) {
      return;
    }

    // 清除之前的定时器
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }

    // 使用防抖：500ms后同步，确保流式输出完成后再同步
    syncTimerRef.current = window.setTimeout(() => {
      // 再次检查是否仍需要同步
      const currentLastMsg = messagesRef.current[messagesRef.current.length - 1];
      const currentHash = `${messagesRef.current.length}:${currentLastMsg?.content.slice(0, 100) || ''}:${currentLastMsg?.status || ''}`;
      
      if (currentHash !== lastSyncHashRef.current) {
        lastSyncHashRef.current = currentHash;
        updateConversation(currentConversationId, { messages: messagesRef.current });
      }
      syncTimerRef.current = null;
    }, 500);

    // 清理函数
    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
    };
  }, [messages, currentConversationId, updateConversation, isStreaming, isLoading]);

  /**
   * 检查是否有待处理的消息需要发送
   * 当会话创建完成后，发送之前暂存的消息
   */
  useEffect(() => {
    if (pendingConversationIdRef.current && pendingMessageRef.current) {
      const conversationId = pendingConversationIdRef.current;
      const message = pendingMessageRef.current;

      // 检查会话是否已创建
      const conv = conversations.find((c) => c.id === conversationId);
      if (conv) {
        // 发送暂存的消息
        sendMessage(message, conversationId);
        // 清除暂存数据
        pendingConversationIdRef.current = null;
        pendingMessageRef.current = null;
      }
    }
  }, [conversations, sendMessage]);

  /**
   * 处理新建会话
   */
  const handleNewConversation = useCallback((): void => {
    clearMessages();
    setSidebarOpen(false);
    createConversation();
  }, [createConversation, clearMessages]);

  /**
   * 处理切换会话
   */
  const handleSwitchConversation = useCallback(
    (id: string): void => {
      switchConversation(id);
      setSidebarOpen(false);
      // 切换会话时清除待处理消息
      pendingConversationIdRef.current = null;
      pendingMessageRef.current = null;
    },
    [switchConversation]
  );

  /**
   * 处理发送消息
   */
  const handleSendMessage = useCallback(
    async (content: string): Promise<void> => {
      // 如果没有当前会话，先创建一个并暂存消息
      if (!currentConversationId) {
        // 创建新会话
        const newConv = createConversation();
        // 暂存消息，等会话创建完成后再发送
        pendingConversationIdRef.current = newConv.id;
        pendingMessageRef.current = content;
        switchConversation(newConv.id);
        return;
      }

      // 直接发送消息
      sendMessage(content, currentConversationId);
    },
    [currentConversationId, createConversation, switchConversation, sendMessage]
  );

  /**
   * 处理中断请求
   */
  const handleAbortRequest = useCallback((): void => {
    abortRequest();
  }, [abortRequest]);

  /**
   * 处理删除会话
   */
  const handleDeleteConversation = useCallback(
    (id: string): void => {
      deleteConversation(id);
    },
    [deleteConversation]
  );

  return (
    <div className={`min-h-screen flex flex-col ${backendStatus === 'offline' ? 'pt-12' : ''}`}>
      {/* 顶部条幅 - Mock模式提示 */}
      {backendStatus === 'offline' && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-50 border-b-2 border-amber-300 shadow-md">
          <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-amber-900">
              <svg className="w-5 h-5 flex-shrink-0 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="font-semibold">演示模式</span>
              <span className="text-amber-700">· 当前使用Mock数据，启动后端后可使用真实AI</span>
            </div>
            <button
              onClick={() => {
                console.log('点击重新检测');
                checkBackendStatus(true);
              }}
              disabled={isChecking}
              className={`
                inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold text-sm
                transition-all duration-200 transform
                ${isChecking 
                  ? 'bg-amber-200 text-amber-500 cursor-not-allowed' 
                  : 'bg-amber-500 hover:bg-amber-600 text-white active:scale-95 shadow-md hover:shadow-lg'
                }
              `}
            >
              {isChecking ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  检测中
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  重新检测
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 错误提示Toast */}
      {errorMessage && (
        <ErrorToast
          message={errorMessage}
          type="info"
          onClose={() => setErrorMessage(null)}
        />
      )}

      {/* 主应用布局 */}
      <div className="app-layout">
        {/* 网络状态提示 */}
        <NetworkBanner isOnline={isOnline} onReconnect={reconnect} />

        {/* 侧边栏 */}
        <Sidebar
          conversations={conversations}
          currentConversationId={currentConversationId}
          onNewConversation={handleNewConversation}
          onSwitchConversation={handleSwitchConversation}
          onDeleteConversation={handleDeleteConversation}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* 主聊天区域 */}
        <main className="main-content">
          {/* 顶部标题栏 - 使用与聊天区域一致的边距 */}
          <header className="flex-shrink-0 bg-white border-b border-gray-200 px-[25px] md:px-[32px] py-3 flex items-center justify-between">
            <button
              className="md:hidden p-2 -ml-2 text-gray-600 hover:text-gray-900"
              onClick={() => setSidebarOpen(true)}
              aria-label="打开菜单"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-gray-800">
                {currentConversation?.title || 'AI 对话工作台'}
              </h1>
              {/* 后端状态指示器 */}
              {backendStatus === 'online' ? (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                  已连接
                </span>
              ) : backendStatus === 'offline' ? (
                <span className="flex items-center gap-1 text-xs text-amber-600">
                  <span className="w-2 h-2 bg-amber-500 rounded-full" />
                  演示模式
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" />
                  检测中
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isStreaming && (
                <span className="text-xs text-primary-500 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" />
                  生成中
                </span>
              )}
            </div>
          </header>

          {/* 聊天区域 */}
          <ChatArea
            messages={messages}
            isLoading={isLoading}
            isStreaming={isStreaming}
            onSendMessage={handleSendMessage}
          />

          {/* 输入栏 */}
          <InputBar
            isLoading={isLoading}
            isStreaming={isStreaming}
            onSend={handleSendMessage}
            onAbort={handleAbortRequest}
            disabled={!isOnline}
          />
        </main>
      </div>

      {/* 权限确认弹窗（编辑类工具执行前触发） */}
      {pendingPermission && (
        <PermissionDialog
          request={pendingPermission}
          onRespond={respondPermission}
        />
      )}
    </div>
  );
};

export default App;
