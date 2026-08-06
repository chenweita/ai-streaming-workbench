/**
 * 内置工具：正则搜索文件内容（grep_search）
 * 对标 BearCode 文件系统工具（轻量化 TS 重构）
 *
 * 功能：在指定目录下递归搜索匹配正则的文件内容
 * 安全级别：ReadOnly（只读无副作用，并发安全）
 */

import fs from 'fs/promises';
import path from 'path';
import { ToolDef, ToolSafety } from '../ToolProtocol';

/** fs.Dirent 类型别名（从同步 fs 模块导入类型，避免运行时依赖） */
type Dirent = import('fs').Dirent;

/** grep_search 工具参数 */
interface GrepSearchParams {
  /** 正则表达式模式 */
  pattern: string;
  /** 搜索目录（相对于工作目录，默认当前目录） */
  directory?: string;
  /** 文件名 glob 过滤（如 "*.ts"，默认搜索所有文件） */
  filePattern?: string;
  /** 是否大小写敏感（默认 false） */
  caseSensitive?: boolean;
  /** 最大返回匹配数（默认 50） */
  maxMatches?: number;
}

/** 单个匹配结果 */
interface GrepMatch {
  filePath: string;
  line: number;
  content: string;
}

/**
 * 将 glob 模式转换为正则表达式
 * 仅支持 * 和 ? 两种通配符，满足基本需求
 * @param glob glob 模式（如 "*.ts"）
 */
function globToRegex(glob: string): RegExp {
  // 转义正则特殊字符，然后还原 * 和 ?
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/**
 * 判断文件是否匹配 glob 模式
 */
function matchesGlob(fileName: string, filePattern?: string): boolean {
  if (!filePattern) {
    return true;
  }
  try {
    return globToRegex(filePattern).test(fileName);
  } catch {
    return false;
  }
}

/**
 * 递归搜索目录
 * @param absDir 绝对路径
 * @param regex 正则
 * @param filePattern 文件 glob
 * @param maxMatches 最大匹配数
 * @param prefix 路径前缀
 * @param results 结果累积数组
 */
async function searchDir(
  absDir: string,
  regex: RegExp,
  filePattern: string | undefined,
  maxMatches: number,
  prefix: string,
  results: GrepMatch[]
): Promise<void> {
  if (results.length >= maxMatches) {
    return;
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxMatches) {
      return;
    }

    // 跳过无关目录
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
      continue;
    }

    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      await searchDir(path.join(absDir, entry.name), regex, filePattern, maxMatches, relPath, results);
    } else if (entry.isFile() && matchesGlob(entry.name, filePattern)) {
      // 读取文件内容并逐行匹配
      try {
        const content = await fs.readFile(path.join(absDir, entry.name), 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxMatches) {
            return;
          }
          if (regex.test(lines[i])) {
            results.push({
              filePath: relPath,
              line: i + 1,
              content: lines[i].length > 200 ? lines[i].slice(0, 200) + '...' : lines[i],
            });
          }
        }
      } catch {
        // 二进制文件或读取失败，跳过
      }
    }
  }
}

/**
 * grep_search 工具定义
 */
export const grepSearchTool: ToolDef<GrepSearchParams, string> = {
  name: 'grep_search',
  description:
    '在指定目录下递归搜索匹配正则表达式的文件内容。用于查找代码、定位函数定义等。默认跳过 node_modules、.git、dist 目录。',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '正则表达式模式（如 "function\\s+\\w+"）',
      },
      directory: {
        type: 'string',
        description: '搜索目录（相对于工作目录，默认当前目录）',
      },
      filePattern: {
        type: 'string',
        description: '文件名 glob 过滤（如 "*.ts"，默认搜索所有文件）',
      },
      caseSensitive: {
        type: 'boolean',
        description: '是否大小写敏感（默认 false）',
      },
      maxMatches: {
        type: 'integer',
        description: '最大返回匹配数（默认 50）',
      },
    },
    required: ['pattern'],
  },
  safety: ToolSafety.ReadOnly,

  async execute(params: GrepSearchParams, context): Promise<string> {
    const pattern = params.pattern;
    const directory = params.directory ?? '.';
    const filePattern = params.filePattern;
    const caseSensitive = params.caseSensitive ?? false;
    const maxMatches = params.maxMatches ?? 50;

    if (!pattern) {
      return '错误: pattern 参数不能为空';
    }

    // 编译正则
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `错误: 无效的正则表达式 "${pattern}" - ${msg}`;
    }

    // 解析为绝对路径
    const absDir = path.resolve(context.cwd, directory);
    if (!absDir.startsWith(path.resolve(context.cwd))) {
      throw new Error('禁止访问工作目录之外的路径');
    }

    // 检查目录
    try {
      const stat = await fs.stat(absDir);
      if (!stat.isDirectory()) {
        return `错误: "${directory}" 不是目录`;
      }
    } catch {
      return `错误: 目录 "${directory}" 不存在`;
    }

    // 执行搜索
    const results: GrepMatch[] = [];
    await searchDir(absDir, regex, filePattern, maxMatches, '', results);

    if (results.length === 0) {
      return `未找到匹配 "${pattern}" 的内容`;
    }

    const lines = results.map((m) => `${m.filePath}:${m.line}: ${m.content}`);
    const header = `搜索 "${pattern}" 在 ${directory}（共 ${results.length} 项匹配${results.length >= maxMatches ? '，已达上限' : ''}）\n`;
    return header + lines.join('\n');
  },
};
