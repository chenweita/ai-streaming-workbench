/**
 * 内置工具：列出目录内容（list_files）
 * 对标 BearCode 文件系统工具（轻量化 TS 重构）
 *
 * 功能：列出指定目录下的文件与子目录
 * 安全级别：ReadOnly（只读无副作用，并发安全）
 */

import fs from 'fs/promises';
import path from 'path';
import { ToolDef, ToolSafety, ToolContext } from '../ToolProtocol';

/** fs.Dirent 类型别名（从同步 fs 模块导入类型，避免运行时依赖） */
type Dirent = import('fs').Dirent;

/** list_files 工具参数 */
interface ListFilesParams {
  /** 目标目录路径（相对于工作目录，默认为当前目录） */
  directory?: string;
  /** 是否递归列出子目录（默认 false） */
  recursive?: boolean;
  /** 最大返回条目数（防止输出过大，默认 100） */
  maxEntries?: number;
}

/** 单个目录条目信息 */
interface DirEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
}

/**
 * 递归列出目录内容
 * @param absDir 绝对路径
 * @param recursive 是否递归
 * @param maxEntries 最大条目数
 * @param prefix 路径前缀（用于递归时的相对路径展示）
 */
async function listDirRecursive(
  absDir: string,
  recursive: boolean,
  maxEntries: number,
  prefix = ''
): Promise<DirEntry[]> {
  const result: DirEntry[] = [];
  let entries: Dirent[];

  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (result.length >= maxEntries) {
      break;
    }

    // 跳过常见无关目录（node_modules、.git 等）
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }

    const displayName = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      result.push({ name: displayName, type: 'directory', size: 0 });
      if (recursive && result.length < maxEntries) {
        const subEntries = await listDirRecursive(
          path.join(absDir, entry.name),
          recursive,
          maxEntries - result.length,
          displayName
        );
        result.push(...subEntries);
      }
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(path.join(absDir, entry.name));
        result.push({ name: displayName, type: 'file', size: stat.size });
      } catch {
        result.push({ name: displayName, type: 'file', size: 0 });
      }
    }
  }

  return result;
}

/**
 * list_files 工具定义
 */
export const listFilesTool: ToolDef<ListFilesParams, string> = {
  name: 'list_files',
  description:
    '列出指定目录下的文件和子目录。用于浏览项目结构、查找文件。默认跳过 node_modules 和 .git 目录。',
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: '目标目录路径（相对于工作目录，默认为当前目录）',
      },
      recursive: {
        type: 'boolean',
        description: '是否递归列出子目录（默认 false）',
      },
      maxEntries: {
        type: 'integer',
        description: '最大返回条目数（默认 100）',
      },
    },
    required: [],
  },
  safety: ToolSafety.ReadOnly,

  async execute(params: ListFilesParams, context: ToolContext): Promise<string> {
    const directory = params.directory ?? '.';
    const recursive = params.recursive ?? false;
    const maxEntries = params.maxEntries ?? 100;

    // 解析为绝对路径，并防止越出工作目录
    const absDir = path.resolve(context.cwd, directory);
    if (!absDir.startsWith(path.resolve(context.cwd))) {
      throw new Error('禁止访问工作目录之外的路径');
    }

    // 检查目录是否存在
    try {
      const stat = await fs.stat(absDir);
      if (!stat.isDirectory()) {
        return `错误: "${directory}" 不是目录`;
      }
    } catch {
      return `错误: 目录 "${directory}" 不存在`;
    }

    const entries = await listDirRecursive(absDir, recursive, maxEntries);

    if (entries.length === 0) {
      return `目录 "${directory}" 为空`;
    }

    const lines = entries.map((e) => {
      const typeMark = e.type === 'directory' ? '[DIR] ' : '      ';
      const sizeStr = e.type === 'file' ? ` (${e.size} bytes)` : '';
      return `${typeMark}${e.name}${sizeStr}`;
    });

    const header = `目录: ${directory} (共 ${entries.length} 项${entries.length >= maxEntries ? '，已达上限' : ''})\n`;
    return header + lines.join('\n');
  },
};
