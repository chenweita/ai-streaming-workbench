/**
 * NetworkBanner组件
 * 网络状态提示横幅
 * - 显示在线/离线状态
 * - 提供重新连接按钮
 */
import React from 'react';

interface NetworkBannerProps {
  isOnline: boolean;
  onReconnect: () => void;
}

/**
 * NetworkBanner组件
 */
export const NetworkBanner: React.FC<NetworkBannerProps> = ({
  isOnline,
  onReconnect,
}) => {
  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 bg-yellow-500 text-white px-4 py-2 flex items-center justify-center gap-3 z-50 animate-slide-down">
      <div className="flex items-center gap-2">
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
            d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
          />
        </svg>
        <span className="text-sm font-medium">网络连接已断开</span>
      </div>
      <button
        className="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 rounded text-sm font-medium transition-colors"
        onClick={onReconnect}
      >
        重新连接
      </button>
    </div>
  );
};
