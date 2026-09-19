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
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
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


/** 遠端 op 觸發「版本歷史重抓」的節流窗（BUG-51）。歷史的粒度是版本，不是按鍵。 */
const HISTORY_INVALIDATE_THROTTLE_MS = 3000;
let lastHistoryInvalidate = 0;

export function usePageSync(
  pageId: string | null,
  options: UsePageSyncOptions = {},
): PageSyncApi {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const state = useStore(syncStore, (s) => s.state);
  const [seq, setSeq] = useState(0);
  const [permission, setPermission] = useState<PagePermission>('read');

  /*
   * ⭐ 回歸分診第一輪：這裡**必須**是 `useLayoutEffect`，不能是 `useEffect`。
   *
   * `useEditorHost()` 先呼叫 `usePageSync()`、後面才用 `useLayoutEffect` 建編輯器。
   * React 的 layout effect 一律排在 passive effect（`useEffect`）之前，所以原本的
   * 順序是「建編輯器 → 送 op → （很久以後才）attachPage」。而
   * `SyncClient.submit()` 對**還沒 attach 的頁面會直接 `return`**（ops 靜悄悄丟掉），
   * 於是編輯器在 mount 當下送出的那一批 op 全部消失。
   *
   * 踩到的現場：`rootIds.length === 0` 的頁面（＝資料庫的「列」頁，`createRow()`
   * 不會建任何 block）。`useEditorHost` 會補一個空段落並送出 `block.insert` ——
   * 那一筆被丟掉之後，使用者打的字走 OT 的 `text.delta` 打到一個伺服器不認識的
   * block → `txRejected BLOCK_NOT_FOUND` → `onRollback` → 整頁重抓重建 →
   * 剛打的字全部不見（重整後編輯器是空的）。
   *
   * 改成 layout effect 之後，attach 一定發生在編輯器送出第一批 op 之前。
   * （另一半的保險在 `lib/sync-client.ts` 的 `submit()`：改成先進 pending 佇列，
   * attach 時再補送，而不是默默丟掉。）
   */
  /** 見下方 BUG-51：版本歷史的重抓節流窗（模組層，跨頁共用一個時間戳就夠） */
  useLayoutEffect(() => {
    if (!pageId) return;
    const sync = getSyncClient();
    sync.start();

    const initialSeq = optionsRef.current.getLocalSeq?.() ?? 0;
    setSeq(initialSeq);

    const detach = sync.attachPage(
      pageId,
      {
        onRemoteOps: (ops, meta) => {
          /**
           * ⭐ 第十輪 BUG-51：**版本歷史面板對別人的編輯是瞎的。**
           *
           * `HistoryPanel` 的資料來自 `useQuery(['page', pageId, 'history'])`，
           * 而全站只有兩個地方讓它失效：面板自己按下「還原」，
           * 以及 `onResync` 的 `['page', pageId, 'snapshot']` ——
           * 但 `invalidateQueries` 是**前綴比對**，`...'snapshot'` 比不中 `...'history'`。
           * 結果是：兩個人同時開著同一頁，A 一直編輯，B 的版本歷史停在打開的那一刻，
           * 而且**畫面上沒有任何東西說它過期了**（沒有 spinner、沒有「有新版本」）。
           * 協作 UI 最糟的形狀就是「看起來是現況、其實是快照」。
           *
           * 為什麼要節流：遠端 op 是**每一次按鍵**都會來一筆，
           * 一次 invalidate 等於一次 `GET /history` 往返。歷史的粒度是「版本」
           * （伺服器把連續編輯折成一段），秒級的即時性完全夠用。
           * 3 秒是刻意選的：比「使用者停下來看面板」快，比「連續打字」慢很多。
           *
           * `invalidateQueries` 只會讓**掛載中的**元件重抓（沒有 listener 的條目
           * 連 data 都直接丟掉），所以面板沒開時這條路是零成本的。
           */
          const now = Date.now();
          if (now - lastHistoryInvalidate > HISTORY_INVALIDATE_THROTTLE_MS) {
            lastHistoryInvalidate = now;
            invalidateQueries(['page', pageId, 'history']);
          }
          optionsRef.current.onRemoteOps?.(ops, meta);
        },
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

    /**
     * ⭐ 第十輪 BUG-52：**只有「在編輯器裡點過一下」的人才會出現在 presence 名單上。**
     *
     * `updatePresence()` 全站只有一個呼叫端：`useEditorHost` 的 `selectionChange`
     * （`features/editor/useEditorHost.ts:344`）。而伺服器的房間只把
     * **送過 `{ t: 'presence' }` 的 session** 放進 `room.presence`
     * （`realtime/room-manager.ts`），所以：
     *   · 純閱讀的人（開著頁面沒點進內文）→ 別人的頭像列上**完全不存在**
     *   · **資料庫頁**（表格 / 看板 / 日曆）根本沒有編輯器 → 一個人都不會顯示，
     *     哪怕五個人同時在改同一張表。這就是「presence 名牌在資料庫儲存格」
     *     這一條走不下去的真正原因：不是名牌沒畫，是**連人都還沒進名單**。
     *
     * 「我在這一頁」和「我的游標在哪」是兩件事，前者在 attach 當下就成立。
     * 這裡在 attach 之後立刻宣告一次「我在，但沒有游標」；
     * 之後編輯器有選取時再用同一支 API 覆蓋上去。
     *
     * 連線還沒好也沒關係：`updatePresence()` 會把它記進 `entry.presence`，
     * `sync-client` 收到 `synced` 時會照著重送一次（見那一支的 `case 'synced'`）。
     */
    sync.updatePresence(pageId, null, null);

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
