/**
 * InputBar组件
 * 底部输入框组件
 * - 多行文本输入
 * - 发送按钮
 * - 中断按钮（流式输出时）
 * - 快捷键支持（Enter发送，Shift+Enter换行）
 * - 移动端适配
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';

interface InputBarProps {
  isLoading: boolean;
  isStreaming: boolean;
  onSend: (content: string) => void;
  onAbort: () => void;
  disabled?: boolean;
}

/**
 * InputBar组件
 */
export const InputBar: React.FC<InputBarProps> = ({
  isLoading,
  isStreaming,
  onSend,
  onAbort,
  disabled = false,
}) => {
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const maxLength = 4000;

  /**
   * 自适应调整文本框高度
   */
  const autoResize = useCallback((): void => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, []);

  useEffect(() => {
    autoResize();
  }, [inputValue, autoResize]);

  /**
   * 处理发送
   */
  const handleSend = useCallback((): void => {
    const content = inputValue.trim();
    if (!content || isLoading || disabled) return;

    onSend(content);
    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [inputValue, isLoading, disabled, onSend]);

  /**
   * 处理键盘事件
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      // Enter发送，Shift+Enter换行
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }

      // Ctrl+Enter发送
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  /**
   * 处理中断
   */
  const handleAbort = useCallback((): void => {
    onAbort();
  }, [onAbort]);

  const canSend = inputValue.trim().length > 0 && !isLoading && !disabled;
  const canAbort = isStreaming;

  return (
    <div className="input-container safe-area-bottom">
      {/* 使用与聊天区域一致的25px左右边距 */}
      <div className="w-full px-[25px] md:px-[32px] py-3">
        {/* 流式输出中的中断按钮 */}
        {canAbort && (
          <div className="flex justify-center mb-2">
            <button
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-full flex items-center gap-2 transition-colors"
              onClick={handleAbort}
            >
              <svg
                className="w-4 h-4"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              停止生成
            </button>
          </div>
        )}

        {/* 输入框容器 */}
        <div className="bg-gray-100 rounded-2xl border border-gray-200 focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100 transition-all p-2">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              className="input-base flex-1 bg-transparent border-none resize-none max-h-[150px] text-sm"
              placeholder={
                isLoading
                  ? 'AI正在思考...'
                  : '输入消息，Enter发送，Shift+Enter换行'
              }
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value.slice(0, maxLength));
              }}
              onKeyDown={handleKeyDown}
              disabled={isLoading || disabled}
              rows={1}
              autoFocus
            />

            {/* 发送按钮 */}
            <button
              className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                canSend
                  ? 'bg-primary-500 hover:bg-primary-600 text-white cursor-pointer'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
              onClick={handleSend}
              disabled={!canSend}
              aria-label="发送消息"
            >
              {isLoading ? (
                <svg
                  className="w-5 h-5 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
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
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              )}
            </button>
          </div>

          {/* 字符计数 - 底部右对齐 */}
          <div className="flex justify-end mt-1 pr-1">
            <span className={`text-xs ${inputValue.length > maxLength * 0.9 ? 'text-red-500' : 'text-gray-400'}`}>
              {inputValue.length}/{maxLength}
            </span>
          </div>
        </div>

        {/* 底部提示 */}
        <p className="text-xs text-gray-400 text-center mt-2">
          AI生成的内容仅供参考，请核实重要信息
        </p>
      </div>
    </div>
  );
};
