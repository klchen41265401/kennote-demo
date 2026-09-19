/**
 * 同步狀態的 React 綁定（02 §5.5 的 realtimeStore）。
 *
 * 分層：
 *   lib/sync-client.ts  純邏輯（狀態機、佇列、補傳），沒有 React
 *   stores/sync.ts      單例 + store + usePageSync（這個檔案）
 *   components/         ConnectionBadge、PresenceAvatars
 *
 * 元件層永遠不直接碰 WebSocket，也不直接呼叫寫入 API（04 §7.3 / 00-README 風險二）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Operation,
  PagePermission,
  ServerMessage,
  Transaction,
  TransactionResult,
} from '@kennote/shared-types';
import { API_ROUTES } from '@kennote/shared-types';
import { createStore, invalidateQueries, useStore } from '@kennote/ui';
import { api, getAccessToken } from '../lib/api-client';
import type { QueuedTransaction } from '../lib/offline-queue';
import {
  createSyncClient,
  type RemoteOpsMeta,
  type SyncClient,
  type SyncState,
} from '../lib/sync-client';
import { clearPagePresence, setPagePresence, setSelfSessionId } from './presence';
import { applyIncomingNotification } from './notifications';

export interface ConflictToast {
  id: string;
  pageId: string;
  blockIds: string[];
  actorId: string;
  at: number;
}

export interface SyncStoreState {
  state: SyncState;
  /** 尚未送達伺服器的 transaction 數（離線徽章顯示「變更已暫存」） */
  pending: number;
  conflicts: ConflictToast[];
  lastError: string | null;
}

export const syncStore = createStore<SyncStoreState>({
  state: 'idle',
  pending: 0,
  conflicts: [],
  lastError: null,
});

let client: SyncClient | null = null;

/** 單例。第一次用到時才建立（登入前不會亂連） */
export function getSyncClient(): SyncClient {
  if (client) return client;
  client = createSyncClient({
    getToken: () => getAccessToken(),
    http: {
      submit: (pageId: string, tx: Transaction) =>
        api.post<TransactionResult>(API_ROUTES.pageTransactions(pageId), tx),
      fetchSince: (pageId: string, since: number) =>
        api.get<{ pageId: string; seq: number; results: TransactionResult[] }>(
          API_ROUTES.pageTransactions(pageId),
          { since },
        ),
    },
    onStateChange: (state) => {
      syncStore.setState((prev) => ({ ...prev, state }));
      void refreshPending();
    },
    onNotification: (msg) => applyIncomingNotification(msg.notification, msg.unread),
  });
  // presence 名單要把「我自己這個分頁」濾掉
  setSelfSessionId(client.sessionId);
  return client;
}

export async function refreshPending(): Promise<void> {
  if (!client) return;
  const pending = await client.pendingCount();
  syncStore.setState((prev) => (prev.pending === pending ? prev : { ...prev, pending }));
}

export function dismissConflict(id: string): void {
  syncStore.setState((prev) => ({ ...prev, conflicts: prev.conflicts.filter((c) => c.id !== id) }));
}

function pushConflict(pageId: string, blockIds: string[], actorId: string): void {
  const toast: ConflictToast = {
    id: `${pageId}:${blockIds.join(',')}:${Date.now()}`,
    pageId,
    blockIds,
    actorId,
    at: Date.now(),
  };
  syncStore.setState((prev) => ({ ...prev, conflicts: [...prev.conflicts.slice(-4), toast] }));
}

export function useSyncState(): SyncStoreState {
  return useStore(syncStore);
}

/** 瀏覽器回到線上 / 切回分頁時立刻重試，不必等 backoff 跑完 */
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    const c = client;
    if (!c) return;
    c.stop();
    c.start();
  });
}

export interface UsePageSyncOptions {
  /** ⭐ 遠端變更 → 宿主呼叫 editor.applyRemote(ops)（IME 組字時 editor 自行排隊） */
  onRemoteOps?(ops: Operation[], meta: RemoteOpsMeta): void;
  /** 宿主目前已套用到第幾個 seq（通常來自 snapshot.seq） */
  getLocalSeq?(): number;
  /** 落後太多 → 重抓 snapshot。預設會讓 usePageSnapshot 的快取失效 */
  onResync?(reason: string): void;
  onConflict?(blockIds: string[], actorId: string): void;
  /** 伺服器拒絕這筆變更 → 宿主套用 inverseOps 回滾 */
  onRollback?(tx: QueuedTransaction, reason: { code: string; message: string }): void;
  onComment?(msg: Extract<ServerMessage, { t: 'comment' }>): void;
}

export interface PageSyncApi {
  state: SyncState;
  seq: number;
  permission: PagePermission;
  canEdit: boolean;
  /** 樂觀更新後呼叫：進 pending queue、debounce 300ms 打包送出 */
  submit(ops: Operation[]): void;
  /** 立刻送出（切頁、關閉視窗前） */
  flush(): Promise<void>;
  /** 游標/選取範圍變動時呼叫（不進 operation log） */
  updatePresence(blockId: string | null, selection: [number, number] | null): void;
}

export function usePageSync(
  pageId: string | null,
  options: UsePageSyncOptions = {},
): PageSyncApi {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const state = useStore(syncStore, (s) => s.state);
  const [seq, setSeq] = useState(0);
  const [permission, setPermission] = useState<PagePermission>('read');

  useEffect(() => {
    if (!pageId) return;
    const sync = getSyncClient();
    sync.start();

    const initialSeq = optionsRef.current.getLocalSeq?.() ?? 0;
    setSeq(initialSeq);

    const detach = sync.attachPage(
      pageId,
      {
        onRemoteOps: (ops, meta) => optionsRef.current.onRemoteOps?.(ops, meta),
        onSeqChange: (next) => setSeq(next),
        onPermission: (next) => setPermission(next),
        onPresence: (peers) => setPagePresence(pageId, peers),
        onConflict: (blockIds, actorId) => {
          pushConflict(pageId, blockIds, actorId);
          optionsRef.current.onConflict?.(blockIds, actorId);
        },
        onRollback: (tx, reason) => {
          syncStore.setState((prev) => ({ ...prev, lastError: reason.message }));
          optionsRef.current.onRollback?.(tx, reason);
          void refreshPending();
        },
        onResync: (reason) => {
          // 預設行為：讓 snapshot 快取失效，宿主重新載入整頁
          invalidateQueries(['page', pageId, 'snapshot']);
          optionsRef.current.onResync?.(reason);
        },
        onComment: (msg) => {
          invalidateQueries(['page', pageId, 'discussions']);
          optionsRef.current.onComment?.(msg);
        },
      },
      initialSeq,
    );

    void refreshPending();

    return () => {
      detach();
      clearPagePresence(pageId);
    };
  }, [pageId]);

  const submit = useCallback(
    (ops: Operation[]) => {
      if (!pageId) return;
      getSyncClient().submit(pageId, ops);
      void refreshPending();
    },
    [pageId],
  );

  const flush = useCallback(async () => {
    if (!pageId) return;
    await getSyncClient().flush(pageId);
    await refreshPending();
  }, [pageId]);

  const updatePresence = useCallback(
    (blockId: string | null, selection: [number, number] | null) => {
      if (!pageId) return;
      getSyncClient().updatePresence(pageId, blockId, selection);
    },
    [pageId],
  );

  return {
    state,
    seq,
    permission,
    canEdit: permission === 'edit' || permission === 'full',
    submit,
    flush,
    updatePresence,
  };
}
