/**
 * Transport —— 把 editor-core 的 localOps 送到後端（M2-B 交付物 11）。
 *
 * 職責：
 *   1. debounce 300ms 打包成一個 transaction（連續打字不會每個字打一次 API）
 *   2. 序列化送出（同一頁同時只會有一個 in-flight request，保證 ops 順序）
 *   3. 網路/5xx 錯誤重試（指數退避），4xx（不合法 op）立刻 rollback
 *   4. rollback = 把這一批的 inverse ops 反序餵回 editor.applyRemote()
 *
 * **設計成可以整批換成 sync-client**：只要有人實作 `SyncAdapter`
 * （`{ submit(ops), onRemote(cb) }`），把它傳進 `createTransport({ adapter })` 即可，
 * 其餘邏輯（打包、rollback、狀態）完全不用改。
 *
 * 純邏輯 + 可注入 timer/送出函式 → 可在 Node 環境單測（見 __tests__/transport.test.ts）。
 */
import type { Operation, TransactionResult } from '@kennote/shared-types';
import { API_ROUTES, MAX_OPS_PER_TRANSACTION } from '@kennote/shared-types';
import { api } from '../../lib/api-client';

export const DEFAULT_DEBOUNCE_MS = 300;

/** 之後把 lib/sync-client.ts 接上來時，只需要滿足這個介面。 */
export interface SyncAdapter {
  /** 送出一批 ops。回傳伺服器結果（至少要有 seq）。 */
  submit(ops: Operation[], meta: { txId: string; pageId: string; originSessionId: string }): Promise<TransactionResult>;
  /** 訂閱遠端 ops。回傳 unsubscribe。 */
  onRemote?(cb: (ops: Operation[]) => void): () => void;
  destroy?(): void;
}

export type TransportStatus = 'idle' | 'pending' | 'saving' | 'error' | 'offline';

export interface TransportState {
  status: TransportStatus;
  /** 尚未送達伺服器的 op 數量（含排隊中與 in-flight） */
  pending: number;
  /** 伺服器最後回報的 seq */
  seq: number;
  lastError: string | null;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CreateTransportOptions {
  pageId: string;
  sessionId: string;
  adapter?: SyncAdapter;
  debounceMs?: number;
  /** 網路錯誤最多重試幾次（不含第一次） */
  maxRetries?: number;
  initialSeq?: number;
  timers?: Timers;
  newTxId?: () => string;
  /** rollback：把 inverse ops 套回編輯器（實務上是 editor.applyRemote） */
  onRollback?(inverseOps: Operation[]): void;
  onStateChange?(state: TransportState): void;
  onError?(message: string, error: unknown): void;
  onRemoteOps?(ops: Operation[]): void;
}

export interface Transport {
  /** editor 的 localOps 事件接到這裡。inverseOps 供失敗時 rollback。 */
  push(ops: Operation[], inverseOps: Operation[]): void;
  /** 立刻送出所有排隊中的變更（離開頁面、切換頁面時呼叫）。 */
  flush(): Promise<void>;
  getState(): TransportState;
  subscribe(cb: (state: TransportState) => void): () => void;
  destroy(): void;
}

interface Batch {
  ops: Operation[];
  /** 已經反序好的 inverse ops（rollback 時直接套用） */
  inverse: Operation[];
}

/** 預設 adapter：POST /api/pages/:id/transactions */
export function createHttpAdapter(): SyncAdapter {
  return {
    submit(ops, meta) {
      return api.post<TransactionResult>(API_ROUTES.pageTransactions(meta.pageId), {
        txId: meta.txId,
        pageId: meta.pageId,
        originSessionId: meta.originSessionId,
        ops,
      });
    },
  };
}

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  // status 0 = 連線失敗；5xx = 伺服器暫時性錯誤；429 = 被限流
  return status === 0 || status === 429 || (typeof status === 'number' && status >= 500);
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return '未知錯誤';
}

export function createTransport(options: CreateTransportOptions): Transport {
  const timers: Timers = options.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxRetries = options.maxRetries ?? 3;
  const adapter = options.adapter ?? createHttpAdapter();
  const newTxId = options.newTxId ?? defaultTxId;

  let queue: Batch = { ops: [], inverse: [] };
  let inFlight = false;
  let timer: unknown = null;
  let destroyed = false;
  let flushWaiters: (() => void)[] = [];

  const state: TransportState = {
    status: 'idle',
    pending: 0,
    seq: options.initialSeq ?? 0,
    lastError: null,
  };
  const listeners = new Set<(s: TransportState) => void>();

  function emit(patch: Partial<TransportState>): void {
    Object.assign(state, patch);
    const snapshot = { ...state };
    options.onStateChange?.(snapshot);
    for (const cb of [...listeners]) cb(snapshot);
  }

  const offRemote = adapter.onRemote?.((ops) => options.onRemoteOps?.(ops)) ?? null;

  function scheduleFlush(): void {
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      void drain();
    }, debounceMs);
  }

  function settleFlushWaiters(): void {
    if (queue.ops.length > 0 || inFlight) return;
    const waiters = flushWaiters;
    flushWaiters = [];
    for (const w of waiters) w();
  }

  async function drain(): Promise<void> {
    if (destroyed || inFlight) return;
    if (queue.ops.length === 0) {
      emit({ status: state.lastError ? 'error' : 'idle', pending: 0 });
      settleFlushWaiters();
      return;
    }

    // 一個 transaction 最多 200 個 op（後端契約）
    const ops = queue.ops.slice(0, MAX_OPS_PER_TRANSACTION);
    const takenInverse = queue.inverse.slice(-ops.length);
    queue = {
      ops: queue.ops.slice(ops.length),
      inverse: queue.inverse.slice(0, queue.inverse.length - takenInverse.length),
    };

    inFlight = true;
    emit({ status: 'saving', pending: ops.length + queue.ops.length });

    const txId = newTxId();
    let attempt = 0;
    for (;;) {
      try {
        const result = await adapter.submit(ops, {
          txId,
          pageId: options.pageId,
          originSessionId: options.sessionId,
        });
        inFlight = false;
        emit({
          status: queue.ops.length > 0 ? 'pending' : 'idle',
          pending: queue.ops.length,
          seq: result?.seq ?? state.seq,
          lastError: null,
        });
        if (result?.conflicts?.length) {
          options.onError?.(`有 ${result.conflicts.length} 個 block 版本衝突，已以伺服器版本為準`, result);
        }
        break;
      } catch (error) {
        if (destroyed) {
          inFlight = false;
          return;
        }
        if (isRetryable(error) && attempt < maxRetries) {
          attempt += 1;
          emit({ status: 'offline', lastError: errorMessage(error) });
          await delay(timers, Math.min(8000, 2 ** attempt * 250));
          continue;
        }
        // 放棄：rollback 這一批（inverse 已經是反序）
        inFlight = false;
        options.onRollback?.(takenInverse);
        options.onError?.(`變更未能儲存，已還原：${errorMessage(error)}`, error);
        emit({ status: 'error', pending: queue.ops.length, lastError: errorMessage(error) });
        break;
      }
    }

    if (queue.ops.length > 0) void drain();
    else settleFlushWaiters();
  }

  return {
    push(ops, inverseOps) {
      if (destroyed || ops.length === 0) return;
      queue.ops.push(...ops);
      // inverse 要反序才能正確還原（後做的先還原）
      queue.inverse.unshift(...[...inverseOps].reverse());
      emit({ status: 'pending', pending: queue.ops.length + (inFlight ? 1 : 0) });
      scheduleFlush();
    },
    flush() {
      if (destroyed) return Promise.resolve();
      if (timer !== null) {
        timers.clearTimeout(timer);
        timer = null;
      }
      if (queue.ops.length === 0 && !inFlight) return Promise.resolve();
      const done = new Promise<void>((resolve) => flushWaiters.push(resolve));
      void drain();
      return done;
    },
    getState() {
      return { ...state };
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy() {
      destroyed = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      offRemote?.();
      adapter.destroy?.();
      listeners.clear();
      flushWaiters = [];
    },
  };
}

function delay(timers: Timers, ms: number): Promise<void> {
  return new Promise((resolve) => {
    timers.setTimeout(resolve, ms);
  });
}

function defaultTxId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 每個瀏覽器分頁一個 session id（廣播時伺服器用它排除自己） */
export function createSessionId(): string {
  return defaultTxId();
}

/**
 * 頁面即將關閉時的保底送出。
 * fetch 帶 keepalive 才能在 unload 後存活；失敗就算了（下次開頁會從 snapshot 撿回來）。
 */
export function beaconFlush(pageId: string, sessionId: string, ops: Operation[]): void {
  if (ops.length === 0) return;
  const body = JSON.stringify({
    txId: defaultTxId(),
    pageId,
    originSessionId: sessionId,
    ops: ops.slice(0, MAX_OPS_PER_TRANSACTION),
  });
  try {
    void fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}${API_ROUTES.pageTransactions(pageId)}`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch {
    /* unload 階段的失敗無法處理，忽略 */
  }
}
