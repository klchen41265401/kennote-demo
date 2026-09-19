import { describe, expect, it, vi } from 'vitest';
import type { Operation, TransactionResult } from '@kennote/shared-types';
import { createTransport, type SyncAdapter, type Timers } from '../transport';

/** 可手動推進的假時鐘（transport 的所有計時都走注入的 timers） */
function manualClock() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const timers: Timers = {
    setTimeout(fn) {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    get size() {
      return pending.size;
    },
    /** 執行目前排隊中的 callback（新排的留到下一輪） */
    tick() {
      const entries = [...pending];
      pending.clear();
      for (const [, fn] of entries) fn();
    },
  };
}

/** 讓 microtask 與假計時器交錯跑完 */
async function settle(clock: ReturnType<typeof manualClock>, rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock.tick();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function op(blockId: string, text: string): Operation {
  return { type: 'block.update', blockId, patch: { content: [{ text }] } };
}

function result(seq: number): TransactionResult {
  return {
    txId: 'tx',
    pageId: 'p1',
    seq,
    ops: [],
    appliedAt: new Date().toISOString(),
    actorId: 'u1',
  };
}

function makeAdapter(impl: SyncAdapter['submit']): { adapter: SyncAdapter; calls: Operation[][] } {
  const calls: Operation[][] = [];
  return {
    calls,
    adapter: {
      submit(ops, meta) {
        calls.push(ops);
        return impl(ops, meta);
      },
    },
  };
}

function blockIdOf(operation: Operation): string | null {
  return 'blockId' in operation ? operation.blockId : null;
}

describe('transport：debounce 打包', () => {
  it('debounce 之內的多次 push 只送一個 transaction', async () => {
    const clock = manualClock();
    const { adapter, calls } = makeAdapter(() => Promise.resolve(result(1)));
    const transport = createTransport({
      pageId: 'p1',
      sessionId: 's1',
      adapter,
      timers: clock.timers,
      newTxId: () => 'tx-1',
    });

    transport.push([op('b1', 'a')], [op('b1', '')]);
    transport.push([op('b1', 'ab')], [op('b1', 'a')]);
    transport.push([op('b1', 'abc')], [op('b1', 'ab')]);
    expect(calls).toHaveLength(0);
    expect(transport.getState().pending).toBe(3);

    clock.tick();
    await settle(clock);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(3);
    expect(transport.getState().status).toBe('idle');
    expect(transport.getState().seq).toBe(1);
    transport.destroy();
  });

  it('flush() 會略過 debounce 立刻送出（離開頁面用）', async () => {
    const clock = manualClock();
    const { adapter, calls } = makeAdapter(() => Promise.resolve(result(7)));
    const transport = createTransport({ pageId: 'p1', sessionId: 's1', adapter, timers: clock.timers });

    transport.push([op('b1', 'x')], [op('b1', '')]);
    const flushed = transport.flush();
    await settle(clock);
    await flushed;

    expect(calls).toHaveLength(1);
    expect(transport.getState().seq).toBe(7);
    transport.destroy();
  });

  it('沒有變更時 flush() 直接 resolve', async () => {
    const clock = manualClock();
    const { adapter, calls } = makeAdapter(() => Promise.resolve(result(1)));
    const transport = createTransport({ pageId: 'p1', sessionId: 's1', adapter, timers: clock.timers });
    await transport.flush();
    expect(calls).toHaveLength(0);
    transport.destroy();
  });

  it('送出時帶上 txId / pageId / originSessionId（冪等契約）', async () => {
    const clock = manualClock();
    const metas: unknown[] = [];
    const transport = createTransport({
      pageId: 'page-42',
      sessionId: 'sess-9',
      timers: clock.timers,
      newTxId: () => 'tx-abc',
      adapter: {
        submit(_ops, meta) {
          metas.push(meta);
          return Promise.resolve(result(1));
        },
      },
    });
    transport.push([op('b1', 'x')], []);
    clock.tick();
    await settle(clock);
    expect(metas[0]).toEqual({ txId: 'tx-abc', pageId: 'page-42', originSessionId: 'sess-9' });
    transport.destroy();
  });
});

describe('transport：失敗 rollback', () => {
  it('400（不合法 op）→ 立刻 rollback，inverse 以反序套用', async () => {
    const clock = manualClock();
    const rolled: Operation[][] = [];
    const errors: string[] = [];
    const transport = createTransport({
      pageId: 'p1',
      sessionId: 's1',
      timers: clock.timers,
      onRollback: (ops) => rolled.push(ops),
      onError: (message) => errors.push(message),
      adapter: {
        submit: () => Promise.reject(Object.assign(new Error('INVALID_OPERATION'), { status: 400 })),
      },
    });

    transport.push([op('b1', 'first')], [op('b1', 'inv-1')]);
    transport.push([op('b2', 'second')], [op('b2', 'inv-2')]);
    clock.tick();
    await settle(clock);

    expect(rolled).toHaveLength(1);
    // 後做的先還原
    expect(rolled[0]?.map(blockIdOf)).toEqual(['b2', 'b1']);
    expect(errors[0]).toContain('變更未能儲存');
    expect(transport.getState().status).toBe('error');
    transport.destroy();
  });

  it('500 會重試，成功後不 rollback', async () => {
    const clock = manualClock();
    const rolled: Operation[][] = [];
    let attempts = 0;
    const transport = createTransport({
      pageId: 'p1',
      sessionId: 's1',
      timers: clock.timers,
      maxRetries: 3,
      onRollback: (ops) => rolled.push(ops),
      adapter: {
        submit: () => {
          attempts += 1;
          if (attempts < 3) {
            return Promise.reject(Object.assign(new Error('boom'), { status: 500 }));
          }
          return Promise.resolve(result(5));
        },
      },
    });

    transport.push([op('b1', 'x')], [op('b1', '')]);
    clock.tick();
    await settle(clock, 30);

    expect(attempts).toBe(3);
    expect(rolled).toHaveLength(0);
    expect(transport.getState().seq).toBe(5);
    expect(transport.getState().status).toBe('idle');
    transport.destroy();
  });

  it('重試用完仍失敗 → rollback', async () => {
    const clock = manualClock();
    const rolled: Operation[][] = [];
    const transport = createTransport({
      pageId: 'p1',
      sessionId: 's1',
      timers: clock.timers,
      maxRetries: 1,
      onRollback: (ops) => rolled.push(ops),
      adapter: {
        submit: () => Promise.reject(Object.assign(new Error('offline'), { status: 0 })),
      },
    });

    transport.push([op('b1', 'x')], [op('b1', '')]);
    clock.tick();
    await settle(clock, 30);

    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toHaveLength(1);
    transport.destroy();
  });

  it('conflicts 會透過 onError 回報，但不 rollback', async () => {
    const clock = manualClock();
    const rolled: Operation[][] = [];
    const errors: string[] = [];
    const transport = createTransport({
      pageId: 'p1',
      sessionId: 's1',
      timers: clock.timers,
      onRollback: (ops) => rolled.push(ops),
      onError: (message) => errors.push(message),
      adapter: {
        submit: () => Promise.resolve({ ...result(3), conflicts: ['b1'] }),
      },
    });
    transport.push([op('b1', 'x')], [op('b1', '')]);
    clock.tick();
    await settle(clock);
    expect(rolled).toHaveLength(0);
    expect(errors[0]).toContain('版本衝突');
    transport.destroy();
  });
});

describe('transport：狀態與訂閱', () => {
  it('狀態流轉 pending → saving → idle', async () => {
    const clock = manualClock();
    const seen: string[] = [];
    const transport = createTransport({
      pageId: 'p1',
      sessionId: 's1',
      timers: clock.timers,
      onStateChange: (state) => seen.push(state.status),
      adapter: { submit: () => Promise.resolve(result(1)) },
    });
    transport.push([op('b1', 'x')], []);
    clock.tick();
    await settle(clock);
    expect(seen).toContain('pending');
    expect(seen).toContain('saving');
    expect(seen[seen.length - 1]).toBe('idle');
    transport.destroy();
  });

  it('subscribe / destroy 之後不再送出', async () => {
    const clock = manualClock();
    const submit = vi.fn(() => Promise.resolve(result(1)));
    const transport = createTransport({
      pageId: 'p1',
      sessionId: 's1',
      timers: clock.timers,
      adapter: { submit },
    });
    const off = transport.subscribe(() => undefined);
    off();
    transport.destroy();
    transport.push([op('b1', 'x')], []);
    clock.tick();
    await settle(clock);
    expect(submit).not.toHaveBeenCalled();
  });

  it('遠端 ops 透過 adapter.onRemote 轉給宿主（之後換成 sync-client 的接點）', async () => {
    const clock = manualClock();
    const remote: { emit: ((ops: Operation[]) => void) | null } = { emit: null };
    const received: Operation[][] = [];
    const transport = createTransport({
      pageId: 'p1',
      sessionId: 's1',
      timers: clock.timers,
      onRemoteOps: (ops) => received.push(ops),
      adapter: {
        submit: () => Promise.resolve(result(1)),
        onRemote(cb) {
          remote.emit = cb;
          return () => {
            remote.emit = null;
          };
        },
      },
    });
    expect(remote.emit).not.toBeNull();
    remote.emit?.([op('remote', 'hi')]);
    expect(received).toHaveLength(1);
    expect(blockIdOf(received[0]?.[0] as Operation)).toBe('remote');
    transport.destroy();
    expect(remote.emit).toBeNull();
  });
});
