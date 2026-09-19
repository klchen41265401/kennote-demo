/**
 * sync-client 的狀態機、補傳、離線佇列行為。
 * 用假 WebSocket + 記憶體佇列，在 Node 就能跑完整條路徑（不需要瀏覽器與伺服器）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, Operation, ServerMessage, TransactionResult } from '@kennote/shared-types';
import { MemoryQueue } from './offline-queue';
import {
  backoffDelay,
  createSyncClient,
  decideSeq,
  RECONNECT_DELAYS_MS,
  type SyncClient,
  type SyncState,
  type WebSocketLike,
} from './sync-client';

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  readonly sent: ClientMessage[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  static last(): FakeSocket {
    const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
    if (!socket) throw new Error('還沒有建立任何連線');
    return socket;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  /** 測試用：伺服器接受連線 */
  accept(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** 測試用：伺服器送一則訊息下來 */
  emit(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  messagesOfType<T extends ClientMessage['t']>(t: T): Array<Extract<ClientMessage, { t: T }>> {
    return this.sent.filter((m) => m.t === t) as Array<Extract<ClientMessage, { t: T }>>;
  }
}

const PAGE = '11111111-1111-7111-8111-111111111111';

function txResult(seq: number, ops: Operation[] = [], extra: Partial<TransactionResult> = {}): TransactionResult {
  return {
    txId: `tx-${seq}`,
    pageId: PAGE,
    seq,
    ops,
    appliedAt: new Date().toISOString(),
    actorId: 'someone-else',
    ...extra,
  };
}

const op = (blockId: string): Operation => ({
  type: 'block.update',
  blockId,
  patch: { content: [{ text: blockId }] },
});

interface Harness {
  client: SyncClient;
  queue: MemoryQueue;
  states: SyncState[];
  remote: Array<{ ops: Operation[]; seq: number; catchUp: boolean }>;
  resyncs: string[];
  rollbacks: Array<{ txId: string; code: string }>;
  conflicts: string[][];
  httpSubmit: ReturnType<typeof vi.fn>;
}

function setup(options: { online?: boolean } = {}): Harness {
  const queue = new MemoryQueue();
  const states: SyncState[] = [];
  const remote: Harness['remote'] = [];
  const resyncs: string[] = [];
  const rollbacks: Harness['rollbacks'] = [];
  const conflicts: string[][] = [];
  const httpSubmit = vi.fn(async (_pageId: string, tx: { txId: string }) =>
    txResult(99, [], { txId: tx.txId, actorId: 'me' }),
  );

  const client = createSyncClient({
    getToken: () => 'fake-token',
    sessionId: 'my-session',
    url: 'ws://test/ws',
    socketFactory: (url) => new FakeSocket(url),
    queue,
    debounceMs: 300,
    ackTimeoutMs: 10_000,
    isOnline: () => options.online ?? true,
    random: () => 0.5,
    onStateChange: (s) => states.push(s),
    http: {
      submit: httpSubmit as never,
      fetchSince: async () => ({ pageId: PAGE, seq: 0, results: [] }),
    },
  });

  client.start();
  client.attachPage(
    PAGE,
    {
      onRemoteOps: (ops, meta) => remote.push({ ops, seq: meta.seq, catchUp: meta.catchUp }),
      onResync: (reason) => resyncs.push(reason),
      onRollback: (tx, reason) => rollbacks.push({ txId: tx.txId, code: reason.code }),
      onConflict: (blockIds) => conflicts.push(blockIds),
    },
    0,
  );

  return { client, queue, states, remote, resyncs, rollbacks, conflicts, httpSubmit };
}

/** 走完 connecting → authenticating → syncing → ready */
function handshake(seq = 10): FakeSocket {
  const socket = FakeSocket.last();
  socket.accept();
  socket.emit({ t: 'authOk', userId: 'me', sessionId: 'my-session' });
  socket.emit({ t: 'synced', pageId: PAGE, seq, permission: 'edit' });
  return socket;
}

beforeEach(() => {
  FakeSocket.instances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('純函式', () => {
  it('decideSeq 的三分支（04 §6.4）', () => {
    expect(decideSeq(41, 42)).toBe('apply');
    expect(decideSeq(41, 41)).toBe('duplicate');
    expect(decideSeq(41, 40)).toBe('duplicate');
    expect(decideSeq(41, 44)).toBe('gap');
  });

  it('backoff 是 1,2,4,8,16,30 秒，且帶 ±20% jitter', () => {
    expect(backoffDelay(0, () => 0.5)).toBe(1000);
    expect(backoffDelay(3, () => 0.5)).toBe(8000);
    // 超過表格長度就維持 30 秒
    expect(backoffDelay(99, () => 0.5)).toBe(30000);
    expect(backoffDelay(0, () => 0)).toBe(800);
    expect(backoffDelay(0, () => 1)).toBe(1200);
    for (let attempt = 0; attempt < RECONNECT_DELAYS_MS.length; attempt += 1) {
      const base = RECONNECT_DELAYS_MS[attempt]!;
      expect(backoffDelay(attempt, () => Math.random())).toBeGreaterThanOrEqual(base * 0.8);
      expect(backoffDelay(attempt, () => Math.random())).toBeLessThanOrEqual(base * 1.2);
    }
  });
});

describe('連線狀態機', () => {
  it('握手後進 ready，並帶著 sinceSeq 訂閱頁面', () => {
    const h = setup();
    const socket = handshake(10);

    expect(h.states).toEqual(['connecting', 'authenticating', 'syncing', 'ready']);
    expect(socket.messagesOfType('subscribe')).toEqual([
      { t: 'subscribe', pageId: PAGE, sinceSeq: 0 },
    ]);
    expect(h.client.getLocalSeq(PAGE)).toBe(10);
    expect(h.client.getPermission(PAGE)).toBe('edit');
  });

  it('連線中斷後進 reconnecting，並在 backoff 之後重連', async () => {
    const h = setup();
    handshake(10);
    FakeSocket.last().close();

    expect(h.client.getState()).toBe('reconnecting');
    expect(FakeSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.instances).toHaveLength(2);

    // 重連後要用「目前的 localSeq」補傳，不是從 0 開始
    handshake(10);
    expect(FakeSocket.last().messagesOfType('subscribe')[0]?.sinceSeq).toBe(10);
  });

  it('瀏覽器離線時狀態是 offline，不是 reconnecting', async () => {
    const h = setup({ online: false });
    expect(h.client.getState()).toBe('offline');
  });
});

describe('遠端變更與補傳', () => {
  it('seq 連續 → 直接套用', () => {
    const h = setup();
    const socket = handshake(10);
    socket.emit({ t: 'txBroadcast', result: txResult(11, [op('b1')]) });

    expect(h.remote).toHaveLength(1);
    expect(h.remote[0]?.seq).toBe(11);
    expect(h.client.getLocalSeq(PAGE)).toBe(11);
  });

  it('重複訊息 → 忽略（冪等）', () => {
    const h = setup();
    const socket = handshake(10);
    socket.emit({ t: 'txBroadcast', result: txResult(11, [op('b1')]) });
    socket.emit({ t: 'txBroadcast', result: txResult(11, [op('b1')]) });
    socket.emit({ t: 'txBroadcast', result: txResult(9, [op('b0')]) });

    expect(h.remote).toHaveLength(1);
  });

  it('⭐ 漏收（seq 不連續）→ 自動送 subscribe(sinceSeq) 要求補傳', () => {
    const h = setup();
    const socket = handshake(10);
    socket.sent.length = 0;

    socket.emit({ t: 'txBroadcast', result: txResult(14, [op('b1')]) });

    expect(h.remote).toHaveLength(0);
    expect(socket.messagesOfType('subscribe')).toEqual([
      { t: 'subscribe', pageId: PAGE, sinceSeq: 10 },
    ]);

    // 伺服器補上 11~14
    socket.emit({
      t: 'catchUp',
      pageId: PAGE,
      results: [txResult(12, [op('b2')]), txResult(11, [op('b1')]), txResult(14, [op('b4')]), txResult(13, [op('b3')])],
      toSeq: 14,
    });

    expect(h.remote.map((r) => r.seq)).toEqual([11, 12, 13, 14]); // 依 seq 排序後套用
    expect(h.remote.every((r) => r.catchUp)).toBe(true);
    expect(h.client.getLocalSeq(PAGE)).toBe(14);
  });

  it('catchUp 會跳過已經套用過的 seq', () => {
    const h = setup();
    const socket = handshake(10);
    socket.emit({ t: 'txBroadcast', result: txResult(11, [op('b1')]) });
    socket.emit({
      t: 'catchUp',
      pageId: PAGE,
      results: [txResult(11, [op('b1')]), txResult(12, [op('b2')])],
      toSeq: 12,
    });

    expect(h.remote.map((r) => r.seq)).toEqual([11, 12]);
  });

  it('resync：丟掉本地 seq 並通知宿主重抓 snapshot', () => {
    const h = setup();
    const socket = handshake(500);
    socket.emit({ t: 'resync', pageId: PAGE, reason: 'too_far_behind' });

    expect(h.resyncs).toEqual(['too_far_behind']);
    expect(h.client.getLocalSeq(PAGE)).toBe(0);
  });
});

describe('送出變更', () => {
  it('debounce 300ms 把多個 op 打包成一筆 transaction', async () => {
    const h = setup();
    const socket = handshake(10);

    h.client.submit(PAGE, [op('b1')]);
    h.client.submit(PAGE, [op('b2')]);
    await vi.advanceTimersByTimeAsync(299);
    expect(socket.messagesOfType('tx')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2);
    const sent = socket.messagesOfType('tx');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.tx.ops).toHaveLength(2);
    expect(sent[0]?.tx.originSessionId).toBe('my-session');
    // 送出前就先寫進佇列（斷電也不會丟）
    expect(await h.queue.size()).toBe(1);
  });

  it('收到 txApplied 才把佇列清掉，並更新 localSeq / 衝突提示', async () => {
    const h = setup();
    const socket = handshake(10);
    h.client.submit(PAGE, [op('b1')]);
    await vi.advanceTimersByTimeAsync(300);

    const txId = socket.messagesOfType('tx')[0]!.tx.txId;
    expect(await h.queue.size()).toBe(1);

    socket.emit({
      t: 'txApplied',
      result: txResult(11, [op('b1')], { txId, actorId: 'me', conflicts: ['b1'] }),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(await h.queue.size()).toBe(0);
    expect(h.client.getLocalSeq(PAGE)).toBe(11);
    expect(h.conflicts).toEqual([['b1']]);
  });

  it('txRejected → 回滾並從佇列移除', async () => {
    const h = setup();
    const socket = handshake(10);
    h.client.submit(PAGE, [op('b1')]);
    await vi.advanceTimersByTimeAsync(300);
    const txId = socket.messagesOfType('tx')[0]!.tx.txId;

    socket.emit({ t: 'txRejected', txId, code: 'FORBIDDEN', message: '沒有編輯權限' });
    await vi.advanceTimersByTimeAsync(0);

    expect(h.rollbacks).toEqual([{ txId, code: 'FORBIDDEN' }]);
    expect(await h.queue.size()).toBe(0);
  });

  it('WS 沒回 ack → 逾時後降級走 HTTP（txId 相同，伺服器冪等）', async () => {
    const h = setup();
    const socket = handshake(10);
    h.client.submit(PAGE, [op('b1')]);
    await vi.advanceTimersByTimeAsync(300);
    const txId = socket.messagesOfType('tx')[0]!.tx.txId;

    await vi.advanceTimersByTimeAsync(10_000);

    expect(h.httpSubmit).toHaveBeenCalledTimes(1);
    expect(h.httpSubmit.mock.calls[0]?.[1]).toMatchObject({ txId });
    expect(await h.queue.size()).toBe(0);
  });

  it('WS 還沒 ready 時直接走 HTTP 降級路徑', async () => {
    const h = setup();
    // 不做 handshake：狀態停在 connecting
    h.client.submit(PAGE, [op('b1')]);
    await vi.advanceTimersByTimeAsync(300);

    expect(h.httpSubmit).toHaveBeenCalledTimes(1);
    expect(await h.queue.size()).toBe(0);
  });
});

describe('離線佇列', () => {
  it('⭐ 斷線期間的變更留在佇列，重連 synced 之後依序重送', async () => {
    const h = setup({ online: false });
    // 離線：HTTP 也不能用
    h.client.submit(PAGE, [op('b1')]);
    await vi.advanceTimersByTimeAsync(300);
    h.client.submit(PAGE, [op('b2')]);
    await vi.advanceTimersByTimeAsync(300);

    expect(h.httpSubmit).not.toHaveBeenCalled();
    const queued = await h.queue.list();
    expect(queued).toHaveLength(2);
    expect(queued.map((q) => q.ops[0])).toEqual([op('b1'), op('b2')]);

    // 網路回來 → 重連 → synced 後自動重送
    const online = setupReconnect(h);
    await online;

    const sentTx = FakeSocket.last().messagesOfType('tx');
    expect(sentTx).toHaveLength(2);
    expect(sentTx.map((m) => m.tx.ops[0])).toEqual([op('b1'), op('b2')]);
    // txId 沿用佇列裡的，伺服器端冪等
    expect(sentTx.map((m) => m.tx.txId)).toEqual(queued.map((q) => q.txId));
  });

  it('重送失敗的 transaction 不會亂序（order 保持不變）', async () => {
    const queue = new MemoryQueue();
    await queue.put({ txId: 'a', pageId: PAGE, ops: [op('a')], createdAt: 1, attempts: 0, order: 1 });
    await queue.put({ txId: 'b', pageId: PAGE, ops: [op('b')], createdAt: 2, attempts: 0, order: 2 });
    // a 重送（attempts +1）不該把它排到 b 後面
    await queue.put({ txId: 'a', pageId: PAGE, ops: [op('a')], createdAt: 9, attempts: 1, order: 99 });

    expect((await queue.list()).map((q) => q.txId)).toEqual(['a', 'b']);
  });
});

/** 模擬「網路回來 → 重連 → 握手」 */
async function setupReconnect(h: Harness): Promise<void> {
  // 佇列是離線時寫入的，這裡讓 client 以為自己已經上線
  (h.client as unknown as { opts: { isOnline(): boolean } }).opts.isOnline = () => true;
  await vi.advanceTimersByTimeAsync(1000);
  const socket = FakeSocket.last();
  socket.accept();
  socket.emit({ t: 'authOk', userId: 'me', sessionId: 'my-session' });
  socket.emit({ t: 'synced', pageId: PAGE, seq: 10, permission: 'edit' });
  await vi.advanceTimersByTimeAsync(0);
}
