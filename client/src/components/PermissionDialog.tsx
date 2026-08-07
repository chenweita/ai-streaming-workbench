/**
 * PermissionDialog 组件
 * 权限确认弹窗（编辑类工具执行前触发）
 *
 * 对齐 BearCode 权限设计：危险操作逐项询问用户确认
 *
 * 功能：
 *   - 展示工具名、操作类型、目标文件路径（最醒目）
 *   - 可折叠查看完整参数（edit_file 展示 oldString → newString diff）
 *   - 倒计时（基于 expiresAt，超时自动拒绝由后端处理，前端仅展示）
 *   - 同意/拒绝按钮，点击后立即 disable 防双击
 *   - 遮罩点击 = 拒绝
 *
 * 权限状态单次有效：每次 Edit 工具调用触发独立弹窗，不缓存授权
 */
import React, { useState, useEffect, useMemo } from 'react';
import { PermissionRequest } from '../types';

interface PermissionDialogProps {
  request: PermissionRequest;
  onRespond: (approved: boolean, reason?: string) => void;
}

/** 工具名中文映射 */
const TOOL_LABELS: Record<string, string> = {
  write_file: '写入文件',
  edit_file: '编辑文件',
};

/** 工具操作类型徽章配置 */
const TOOL_BADGE: Record<string, { label: string; color: string }> = {
  write_file: { label: '覆盖写入', color: 'bg-red-100 text-red-700 border-red-300' },
  edit_file: { label: '局部编辑', color: 'bg-orange-100 text-orange-700 border-orange-300' },
};

/** 解析后的工具参数（提取文件路径与编辑内容） */
interface ParsedArgs {
  filePath: string;
  content?: string;
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
}

/**
 * 从 arguments JSON 字符串解析参数
 */
function parseArgs(args: string): ParsedArgs {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    return {
      filePath: (parsed.filePath as string) || '(未提供路径)',
      content: parsed.content as string | undefined,
      oldString: parsed.oldString as string | undefined,
      newString: parsed.newString as string | undefined,
      replaceAll: parsed.replaceAll as boolean | undefined,
    };
  } catch {
    return { filePath: '(参数解析失败)' };
  }
}

/**
 * 截断长文本用于展示
 */
function truncateForDisplay(text: string, maxLen = 2000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n... (已截断，共 ${text.length} 字符)`;
}

/**
 * PermissionDialog 组件
 */
export const PermissionDialog: React.FC<PermissionDialogProps> = ({ request, onRespond }) => {
  const [expanded, setExpanded] = useState(false);
  const [responding, setResponding] = useState(false);
  const [remaining, setRemaining] = useState<number>(0);

  const parsed = useMemo(() => parseArgs(request.arguments), [request.arguments]);
  const label = TOOL_LABELS[request.toolName] || request.toolName;
  const badge = TOOL_BADGE[request.toolName] || { label: '编辑操作', color: 'bg-gray-100 text-gray-700 border-gray-300' };

  // 倒计时
  useEffect(() => {
    const update = (): void => {
      const remain = Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000));
      setRemaining(remain);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [request.expiresAt]);

  const handleRespond = (approved: boolean): void => {
    if (responding) return;
    setResponding(true);
    onRespond(approved);
  };

  const isUrgent = remaining <= 10;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[200] flex items-start justify-center px-4"
      onClick={() => handleRespond(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-title"
    >
      <div
        className="mt-32 w-full max-w-2xl bg-white rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <h2 id="permission-title" className="text-lg font-semibold text-gray-800">
            操作授权确认
          </h2>
          <span className={`ml-auto text-xs font-mono px-2 py-1 rounded ${isUrgent ? 'bg-red-100 text-red-700 animate-pulse' : 'bg-gray-100 text-gray-600'}`}>
            {remaining}s 后自动拒绝
          </span>
        </div>

        {/* 工具信息 */}
        <div className="px-6 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">工具：</span>
            <span className="font-medium text-gray-800">{label}</span>
            <span className={`text-xs px-2 py-0.5 rounded border ${badge.color}`}>
              {badge.label}
            </span>
          </div>

          {/* 目标文件路径（最醒目） */}
          <div>
            <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
              <span>📁</span>
              <span>目标文件路径</span>
            </div>
            <div className="bg-amber-50 border border-amber-200 px-3 py-2 rounded font-mono text-sm text-gray-800 break-all">
              {parsed.filePath}
            </div>
          </div>

          {/* edit_file 的 diff 预览 */}
          {request.toolName === 'edit_file' && parsed.oldString !== undefined && (
            <div className="space-y-2">
              <div className="text-sm text-gray-500">变更预览：</div>
              <div className="bg-red-50 border border-red-200 rounded p-2">
                <div className="text-xs text-red-600 font-medium mb-1">- 旧内容（将被替换）</div>
                <pre className="text-xs text-red-800 whitespace-pre-wrap break-all line-through max-h-40 overflow-y-auto">
                  {truncateForDisplay(parsed.oldString, 1000)}
                </pre>
              </div>
              <div className="bg-green-50 border border-green-200 rounded p-2">
                <div className="text-xs text-green-600 font-medium mb-1">+ 新内容</div>
                <pre className="text-xs text-green-800 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                  {truncateForDisplay(parsed.newString ?? '', 1000)}
                </pre>
              </div>
              {parsed.replaceAll && (
                <div className="text-xs text-orange-600">⚠ 将替换所有匹配项</div>
              )}
            </div>
          )}

          {/* write_file 内容预览（折叠） */}
          {request.toolName === 'write_file' && parsed.content !== undefined && (
            <div>
              <button
                type="button"
                className="text-sm text-blue-600 hover:text-blue-800"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? '▼ 收起内容预览' : '▶ 展开内容预览'}
              </button>
              {expanded && (
                <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded p-2 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                  {truncateForDisplay(parsed.content)}
                </pre>
              )}
            </div>
          )}

          {/* 完整参数（可折叠） */}
          <div>
            <button
              type="button"
              className="text-xs text-gray-500 hover:text-gray-700"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '▼' : '▶'} 查看完整参数
            </button>
            {expanded && (
              <pre className="mt-1 text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto max-h-40">
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(request.arguments), null, 2);
                  } catch {
                    return request.arguments;
                  }
                })()}
              </pre>
            )}
          </div>
        </div>

        {/* 按钮区 */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3 bg-gray-50">
          <button
            type="button"
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handleRespond(false)}
            disabled={responding}
            autoFocus
          >
            拒绝
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handleRespond(true)}
            disabled={responding}
            aria-label="同意执行该文件操作"
          >
            {responding ? '处理中...' : '同意并执行'}
          </button>
        </div>
      </div>
    </div>
  );
};
