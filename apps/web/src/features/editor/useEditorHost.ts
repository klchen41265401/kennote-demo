/**
 * 編輯器宿主的生命週期（M2-B 交付物 1）。
 *
 * snapshot → EditorDoc → createEditor → localOps → 同步層 → 後端
 *                                    ↖ 遠端 ops ← 同步層
 *
 * 同步層有兩條路（見 README 的「與 sync-client 的接點」）：
 *   1. 預設：`usePageSync`（lib/sync-client.ts，WS 優先 + HTTP 降級 + 離線佇列）
 *   2. 後備：`transport.ts`（純 HTTP，debounce 300ms + rollback），
 *      設 `VITE_EDITOR_HTTP_TRANSPORT=1` 時啟用。WS 不可用的環境（e2e、內網）用得到。
 *   兩者共用同一個出入口：`submitOps()` 與 `applyRemote()`。
 *
 * StrictMode 安全：effect 一定有 cleanup（destroy），且 container 是空 <div>，
 * React 的 diff 永遠進不去 editor-core 管的子樹。
 * 同一頁重新整理不閃爍：doc 以 pageId 為 key 只建一次，snapshot 重新驗證不會重建編輯器。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  createEditor,
  type Block as CoreBlock,
  type Editor,
  type EditorDoc,
  type EditorSelection,
  type OtDelta,
} from '@kennote/editor-core';
import { defaultAtomText, type InlineAtom } from '@kennote/editor-core';

/**
 * atom 的顯示文字（第五輪 BUG-15 的殘留資料修補）。
 *
 * 第四輪把 `MentionMenu` 建 atom 時多加的 `@` 拿掉了，渲染層（`defaultAtomText`）
 * 才是唯一補 `@` 的地方。但**在那之前存下來的** mention，`data.text` 裡本來就有
 * 一個 `@`，重新開頁還是會顯示「@@訪客」。
 *
 * 這裡在渲染時把開頭多出來的 `@` 收掉 —— 純顯示層的修補，不改資料庫裡的內容，
 * 使用者重新編輯那一段時自然會被新的格式覆蓋掉。
 * （editor-core 這一輪不得改動，`createEditor` 的 `inline.atomText` 正好是官方的
 *  覆寫點，不必動套件。）
 */
export function hostAtomText(atom: InlineAtom): string {
  const text = defaultAtomText(atom);
  return atom.atom === 'mention' ? text.replace(/^@{2,}/, '@') : text;
}
import type { Block as ServerBlock, Operation, PageSnapshot } from '@kennote/shared-types';
import { API_ROUTES, blockRevOf, splitDeltaOps } from '@kennote/shared-types';
import { invalidateQueries, setQueryData, useStore } from '@kennote/ui';
import { api } from '../../lib/api-client';
import { createPage, queryKeys } from '../../lib/queries';
import { uploadFile } from '../../lib/upload';
import { getSyncClient, syncStore, usePageSync } from '../../stores/sync';
import {
  getCachedOtFlag,
  OtPageChannel,
  resolveOtEnabled,
  type HealthFeatures,
} from '../../lib/ot-client';
import type { EditorHostApi, UploadedFile } from './context';
import { createHostRegistry } from './blocks/hostRegistry';
import { getCreateDatabase } from './blocks/externalRegistry';
import { createSessionId, createTransport, type Transport, type TransportState } from './transport';
import { toast } from './ui/toast';
import { createId } from '../../lib/sync-client';

/** 想跳過 WebSocket 時設 `VITE_EDITOR_HTTP_TRANSPORT=1` */
const HTTP_FALLBACK = import.meta.env.VITE_EDITOR_HTTP_TRANSPORT === '1';

/**
 * M6 自建 OT（04 §6.6、docs/adr/0006-ot.md）。
 *
 * 開啟條件：`VITE_FEATURE_OT=1`，或伺服器的 `/api/health` 回報 `features.ot === true`。
 * HTTP fallback 模式不支援 OT（它沒有 delta 通道），維持 LWW。
 */
function useOtEnabled(): boolean {
  // 同一個 session 探測過一次就記住 → 只有「第一次載入編輯器」可能在探測回來後重建一次
  const [enabled, setEnabled] = useState(() => getCachedOtFlag() ?? false);
  useEffect(() => {
    if (HTTP_FALLBACK || getCachedOtFlag() !== null) return;
    let alive = true;
    void resolveOtEnabled(() => api.get<{ features?: HealthFeatures }>('/api/health')).then((ok) => {
      if (alive) setEnabled(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  return enabled && !HTTP_FALLBACK;
}

/** snapshot 的每個 block 目前的 OT rev（`blocks.rev`，migration 0030）。 */
export function snapshotRevs(snapshot: PageSnapshot): Record<string, number> {
  const revs: Record<string, number> = {};
  for (const [id, entry] of Object.entries(snapshot.recordMap.block)) {
    const value = entry?.value as ServerBlock | undefined;
    if (value) revs[id] = blockRevOf(value);
  }
  return revs;
}

/** PageSnapshot（record_map 形狀）→ editor-core 的 EditorDoc */
export function snapshotToDoc(snapshot: PageSnapshot): EditorDoc {
  const blocks: Record<string, CoreBlock> = {};
  for (const [id, entry] of Object.entries(snapshot.recordMap.block)) {
    const value = entry?.value as ServerBlock | undefined;
    if (!value) continue;
    blocks[id] = {
      id: value.id,
      parentId: value.parentId,
      type: value.type,
      props: (value.props ?? {}) as Record<string, unknown>,
      content: (value.content ?? []) as CoreBlock['content'],
      children: Array.isArray(value.children) ? value.children.filter((c) => typeof c === 'string') : [],
      version: value.version ?? 1,
    };
  }
  // 防禦：children / rootIds 只保留真的存在的 block（後端資料不一致時不要整頁炸掉）
  for (const block of Object.values(blocks)) {
    block.children = block.children.filter((id) => blocks[id]);
  }
  const rootIds = snapshot.rootBlockIds.filter((id) => blocks[id]);
  return { rootIds, blocks };
}

export interface UseEditorHostOptions {
  pageId: string;
  workspaceId: string | null;
  snapshot: PageSnapshot | undefined;
  readOnly?: boolean;
  navigateToPage(pageId: string): void;
}

export interface EditorHostResult {
  containerRef: RefObject<HTMLDivElement>;
  host: EditorHostApi | null;
  transportState: TransportState;
}

export function useEditorHost(options: UseEditorHostOptions): EditorHostResult {
  const { pageId, workspaceId, snapshot, readOnly = false, navigateToPage } = options;

  const otEnabled = useOtEnabled();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const otChannelRef = useRef<OtPageChannel | null>(null);
  const transportRef = useRef<Transport | null>(null);
  const sessionIdRef = useRef<string>(createSessionId());
  const navigateRef = useRef(navigateToPage);
  navigateRef.current = navigateToPage;

  const [editor, setEditor] = useState<Editor | null>(null);
  const [doc, setDoc] = useState<EditorDoc | null>(null);
  const [rev, setRev] = useState(0);
  /** onResync / rollback 之後 +1，強制以伺服器的 snapshot 重建整頁 */
  const [reloadToken, setReloadToken] = useState(0);
  const [httpState, setHttpState] = useState<TransportState>({
    status: 'idle',
    pending: 0,
    seq: 0,
    lastError: null,
  });

  const seqRef = useRef(snapshot?.seq ?? 0);
  seqRef.current = snapshot?.seq ?? seqRef.current;

  const applyRemote = useCallback((ops: Operation[]) => {
    editorRef.current?.applyRemote(ops as unknown as Parameters<Editor['applyRemote']>[0]);
  }, []);

  const applyRemoteDelta = useCallback((blockId: string, delta: OtDelta) => {
    editorRef.current?.applyRemoteDelta(blockId, delta);
  }, []);

  const reload = useCallback(
    (message?: string) => {
      // BUG-18（伺服器那一半的放大器）：以前這裡只 invalidate 再換 token，重建時吃到的是快取裡的
      // 「舊 snapshot」，使用者剛打的內容整段消失。改成先抓到新鮮的 snapshot 寫進快取，再換 token 重建。
      void (async () => {
        try {
          const fresh = await api.get<PageSnapshot>(API_ROUTES.pageSnapshot(pageId));
          setQueryData<PageSnapshot>(queryKeys.snapshot(pageId), () => fresh);
        } catch {
          invalidateQueries(queryKeys.snapshot(pageId));
        }
        setReloadToken((n) => n + 1);
        if (message) toast(message, { kind: 'info' });
      })();
    },
    [pageId],
  );

  /* ── 同步層（預設走 WS，沒有時 usePageSync(null) 完全惰性）─ */
  const sync = usePageSync(HTTP_FALLBACK ? null : pageId, {
    getLocalSeq: () => seqRef.current,
    onRemoteOps: (ops) => applyRemote(ops),
    onRollback: () => {
      // sync-client 只給我們被拒絕的 ops，沒有 inverse；
      // 最保險的復原是以伺服器為準重抓整頁（這種情況代表有 bug，本來就該現形）
      reload('有變更被伺服器拒絕，已重新載入這一頁');
    },
    onResync: () => setReloadToken((n) => n + 1),
  });
  const syncPending = useStore(syncStore, (s) => s.pending);
  const syncRef = useRef(sync);
  syncRef.current = sync;

  // doc 以 (pageId, reloadToken) 為 key 只建一次 → snapshot revalidate 不會重建編輯器（不閃爍）
  const builtRef = useRef<{ key: string; doc: EditorDoc; seq: number } | null>(null);
  const docKey = `${pageId}:${reloadToken}`;
  let initialDoc: EditorDoc | null = null;
  if (snapshot && snapshot.pageId === pageId) {
    if (builtRef.current?.key === docKey) initialDoc = builtRef.current.doc;
    else {
      initialDoc = snapshotToDoc(snapshot);
      builtRef.current = { key: docKey, doc: initialDoc, seq: snapshot.seq };
    }
  }
  /**
   * ⚠️ 這個值會進下面 useLayoutEffect 的依賴陣列，所以**必須跟 initialDoc 一樣穩定**。
   * 以前這裡直接寫 `snapshot?.seq ?? 0`：只要 snapshot 被重新驗證（改標題 / 改 icon /
   * 改封面都會 `invalidateQueries(snapshot)`），seq 一變 effect 就整段重跑 ——
   * cleanup 砸掉現在的 editor，再用**快取裡那份舊 doc** 重建，
   * 使用者剛打的字就這樣被清空（實測：打完字改標題 → 內文整段消失）。
   * seq 要取「建出這份 doc 的那個 snapshot 的 seq」，兩者本來就該是一組的。
   */
  const initialSeq = builtRef.current?.key === docKey ? builtRef.current.seq : (snapshot?.seq ?? 0);

  /*
   * 第五輪 BUG-20：`readOnly`（鎖定頁面 / 版本預覽 / 權限變更）在下面 effect 的依賴
   * 陣列裡，切換它會把編輯器砸掉重建 —— 而重建吃的是 `builtRef` 裡**載入當下**那份
   * doc，使用者在那之後打的字整段消失（重整才回得來，看起來就是掉資料）。
   *
   * 這裡另外記一份「編輯器現在的 doc」，重建時優先用它。
   * `builtRef` 不能拿來做這件事：`initialDoc` 在 render 階段就已經把它讀走了，
   * 等 cleanup 再寫回去已經來不及。
   */
  const liveDocRef = useRef<{ key: string; doc: EditorDoc } | null>(null);
  /*
   * ⭐ 回歸分診第一輪：重建時**連游標一起接回去**。
   *
   * `otEnabled` 在依賴陣列裡，而 `useOtEnabled()` 第一次載入時是
   * 「先回 false → `/api/health` 探測回來 → setState(true)」——
   * 也就是**每個 session 的第一個編輯器一定會被砸掉重建一次**，時機大約是
   * 開頁後 0.5～2 秒（站台忙的時候更晚）。`liveDocRef` 讓內容活了下來，
   * 但焦點沒有：舊的 contenteditable 被 destroy，焦點掉回 <body>，
   * 使用者在那之後敲的鍵**一個字都不會進編輯器**（不是掉資料，是根本沒收到）。
   *
   * 症狀就是「開頁後馬上打字，前幾個字（或整段）不見」——
   * e2e 的資料庫列整頁那一條踩得最準：它 click 完 600ms 就開始打字。
   *
   * 這裡記下舊實例的 selection，新實例建好之後接回去。
   * 只有「同一個 docKey 的重建」才接 —— 第一次建立時沒有舊 selection，
   * 所以**不會**在開頁時搶焦點。
   */
  const liveSelRef = useRef<{ key: string; sel: EditorSelection } | null>(null);
  const docKeyAtSetup = docKey;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !initialDoc || !pageId) return;
    const startDoc =
      liveDocRef.current?.key === docKeyAtSetup ? liveDocRef.current.doc : initialDoc;

    let transport: Transport | null = null;
    if (HTTP_FALLBACK) {
      transport = createTransport({
        pageId,
        sessionId: sessionIdRef.current,
        initialSeq,
        onStateChange: setHttpState,
        onRollback: (inverseOps) => applyRemote(inverseOps),
        onRemoteOps: (ops) => applyRemote(ops),
        onError: (message) => toast(message, { kind: 'error' }),
      });
      transportRef.current = transport;
    }

    /* ── OT delta 通道（M6）───────────────────────────
     * 開啟時：同一個 block 內的文字變更走 text.delta（OT 三狀態機）
     *         結構變更仍走原本的 tx 通道
     * 關閉時：otChannel 為 null，一切行為與 M5 完全相同
     */
    let otChannel: OtPageChannel | null = null;
    let detachDelta: (() => void) | null = null;
    if (otEnabled && !HTTP_FALLBACK) {
      otChannel = new OtPageChannel({
        submitDelta: (blockId, delta, baseRev) =>
          getSyncClient().submitDelta(pageId, blockId, delta, baseRev),
        applyRemoteDelta: (blockId, delta) => applyRemoteDelta(blockId, delta),
        onDesync: (reason) => reload(`協作狀態需要重新同步（${reason}），已重新載入這一頁`),
      });
      if (snapshot && snapshot.pageId === pageId) otChannel.setInitialRevs(snapshotRevs(snapshot));
      otChannelRef.current = otChannel;
      detachDelta = getSyncClient().attachDeltaChannel(pageId, {
        onAck: (op, txId) => otChannel?.handleAck(op, txId),
        onRemoteDelta: (op) => otChannel?.handleRemote(op),
        onRejected: (blockId, reason) => otChannel?.handleReject(blockId, reason.code),
      });
    }

    const instance = createEditor({
      container,
      doc: startDoc,
      blockRegistry: createHostRegistry(),
      editable: !readOnly,
      // 後端要求 block id 必須是 UUID（v7，與 server 同版面）
      newId: createId,
      inline: { atomText: hostAtomText },
      ...(otChannel
        ? { ot: { enabled: true, getBaseRev: (blockId: string) => otChannel!.getBaseRev(blockId) } }
        : {}),
    });
    editorRef.current = instance;

    const offOps = instance.on('localOps', (ops, tx) => {
      if (transport) {
        transport.push(ops as unknown as Operation[], tx.inverseOps as unknown as Operation[]);
        return;
      }
      if (otChannel) {
        // text.delta → OT 通道（不進 debounce buffer）；其餘 → 原本的 tx 通道。
        // ⭐ 必須**依原順序**分流（ADR 0006 §2.9）：同一批裡可能有
        // `block.insert` / `block.update{blockType}` 排在 `text.delta` 前面，
        // 先把它們放進 tx buffer，`submitDelta()` 才能在送 delta 之前把它們沖出去
        // （否則 delta 會先到伺服器 → BLOCK_NOT_FOUND / 套在舊內容上）。
        for (const group of splitDeltaOps(ops as unknown as Operation[])) {
          const rest = otChannel.submitLocalOps(group.ops);
          if (rest.length > 0) syncRef.current.submit(rest);
        }
        return;
      }
      syncRef.current.submit(ops as unknown as Operation[]);
    });
    const offTx = instance.on('transaction', () => {
      const next = instance.getDoc();
      // 重建（例如切換鎖定）時要從這一份長回來，不是從載入當下那一份
      liveDocRef.current = { key: docKeyAtSetup, doc: next };
      setDoc(next);
      setRev((n) => n + 1);
    });
    // 讓別人看得到我的游標（presence 不進 operation log）
    const offSel = instance.on('selectionChange', (sel) => {
      if (sel.type !== 'none') liveSelRef.current = { key: docKeyAtSetup, sel };
      if (HTTP_FALLBACK) return;
      if (sel.type === 'text') {
        syncRef.current.updatePresence(sel.focus.blockId, [sel.anchor.offset, sel.focus.offset]);
      } else {
        syncRef.current.updatePresence(null, null);
      }
    });

    // 空頁面：補一個段落，讓游標有地方去（這一筆也會被持久化）
    if (startDoc.rootIds.length === 0 && !readOnly) {
      instance.insertBlockAfter(null, { type: 'paragraph' });
    }

    // 重建：把游標接回去（見 liveSelRef 的註解）。第一次建立時 restore 是 null。
    const restore = liveSelRef.current?.key === docKeyAtSetup ? liveSelRef.current.sel : null;
    if (restore && restore.type !== 'none') {
      try {
        instance.setSelection(restore);
      } catch {
        /* 那個 block 可能已經不在了 —— 接不回去就算了，不能讓整頁建不起來 */
      }
    }

    setEditor(instance);
    setDoc(instance.getDoc());
    setRev((n) => n + 1);

    return () => {
      offOps();
      offTx();
      offSel();
      detachDelta?.();
      otChannel?.reset();
      otChannelRef.current = null;
      // 離開頁面前把排隊中的變更送出去
      void (transport ? transport.flush() : syncRef.current.flush()).finally(() => {
        transport?.destroy();
        invalidateQueries(queryKeys.snapshot(pageId));
      });
      instance.destroy();
      editorRef.current = null;
      transportRef.current = null;
      setEditor(null);
      setDoc(null);
    };
    // initialDoc 的 identity 以 (pageId, reloadToken) 為 key 穩定，所以一頁只跑一次
    // （snapshot / reload 是刻意不進依賴陣列的：它們只在建立編輯器的那一刻被讀一次）
    // eslint-disable-next-line react-hooks/exhaustive-deps -- docKeyAtSetup 與 initialDoc 是同一組 key，刻意只讓後者進陣列
  }, [pageId, initialDoc, readOnly, initialSeq, applyRemote, applyRemoteDelta, otEnabled]);

  // 分頁被隱藏 / 關閉 → 立刻沖出去
  useEffect(() => {
    const flush = (): void => {
      void (transportRef.current ? transportRef.current.flush() : syncRef.current.flush());
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const upload = useCallback(
    async (file: File, onProgress?: (percent: number) => void): Promise<UploadedFile> => {
      if (!workspaceId) throw new Error('找不到工作區，無法上傳');
      const handle = uploadFile(workspaceId, file, onProgress ? { onProgress } : {});
      const meta = await handle.promise;
      return {
        id: meta.id,
        url: meta.url,
        name: meta.originalName,
        size: meta.size,
        contentType: meta.contentType,
      };
    },
    [workspaceId],
  );

  const hostApi = useMemo<EditorHostApi | null>(() => {
    if (!editor || !doc) return null;
    const host: EditorHostApi = {
      editor,
      doc,
      rev,
      pageId,
      workspaceId,
      readOnly,
      getBlock: (id) => editor.getBlock(id),
      updateProps(blockId, patch) {
        const block = editor.getBlock(blockId);
        if (!block) return;
        editor.dispatch({
          ops: [{ type: 'block.update', blockId, patch: { props: { ...block.props, ...patch } } }],
          kind: 'structural',
          breakHistory: true,
        });
      },
      setContent(blockId, content) {
        editor.dispatch({ ops: [{ type: 'block.update', blockId, patch: { content } }] });
      },
      setType(blockId, type, props) {
        editor.setBlockType(blockId, type, props);
      },
      insertAfter(afterId, opts) {
        return editor.insertBlockAfter(afterId, opts);
      },
      remove(blockIds) {
        editor.deleteBlocks(blockIds);
      },
      move(blockId, parentId, afterId) {
        editor.moveBlock(blockId, parentId, afterId);
      },
      focus(blockId, offset) {
        editor.focusBlock(blockId, offset ?? 0);
      },
      applyOps(ops) {
        editor.dispatch({
          ops: ops as unknown as Parameters<Editor['dispatch']>[0]['ops'],
          kind: 'structural',
          breakHistory: true,
        });
      },
      navigateToPage: (id) => navigateRef.current(id),
      async createSubPage(blockId) {
        if (!workspaceId) {
          toast('找不到工作區，無法建立子頁面', { kind: 'error' });
          return;
        }
        try {
          const page = await createPage({ workspaceId, parentId: pageId });
          host.updateProps(blockId, { pageId: page.id });
        } catch {
          toast('建立子頁面失敗', { kind: 'error' });
        }
      },
      async createInlineDatabase(blockId) {
        if (!workspaceId) return;
        try {
          const custom = getCreateDatabase();
          if (custom) {
            const created = await custom({ workspaceId, parentId: pageId });
            host.updateProps(blockId, { collectionId: created.collectionId, viewIds: created.viewIds });
            return;
          }
          const result = await api.post<{ collection: { id: string }; views: { id: string }[] }>(
            API_ROUTES.databases,
            { workspaceId, parentId: pageId },
          );
          host.updateProps(blockId, {
            collectionId: result.collection.id,
            viewIds: result.views.map((v) => v.id),
          });
        } catch {
          toast('建立資料庫失敗（資料庫模組可能尚未完成）', { kind: 'error' });
        }
      },
      upload,
    };
    return host;
  }, [editor, doc, rev, pageId, workspaceId, readOnly, upload]);

  const transportState = useMemo<TransportState>(() => {
    if (HTTP_FALLBACK) return httpState;
    return {
      status: syncStatusToTransport(sync.state, syncPending),
      pending: syncPending,
      seq: sync.seq,
      lastError: null,
    };
  }, [httpState, sync.state, sync.seq, syncPending]);

  return { containerRef, host: hostApi, transportState };
}

function syncStatusToTransport(state: string, pending: number): TransportState['status'] {
  switch (state) {
    case 'offline':
      return 'offline';
    case 'connecting':
    case 'authenticating':
    case 'syncing':
    case 'reconnecting':
      return 'saving';
    default:
      return pending > 0 ? 'saving' : 'idle';
  }
}
