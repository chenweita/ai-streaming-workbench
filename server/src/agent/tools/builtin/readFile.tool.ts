/**
 * 内置工具：读取文件内容（read_file）
 * 对标 BearCode 文件系统工具（轻量化 TS 重构）
 *
 * 功能：读取指定文件的文本内容
 * 安全级别：ReadOnly（只读无副作用，并发安全）
 */

import fs from 'fs/promises';
import path from 'path';
import { ToolDef, ToolSafety } from '../ToolProtocol';

/** read_file 工具参数 */
interface ReadFileParams {
  /** 文件路径（相对于工作目录） */
  filePath: string;
  /** 起始行号（从 1 开始，默认 1） */
  startLine?: number;
  /** 结束行号（默认到文件末尾） */
  endLine?: number;
  /** 最大读取字节数（防止读取超大文件，默认 512KB） */
  maxBytes?: number;
}

/** 默认最大读取字节数（512KB） */
const DEFAULT_MAX_BYTES = 512 * 1024;

/**
 * read_file 工具定义
 */
export const readFileTool: ToolDef<ReadFileParams, string> = {
  name: 'read_file',
  description:
    '读取指定文件的文本内容。支持按行号范围读取。用于查看源码、配置文件等。',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '文件路径（相对于工作目录）',
      },
      startLine: {
        type: 'integer',
        description: '起始行号（从 1 开始，默认 1）',
      },
      endLine: {
        type: 'integer',
        description: '结束行号（默认到文件末尾）',
      },
      maxBytes: {
        type: 'integer',
        description: '最大读取字节数（默认 524288，即 512KB）',
      },
    },
    required: ['filePath'],
  },
  safety: ToolSafety.ReadOnly,

  async execute(params: ReadFileParams, context): Promise<string> {
    const filePath = params.filePath;
    const startLine = params.startLine ?? 1;
    const endLine = params.endLine;
    const maxBytes = params.maxBytes ?? DEFAULT_MAX_BYTES;

    if (!filePath) {
      return '错误: filePath 参数不能为空';
    }

    // 解析为绝对路径，防止越出工作目录
    const absPath = path.resolve(context.cwd, filePath);
    if (!absPath.startsWith(path.resolve(context.cwd))) {
      throw new Error('禁止访问工作目录之外的路径');
    }

    // 检查文件是否存在
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) {
        return `错误: "${filePath}" 不是文件`;
      }
      // 超出大小限制提前拒绝
      if (stat.size > maxBytes * 2) {
        return `错误: 文件大小 ${stat.size} 字节，超过限制 ${maxBytes * 2} 字节。请使用 startLine/endLine 分段读取。`;
      }
    } catch {
      return `错误: 文件 "${filePath}" 不存在`;
    }

    // 读取文件内容
    let content: string;
    try {
      content = await fs.readFile(absPath, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `错误: 读取文件失败 - ${msg}`;
    }

    // 截断到最大字节数
    if (content.length > maxBytes) {
      content = content.slice(0, maxBytes) + '\n... (已截断，仅显示前 ' + maxBytes + ' 字节)';
    }

    // 按行号范围截取
    const lines = content.split('\n');
    const start = Math.max(1, startLine) - 1;
    const end = endLine ? Math.min(lines.length, endLine) : lines.length;
    const selectedLines = lines.slice(start, end);

    // 添加行号前缀
    const numberedLines = selectedLines.map((line, idx) => {
      const lineNum = start + idx + 1;
      return `${String(lineNum).padStart(6, ' ')}\t${line}`;
    });

    const header = `文件: ${filePath} (行 ${start + 1}-${end}，共 ${lines.length} 行)\n`;
    return header + numberedLines.join('\n');
  },
};
