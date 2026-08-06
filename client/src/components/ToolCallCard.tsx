/**
 * ToolCallCard 组件
 * 工具调用轨迹卡片
 *
 * 功能：
 *   - 显示工具调用过程（参数 → 执行中 → 结果）
 *   - 支持展开/收起查看完整参数和结果
 *   - 区分只读/副作用工具样式
 *   - 错误状态高亮
 */
import React, { useState } from 'react';
import { ToolCallRecord } from '../types';

interface ToolCallCardProps {
  toolCall: ToolCallRecord;
}

/** 工具名中文映射表 */
const TOOL_NAME_LABELS: Record<string, string> = {
  list_files: '列出文件',
  read_file: '读取文件',
  grep_search: '搜索代码',
};

/** 工具名图标映射 */
const TOOL_ICONS: Record<string, string> = {
  list_files: '📁',
  read_file: '📄',
  grep_search: '🔍',
};

/**
 * 截断文本到指定长度
 */
function truncate(text: string, maxLen: number): { text: string; truncated: boolean } {
  if (text.length <= maxLen) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, maxLen) + '...', truncated: true };
}

/**
 * ToolCallCard 组件
 */
export const ToolCallCard: React.FC<ToolCallCardProps> = ({ toolCall }) => {
  const [expanded, setExpanded] = useState(false);

  const { toolName, arguments: args, status, result, durationMs, truncated } = toolCall;
  const displayName = TOOL_NAME_LABELS[toolName] || toolName;
  const icon = TOOL_ICONS[toolName] || '🔧';

  // 解析参数（尝试格式化 JSON）
  let argsDisplay = args;
  try {
    const parsed = JSON.parse(args);
    argsDisplay = JSON.stringify(parsed, null, 2);
  } catch {
    // 非 JSON 格式，保持原样
  }

  // 状态颜色与动画
  const statusConfig: Record<string, { color: string; label: string; animated: boolean }> = {
    pending: { color: 'text-gray-400', label: '等待中', animated: false },
    running: { color: 'text-blue-500', label: '执行中', animated: true },
    completed: { color: 'text-green-500', label: '完成', animated: false },
    error: { color: 'text-red-500', label: '失败', animated: false },
  };

  const statusInfo = statusConfig[status] || statusConfig.pending;

  // 结果预览（截断到 200 字符）
  const resultPreview = result ? truncate(result, 200) : null;

  return (
    <div className="tool-call-card my-2 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
      {/* 卡片头部 */}
      <button
        type="button"
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-gray-100 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* 状态图标 */}
        <span className="text-lg flex-shrink-0">{icon}</span>

        {/* 工具名 */}
        <span className="font-medium text-sm text-gray-700 flex-shrink-0">
          {displayName}
        </span>

        {/* 状态指示器 */}
        <span className={`text-xs flex-shrink-0 ${statusInfo.color}`}>
          {statusInfo.animated ? (
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
              {statusInfo.label}
            </span>
          ) : (
            statusInfo.label
          )}
        </span>

        {/* 结果摘要（折叠状态下显示一行） */}
        {result && status !== 'error' && (
          <span className="text-xs text-gray-500 flex-shrink-0 truncate max-w-[200px]">
            {truncated ? result.slice(0, 60) + '...' : result.slice(0, 60)}
          </span>
        )}

        {/* 耗时 */}
        {durationMs !== undefined && (
          <span className="text-xs text-gray-400 flex-shrink-0">
            {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* 展开/收起箭头 */}
        <span className="ml-auto text-gray-400 text-xs flex-shrink-0">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* 展开区域 */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-200 pt-2">
          {/* 参数区域 */}
          <div>
            <div className="text-xs text-gray-500 mb-1">参数</div>
            <pre className="text-xs bg-white rounded p-2 overflow-x-auto border border-gray-200 max-h-40">
              {argsDisplay}
            </pre>
          </div>

          {/* 结果区域（已完成时显示） */}
          {resultPreview && (
            <div>
              <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                <span>结果</span>
                {truncated && (
                  <span className="text-yellow-600">(已截断，共 {result.length} 字符)</span>
                )}
              </div>
              <pre className={`text-xs rounded p-2 overflow-x-auto border max-h-60 whitespace-pre-wrap break-all ${
                status === 'error'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-white border-gray-200 text-gray-700'
              }`}>
                {expanded ? result : resultPreview.text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * 工具调用列表组件
 * 在 AI 消息气泡中渲染多个工具调用卡片
 */
interface ToolCallListProps {
  toolCalls: ToolCallRecord[];
}

export const ToolCallList: React.FC<ToolCallListProps> = ({ toolCalls }) => {
  if (toolCalls.length === 0) {
    return null;
  }

  return (
    <div className="tool-call-list my-3 space-y-1">
      <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
        <span>🛠️ Agent 调用了 {toolCalls.length} 个工具</span>
      </div>
      {toolCalls.map((tc) => (
        <ToolCallCard key={tc.toolCallId} toolCall={tc} />
      ))}
    </div>
  );
};
