/**
 * Demo 後端的「資料庫」：記憶體快取 + IndexedDB 持久化。
 *
 * schema 刻意對齊伺服器（`apps/server/migrations/*.sql`）的表名：
 * users / workspaces / pages / blocks / page_transactions / collections /
 * collection_views / files / favorites / notifications / discussions /
 * comments / page_visits。
 *
 * 持久化策略：整包 state 以一個 key 存進 IndexedDB（demo 的資料量是幾百筆，
 * 一次寫入 < 1ms），檔案 blob 另存一個 object store。寫入 debounce 150ms。
 */
import type {
  AuthUser,
  Block,
  DiscussionAnchor,
  Collection,
  CollectionView,
  Notification,
  Page,
  RichText,
  TransactionResult,
  WorkspaceSummary,
} from '@kennote/shared-types';
import type { Operation } from '@kennote/shared-types';

export const DEMO_DB_NAME = 'kennote-demo';
export const DEMO_DB_VERSION = 1;
const STATE_STORE = 'state';
const BLOB_STORE = 'blobs';
const STATE_KEY = 'db';
/** schema 改版時把這個數字 +1，舊資料會被丟棄重新種子 */
export const DEMO_SCHEMA_VERSION = 3;

export interface DemoBlock extends Block {
  deletedAt: string | null;
  workspaceId: string;
}

export interface DemoWorkspace extends WorkspaceSummary {
  createdAt: string;
  deletedAt: string | null;
}

export interface DemoTransaction {
  txId: string;
  pageId: string;
  seq: number;
  /** 寫進歷史的 ops（text.delta 會被記成 block.update{content}） */
  ops: Operation[];
  result: TransactionResult;
  actorId: string;
  originSessionId: string;
  createdAt: string;
}

export interface DemoFile {
  id: string;
  workspaceId: string;
  pageId: string | null;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  /** blob: URL（由 IndexedDB 的 blob 重新產生，每次開站都不同） */
  url: string;
}

export interface DemoComment {
  id: string;
  discussionId: string;
  authorId: string;
  body: RichText;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DemoDiscussion {
  id: string;
  pageId: string;
  blockId: string | null;
  anchor: DiscussionAnchor;
  resolved: boolean;
  resolvedBy: string | null;
  createdAt: string;
  createdBy: string;
  comments: DemoComment[];
}

export interface DemoVisit {
  pageId: string;
  userId: string;
  at: string;
}

export interface DemoState {
  schemaVersion: number;
  users: Record<string, AuthUser>;
  workspaces: Record<string, DemoWorkspace>;
  pages: Record<string, Page>;
  blocks: Record<string, DemoBlock>;
  pageTransactions: DemoTransaction[];
  collections: Record<string, Collection>;
  views: Record<string, CollectionView>;
  files: Record<string, Omit<DemoFile, 'url'>>;
  favorites: Array<{ pageId: string; userId: string; at: string }>;
  visits: DemoVisit[];
  notifications: Notification[];
  discussions: Record<string, DemoDiscussion>;
  /** 目前登入的使用者（demo 只有一個；null = 尚未登入） */
  sessionUserId: string | null;
  seededAt: string | null;
}

export function emptyState(): DemoState {
  return {
    schemaVersion: DEMO_SCHEMA_VERSION,
    users: {},
    workspaces: {},
    pages: {},
    blocks: {},
    pageTransactions: [],
    collections: {},
    views: {},
    files: {},
    favorites: [],
    visits: [],
    notifications: [],
    discussions: {},
    sessionUserId: null,
    seededAt: null,
  };
}

/* ── IndexedDB ───────────────────────────────────────────── */

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DEMO_DB_NAME, DEMO_DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE);
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/** 檔案 blob 的記憶體對照（fileId → blob: URL），每次開站重建 */
const blobUrls = new Map<string, string>();

export function blobUrlFor(fileId: string): string | null {
  return blobUrls.get(fileId) ?? null;
}

class DemoStore {
  state: DemoState = emptyState();
  private db: IDBDatabase | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private ready: Promise<void> | null = null;

  init(): Promise<void> {
    if (!this.ready) this.ready = this.doInit();
    return this.ready;
  }

  private async doInit(): Promise<void> {
    this.db = await openDb();
    if (!this.db) return;
    const loaded = await this.readState();
    if (loaded && loaded.schemaVersion === DEMO_SCHEMA_VERSION) {
      this.state = { ...emptyState(), ...loaded };
      await this.rehydrateBlobs();
    }
  }

  private readState(): Promise<DemoState | null> {
    return new Promise((resolve) => {
      if (!this.db) return resolve(null);
      try {
        const tx = this.db.transaction(STATE_STORE, 'readonly');
        const req = tx.objectStore(STATE_STORE).get(STATE_KEY);
        req.onsuccess = () => resolve((req.result as DemoState | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private rehydrateBlobs(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.db) return resolve();
      try {
        const tx = this.db.transaction(BLOB_STORE, 'readonly');
        const store = tx.objectStore(BLOB_STORE);
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve();
          const blob = cursor.value as Blob;
          try {
            blobUrls.set(String(cursor.key), URL.createObjectURL(blob));
          } catch {
            /* 忽略 */
          }
          cursor.continue();
        };
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /** 每次寫入後呼叫；debounce 之後整包存回 IndexedDB */
  persist(): void {
    if (!this.db) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        const tx = this.db!.transaction(STATE_STORE, 'readwrite');
        // structuredClone 友善：state 全部是 JSON 可序列化的值
        tx.objectStore(STATE_STORE).put(JSON.parse(JSON.stringify(this.state)), STATE_KEY);
      } catch {
        /* 無痕模式 / 配額不足：demo 仍可在記憶體中運作 */
      }
    }, 150);
  }

  async putBlob(fileId: string, blob: Blob): Promise<string> {
    let url = '';
    try {
      url = URL.createObjectURL(blob);
      blobUrls.set(fileId, url);
    } catch {
      /* 忽略 */
    }
    if (this.db) {
      try {
        const tx = this.db.transaction(BLOB_STORE, 'readwrite');
        tx.objectStore(BLOB_STORE).put(blob, fileId);
      } catch {
        /* 忽略 */
      }
    }
    return url;
  }

  /** 「重設 Demo 資料」：清空 IndexedDB 與記憶體 */
  async reset(): Promise<void> {
    for (const url of blobUrls.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* 忽略 */
      }
    }
    blobUrls.clear();
    this.state = emptyState();
    if (this.db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = this.db!.transaction([STATE_STORE, BLOB_STORE], 'readwrite');
          tx.objectStore(STATE_STORE).clear();
          tx.objectStore(BLOB_STORE).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
  }
}

export const store = new DemoStore();

/** 測試用：直接換掉整份 state（不碰 IndexedDB） */
export function replaceState(next: DemoState): void {
  store.state = next;
}

export function db(): DemoState {
  return store.state;
}

export function commit(): void {
  store.persist();
}
