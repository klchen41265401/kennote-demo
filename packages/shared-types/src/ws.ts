/**
 * WebSocket 訊息協定（04 §6.3）。**完全自訂、前後端共用**：
 * DevTools 的 WS 分頁可以一眼看懂每一則訊息，這是自研最直接的回報。
 *
 * 命名對照（04 §8 M5 的交付清單用了比較口語的名字）：
 *   ack / txResult → `txApplied`（自己的 tx 成功）
 *   remoteTx       → `txBroadcast`（他人的 tx）
 *   cursor         → `presence`（游標/選取範圍是 presence 的欄位，不另開訊息）
 *   error          → `error`（非致命錯誤；認證失敗仍用 `authError`，因為會接著關連線）
 */
import type { Notification } from './notifications.js';
import type { Transaction, TransactionResult } from './operation.js';
import type { Comment, Discussion } from './comments.js';

/** 一個協作者在某一頁的即時狀態。**永遠不進 PostgreSQL**（03 §8.2） */
export interface PeerPresence {
  sessionId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** 伺服器指派（由 userId 雜湊），同一個人在所有客戶端顏色一致 */
  color: string;
  blockId: string | null;
  selection: [number, number] | null;
  updatedAt: number;
}

/** 留言的即時事件（02 §3.6：comment:created / comment:resolved） */
export type CommentEventKind = 'created' | 'updated' | 'resolved' | 'reopened' | 'deleted';

export type ClientMessage =
  | { t: 'auth'; token: string; sessionId: string }
  | { t: 'subscribe'; pageId: string; sinceSeq?: number }
  | { t: 'unsubscribe'; pageId: string }
  | { t: 'tx'; tx: Transaction }
  | {
      t: 'presence';
      pageId: string;
      blockId: string | null;
      selection: [number, number] | null;
    }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'authOk'; userId: string; sessionId: string }
  | { t: 'authError'; code: string }
  | { t: 'synced'; pageId: string; seq: number; permission: PagePermission }
  | { t: 'txApplied'; result: TransactionResult }
  | { t: 'txRejected'; txId: string; code: string; message: string }
  | { t: 'txBroadcast'; result: TransactionResult }
  | { t: 'catchUp'; pageId: string; results: TransactionResult[]; toSeq: number }
  | { t: 'presence'; pageId: string; peers: PeerPresence[] }
  | { t: 'resync'; pageId: string; reason: string }
  | { t: 'notification'; notification: Notification; unread: number }
  | {
      t: 'comment';
      pageId: string;
      event: CommentEventKind;
      discussion: Discussion;
      comment?: Comment;
    }
  | { t: 'error'; code: string; message: string; pageId?: string }
  | { t: 'pong' };

export type ClientMessageType = ClientMessage['t'];
export type ServerMessageType = ServerMessage['t'];

/** 由弱到強，可以直接比大小（PAGE_PERMISSION_RANK） */
export type PagePermission = 'none' | 'read' | 'comment' | 'edit' | 'full';

export const PAGE_PERMISSION_RANK: Record<PagePermission, number> = {
  none: 0,
  read: 1,
  comment: 2,
  edit: 3,
  full: 4,
};

export function permissionAtLeast(have: PagePermission, need: PagePermission): boolean {
  return PAGE_PERMISSION_RANK[have] >= PAGE_PERMISSION_RANK[need];
}

/** 前端連線狀態機（04 §6.5）。SYNCING 期間 UI 顯示「同步中」 */
export type SyncConnectionState =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'syncing'
  | 'ready'
  | 'reconnecting'
  | 'offline';

/* ── 協定常數（前後端都引用同一份，不要各寫各的） ───────── */

/** client 每 25s 送 ping（必須短於 Nginx/Cloudflare 的 60s 閒置逾時） */
export const WS_CLIENT_PING_INTERVAL_MS = 25_000;
/** server 每 30s 掃一次死連線 */
export const WS_SERVER_HEARTBEAT_MS = 30_000;
/** 超過這個時間沒有任何訊息/pong → 視為死連線 */
export const WS_DEAD_CONNECTION_MS = 60_000;
/** 落後超過這個量就不補傳，直接叫 client 重抓 snapshot */
export const WS_MAX_CATCHUP = 500;
/** 房間空了之後延遲銷毀，避免切頁抖動 */
export const WS_ROOM_LINGER_MS = 30_000;
/** presence 超過這個時間沒更新就當作離開（跨實例合併時用） */
export const PRESENCE_TTL_MS = 45_000;

/** 協作者色票（伺服器依 userId 雜湊指派，客戶端只負責畫） */
export const PRESENCE_COLORS = [
  '#e0554a',
  '#e08a20',
  '#cfa60d',
  '#37a169',
  '#1f9aa8',
  '#3b82c4',
  '#7a5cd6',
  '#c0459a',
] as const;

export function presenceColorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length]!;
}
