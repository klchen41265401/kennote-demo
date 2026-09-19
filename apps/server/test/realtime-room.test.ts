/**
 * room-manager 的行為測試。完全不需要資料庫與 WebSocket：
 * 連線只是「有 send() 的物件」，這正是把 room-manager 與傳輸層分開的回報。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage, TransactionResult } from '@kennote/shared-types';
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
