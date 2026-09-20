/**
 * 假 WebSocket。`sync-client.ts` 用的是 `new WebSocket(url)`（全域建構子），
 * 所以只要在 demo 模式把 `globalThis.WebSocket` 換掉，整條即時同步路徑
 * （狀態機 / 訂閱 / presence / 心跳 / 離線佇列）都能照常運作。
 *
 * 協定完全照 `packages/shared-types/src/ws.ts`：
 *   client `auth`/`subscribe`/`unsubscribe`/`tx`/`presence`/`ping`
 *   server `authOk`/`synced`/`txApplied`/`txRejected`/`txBroadcast`/`presence`/`pong`/`error`
 *
 * 只有本分頁一個人，所以 presence 永遠是「自己一個」；
 * 連線徽章因此會顯示「已連線」而不是「離線」。
 */
import type { ClientMessage, PeerPresence, ServerMessage, TransactionResult } from '@kennote/shared-types';
import { applyTransaction, setDemoBroadcaster } from './core';
import { db } from './store';
import { DemoApiError } from './util';

const OPEN = 1;
const CLOSED = 3;

/** presence 的固定色（伺服器是依 userId 雜湊，demo 只有一個人） */
const DEMO_PRESENCE_COLOR = '#2383e2';

const sockets = new Set<DemoWebSocket>();

class DemoWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;
  readonly url: string;
  readonly protocol = '';
  readonly extensions = '';
  binaryType: 'blob' | 'arraybuffer' = 'blob';
  bufferedAmount = 0;

  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;

  /** 這條連線訂閱了哪些頁 */
  readonly rooms = new Set<string>();
  sessionId: string;

  constructor(url: string | URL) {
    this.url = String(url);
    const params = new URL(this.url, 'http://demo.local'.replace('http', 'http')).searchParams;
    this.sessionId = params.get('sessionId') ?? 'demo-session';
    sockets.add(this);
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = OPEN;
      this.onopen?.({ type: 'open' });
      // 沒有真的握手：token 在 query 上，直接回 authOk（與伺服器同樣的時機）
      this.emit({ t: 'authOk', userId: db().sessionUserId ?? 'demo-user', sessionId: this.sessionId });
    }, 0);
  }

  private emit(msg: ServerMessage): void {
    if (this.readyState !== OPEN) return;
    // 非同步送出，模擬真實網路（也避免在 send() 裡同步遞迴）
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(msg) }), 0);
  }

  private selfPresence(): PeerPresence[] {
    const user = db().users[db().sessionUserId ?? ''];
    if (!user) return [];
    return [
      {
        sessionId: this.sessionId,
        userId: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
        color: DEMO_PRESENCE_COLOR,
        blockId: null,
        selection: null,
        updatedAt: Date.now(),
      },
    ];
  }

  send(data: string): void {
    if (this.readyState !== OPEN) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data) as ClientMessage;
    } catch {
      return;
    }
    switch (msg.t) {
      case 'auth':
        this.sessionId = msg.sessionId;
        this.emit({ t: 'authOk', userId: db().sessionUserId ?? 'demo-user', sessionId: msg.sessionId });
        return;
      case 'subscribe': {
        this.rooms.add(msg.pageId);
        const page = db().pages[msg.pageId];
        if (!page || page.deletedAt) {
          this.emit({ t: 'error', code: 'PAGE_NOT_FOUND', message: '頁面不存在', pageId: msg.pageId });
          return;
        }
        this.emit({ t: 'synced', pageId: msg.pageId, seq: page.seq, permission: 'full' });
        this.emit({ t: 'presence', pageId: msg.pageId, peers: this.selfPresence() });
        return;
      }
      case 'unsubscribe':
        this.rooms.delete(msg.pageId);
        return;
      case 'tx': {
        try {
          const result = applyTransaction(msg.tx.pageId, msg.tx);
          this.emit({ t: 'txApplied', result });
        } catch (error) {
          const code = error instanceof DemoApiError ? error.code : 'INTERNAL_ERROR';
          const message = error instanceof Error ? error.message : '套用失敗';
          this.emit({ t: 'txRejected', txId: msg.tx.txId, code, message });
        }
        return;
      }
      case 'presence':
        this.emit({ t: 'presence', pageId: msg.pageId, peers: this.selfPresence() });
        return;
      case 'ping':
        this.emit({ t: 'pong' });
        return;
      default:
        return;
    }
  }

  close(_code?: number, _reason?: string): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    sockets.delete(this);
    setTimeout(() => this.onclose?.({ type: 'close', code: _code ?? 1000, reason: _reason ?? '' }), 0);
  }

  addEventListener(type: string, listener: (ev: unknown) => void): void {
    // sync-client 只用 on* 屬性；這裡補一個最小實作以防其他呼叫端
    if (type === 'open') this.onopen = listener;
    if (type === 'message') this.onmessage = listener as (ev: { data: unknown }) => void;
    if (type === 'close') this.onclose = listener;
    if (type === 'error') this.onerror = listener;
  }

  removeEventListener(): void {
    /* no-op */
  }

  dispatchEvent(): boolean {
    return true;
  }
}

/** REST 送出的 transaction 也要廣播給（其他 session 的）WS 訂閱者 */
function broadcast(result: TransactionResult, originSessionId: string): void {
  for (const socket of sockets) {
    if (socket.sessionId === originSessionId) continue;
    if (!socket.rooms.has(result.pageId)) continue;
    if (socket.readyState !== OPEN) continue;
    setTimeout(() => socket.onmessage?.({ data: JSON.stringify({ t: 'txBroadcast', result }) }), 0);
  }
}

let installed = false;

export function installDemoWebSocket(): void {
  if (installed) return;
  installed = true;
  setDemoBroadcaster(broadcast);
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = DemoWebSocket;
}

export { DemoWebSocket };
