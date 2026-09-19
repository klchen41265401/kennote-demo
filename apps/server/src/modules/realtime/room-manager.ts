/**
 * 自研 room manager（04 §6.2）。**刻意不認識 fastify / ws / 資料庫**：
 * 連線只是一個有 send() 的物件，因此可以用假連線完整單元測試
 * （apps/server/test/realtime-room.test.ts）。
 *
 *   Connection（一個 WS 連線）
 *     ├── userId / sessionId / subscribedPages: Set<pageId> / lastSeenAt
 *   PageRoom（pageId）
 *     ├── connections: Set<Connection>
 *     └── presence: Map<sessionId, PeerPresence>   ← 本機 + 跨實例合併後的結果
 *
 * 紀律：
 *   - 一個 WS 連線可訂閱多頁（瀏覽器每網域約 6 條連線上限，不要一頁一條）
 *   - 房間最後一人離開後**延遲 30 秒**銷毀（避免切頁抖動）
 *   - presence 永遠只在記憶體，絕不進 PostgreSQL（03 §8.2）
 */
import type { Notification, PeerPresence, ServerMessage } from '@kennote/shared-types';
import { PRESENCE_TTL_MS, WS_ROOM_LINGER_MS, presenceColorFor } from '@kennote/shared-types';
import type { BroadcastAdapter, BroadcastEnvelope } from './broadcast.js';
import { pageChannel, userChannel } from './broadcast.js';

export interface RealtimeConnection {
  readonly sessionId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** 已訂閱的頁面 */
  readonly subscribedPages: Set<string>;
  lastSeenAt: number;
  send(msg: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

interface PageRoom {
  pageId: string;
  connections: Set<RealtimeConnection>;
  presence: Map<string, PeerPresence>;
  unsubscribe: (() => void) | null;
  lingerTimer: ReturnType<typeof setTimeout> | null;
}

interface UserChannel {
  connections: Set<RealtimeConnection>;
  unsubscribe: (() => void) | null;
}

export class RoomManager {
  private readonly rooms = new Map<string, PageRoom>();
  private readonly users = new Map<string, UserChannel>();

  constructor(
    private readonly adapter: BroadcastAdapter,
    private readonly lingerMs: number = WS_ROOM_LINGER_MS,
  ) {}

  /* ── 房間生命週期 ─────────────────────────────────── */

  private async ensureRoom(pageId: string): Promise<PageRoom> {
    let room = this.rooms.get(pageId);
    if (room) {
      if (room.lingerTimer) {
        clearTimeout(room.lingerTimer);
        room.lingerTimer = null;
      }
      return room;
    }
    room = {
      pageId,
      connections: new Set(),
      presence: new Map(),
      unsubscribe: null,
      lingerTimer: null,
    };
    this.rooms.set(pageId, room);
    room.unsubscribe = await this.adapter.subscribe(pageChannel(pageId), (envelope) =>
      this.onRoomMessage(pageId, envelope),
    );
    return room;
  }

  private scheduleDispose(room: PageRoom): void {
    if (room.connections.size > 0 || room.lingerTimer) return;
    const timer = setTimeout(() => {
      const current = this.rooms.get(room.pageId);
      if (!current || current.connections.size > 0) return;
      current.unsubscribe?.();
      this.rooms.delete(room.pageId);
    }, this.lingerMs);
    timer.unref?.();
    room.lingerTimer = timer;
  }

  /* ── 訂閱 / 退訂 ──────────────────────────────────── */

  async subscribe(conn: RealtimeConnection, pageId: string): Promise<void> {
    const room = await this.ensureRoom(pageId);
    room.connections.add(conn);
    conn.subscribedPages.add(pageId);
    // 新加入的人先收到目前的 presence 名單
    conn.send({ t: 'presence', pageId, peers: this.peers(pageId) });
  }

  async unsubscribe(conn: RealtimeConnection, pageId: string): Promise<void> {
    const room = this.rooms.get(pageId);
    conn.subscribedPages.delete(pageId);
    if (!room) return;
    room.connections.delete(conn);
    if (room.presence.delete(conn.sessionId)) {
      await this.adapter.publish(pageChannel(pageId), {
        msg: { t: 'presence', pageId, peers: [] },
        leave: { pageId, sessionId: conn.sessionId },
      });
      this.deliver(room, { t: 'presence', pageId, peers: this.peers(pageId) }, null);
    }
    this.scheduleDispose(room);
  }

  /** 連線關閉：退出所有房間 + 解除 user channel */
  async removeConnection(conn: RealtimeConnection): Promise<void> {
    for (const pageId of [...conn.subscribedPages]) {
      await this.unsubscribe(conn, pageId);
    }
    const entry = this.users.get(conn.userId);
    if (entry) {
      entry.connections.delete(conn);
      if (entry.connections.size === 0) {
        entry.unsubscribe?.();
        this.users.delete(conn.userId);
      }
    }
  }

  /* ── presence ─────────────────────────────────────── */

  async updatePresence(
    conn: RealtimeConnection,
    pageId: string,
    blockId: string | null,
    selection: [number, number] | null,
  ): Promise<void> {
    const room = this.rooms.get(pageId);
    if (!room || !room.connections.has(conn)) return;
    const peer: PeerPresence = {
      sessionId: conn.sessionId,
      userId: conn.userId,
      name: conn.name,
      avatarUrl: conn.avatarUrl,
      color: presenceColorFor(conn.userId),
      blockId,
      selection,
      updatedAt: Date.now(),
    };
    room.presence.set(conn.sessionId, peer);
    // 只廣播「我自己」這一筆，其他實例把它併進自己的表
    await this.adapter.publish(pageChannel(pageId), {
      msg: { t: 'presence', pageId, peers: [peer] },
    });
    this.deliver(room, { t: 'presence', pageId, peers: this.peers(pageId) }, null);
  }

  /** 目前線上名單（過濾掉超過 TTL 沒更新的跨實例殘留） */
  peers(pageId: string): PeerPresence[] {
    const room = this.rooms.get(pageId);
    if (!room) return [];
    const now = Date.now();
    const alive: PeerPresence[] = [];
    for (const [sessionId, peer] of room.presence) {
      if (now - peer.updatedAt > PRESENCE_TTL_MS && !this.hasLocalSession(room, sessionId)) {
        room.presence.delete(sessionId);
        continue;
      }
      alive.push(peer);
    }
    return alive.sort((a, b) => a.updatedAt - b.updatedAt);
  }

  private hasLocalSession(room: PageRoom, sessionId: string): boolean {
    for (const conn of room.connections) if (conn.sessionId === sessionId) return true;
    return false;
  }

  /* ── 廣播 ─────────────────────────────────────────── */

  /** 收到（本機或跨實例）房間訊息 → 分派給本機連線 */
  private onRoomMessage(pageId: string, envelope: BroadcastEnvelope): void {
    const room = this.rooms.get(pageId);
    if (!room) return;

    if (envelope.leave) {
      room.presence.delete(envelope.leave.sessionId);
      this.deliver(room, { t: 'presence', pageId, peers: this.peers(pageId) }, null);
      return;
    }

    if (envelope.msg.t === 'presence') {
      let changed = false;
      for (const peer of envelope.msg.peers) {
        const known = room.presence.get(peer.sessionId);
        if (!known || known.updatedAt <= peer.updatedAt) {
          room.presence.set(peer.sessionId, peer);
          changed = true;
        }
      }
      if (!changed) return;
      this.deliver(room, { t: 'presence', pageId, peers: this.peers(pageId) }, null);
      return;
    }

    this.deliver(room, envelope.msg, envelope.excludeSessionId ?? null);
  }

  private deliver(room: PageRoom, msg: ServerMessage, excludeSessionId: string | null): void {
    for (const conn of room.connections) {
      if (excludeSessionId && conn.sessionId === excludeSessionId) continue;
      try {
        conn.send(msg);
      } catch {
        // 單一連線寫入失敗不該讓整個廣播中斷
      }
    }
  }

  /** applyTransaction 的 broadcaster 掛勾（commit 之後才會呼叫） */
  async publishTransaction(
    result: { pageId: string },
    msg: ServerMessage,
    originSessionId: string | null,
  ): Promise<void> {
    await this.adapter.publish(pageChannel(result.pageId), {
      msg,
      excludeSessionId: originSessionId,
    });
  }

  async publishToPage(
    pageId: string,
    msg: ServerMessage,
    excludeSessionId: string | null = null,
  ): Promise<void> {
    await this.adapter.publish(pageChannel(pageId), { msg, excludeSessionId });
  }

  /* ── 通知（user channel） ──────────────────────────── */

  async attachUser(conn: RealtimeConnection): Promise<void> {
    let entry = this.users.get(conn.userId);
    if (!entry) {
      entry = { connections: new Set(), unsubscribe: null };
      this.users.set(conn.userId, entry);
      entry.unsubscribe = await this.adapter.subscribe(userChannel(conn.userId), (envelope) => {
        const current = this.users.get(conn.userId);
        if (!current) return;
        for (const c of current.connections) {
          if (envelope.excludeSessionId && c.sessionId === envelope.excludeSessionId) continue;
          try {
            c.send(envelope.msg);
          } catch {
            /* 忽略單一連線的寫入錯誤 */
          }
        }
      });
    }
    entry.connections.add(conn);
  }

  async publishNotification(
    userId: string,
    notification: Notification,
    unread: number,
  ): Promise<void> {
    await this.adapter.publish(userChannel(userId), {
      msg: { t: 'notification', notification, unread },
    });
  }

  /* ── 觀測 / 測試 ──────────────────────────────────── */

  roomCount(): number {
    return this.rooms.size;
  }

  connectionCount(pageId: string): number {
    return this.rooms.get(pageId)?.connections.size ?? 0;
  }

  stats(): { rooms: number; connections: number; users: number } {
    let connections = 0;
    for (const room of this.rooms.values()) connections += room.connections.size;
    return { rooms: this.rooms.size, connections, users: this.users.size };
  }

  /** 測試 / 關機用：清掉所有 timer 與訂閱 */
  async dispose(): Promise<void> {
    for (const room of this.rooms.values()) {
      if (room.lingerTimer) clearTimeout(room.lingerTimer);
      room.unsubscribe?.();
    }
    this.rooms.clear();
    for (const entry of this.users.values()) entry.unsubscribe?.();
    this.users.clear();
  }
}

let manager: RoomManager | null = null;

export function getRoomManager(adapter?: BroadcastAdapter): RoomManager {
  if (!manager) {
    if (!adapter) throw new Error('RoomManager 尚未初始化');
    manager = new RoomManager(adapter);
  }
  return manager;
}

export function setRoomManager(next: RoomManager | null): void {
  manager = next;
}
