/**
 * 内置工具：写入文件（write_file）
 * 对标 BearCode 文件系统工具（轻量化 TS 重构）
 *
 * 功能：将完整内容写入指定文件（覆盖已有内容或创建新文件）
 * 安全级别：Edit（需权限确认，串行执行）
 *
 * 安全措施：
 *   - 路径越界检查（禁止访问工作目录之外的路径）
 *   - 拒绝写入敏感目录（node_modules / .git / dist）
 *   - 内容大小限制（1MB，防止 LLM 写入超大文件）
 *   - 原子写（临时文件 + rename，避免中途崩溃留下半截文件）
 */

import fs from 'fs/promises';
import path from 'path';
import { ToolDef, ToolSafety } from '../ToolProtocol';

/** write_file 工具参数 */
interface WriteFileParams {
  /** 文件路径（相对于工作目录） */
  filePath: string;
  /** 要写入的完整文件内容（将覆盖已有内容） */
  content: string;
  /** 是否自动创建父目录（默认 false） */
  createDirectories?: boolean;
}

/** 最大写入字节数（1MB，防止 LLM 写入超大文件） */
const MAX_WRITE_BYTES = 1024 * 1024;

/** 禁止写入的敏感目录名（防止破坏项目本身） */
const FORBIDDEN_DIRS = ['node_modules', '.git', 'dist'];

/**
 * 检查路径是否落在禁止写入的敏感目录内
 */
function isForbiddenPath(relPath: string): boolean {
  const normalized = path.normalize(relPath).replace(/\\/g, '/');
  const firstSeg = normalized.split('/')[0] ?? '';
  return FORBIDDEN_DIRS.includes(firstSeg);
}

/**
 * write_file 工具定义
 */
export const writeFileTool: ToolDef<WriteFileParams, string> = {
  name: 'write_file',
  description:
    '将完整内容写入指定文件（覆盖已有内容或创建新文件）。用于创建新文件、重写配置等。注意：会完全覆盖原文件内容。',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '文件路径（相对于工作目录）',
      },
      content: {
        type: 'string',
        description: '要写入的完整文件内容（将覆盖已有内容）',
      },
      createDirectories: {
        type: 'boolean',
        description: '是否自动创建父目录（默认 false）',
      },
    },
    required: ['filePath', 'content'],
  },
  safety: ToolSafety.Edit,

  async execute(params: WriteFileParams, context): Promise<string> {
    const filePath = params.filePath;
    const content = params.content ?? '';
    const createDirectories = params.createDirectories ?? false;

    if (!filePath) {
      return '错误: filePath 参数不能为空';
    }

    // 1. 路径越界检查（解析为绝对路径，禁止越出工作目录）
    const absPath = path.resolve(context.cwd, filePath);
    const cwdResolved = path.resolve(context.cwd);
    if (!absPath.startsWith(cwdResolved)) {
      throw new Error('禁止写入工作目录之外的路径');
    }

    // 2. 敏感目录检查（双重防御：即便用户同意权限也拦截）
    const relPath = path.relative(context.cwd, absPath);
    if (isForbiddenPath(relPath)) {
      return `错误: 禁止写入敏感目录（${FORBIDDEN_DIRS.join('/')}）下的文件`;
    }

    // 3. 内容大小限制
    const byteLength = Buffer.byteLength(content, 'utf-8');
    if (byteLength > MAX_WRITE_BYTES) {
      return `错误: 内容大小 ${byteLength} 字节，超过限制 ${MAX_WRITE_BYTES} 字节（1MB）`;
    }

    // 4. 自动创建父目录
    const dirPath = path.dirname(absPath);
    if (createDirectories) {
      try {
        await fs.mkdir(dirPath, { recursive: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `错误: 创建父目录失败 - ${msg}`;
      }
    } else {
      // 不自动创建时检查父目录是否存在
      try {
        await fs.stat(dirPath);
      } catch {
        return `错误: 父目录不存在，可设置 createDirectories=true 自动创建`;
      }
    }

    // 5. 原子写：临时文件 → rename（避免中途崩溃留下半截文件）
    const tmpPath = `${absPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await fs.writeFile(tmpPath, content, 'utf-8');
      await fs.rename(tmpPath, absPath);
    } catch (err) {
      // 清理可能残留的临时文件
      try {
        await fs.unlink(tmpPath);
      } catch {
        // 临时文件不存在时忽略
      }
      const msg = err instanceof Error ? err.message : String(err);
      return `错误: 写入文件失败 - ${msg}`;
    }

    return `已写入文件 ${filePath}（${byteLength} 字节）`;
  },
};
