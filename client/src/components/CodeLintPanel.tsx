/**
 * CodeLintPanel 组件
 * 代码检测与修复面板
 * - 检测 AI 消息中的代码块
 * - 调用后端 /api/code-lint-fix 接口
 * - 展示原始代码 / 修复后代码 / lint 错误列表
 *
 * 约束：
 * - 前端不引入任何 eslint/stylelint/markdownlint
 * - 所有 lint 逻辑由后端 @buildloop/lint 完成
 */
import React, { useState, useCallback } from 'react';

/** 代码块信息 */
interface CodeBlock {
  lang: string;
  code: string;
  fileType: string;
}

/** lint 错误信息 */
interface LintError {
  line: number;
  column?: number;
  rule: string;
  message: string;
  severity?: number;
  fixable?: boolean;
}

/** lint 结果响应 */
interface LintResponse {
  originCode: string;
  fixedCode: string;
  lintErrors: LintError[];
}

/** 文件类型映射（markdown fence → @buildloop/lint fileType） */
const LANG_MAP: Record<string, string> = {
  javascript: 'js',
  js: 'js',
  typescript: 'ts',
  ts: 'ts',
  jsx: 'jsx',
  tsx: 'tsx',
  vue: 'vue',
  css: 'css',
  scss: 'scss',
  less: 'less',
  markdown: 'md',
  md: 'md',
};

/** 支持的文件类型集合 */
const SUPPORTED_TYPES = new Set(['js', 'jsx', 'ts', 'tsx', 'vue', 'css', 'scss', 'less', 'md']);

/**
 * 从 markdown 内容中提取代码块
 */
function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```(\w+)\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const lang = match[1].toLowerCase();
    const code = match[2];
    const fileType = LANG_MAP[lang];
    if (fileType && SUPPORTED_TYPES.has(fileType)) {
      blocks.push({ lang, code, fileType });
    }
  }

  return blocks;
}

interface CodeLintPanelProps {
  content: string;
  isStreaming?: boolean;
}

export const CodeLintPanel: React.FC<CodeLintPanelProps> = ({
  content,
  isStreaming = false,
}) => {
  const blocks = React.useMemo(() => extractCodeBlocks(content), [content]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'original' | 'fixed'>('original');
  const [result, setResult] = useState<LintResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleLint = useCallback(async () => {
    if (blocks.length === 0 || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const results: LintResponse[] = [];

      for (const block of blocks) {
        const response = await fetch('/api/code-lint-fix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            codeText: block.code,
            fileType: block.fileType,
            fix: true,
          }),
        });

        if (!response.ok) {
          throw new Error(`请求失败: HTTP ${response.status}`);
        }

        const data = await response.json();
        results.push({
          originCode: data.originCode,
          fixedCode: data.fixedCode,
          lintErrors: data.lintErrors || [],
        });
      }

      // 合并所有代码块的结果（展示第一个非空的，或合并）
      const merged: LintResponse = {
        originCode: results.map(r => r.originCode).join('\n\n'),
        fixedCode: results.map(r => r.fixedCode).join('\n\n'),
        lintErrors: results.flatMap(r => r.lintErrors),
      };

      setResult(merged);
      setExpanded(true);
      setActiveTab('original');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`代码检测失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }, [blocks, loading]);

  const handleCopyFix = useCallback(async () => {
    if (!result?.fixedCode) return;
    try {
      await navigator.clipboard.writeText(result.fixedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('复制失败，请手动选择文本复制');
    }
  }, [result]);

  // 流式输出中不显示按钮
  if (isStreaming || blocks.length === 0) {
    return null;
  }

  return (
    <div className="mt-2">
      {/* 触发按钮 */}
      <button
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={handleLint}
        disabled={loading}
      >
        {loading ? (
          <>
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
            </svg>
            检测中...
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            执行代码规范化修复
            {blocks.length > 1 && ` (${blocks.length} 个代码块)`}
          </>
        )}
      </button>

      {/* 错误提示 */}
      {error && (
        <div className="mt-2 p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}

      {/* 折叠面板 */}
      {expanded && result && !error && (
        <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden bg-white">
          {/* Tab 切换 */}
          <div className="flex border-b border-gray-200">
            <button
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === 'original'
                  ? 'text-primary-600 bg-primary-50 border-b-2 border-primary-500'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setActiveTab('original')}
            >
              原始代码
            </button>
            <button
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === 'fixed'
                  ? 'text-primary-600 bg-primary-50 border-b-2 border-primary-500'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setActiveTab('fixed')}
            >
              修复后代码
            </button>
          </div>

          {/* 代码内容 */}
          <div className="p-3">
            <pre className="text-xs bg-gray-50 rounded p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-60">
              {activeTab === 'original' ? result.originCode : result.fixedCode}
            </pre>
          </div>

          {/* lint 错误列表 */}
          {result.lintErrors.length > 0 && (
            <div className="border-t border-gray-200 p-3 bg-gray-50">
              <div className="text-xs font-medium text-gray-700 mb-2">
                发现 {result.lintErrors.length} 个问题：
              </div>
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {result.lintErrors.map((err, idx) => (
                  <li key={idx} className="text-xs flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-[10px] font-medium">
                      {err.line}
                    </span>
                    <span className="text-gray-600">
                      <span className="font-medium text-gray-800">{err.rule}</span>
                      <span className="text-gray-500"> — {err.message}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-2 border-t border-gray-200 p-2 bg-white">
            <button
              className="px-3 py-1.5 text-xs font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-md transition-colors disabled:opacity-50"
              onClick={handleCopyFix}
              disabled={!result.fixedCode}
            >
              {copied ? '已复制 ✓' : '复制修复后代码'}
            </button>
            <button
              className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              onClick={() => setExpanded(false)}
            >
              收起
            </button>
          </div>
        </div>
      )}
    </div>
  );
};