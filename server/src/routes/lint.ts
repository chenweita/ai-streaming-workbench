/**
 * POST /api/code-lint-fix - 代码检测与自动修复接口
 *
 * 纯薄包装层，不实现任何 lint 逻辑，全部委托给 @buildloop/lint。
 *
 * 请求体：
 *   {
 *     codeText: string,       // 源代码文本
 *     fileType: string,       // 文件类型：js | jsx | ts | tsx | vue | css | scss | less | md
 *     fix?: boolean,          // 是否自动修复（默认 true）
 *     quiet?: boolean         // 仅输出错误（忽略 warning）
 *   }
 *
 * 响应体：
 *   {
 *     originCode: string,
 *     fixedCode: string,
 *     lintErrors: Array<{ line, column, rule, message, severity, fixable }>
 *   }
 */

import { Router, Request, Response } from 'express';
import { fixText, scanText, type FileType } from '@buildloop/lint';

const router = Router();

const VALID_FILE_TYPES: FileType[] = ['js', 'jsx', 'ts', 'tsx', 'vue', 'css', 'scss', 'less', 'md'];

router.post('/code-lint-fix', async (req: Request, res: Response) => {
  try {
    const { codeText, fileType, fix = true, quiet = false } = req.body as {
      codeText: string;
      fileType: string;
      fix?: boolean;
      quiet?: boolean;
    };

    if (!codeText || !fileType) {
      res.status(400).json({ code: 400, message: 'codeText 和 fileType 为必填参数' });
      return;
    }

    const normalizedType = fileType.toLowerCase() as FileType;
    if (!VALID_FILE_TYPES.includes(normalizedType)) {
      res.status(400).json({
        code: 400,
        message: `不支持的文件类型：${fileType}`,
      });
      return;
    }

    const api = fix ? fixText : scanText;
    const result = await api(codeText, normalizedType, { quiet });

    res.json({
      originCode: codeText,
      fixedCode: result.fixedCode ?? codeText,
      lintErrors: result.results.flatMap((r: any) => r.messages),
    });
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error('[CodeLint] 处理异常:', error.message);
    res.status(500).json({ code: 500, message: error.message });
  }
});

export default router;