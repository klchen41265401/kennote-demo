import { describe, expect, it } from 'vitest';
import type { Operation } from '@kennote/shared-types';
import {
  createOfflineQueue,
  MemoryQueue,
  nextOrder,
  pendingOpCount,
  sortQueue,
  type QueuedTransaction,
} from './offline-queue';

const op = (blockId: string): Operation => ({ type: 'block.delete', blockId });

const tx = (txId: string, order: number, pageId = 'page-1'): QueuedTransaction => ({
  txId,
  pageId,
  ops: [op(txId)],
  createdAt: order,
  attempts: 0,
  order,
});

describe('離線佇列', () => {
  it('沒有 IndexedDB 的環境（Node / SSR）自動退回記憶體實作', () => {
    expect(createOfflineQueue()).toBeInstanceOf(MemoryQueue);
  });

  it('依 order 排序重送，不是依插入順序', async () => {
    const queue = new MemoryQueue();
    await queue.put(tx('c', 3));
    await queue.put(tx('a', 1));
    await queue.put(tx('b', 2));
    expect((await queue.list()).map((t) => t.txId)).toEqual(['a', 'b', 'c']);
  });

  it('同一個 txId 重送時保留原本的 order（重送不會亂序）', async () => {
    const queue = new MemoryQueue();
    await queue.put(tx('a', 1));
    await queue.put(tx('b', 2));
    await queue.put({ ...tx('a', 999), attempts: 3 });

    const list = await queue.list();
    expect(list.map((t) => t.txId)).toEqual(['a', 'b']);
    expect(list[0]?.attempts).toBe(3);
    expect(await queue.size()).toBe(2);
  });

  it('可以只列出某一頁的待送變更', async () => {
    const queue = new MemoryQueue();
    await queue.put(tx('a', 1, 'page-1'));
    await queue.put(tx('b', 2, 'page-2'));
    expect((await queue.list('page-2')).map((t) => t.txId)).toEqual(['b']);
  });

  it('ack 之後移除；clear 清空', async () => {
    const queue = new MemoryQueue();
    await queue.put(tx('a', 1));
    await queue.put(tx('b', 2));
    await queue.remove('a');
    expect(await queue.size()).toBe(1);
    await queue.clear();
    expect(await queue.size()).toBe(0);
  });

  it('pendingOpCount 算的是 op 數量而不是 transaction 數量', async () => {
    const queue = new MemoryQueue();
    await queue.put({ ...tx('a', 1), ops: [op('x'), op('y')] });
    await queue.put(tx('b', 2));
    expect(await pendingOpCount(queue)).toBe(3);
  });

  it('nextOrder 嚴格遞增（同一毫秒連續呼叫也是）', () => {
    const a = nextOrder(1000);
    const b = nextOrder(1000);
    const c = nextOrder(1001);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('sortQueue 是穩定的（order 相同時看 createdAt）', () => {
    const items = [
      { ...tx('b', 5), createdAt: 20 },
      { ...tx('a', 5), createdAt: 10 },
    ];
    expect(sortQueue(items).map((t) => t.txId)).toEqual(['a', 'b']);
  });
});
