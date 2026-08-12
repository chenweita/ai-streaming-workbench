/**
 * 全局操作审计日志模块
 * 记录所有文件修改、工具调用、技能变更等关键操作
 *
 * 存储路径：~/.trae-cn/audit/audit.log（JSONL 格式，按行追加）
 * 支持查询历史操作记录
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/** 审计操作类型 */
export type AuditActionType =
  | 'tool_call'
  | 'file_write'
  | 'file_edit'
  | 'skill_create'
  | 'skill_evolve'
  | 'skill_delete'
  | 'memory_save'
  | 'memory_delete'
  | 'sub_agent_spawn'
  | 'sub_agent_complete'
  | 'permission_denied'
  | 'context_trim';

/** 审计日志条目 */
export interface AuditLogEntry {
  /** 唯一 ID */
  id: string;
  /** 操作类型 */
  action: AuditActionType;
  /** 操作描述 */
  description: string;
  /** 操作者（agent_id 或 'system'） */
  agentId: string;
  /** 父 Agent ID（子 Agent 时使用） */
  parentAgentId?: string;
  /** 操作时间戳 */
  timestamp: number;
  /** 详细元数据（JSON 可序列化） */
  metadata?: Record<string, unknown>;
  /** 结果：success / failed / denied */
  status: 'success' | 'failed' | 'denied';
  /** 耗时（毫秒） */
  durationMs?: number;
}

/** 审计日志存储配置 */
export interface AuditLogConfig {
  /** 存储根目录（默认 ~/.trae-cn/audit） */
  rootDir?: string;
  /** 单文件最大行数（超过后滚动） */
  maxFileSize?: number;
}

/** 默认审计日志路径 */
function getAuditDir(): string {
  return path.join(os.homedir(), '.trae-cn', 'audit');
}

/** 生成 UUID */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 审计日志存储类 */
export class AuditLog {
  private readonly logDir: string;
  private readonly logFile: string;
  private readonly maxFileSize: number;
  private writeStream: fs.WriteStream | null = null;

  constructor(config?: AuditLogConfig) {
    this.logDir = config?.rootDir ?? getAuditDir();
    this.logFile = path.join(this.logDir, 'audit.log');
    this.maxFileSize = config?.maxFileSize ?? 100000;
    this.init();
  }

  private init(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      // 滚动日志
      if (fs.existsSync(this.logFile)) {
        const stat = fs.statSync(this.logFile);
        const lineCount = stat.size > 0 ? fs.readFileSync(this.logFile, 'utf-8').split('\n').length - 1 : 0;
        if (lineCount >= this.maxFileSize) {
          const backup = path.join(this.logDir, `audit_${Date.now()}.log`);
          fs.renameSync(this.logFile, backup);
          console.log(`[AuditLog] 日志滚动: ${backup}`);
        }
      }
      console.log(`[AuditLog] 审计日志存储: ${this.logFile}`);
    } catch (e) {
      console.error(`[AuditLog] 初始化失败:`, e instanceof Error ? e.message : String(e));
    }
  }

  /** 写入审计日志 */
  log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now(),
    };

    try {
      const line = JSON.stringify(fullEntry) + '\n';
      fs.appendFileSync(this.logFile, line, 'utf-8');
    } catch (e) {
      console.error(`[AuditLog] 写入失败:`, e instanceof Error ? e.message : String(e));
    }

    return fullEntry;
  }

  /** 便捷方法：记录工具调用 */
  logToolCall(
    agentId: string,
    toolName: string,
    description: string,
    status: 'success' | 'failed' | 'denied',
    metadata?: Record<string, unknown>
  ): AuditLogEntry {
    return this.log({
      action: 'tool_call',
      description: `[${toolName}] ${description}`,
      agentId,
      status,
      metadata,
    });
  }

  /** 便捷方法：记录文件修改 */
  logFileChange(
    agentId: string,
    action: 'file_write' | 'file_edit',
    filePath: string,
    status: 'success' | 'failed',
    metadata?: Record<string, unknown>
  ): AuditLogEntry {
    return this.log({
      action,
      description: `${action === 'file_write' ? '写入' : '编辑'}文件: ${filePath}`,
      agentId,
      status,
      metadata,
    });
  }

  /** 便捷方法：记录权限拒绝 */
  logPermissionDenied(agentId: string, action: string, description: string): AuditLogEntry {
    return this.log({
      action: 'permission_denied',
      description: `权限被拒绝: [${action}] ${description}`,
      agentId,
      status: 'denied',
    });
  }

  /** 便捷方法：记录上下文裁剪 */
  logContextTrim(
    agentId: string,
    beforeCount: number,
    afterCount: number,
    beforeTokens: number,
    afterTokens: number
  ): AuditLogEntry {
    return this.log({
      action: 'context_trim',
      description: `上下文裁剪: ${beforeCount}→${afterCount} 条消息, ${Math.round(beforeTokens)}→${Math.round(afterTokens)} tokens`,
      agentId,
      status: 'success',
      metadata: { beforeCount, afterCount, beforeTokens, afterTokens },
    });
  }

  /** 查询日志 */
  query(options?: {
    action?: AuditActionType;
    agentId?: string;
    status?: 'success' | 'failed' | 'denied';
    startTime?: number;
    endTime?: number;
    limit?: number;
    keyword?: string;
  }): AuditLogEntry[] {
    try {
      if (!fs.existsSync(this.logFile)) {
        return [];
      }

      const raw = fs.readFileSync(this.logFile, 'utf-8');
      const lines = raw.trim().split('\n');
      const entries: AuditLogEntry[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as AuditLogEntry);
        } catch {
          // 跳过损坏行
        }
      }

      // 应用过滤
      let result = entries.sort((a, b) => b.timestamp - a.timestamp);

      if (options?.action) {
        result = result.filter((e) => e.action === options.action);
      }
      if (options?.agentId) {
        result = result.filter((e) => e.agentId === options.agentId);
      }
      if (options?.status) {
        result = result.filter((e) => e.status === options.status);
      }
      if (options?.startTime) {
        result = result.filter((e) => e.timestamp >= options.startTime!);
      }
      if (options?.endTime) {
        result = result.filter((e) => e.timestamp <= options.endTime!);
      }
      if (options?.keyword) {
        const kw = options.keyword.toLowerCase();
        result = result.filter(
          (e) =>
            e.description.toLowerCase().includes(kw) ||
            (e.metadata && JSON.stringify(e.metadata).toLowerCase().includes(kw))
        );
      }
      if (options?.limit) {
        result = result.slice(0, options.limit);
      }

      return result;
    } catch (e) {
      console.error(`[AuditLog] 查询失败:`, e instanceof Error ? e.message : String(e));
      return [];
    }
  }

  /** 获取日志统计 */
  getStats(): { total: number; byAction: Record<string, number>; byStatus: Record<string, number> } {
    const entries = this.query({ limit: 10000 });
    const byAction: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const entry of entries) {
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;
      byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
    }

    return { total: entries.length, byAction, byStatus };
  }
}