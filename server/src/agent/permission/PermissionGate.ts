/**
 * 权限网关 - Suspend/Resume 协调器
 * 对标 BearCode 权限系统（轻量化 TS 重构）
 *
 * 核心职责：
 *   1. 挂起 AgentLoop 直到用户对编辑类工具的权限请求作出决策
 *   2. 通过 Promise + resolver 实现单线程事件循环下的 suspend/resume
 *   3. 超时自动拒绝（默认 120s），防止永久挂起
 *   4. 监听 AbortSignal 联动中断（用户主动中止时拒绝 pending 请求）
 *   5. 幂等 resolve：已决/不存在的请求返回 false，不抛错
 *
 * 生命周期：
 *   - 单次 AgentLoop 对应一个 PermissionGate 实例
 *   - SSE 连接断开时上层调用 cancelAll() 清理所有 pending
 *   - permissionId 复用 toolCallId（单次工具调用单次权限请求）
 *
 * 设计原则：
 *   - 严格 TypeScript，禁用 any
 *   - 不缓存授权：每次 request 都是独立的（权限状态只作用于单次工具调用）
 *   - 超时 timer 必须在 resolve/cancel 时 clearTimeout，避免泄漏
 */
import { PermissionDecision } from '../tools/ToolProtocol';

/** 权限请求的负载信息（用于通知上层发 SSE） */
export interface PermissionRequestPayload {
  /** 权限请求 ID，等于 toolCallId */
  permissionId: string;
  /** 工具名（write_file / edit_file） */
  toolName: string;
  /** 工具调用 ID（与 LLM 返回的 tool_call_id 对应） */
  toolCallId: string;
  /** 工具参数原始 JSON 字符串（前端解析后展示） */
  arguments: string;
  /** 请求创建时间戳 */
  createdAt: number;
  /** 自动拒绝超时时间戳（前端倒计时用） */
  expiresAt: number;
}

/** pending 请求内部记录 */
interface PendingEntry {
  resolve: (decision: PermissionDecision) => void;
  timerId: ReturnType<typeof setTimeout>;
  /** abort 信号监听器引用（取消时移除） */
  onAbort?: () => void;
  /** 关联的 signal（用于移除监听） */
  signal?: AbortSignal;
}

/** PermissionGate 构造选项 */
export interface PermissionGateOptions {
  /** 自动拒绝超时（毫秒），默认 120000 */
  timeoutMs?: number;
  /** pending 请求创建时的回调（用于上层发 SSE 通知前端） */
  onPending?: (req: PermissionRequestPayload) => void;
}

/** 默认权限确认超时（120 秒） */
const DEFAULT_TIMEOUT_MS = 120000;

/**
 * 权限网关
 *
 * 使用 Promise + resolver 模式挂起 AgentLoop：
 *   const decision = await gate.request(req, signal);
 *   // 上层在 onPending 回调中发 SSE，前端弹窗
 *   // 用户决策通过 HTTP 端点回传，调用 gate.resolve(id, decision) 唤醒
 */
export class PermissionGate {
  /** pending 请求映射：permissionId -> PendingEntry */
  private readonly pending = new Map<string, PendingEntry>();
  /** 超时时间 */
  private readonly timeoutMs: number;
  /** pending 回调（发 SSE） */
  private readonly onPending?: (req: PermissionRequestPayload) => void;

  constructor(opts: PermissionGateOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onPending = opts.onPending;
  }

  /**
   * 发起权限请求并挂起调用方
   *
   * @param req 请求信息（permissionId / toolName / toolCallId / arguments）
   * @param signal 中断信号（用户主动中止时触发，自动拒绝该请求）
   * @returns 用户的权限决策
   */
  request(
    req: Omit<PermissionRequestPayload, 'createdAt' | 'expiresAt'>,
    signal?: AbortSignal
  ): Promise<PermissionDecision> {
    const now = Date.now();
    const payload: PermissionRequestPayload = {
      ...req,
      createdAt: now,
      expiresAt: now + this.timeoutMs,
    };

    return new Promise<PermissionDecision>((resolve) => {
      // 超时自动拒绝
      const timerId = setTimeout(() => {
        this.pending.delete(req.permissionId);
        this.removeAbortListener(req.permissionId);
        resolve({ approved: false, reason: `权限确认超时（${Math.round(this.timeoutMs / 1000)}s）` });
      }, this.timeoutMs);

      // abort 信号联动（用户中断时拒绝）
      let onAbort: (() => void) | undefined;
      if (signal) {
        if (signal.aborted) {
          // 已中断，直接拒绝
          clearTimeout(timerId);
          resolve({ approved: false, reason: '请求已被中断' });
          return;
        }
        onAbort = () => {
          this.reject(req.permissionId, { approved: false, reason: '请求已被中断' });
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pending.set(req.permissionId, { resolve, timerId, onAbort, signal });

      // 同步触发 onPending（发 SSE）——必须在 set 之后，确保 resolve 能找到 entry
      this.onPending?.(payload);
    });
  }

  /**
   * 用户决策回传（HTTP 端点调用）
   * 幂等：已决或不存在的请求返回 false
   *
   * @param permissionId 权限请求 ID
   * @param decision 用户决策
   * @returns true 表示成功唤醒，false 表示已决或不存在
   */
  resolve(permissionId: string, decision: PermissionDecision): boolean {
    return this.reject(permissionId, decision);
  }

  /**
   * 取消单个请求（拒绝并清理）
   */
  cancel(permissionId: string, reason = '权限请求已取消'): void {
    this.reject(permissionId, { approved: false, reason });
  }

  /**
   * 取消所有 pending 请求（SSE 断开 / 中断时调用）
   */
  cancelAll(reason = '会话已关闭'): void {
    for (const permissionId of Array.from(this.pending.keys())) {
      this.reject(permissionId, { approved: false, reason });
    }
  }

  /**
   * 当前挂起的请求数量（诊断用）
   */
  size(): number {
    return this.pending.size;
  }

  /**
   * 内部：唤醒或拒绝一个请求（统一入口）
   * 清理 timer + 移除 abort 监听 + 删除 entry + resolve
   */
  private reject(permissionId: string, decision: PermissionDecision): boolean {
    const entry = this.pending.get(permissionId);
    if (!entry) {
      return false;
    }
    clearTimeout(entry.timerId);
    this.removeAbortListener(permissionId);
    this.pending.delete(permissionId);
    entry.resolve(decision);
    return true;
  }

  /**
   * 移除 abort 信号监听器（防止内存泄漏）
   */
  private removeAbortListener(permissionId: string): void {
    const entry = this.pending.get(permissionId);
    if (entry?.onAbort && entry.signal) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
  }
}
