/**
 * 内置工具：编辑文件（edit_file）
 * 对标 BearCode 文件系统工具（轻量化 TS 重构）
 *
 * 功能：基于旧字符串替换为新字符串，实现文件局部编辑
 * 安全级别：Edit（需权限确认，串行执行）
 *
 * 契约（对标 BearCode edit_file）：
 *   - oldString 必须能在文件中唯一匹配（除非 replaceAll=true）
 *   - 匹配 0 处 → 报错并附文件前 500 字符帮助 LLM 定位
 *   - 匹配 >1 处且 replaceAll=false → 报错要求更长上下文
 *   - 匹配 1 处或多处（replaceAll=true）→ 执行替换
 *   - 原子写回（临时文件 + rename）
 */

import fs from 'fs/promises';
import path from 'path';
import { ToolDef, ToolSafety } from '../ToolProtocol';

/** edit_file 工具参数 */
interface EditFileParams {
  /** 文件路径（相对于工作目录） */
  filePath: string;
  /** 要被替换的原文（必须能在文件中唯一匹配，除非 replaceAll=true） */
  oldString: string;
  /** 替换后的新文本 */
  newString: string;
  /** 当 oldString 多次出现时，是否全部替换（默认 false） */
  replaceAll?: boolean;
}

/** 禁止写入的敏感目录名 */
const FORBIDDEN_DIRS = ['node_modules', '.git', 'dist'];

/** 错误提示附带的文件前缀长度 */
const ERROR_PREVIEW_LEN = 500;

/**
 * 统计子串出现次数
 */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * 检查路径是否落在禁止写入的敏感目录内
 */
function isForbiddenPath(relPath: string): boolean {
  const normalized = path.normalize(relPath).replace(/\\/g, '/');
  const firstSeg = normalized.split('/')[0] ?? '';
  return FORBIDDEN_DIRS.includes(firstSeg);
}

/**
 * edit_file 工具定义
 */
export const editFileTool: ToolDef<EditFileParams, string> = {
  name: 'edit_file',
  description:
    '通过旧字符串替换为新字符串来局部编辑文件。oldString 必须能唯一匹配文件内容（除非 replaceAll=true）。用于精确修改代码片段。注意：不能创建新文件，请用 write_file 创建。',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '文件路径（相对于工作目录）',
      },
      oldString: {
        type: 'string',
        description: '要被替换的原文（必须能在文件中唯一匹配，除非 replaceAll=true）',
      },
      newString: {
        type: 'string',
        description: '替换后的新文本',
      },
      replaceAll: {
        type: 'boolean',
        description: '当 oldString 多次出现时，是否全部替换（默认 false）',
      },
    },
    required: ['filePath', 'oldString', 'newString'],
  },
  safety: ToolSafety.Edit,

  async execute(params: EditFileParams, context): Promise<string> {
    const filePath = params.filePath;
    const oldString = params.oldString ?? '';
    const newString = params.newString ?? '';
    const replaceAll = params.replaceAll ?? false;

    if (!filePath) {
      return '错误: filePath 参数不能为空';
    }
    if (!oldString) {
      return '错误: oldString 参数不能为空（edit_file 不能用于创建文件，请使用 write_file）';
    }

    // 1. 路径越界检查
    const absPath = path.resolve(context.cwd, filePath);
    const cwdResolved = path.resolve(context.cwd);
    if (!absPath.startsWith(cwdResolved)) {
      throw new Error('禁止编辑工作目录之外的路径');
    }

    // 2. 敏感目录检查
    const relPath = path.relative(context.cwd, absPath);
    if (isForbiddenPath(relPath)) {
      return `错误: 禁止编辑敏感目录（${FORBIDDEN_DIRS.join('/')}）下的文件`;
    }

    // 3. 读取原文件（edit_file 不能创建文件）
    let original: string;
    try {
      original = await fs.readFile(absPath, 'utf-8');
    } catch {
      return `错误: 文件 "${filePath}" 不存在。edit_file 不能创建新文件，请使用 write_file。`;
    }

    // 4. 无变化快速返回
    if (newString === oldString) {
      return `文件 ${filePath} 无变化（newString 与 oldString 相同）`;
    }

    // 5. 统计匹配数并校验唯一性
    const matchCount = countOccurrences(original, oldString);
    if (matchCount === 0) {
      const preview = original.slice(0, ERROR_PREVIEW_LEN);
      return `错误: 未在文件中找到要替换的内容。文件前 ${ERROR_PREVIEW_LEN} 字符预览:\n${preview}`;
    }
    if (matchCount > 1 && !replaceAll) {
      return `错误: 找到 ${matchCount} 处匹配，请提供更长的 oldString 上下文以唯一定位，或设置 replaceAll=true 全部替换`;
    }

    // 6. 执行替换
    const newContent = replaceAll
      ? original.split(oldString).join(newString)
      : original.replace(oldString, newString);

    // 7. 原子写回
    const tmpPath = `${absPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await fs.writeFile(tmpPath, newContent, 'utf-8');
      await fs.rename(tmpPath, absPath);
    } catch (err) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        // 临时文件不存在时忽略
      }
      const msg = err instanceof Error ? err.message : String(err);
      return `错误: 写回文件失败 - ${msg}`;
    }

    const replacedCount = replaceAll ? matchCount : 1;
    return `已编辑文件 ${filePath}（替换 ${replacedCount} 处，新文件 ${Buffer.byteLength(newContent, 'utf-8')} 字节）`;
  },
};
