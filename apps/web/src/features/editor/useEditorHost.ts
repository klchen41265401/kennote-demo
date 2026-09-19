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
import { createEditor, type Block as CoreBlock, type Editor, type EditorDoc } from '@kennote/editor-core';
import type { Block as ServerBlock, Operation, PageSnapshot } from '@kennote/shared-types';
import { API_ROUTES } from '@kennote/shared-types';
import { invalidateQueries, useStore } from '@kennote/ui';
import { api } from '../../lib/api-client';
import { createPage, queryKeys } from '../../lib/queries';
import { uploadFile } from '../../lib/upload';
import { syncStore, usePageSync } from '../../stores/sync';
import type { EditorHostApi, UploadedFile } from './context';
import { createHostRegistry } from './blocks/hostRegistry';
import { getCreateDatabase } from './blocks/externalRegistry';
import { createSessionId, createTransport, type Transport, type TransportState } from './transport';
import { toast } from './ui/toast';

/** 想跳過 WebSocket 時設 `VITE_EDITOR_HTTP_TRANSPORT=1` */
const HTTP_FALLBACK = import.meta.env.VITE_EDITOR_HTTP_TRANSPORT === '1';

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

  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
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

  const reload = useCallback(
    (message?: string) => {
      invalidateQueries(queryKeys.snapshot(pageId));
      setReloadToken((n) => n + 1);
      if (message) toast(message, { kind: 'info' });
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
  const builtRef = useRef<{ key: string; doc: EditorDoc } | null>(null);
  const docKey = `${pageId}:${reloadToken}`;
  let initialDoc: EditorDoc | null = null;
  if (snapshot && snapshot.pageId === pageId) {
    if (builtRef.current?.key === docKey) initialDoc = builtRef.current.doc;
    else {
      initialDoc = snapshotToDoc(snapshot);
      builtRef.current = { key: docKey, doc: initialDoc };
    }
  }
  const initialSeq = snapshot?.seq ?? 0;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !initialDoc || !pageId) return;

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

    const instance = createEditor({
      container,
      doc: initialDoc,
      blockRegistry: createHostRegistry(),
      editable: !readOnly,
    });
    editorRef.current = instance;

    const offOps = instance.on('localOps', (ops, tx) => {
      if (transport) transport.push(ops as unknown as Operation[], tx.inverseOps as unknown as Operation[]);
      else syncRef.current.submit(ops as unknown as Operation[]);
    });
    const offTx = instance.on('transaction', () => {
      setDoc(instance.getDoc());
      setRev((n) => n + 1);
    });
    // 讓別人看得到我的游標（presence 不進 operation log）
    const offSel = instance.on('selectionChange', (sel) => {
      if (HTTP_FALLBACK) return;
      if (sel.type === 'text') {
        syncRef.current.updatePresence(sel.focus.blockId, [sel.anchor.offset, sel.focus.offset]);
      } else {
        syncRef.current.updatePresence(null, null);
      }
    });

    // 空頁面：補一個段落，讓游標有地方去（這一筆也會被持久化）
    if (initialDoc.rootIds.length === 0 && !readOnly) {
      instance.insertBlockAfter(null, { type: 'paragraph' });
    }

    setEditor(instance);
    setDoc(instance.getDoc());
    setRev((n) => n + 1);

    return () => {
      offOps();
      offTx();
      offSel();
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
  }, [pageId, initialDoc, readOnly, initialSeq, applyRemote]);

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
