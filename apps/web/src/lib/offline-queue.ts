/**
 * 離線佇列（04 §6.5、§8 M5-5）。
 *
 * 斷線期間使用者仍然可以繼續打字：ops 會被打包成 Transaction 寫進 **IndexedDB**，
 * 連瀏覽器關掉都不會丟。重連後依序重送，txId 不變 → 伺服器端冪等（不會套兩次）。
 *
 * 為什麼不用 localStorage：
 *   - 同步 API，寫入會卡住主執行緒（打字中每 300ms 一次，體感很明顯）
 *   - 5MB 上限而且是字串，大量 ops 很快就爆
 * IndexedDB 是非同步、容量大、結構化。這裡只用到最原始的 API，沒有任何包裝套件。
 *
 * 介面刻意抽象成 OfflineQueue，因此：
 *   - 瀏覽器 → IndexedDbQueue
 *   - Node / 測試 / 隱私模式（IndexedDB 被擋） → MemoryQueue
 */
import type { Operation } from '@kennote/shared-types';

export interface QueuedTransaction {
  txId: string;
  pageId: string;
  ops: Operation[];
  createdAt: number;
  /** 送出次數，用來做「一直失敗就停止重試」的保護 */
  attempts: number;
  /** 單調遞增的插入序號 —— 重送順序的唯一真值 */
  order: number;
}

export interface OfflineQueue {
  init(): Promise<void>;
  /** 新增或覆蓋（同 txId 重送時更新 attempts） */
  put(tx: QueuedTransaction): Promise<void>;
  remove(txId: string): Promise<void>;
  /** 依 order 由小到大；pageId 給定時只回那一頁的 */
  list(pageId?: string): Promise<QueuedTransaction[]>;
  clear(): Promise<void>;
  size(): Promise<number>;
}

const DB_NAME = 'kennote-sync';
const DB_VERSION = 1;
const STORE = 'pending-transactions';

let orderCounter = 0;

/** 插入序號：時間戳 + 同毫秒計數，確保嚴格遞增（重送順序必須穩定） */
export function nextOrder(now: number = Date.now()): number {
  orderCounter += 1;
  return now * 1000 + (orderCounter % 1000);
}

export function sortQueue(items: QueuedTransaction[]): QueuedTransaction[] {
  return [...items].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/* ── 記憶體版（測試 / 沒有 IndexedDB 的環境） ─────────────── */

export class MemoryQueue implements OfflineQueue {
  private readonly items = new Map<string, QueuedTransaction>();

  async init(): Promise<void> {}

  async put(tx: QueuedTransaction): Promise<void> {
    const existing = this.items.get(tx.txId);
    // 重送時保留原本的 order，否則會被排到最後面而亂序
    this.items.set(tx.txId, existing ? { ...tx, order: existing.order } : tx);
  }

  async remove(txId: string): Promise<void> {
    this.items.delete(txId);
  }

  async list(pageId?: string): Promise<QueuedTransaction[]> {
    const all = [...this.items.values()].filter((t) => !pageId || t.pageId === pageId);
    return sortQueue(all);
  }

  async clear(): Promise<void> {
    this.items.clear();
  }

  async size(): Promise<number> {
    return this.items.size;
  }
}

/* ── IndexedDB 版 ─────────────────────────────────────── */

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失敗'));
  });
}

export class IndexedDbQueue implements OfflineQueue {
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;

  async init(): Promise<void> {
    await this.open();
  }

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.opening) return this.opening;
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'txId' });
          store.createIndex('order', 'order');
          store.createIndex('pageId', 'pageId');
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('無法開啟 IndexedDB'));
    });
    return this.opening;
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(STORE, mode);
    const result = await promisify(fn(tx.objectStore(STORE)));
    return result;
  }

  async put(tx: QueuedTransaction): Promise<void> {
    const existing = await this.withStore<QueuedTransaction | undefined>('readonly', (s) =>
      s.get(tx.txId),
    );
    const record = existing ? { ...tx, order: existing.order } : tx;
    await this.withStore('readwrite', (s) => s.put(record));
  }

  async remove(txId: string): Promise<void> {
    await this.withStore('readwrite', (s) => s.delete(txId));
  }

  async list(pageId?: string): Promise<QueuedTransaction[]> {
    const all = await this.withStore<QueuedTransaction[]>('readonly', (s) => s.getAll());
    return sortQueue(all.filter((t) => !pageId || t.pageId === pageId));
  }

  async clear(): Promise<void> {
    await this.withStore('readwrite', (s) => s.clear());
  }

  async size(): Promise<number> {
    return this.withStore<number>('readonly', (s) => s.count());
  }
}

/**
 * 自動挑選實作。IndexedDB 不可用（SSR、Node 測試、Safari 隱私模式）時
 * 退回記憶體佇列 —— 功能不變，只是關掉瀏覽器會丟失未送出的變更。
 */
export function createOfflineQueue(): OfflineQueue {
  if (typeof indexedDB === 'undefined') return new MemoryQueue();
  return new IndexedDbQueue();
}

/** 佇列裡同一頁的 ops 總數（UI 顯示「N 筆變更尚未同步」） */
export async function pendingOpCount(queue: OfflineQueue, pageId?: string): Promise<number> {
  const items = await queue.list(pageId);
  return items.reduce((sum, t) => sum + t.ops.length, 0);
}
