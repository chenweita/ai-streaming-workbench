/**
 * useNetworkStatus Hook
 * 网络状态监听Hook
 * 用于检测网络连接状态，实现断线重连
 */
import { useState, useEffect, useCallback } from 'react';
import { NetworkStatus } from '../types';

/**
 * useNetworkStatus Hook
 * @param onNetworkChange 网络状态变化回调
 * @returns 网络状态和重连方法
 */
export function useNetworkStatus(
  onNetworkChange?: (status: NetworkStatus) => void
): {
  networkStatus: NetworkStatus;
  isOnline: boolean;
  reconnect: () => Promise<boolean>;
} {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>(() => {
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      return navigator.onLine ? 'online' : 'offline';
    }
    return 'online';
  });

  /**
   * 网络状态变化处理
   */
  useEffect(() => {
    const handleOnline = (): void => {
      setNetworkStatus('online');
      onNetworkChange?.('online');
    };

    const handleOffline = (): void => {
      setNetworkStatus('offline');
      onNetworkChange?.('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [onNetworkChange]);

  /**
   * 手动重连检测
   */
  const reconnect = useCallback(async (): Promise<boolean> => {
    try {
      // 尝试请求一个轻量级接口
      const response = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
      });

      if (response.ok) {
        setNetworkStatus('online');
        return true;
      }
      return false;
    } catch {
      setNetworkStatus('offline');
      return false;
    }
  }, []);

  return {
    networkStatus,
    isOnline: networkStatus === 'online',
    reconnect,
  };
}
