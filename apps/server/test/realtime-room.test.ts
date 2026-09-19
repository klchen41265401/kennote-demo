/**
 * room-manager 的行為測試。完全不需要資料庫與 WebSocket：
 * 連線只是「有 send() 的物件」，這正是把 room-manager 與傳輸層分開的回報。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PagePermission, ServerMessage, TransactionResult } from '@kennote/shared-types';
import { InMemoryBroadcast } from '../src/modules/realtime/broadcast.js';
import { RoomManager, type RealtimeConnection } from '../src/modules/realtime/room-manager.js';

interface FakeConnection extends RealtimeConnection {
  sent: ServerMessage[];
}

function makeConn(sessionId: string, userId = `user-${sessionId}`): FakeConnection {
  const sent: ServerMessage[] = [];
  return {
    sessionId,
    userId,
    name: `使用者 ${sessionId}`,
    avatarUrl: null,
    subscribedPages: new Set<string>(),
    lastSeenAt: Date.now(),
    sent,
    send(msg) {
      sent.push(msg);
    },
    close() {},
  };
}

const PAGE = 'page-1';

function txResult(seq: number): TransactionResult {
  return {
    txId: `tx-${seq}`,
    pageId: PAGE,
    seq,
    ops: [],
    appliedAt: new Date().toISOString(),
    actorId: 'user-a',
  };
}

describe('RoomManager', () => {
  let adapter: InMemoryBroadcast;
  let rooms: RoomManager;

  beforeEach(() => {
    adapter = new InMemoryBroadcast();
    rooms = new RoomManager(adapter, 20);
  });

  it('廣播 txBroadcast 給房間內所有人，但排除提交者自己的 session', async () => {
    const a = makeConn('sess-a');
    const b = makeConn('sess-b');
    const c = makeConn('sess-c');
    await rooms.subscribe(a, PAGE);
    await rooms.subscribe(b, PAGE);
    await rooms.subscribe(c, PAGE);

    await rooms.publishToPage(PAGE, { t: 'txBroadcast', result: txResult(42) }, 'sess-a');

    const broadcasts = (conn: FakeConnection) => conn.sent.filter((m) => m.t === 'txBroadcast');
    expect(broadcasts(a)).toHaveLength(0);
    expect(broadcasts(b)).toHaveLength(1);
    expect(broadcasts(c)).toHaveLength(1);
    expect((broadcasts(b)[0] as { result: TransactionResult }).result.seq).toBe(42);
  });

  it('沒訂閱這一頁的連線收不到廣播', async () => {
    const a = makeConn('sess-a');
    const other = makeConn('sess-other');
    await rooms.subscribe(a, PAGE);
    await rooms.subscribe(other, 'page-2');

    await rooms.publishToPage(PAGE, { t: 'txBroadcast', result: txResult(1) }, null);

    expect(a.sent.some((m) => m.t === 'txBroadcast')).toBe(true);
    expect(other.sent.some((m) => m.t === 'txBroadcast')).toBe(false);
  });

  it('presence 更新會把完整名單推給房間內所有人（含自己）', async () => {
    const a = makeConn('sess-a', 'user-1');
    const b = makeConn('sess-b', 'user-2');
    await rooms.subscribe(a, PAGE);
    await rooms.subscribe(b, PAGE);

    await rooms.updatePresence(a, PAGE, 'block-1', [0, 3]);
    await rooms.updatePresence(b, PAGE, 'block-2', null);

    const last = (conn: FakeConnection) =>
      [...conn.sent].reverse().find((m) => m.t === 'presence') as {
        peers: Array<{ sessionId: string; blockId: string | null; color: string }>;
      };

    expect(last(a).peers.map((p) => p.sessionId).sort()).toEqual(['sess-a', 'sess-b']);
    expect(last(b).peers.find((p) => p.sessionId === 'sess-a')?.blockId).toBe('block-1');
    // 顏色由伺服器依 userId 指派，同一個人到處一致
    expect(last(b).peers.find((p) => p.sessionId === 'sess-a')?.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('退訂後會從 presence 名單消失', async () => {
    const a = makeConn('sess-a');
    const b = makeConn('sess-b');
    await rooms.subscribe(a, PAGE);
    await rooms.subscribe(b, PAGE);
    await rooms.updatePresence(a, PAGE, 'block-1', null);
    await rooms.updatePresence(b, PAGE, 'block-2', null);
    expect(rooms.peers(PAGE)).toHaveLength(2);

    await rooms.unsubscribe(a, PAGE);

    expect(rooms.peers(PAGE).map((p) => p.sessionId)).toEqual(['sess-b']);
    expect(rooms.connectionCount(PAGE)).toBe(1);
  });

  it('房間空了要延遲銷毀（避免切頁抖動），逾時後才釋放訂閱', async () => {
    vi.useFakeTimers();
    try {
      const short = new RoomManager(adapter, 30_000);
      const a = makeConn('sess-a');
      await short.subscribe(a, PAGE);
      expect(short.roomCount()).toBe(1);

      await short.unsubscribe(a, PAGE);
      // 立刻銷毀會讓「切走再切回」重新建房，所以先不銷毀
      expect(short.roomCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(30_001);
      expect(short.roomCount()).toBe(0);
      expect(adapter.channelCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('連線關閉會退出所有房間', async () => {
    const a = makeConn('sess-a');
    await rooms.subscribe(a, 'page-1');
    await rooms.subscribe(a, 'page-2');
    await rooms.attachUser(a);
    expect(rooms.stats()).toMatchObject({ rooms: 2, connections: 2, users: 1 });

    await rooms.removeConnection(a);

    expect(rooms.stats()).toMatchObject({ connections: 0, users: 0 });
  });

  it('通知走 user channel：同一使用者的所有連線都收得到', async () => {
    const tab1 = makeConn('sess-1', 'user-x');
    const tab2 = makeConn('sess-2', 'user-x');
    const other = makeConn('sess-3', 'user-y');
    await rooms.attachUser(tab1);
    await rooms.attachUser(tab2);
    await rooms.attachUser(other);

    await rooms.publishNotification(
      'user-x',
      {
        id: 'n1',
        workspaceId: 'w',
        recipientId: 'user-x',
        actorId: 'user-y',
        type: 'mention',
        pageId: null,
        blockId: null,
        discussionId: null,
        commentId: null,
        payload: {},
        groupKey: null,
        readAt: null,
        archivedAt: null,
        createdAt: new Date().toISOString(),
      },
      3,
    );

    expect(tab1.sent.filter((m) => m.t === 'notification')).toHaveLength(1);
    expect(tab2.sent.filter((m) => m.t === 'notification')).toHaveLength(1);
    expect(other.sent.filter((m) => m.t === 'notification')).toHaveLength(0);
  });

  it('跨實例：另一個實例送來的 presence 會被併進名單', async () => {
    const a = makeConn('sess-a');
    await rooms.subscribe(a, PAGE);

    // 模擬 Redis 送來的另一個實例的 peer
    await adapter.publish(`page:${PAGE}`, {
      msg: {
        t: 'presence',
        pageId: PAGE,
        peers: [
          {
            sessionId: 'remote-sess',
            userId: 'user-remote',
            name: '遠端使用者',
            avatarUrl: null,
            color: '#123456',
            blockId: 'block-9',
            selection: null,
            updatedAt: Date.now(),
          },
        ],
      },
    });

    expect(rooms.peers(PAGE).map((p) => p.sessionId)).toContain('remote-sess');
  });
});

/*
 * 第七輪 §4-4 / 第八輪 §4-3 連兩輪掛著的洞：
 * **REST 的權限檢查管不到已經連上的 WebSocket。**
 * 房間只認「subscribe 當下算過的那一次」，撤權之後那條連線照樣收 txBroadcast。
 * 這一組釘住第九輪補上的重檢查路徑（resolver 由 realtime/index.ts 注入，
 * 這裡用假的就能完整測 —— 正是把 room-manager 與資料庫分開的回報）。
 */
describe('RoomManager：權限被撤銷時把人踢出房間', () => {
  let adapter: InMemoryBroadcast;
  let rooms: RoomManager;

  beforeEach(() => {
    adapter = new InMemoryBroadcast();
    rooms = new RoomManager(adapter, 20);
  });

  /** userId → 這個人現在的權限（測試中途改它就等於「權限被改了」） */
  function resolverOf(table: Record<string, PagePermission | null>): void {
    rooms.setPermissionResolver(async (userId) => {
      const permission = table[userId];
      if (permission === null) return null; // 頁面不見了
      return { permission: permission ?? 'none', seq: 77 };
    });
  }

  it('撤權（none）→ 送 error FORBIDDEN 並退出房間，之後收不到廣播', async () => {
    const owner = makeConn('sess-owner', 'user-owner');
    const guest = makeConn('sess-guest', 'user-guest');
    const table: Record<string, PagePermission> = { 'user-owner': 'full', 'user-guest': 'edit' };
    resolverOf(table);
    await rooms.attachUser(owner);
    await rooms.attachUser(guest);
    await rooms.subscribe(owner, PAGE);
    await rooms.subscribe(guest, PAGE);
    expect(rooms.connectionCount(PAGE)).toBe(2);

    table['user-guest'] = 'none';
    await rooms.publishPermissionChanged({ userId: 'user-guest', pageId: null });
    await rooms.settlePermissionChecks();

    const err = guest.sent.find((m) => m.t === 'error');
    expect(err).toBeDefined();
    expect((err as { code: string }).code).toBe('FORBIDDEN');
    expect((err as { pageId?: string }).pageId).toBe(PAGE);
    expect(guest.subscribedPages.has(PAGE)).toBe(false);
    expect(rooms.connectionCount(PAGE)).toBe(1);

    // 真正的重點：踢出去之後就再也收不到內容
    guest.sent.length = 0;
    await rooms.publishToPage(PAGE, { t: 'txBroadcast', result: txResult(9) }, null);
    expect(guest.sent.some((m) => m.t === 'txBroadcast')).toBe(false);

    // 沒被改到的人不受影響
    expect(owner.sent.some((m) => m.t === 'error')).toBe(false);
    expect(owner.subscribedPages.has(PAGE)).toBe(true);
  });

  it('降級成 read → 不踢人，重送 synced{permission} 讓前端切唯讀', async () => {
    const conn = makeConn('sess-b', 'user-b');
    const table: Record<string, PagePermission> = { 'user-b': 'edit' };
    resolverOf(table);
    await rooms.attachUser(conn);
    await rooms.subscribe(conn, PAGE);

    table['user-b'] = 'read';
    await rooms.publishPermissionChanged({ userId: 'user-b', pageId: null });
    await rooms.settlePermissionChecks();

    const synced = conn.sent.filter((m) => m.t === 'synced');
    expect(synced).toHaveLength(1);
    expect(synced[0]).toMatchObject({ pageId: PAGE, seq: 77, permission: 'read' });
    expect(conn.sent.some((m) => m.t === 'error')).toBe(false);
    expect(rooms.connectionCount(PAGE)).toBe(1);
  });

  it('user channel 事件不帶 pageId → 該連線**所有**訂閱中的頁面都重算（權限是繼承的）', async () => {
    const conn = makeConn('sess-c', 'user-c');
    rooms.setPermissionResolver(async (_userId, pageId) =>
      pageId === PAGE ? { permission: 'none', seq: 0 } : { permission: 'edit', seq: 5 },
    );
    await rooms.attachUser(conn);
    await rooms.subscribe(conn, PAGE);
    await rooms.subscribe(conn, 'page-2');

    await rooms.publishPermissionChanged({ userId: 'user-c', pageId: null });
    await rooms.settlePermissionChecks();

    expect(conn.subscribedPages.has(PAGE)).toBe(false);
    expect(conn.subscribedPages.has('page-2')).toBe(true);
  });

  it('房間層事件（workspace 授權 / 關閉公開分享）→ 房間裡每個人都重算', async () => {
    const a = makeConn('sess-a', 'user-a');
    const b = makeConn('sess-b', 'user-b');
    rooms.setPermissionResolver(async (userId) =>
      userId === 'user-a' ? { permission: 'full', seq: 3 } : { permission: 'none', seq: 0 },
    );
    await rooms.subscribe(a, PAGE);
    await rooms.subscribe(b, PAGE);

    await rooms.publishPermissionChanged({ pageId: PAGE });
    await rooms.settlePermissionChecks();

    expect(rooms.connectionCount(PAGE)).toBe(1);
    expect(a.subscribedPages.has(PAGE)).toBe(true);
    expect(b.subscribedPages.has(PAGE)).toBe(false);
  });

  it('頁面已被刪除（resolver 回 null）→ 當作撤權處理', async () => {
    const conn = makeConn('sess-d', 'user-d');
    resolverOf({ 'user-d': null });
    await rooms.attachUser(conn);
    await rooms.subscribe(conn, PAGE);

    await rooms.publishPermissionChanged({ userId: 'user-d', pageId: PAGE });
    await rooms.settlePermissionChecks();

    expect(conn.sent.some((m) => m.t === 'error')).toBe(true);
    expect(rooms.connectionCount(PAGE)).toBe(0);
  });

  it('resolver 拋例外時不踢人（一次資料庫抖動不該讓所有協作者掉線）', async () => {
    const conn = makeConn('sess-e', 'user-e');
    rooms.setPermissionResolver(async () => {
      throw new Error('db down');
    });
    await rooms.attachUser(conn);
    await rooms.subscribe(conn, PAGE);

    await rooms.publishPermissionChanged({ userId: 'user-e', pageId: PAGE });
    await rooms.settlePermissionChecks();

    expect(conn.sent.some((m) => m.t === 'error')).toBe(false);
    expect(rooms.connectionCount(PAGE)).toBe(1);
  });

  it('沒有注入 resolver 時完全不動作（預設 no-op，CLI / 測試環境照樣跑）', async () => {
    const conn = makeConn('sess-f', 'user-f');
    await rooms.attachUser(conn);
    await rooms.subscribe(conn, PAGE);
    conn.sent.length = 0;

    await rooms.publishPermissionChanged({ userId: 'user-f', pageId: PAGE });
    await rooms.settlePermissionChecks();

    expect(conn.sent).toHaveLength(0);
    expect(rooms.connectionCount(PAGE)).toBe(1);
  });
});
