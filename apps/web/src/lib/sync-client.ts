/**
 * 自研同步客戶端（04 §6.4 / §6.5、§8 M5-4）。**沒有 socket.io、沒有 Yjs。**
 *
 * 職責：
 *   1. 連線狀態機：connecting → authenticating → syncing → ready ⇄ reconnecting / offline
 *   2. 重連：1,2,4,8,16,30s 的 backoff，每次 ±20% jitter（避免驚群）
 *   3. 訂閱與補傳：subscribe(pageId, sinceSeq)、seq 不連續時自動要求 catchUp
 *   4. `resync`：落後太多 → 請宿主重抓 snapshot
 *   5. pending queue：WS 優先、失敗降級 HTTP POST、斷線寫入 IndexedDB、重連後依序重送
 *   6. debounce 300ms 打包成一筆 Transaction
 *   7. **OT delta 通道（M6）**：`text.delta` 不走 debounce 佇列，
 *      由 `attachDeltaChannel()` 註冊的 OT 三狀態機決定何時送出（一次只能有一筆 outstanding）。
 *      兩條通道共用同一條 WebSocket 與同一支伺服器 `applyTransaction()`。
 *
 * 這個檔案**不 import React、不 import store**，所以可以在 Node 裡用假 WebSocket 完整測試。
 * React 綁定在 stores/sync.ts（usePageSync / useSyncState）。
 */
import type {
  ClientMessage,
  Operation,
  PagePermission,
  PeerPresence,
  ServerMessage,
  Transaction,
  TransactionResult,
} from '@kennote/shared-types';
import type { OtDelta, TextDeltaOperation } from '@kennote/shared-types';
import {
  isTextDeltaOperation,
  splitDeltaOps,
  textDeltaOperation,
  WS_CLIENT_PING_INTERVAL_MS,
} from '@kennote/shared-types';
import {
  createOfflineQueue,
  nextOrder,
  type OfflineQueue,
  type QueuedTransaction,
} from './offline-queue';

export type SyncState =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'syncing'
  | 'ready'
  | 'reconnecting'
  | 'offline';

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export interface RemoteOpsMeta {
  seq: number;
  txId: string;
  actorId: string;
  /** 補傳（重連後一次套多筆）時為 true，宿主可以選擇不做動畫 */
  catchUp: boolean;
}

export interface PageHandlers {
  /** ⭐ 遠端變更：宿主要呼叫 editor.applyRemote(ops)（IME 組字時由 editor 自行排隊） */
  onRemoteOps?(ops: Operation[], meta: RemoteOpsMeta): void;
  /** 落後太多或伺服器要求 → 請重抓 GET /api/pages/:id/snapshot */
  onResync?(reason: string): void;
  onPresence?(peers: PeerPresence[]): void;
  /** baseVersion 不符：伺服器仍套用（LWW），前端 toast「此段落剛被 XXX 修改」 */
  onConflict?(blockIds: string[], actorId: string): void;
  /** 伺服器拒絕 → 宿主套用 inverseOps 回滾 */
  onRollback?(tx: QueuedTransaction, reason: { code: string; message: string }): void;
  onComment?(message: Extract<ServerMessage, { t: 'comment' }>): void;
  onPermission?(permission: PagePermission): void;
  onSeqChange?(seq: number): void;
}

/**
 * OT delta 通道的回呼（M6）。與 `PageHandlers` 分開註冊，
 * 因為它的生命週期綁在「編輯器實例」而不是「頁面訂閱」。
 */
export interface DeltaChannelHandlers {
  /** 伺服器確認了我們送出的 delta（op 裡帶著 transform 過的 delta 與新的 rev） */
  onAck?(op: TextDeltaOperation, txId: string): void;
  /** 別人送出的 delta（伺服器已套用並 transform 過） */
  onRemoteDelta?(op: TextDeltaOperation, meta: RemoteOpsMeta): void;
  /** 伺服器拒絕（4xx 或 NOT_IMPLEMENTED）→ 宿主重抓整頁 */
  onRejected?(blockId: string, reason: { code: string; message: string }): void;
}

export interface SyncClientOptions {
  getToken(): string | null;
  sessionId?: string;
  url?: string;
  socketFactory?(url: string): WebSocketLike;
  queue?: OfflineQueue;
  /** 打包變更的 debounce（04 §5.4 建議 300ms） */
  debounceMs?: number;
  /** WS 送出後多久沒收到 ack 就降級走 HTTP */
  ackTimeoutMs?: number;
  http?: {
    submit(pageId: string, tx: Transaction): Promise<TransactionResult>;
    fetchSince(
      pageId: string,
      since: number,
    ): Promise<{ pageId: string; seq: number; results: TransactionResult[] }>;
  };
  isOnline?(): boolean;
  onStateChange?(state: SyncState): void;
  onNotification?(message: Extract<ServerMessage, { t: 'notification' }>): void;
  random?(): number;
  now?(): number;
}

/** 重連延遲（04 §6.5）：1,2,4,8,16,30 秒，之後固定 30 秒 */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

/** ±20% jitter —— 伺服器重啟時 100 個客戶端不會同一毫秒一起衝回來 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 30000;
  return Math.round(base * (0.8 + random() * 0.4));
}

/** UUID v7（時間有序）。瀏覽器沒有內建，自己寫 —— 與後端 lib/uuidv7.ts 同一套版面 */
export function createId(now: number = Date.now(), random: () => number = Math.random): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(random() * 256);
  }
  const ts = Math.floor(now);
  bytes[0] = (ts / 2 ** 40) & 0xff;
  bytes[1] = (ts / 2 ** 32) & 0xff;
  bytes[2] = (ts / 2 ** 24) & 0xff;
  bytes[3] = (ts / 2 ** 16) & 0xff;
  bytes[4] = (ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** seq 連續性判斷（04 §6.4 的三分支） */
export type SeqDecision = 'apply' | 'duplicate' | 'gap';

export function decideSeq(localSeq: number, incomingSeq: number): SeqDecision {
  if (incomingSeq <= localSeq) return 'duplicate';
  if (incomingSeq === localSeq + 1) return 'apply';
  return 'gap';
}

interface PageEntry {
  pageId: string;
  handlers: PageHandlers;
  localSeq: number;
  /** 是否已經收過伺服器的 synced（決定 subscribe 要不要帶 sinceSeq） */
  synced: boolean;
  permission: PagePermission;
  buffer: Operation[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  presence: { blockId: string | null; selection: [number, number] | null } | null;
  /** M6 OT：delta 通道的回呼（沒註冊時 text.delta 會退回走 onRemoteOps） */
  deltaHandlers: DeltaChannelHandlers | null;
  /** txId → blockId，txRejected 時才知道要通知哪個 block */
  deltaTxBlocks: Map<string, string>;
}

function defaultUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost:4000/ws';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

export class SyncClient {
  readonly sessionId: string;
  private readonly opts: SyncClientOptions;
  private readonly queue: OfflineQueue;
  private readonly pages = new Map<string, PageEntry>();
  private readonly inflight = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly stateListeners = new Set<(state: SyncState) => void>();

  private socket: WebSocketLike | null = null;
  private state: SyncState = 'idle';
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private queueReady: Promise<void> | null = null;

  constructor(options: SyncClientOptions) {
    this.opts = options;
    this.sessionId = options.sessionId ?? createId();
    this.queue = options.queue ?? createOfflineQueue();
  }

  /* ── 狀態 ─────────────────────────────────────────── */

  getState(): SyncState {
    return this.state;
  }

  onStateChange(fn: (state: SyncState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private setState(next: SyncState): void {
    if (this.state === next) return;
    this.state = next;
    this.opts.onStateChange?.(next);
    for (const fn of [...this.stateListeners]) fn(next);
  }

  private isOnline(): boolean {
    if (this.opts.isOnline) return this.opts.isOnline();
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine !== false;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /* ── 連線 ─────────────────────────────────────────── */

  start(): void {
    if (this.started) return;
    this.started = true;
    this.queueReady = this.queue.init().catch(() => undefined);
    this.connect();
  }

  stop(): void {
    this.started = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    for (const timer of this.inflight.values()) clearTimeout(timer);
    this.inflight.clear();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'client stop');
    this.setState('idle');
  }

  private connect(): void {
    if (!this.started) return;
    const token = this.opts.getToken();
    if (!token) {
      // 還沒登入（或 access token 剛過期）→ 稍後再試，不要瘋狂重連
      this.scheduleReconnect();
      return;
    }
    if (!this.isOnline()) {
      this.setState('offline');
      this.scheduleReconnect();
      return;
    }

    this.setState('connecting');
    const base = this.opts.url ?? defaultUrl();
    const url = `${base}?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(this.sessionId)}`;
    const socket = this.opts.socketFactory
      ? this.opts.socketFactory(url)
      : (new WebSocket(url) as unknown as WebSocketLike);
    this.socket = socket;

    socket.onopen = () => {
      this.setState('authenticating');
      this.startPing();
    };
    socket.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      void this.handleMessage(msg);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      for (const entry of this.pages.values()) entry.synced = false;
      if (!this.started) return;
      this.setState(this.isOnline() ? 'reconnecting' : 'offline');
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // close 會接著來，統一在那裡處理
    };
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    // client 每 25s 送 ping（必須短於 Nginx / Cloudflare 的 60s 閒置逾時）
    this.pingTimer = setInterval(() => this.send({ t: 'ping' }), WS_CLIENT_PING_INTERVAL_MS);
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    const delay = backoffDelay(this.attempt, this.opts.random ?? Math.random);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(msg: ClientMessage): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  /* ── 頁面訂閱 ─────────────────────────────────────── */

  attachPage(pageId: string, handlers: PageHandlers, initialSeq = 0): () => void {
    const existing = this.pages.get(pageId);
    const entry: PageEntry = existing ?? {
      pageId,
      handlers,
      localSeq: initialSeq,
      synced: false,
      permission: 'read',
      buffer: [],
      flushTimer: null,
      presence: null,
      deltaHandlers: null,
      deltaTxBlocks: new Map(),
    };
    entry.handlers = handlers;
    if (initialSeq > entry.localSeq) entry.localSeq = initialSeq;
    this.pages.set(pageId, entry);

    this.subscribe(pageId);
    void this.resendQueued(pageId);

    return () => {
      const current = this.pages.get(pageId);
      if (!current) return;
      if (current.flushTimer) clearTimeout(current.flushTimer);
      // 離開前先把還沒 debounce 出去的變更送掉，不要留在記憶體
      if (current.buffer.length > 0) void this.flush(pageId);
      this.pages.delete(pageId);
      this.send({ t: 'unsubscribe', pageId });
    };
  }

  /** 設定本地 seq（宿主載入 snapshot 之後呼叫） */
  setLocalSeq(pageId: string, seq: number): void {
    const entry = this.pages.get(pageId);
    if (!entry) return;
    if (seq > entry.localSeq) entry.localSeq = seq;
  }

  getLocalSeq(pageId: string): number {
    return this.pages.get(pageId)?.localSeq ?? 0;
  }

  getPermission(pageId: string): PagePermission {
    return this.pages.get(pageId)?.permission ?? 'read';
  }

  private subscribe(pageId: string): void {
    const entry = this.pages.get(pageId);
    if (!entry) return;
    this.send({ t: 'subscribe', pageId, sinceSeq: entry.localSeq });
  }

  updatePresence(
    pageId: string,
    blockId: string | null,
    selection: [number, number] | null,
  ): void {
    const entry = this.pages.get(pageId);
    if (!entry) return;
    entry.presence = { blockId, selection };
    this.send({ t: 'presence', pageId, blockId, selection });
  }

  /* ── OT delta 通道（M6，與 tx 通道並存）──────────────── */

  /**
   * 註冊 delta 通道。回傳解除註冊的函式。
   * 沒註冊時，收到的 `text.delta` 會退回走 `onRemoteOps`（舊的 LWW 路徑仍能運作）。
   */
  attachDeltaChannel(pageId: string, handlers: DeltaChannelHandlers): () => void {
    const entry = this.pages.get(pageId);
    if (!entry) return () => {};
    entry.deltaHandlers = handlers;
    return () => {
      const current = this.pages.get(pageId);
      if (current && current.deltaHandlers === handlers) current.deltaHandlers = null;
    };
  }

  /**
   * 送出一筆 delta。**不進 debounce buffer** —— OT 的三狀態機規定
   * 「同一個 block 一次只能有一筆 outstanding」，打包會破壞這個不變量。
   *
   * 仍然會寫進離線佇列（txId 相同 → 伺服器冪等），所以斷線重送的行為與 tx 通道一致。
   */
  submitDelta(pageId: string, blockId: string, delta: OtDelta, baseRev: number): string {
    const entry = this.pages.get(pageId);
    const txId = createId(this.now());
    if (!entry) return txId;
    entry.deltaTxBlocks.set(txId, blockId);
    const queued: QueuedTransaction = {
      txId,
      pageId,
      ops: [textDeltaOperation(blockId, delta, baseRev)],
      createdAt: this.now(),
      attempts: 0,
      order: nextOrder(this.now()),
    };
    void this.queue
      .put(queued)
      .catch(() => undefined)
      .then(() => this.trySend(queued));
    return txId;
  }

  /* ── 送出變更 ─────────────────────────────────────── */

  /** 樂觀更新之後呼叫：ops 進 buffer，debounce 300ms 打包成一筆 Transaction */
  submit(pageId: string, ops: Operation[]): void {
    if (ops.length === 0) return;
    const entry = this.pages.get(pageId);
    if (!entry) return;
    entry.buffer.push(...ops);
    // 一次最多 200 個 op（MAX_OPS_PER_TRANSACTION）→ 滿了就立刻送，不等 debounce
    if (entry.buffer.length >= 200) {
      void this.flush(pageId);
      return;
    }
    if (entry.flushTimer) clearTimeout(entry.flushTimer);
    entry.flushTimer = setTimeout(() => {
      entry.flushTimer = null;
      void this.flush(pageId);
    }, this.opts.debounceMs ?? 300);
  }

  /** 立刻打包送出（切頁、關閉視窗前呼叫） */
  async flush(pageId: string): Promise<void> {
    const entry = this.pages.get(pageId);
    if (!entry || entry.buffer.length === 0) return;
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer);
      entry.flushTimer = null;
    }
    const ops = entry.buffer.splice(0, 200);
    const queued: QueuedTransaction = {
      txId: createId(this.now()),
      pageId,
      ops,
      createdAt: this.now(),
      attempts: 0,
      order: nextOrder(this.now()),
    };
    await this.queue.put(queued).catch(() => undefined);
    await this.trySend(queued);
    if (entry.buffer.length > 0) await this.flush(pageId);
  }

  private toTransaction(queued: QueuedTransaction): Transaction {
    return {
      txId: queued.txId,
      pageId: queued.pageId,
      originSessionId: this.sessionId,
      ops: queued.ops,
    };
  }

  /** WS 優先，失敗降級 HTTP POST；都送不出去就留在佇列等重連（04 §5.4） */
  private async trySend(queued: QueuedTransaction): Promise<void> {
    queued.attempts += 1;
    await this.queue.put(queued).catch(() => undefined);

    if (this.state === 'ready' || this.state === 'syncing') {
      if (this.send({ t: 'tx', tx: this.toTransaction(queued) })) {
        this.armAckTimeout(queued);
        return;
      }
    }
    await this.sendOverHttp(queued);
  }

  private armAckTimeout(queued: QueuedTransaction): void {
    const existing = this.inflight.get(queued.txId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.inflight.delete(queued.txId);
      // WS 沒回 ack（可能連線半死）→ 用 HTTP 補送，txId 相同所以不會套兩次
      void this.sendOverHttp(queued);
    }, this.opts.ackTimeoutMs ?? 10_000);
    this.inflight.set(queued.txId, timer);
  }

  private async sendOverHttp(queued: QueuedTransaction): Promise<void> {
    const http = this.opts.http;
    if (!http || !this.isOnline()) return;
    try {
      const result = await http.submit(queued.pageId, this.toTransaction(queued));
      await this.onAck(result);
    } catch (err) {
      const reason = err as { code?: string; message?: string; status?: number };
      // 4xx（權限、驗證失敗）不會因為重送而變好 → 回滾並丟掉
      if (typeof reason.status === 'number' && reason.status >= 400 && reason.status < 500) {
        await this.rejectQueued(queued, {
          code: reason.code ?? 'BAD_REQUEST',
          message: reason.message ?? '伺服器拒絕了這筆變更',
        });
        return;
      }
      // 其餘（離線、5xx）留在佇列，重連後重送
    }
  }

  private async onAck(result: TransactionResult): Promise<void> {
    const timer = this.inflight.get(result.txId);
    if (timer) {
      clearTimeout(timer);
      this.inflight.delete(result.txId);
    }
    await this.queue.remove(result.txId).catch(() => undefined);

    const entry = this.pages.get(result.pageId);
    if (!entry) return;
    // OT：伺服器在 result.ops 裡回傳 transform 過的 delta 與新的 rev
    if (entry.deltaHandlers) {
      for (const op of result.ops) {
        if (isTextDeltaOperation(op)) entry.deltaHandlers.onAck?.(op, result.txId);
      }
    }
    entry.deltaTxBlocks.delete(result.txId);
    if (result.seq > entry.localSeq) {
      entry.localSeq = result.seq;
      entry.handlers.onSeqChange?.(result.seq);
    }
    if (result.conflicts && result.conflicts.length > 0) {
      entry.handlers.onConflict?.(result.conflicts, result.actorId);
    }
  }

  private async rejectQueued(
    queued: QueuedTransaction,
    reason: { code: string; message: string },
  ): Promise<void> {
    const timer = this.inflight.get(queued.txId);
    if (timer) {
      clearTimeout(timer);
      this.inflight.delete(queued.txId);
    }
    await this.queue.remove(queued.txId).catch(() => undefined);
    const entry = this.pages.get(queued.pageId);
    const blockId = entry?.deltaTxBlocks.get(queued.txId);
    if (entry && blockId !== undefined) {
      entry.deltaTxBlocks.delete(queued.txId);
      entry.deltaHandlers?.onRejected?.(blockId, reason);
      return; // delta 通道自己處理回滾（重抓整頁），不要再走 tx 的 onRollback
    }
    entry?.handlers.onRollback?.(queued, reason);
  }

  /** 重連後依序重送（txId 不變 → 伺服器冪等） */
  async resendQueued(pageId?: string): Promise<void> {
    if (this.queueReady) await this.queueReady;
    const items = await this.queue.list(pageId).catch(() => [] as QueuedTransaction[]);
    for (const item of items) {
      if (pageId && item.pageId !== pageId) continue;
      if (this.inflight.has(item.txId)) continue;
      await this.trySend(item);
    }
  }

  async pendingCount(pageId?: string): Promise<number> {
    const items = await this.queue.list(pageId).catch(() => [] as QueuedTransaction[]);
    return items.length;
  }

  /* ── 收訊息 ───────────────────────────────────────── */

  /**
   * 把一批遠端 ops 分到兩條通道，**並保持原本的先後順序**。
   *
   * 順序一致性（ADR 0006 §2.6）：同一個 block 上 delta 與 block.update 的相對順序
   * 是伺服器決定的，這裡照著 `result.ops` 的排列依序送出去，宿主不必自己排。
   */
  private dispatchRemoteOps(entry: PageEntry, ops: Operation[], meta: RemoteOpsMeta): void {
    const deltaHandlers = entry.deltaHandlers;
    if (!deltaHandlers) {
      // 沒有 OT 通道（FEATURE_OT 關閉，或這一頁不是用編輯器開的）→ 全部走舊路徑
      entry.handlers.onRemoteOps?.(ops, meta);
      return;
    }
    for (const group of splitDeltaOps(ops)) {
      if (group.kind === 'delta') {
        for (const op of group.ops) deltaHandlers.onRemoteDelta?.(op, meta);
      } else {
        entry.handlers.onRemoteOps?.(group.ops, meta);
      }
    }
  }

  private async handleMessage(msg: ServerMessage): Promise<void> {
    switch (msg.t) {
      case 'authOk': {
        this.attempt = 0;
        this.setState('syncing');
        // 重連後：先補齊他人的變更，再重送自己的佇列（順序很重要）
        for (const pageId of this.pages.keys()) this.subscribe(pageId);
        if (this.pages.size === 0) this.setState('ready');
        return;
      }
      case 'authError': {
        // token 過期：關連線，等 api-client refresh 之後由 backoff 重連
        this.socket?.close(4401, msg.code);
        return;
      }
      case 'synced': {
        const entry = this.pages.get(msg.pageId);
        if (!entry) return;
        entry.synced = true;
        entry.permission = msg.permission;
        entry.handlers.onPermission?.(msg.permission);
        if (entry.localSeq === 0 && msg.seq > 0) {
          // 沒有本地狀態（第一次訂閱）→ 直接對齊伺服器，snapshot 由宿主另外抓
          entry.localSeq = msg.seq;
          entry.handlers.onSeqChange?.(msg.seq);
        }
        this.setState('ready');
        // 重新送出 presence，讓其他人看得到我回來了
        if (entry.presence) {
          this.send({
            t: 'presence',
            pageId: msg.pageId,
            blockId: entry.presence.blockId,
            selection: entry.presence.selection,
          });
        }
        await this.resendQueued(msg.pageId);
        return;
      }
      case 'catchUp': {
        const entry = this.pages.get(msg.pageId);
        if (!entry) return;
        for (const result of [...msg.results].sort((a, b) => a.seq - b.seq)) {
          if (result.seq <= entry.localSeq) continue;
          this.dispatchRemoteOps(entry, result.ops, {
            seq: result.seq,
            txId: result.txId,
            actorId: result.actorId,
            catchUp: true,
          });
          entry.localSeq = result.seq;
        }
        if (msg.toSeq > entry.localSeq) entry.localSeq = msg.toSeq;
        entry.handlers.onSeqChange?.(entry.localSeq);
        this.setState('ready');
        return;
      }
      case 'txApplied': {
        await this.onAck(msg.result);
        return;
      }
      case 'txRejected': {
        for (const entry of this.pages.values()) {
          const blockId = entry.deltaTxBlocks.get(msg.txId);
          if (blockId === undefined) continue;
          entry.deltaTxBlocks.delete(msg.txId);
          entry.deltaHandlers?.onRejected?.(blockId, { code: msg.code, message: msg.message });
        }
        const items = await this.queue.list().catch(() => [] as QueuedTransaction[]);
        const queued = items.find((i) => i.txId === msg.txId);
        if (queued) {
          await this.rejectQueued(queued, { code: msg.code, message: msg.message });
        }
        return;
      }
      case 'txBroadcast': {
        const entry = this.pages.get(msg.result.pageId);
        if (!entry) return;
        // 自己送出的 tx 不會被廣播回來（伺服器用 originSessionId 排除）
        switch (decideSeq(entry.localSeq, msg.result.seq)) {
          case 'duplicate':
            return;
          case 'apply':
            this.dispatchRemoteOps(entry, msg.result.ops, {
              seq: msg.result.seq,
              txId: msg.result.txId,
              actorId: msg.result.actorId,
              catchUp: false,
            });
            entry.localSeq = msg.result.seq;
            entry.handlers.onSeqChange?.(entry.localSeq);
            return;
          case 'gap':
            // 漏收：跟伺服器要 sinceSeq 之後的全部，這一則會包含在 catchUp 裡
            this.subscribe(msg.result.pageId);
            return;
        }
        return;
      }
      case 'presence': {
        this.pages.get(msg.pageId)?.handlers.onPresence?.(msg.peers);
        return;
      }
      case 'resync': {
        const entry = this.pages.get(msg.pageId);
        if (!entry) return;
        entry.localSeq = 0;
        entry.handlers.onResync?.(msg.reason);
        return;
      }
      case 'comment': {
        this.pages.get(msg.pageId)?.handlers.onComment?.(msg);
        return;
      }
      case 'notification': {
        this.opts.onNotification?.(msg);
        return;
      }
      case 'error': {
        if (msg.pageId) this.pages.get(msg.pageId)?.handlers.onResync?.(msg.code);
        return;
      }
      case 'pong':
      default:
        return;
    }
  }

  /**
   * 沒有 WS 時的補傳路徑（例如 FEATURE_REALTIME=false，或 WS 被公司防火牆擋掉）。
   * 宿主可以定期呼叫，行為與 catchUp 相同。
   */
  async pollSince(pageId: string): Promise<void> {
    const entry = this.pages.get(pageId);
    const http = this.opts.http;
    if (!entry || !http) return;
    const data = await http.fetchSince(pageId, entry.localSeq);
    for (const result of data.results) {
      if (result.seq <= entry.localSeq) continue;
      this.dispatchRemoteOps(entry, result.ops, {
        seq: result.seq,
        txId: result.txId,
        actorId: result.actorId,
        catchUp: true,
      });
      entry.localSeq = result.seq;
    }
    entry.handlers.onSeqChange?.(entry.localSeq);
  }
}

export function createSyncClient(options: SyncClientOptions): SyncClient {
  return new SyncClient(options);
}
