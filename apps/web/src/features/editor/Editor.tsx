/**
 * <Editor> —— 編輯區的唯一協調者（02 §3.4）。
 *
 * 它不畫任何 block 樣式：block 的渲染由 editor-core（可編輯內容）
 * 與 blocks/registry.ts 的 React renderer（不可編輯內容）負責。
 * 這一層只做「協調」：生命週期、浮層、快捷鍵、拖放、貼上檔案。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  deleteRange,
  insertText as rtInsertText,
  length as rtLength,
  slice as rtSlice,
  toOffsetText,
  type InlineAtom,
} from '@kennote/editor-core';
import type { MenuTriggerPayload } from '@kennote/editor-core';
import type { BlockType, PageSnapshot } from '@kennote/shared-types';
import { API_ROUTES } from '@kennote/shared-types';
import { EditorHostContext, type EditorHostApi } from './context';
import { useEditorHost } from './useEditorHost';
import type { TransportState } from './transport';
import { BlockPortals } from './blocks/BlockPortals';
import { setUploadProgress } from './blocks/uploadStatus';
import { SlashMenu } from './menus/SlashMenu';
import { BubbleMenu } from './menus/BubbleMenu';
import { BlockHandle } from './menus/BlockHandle';
import { BlockMenu } from './menus/BlockMenu';
import { MentionMenu, localDateISO, type MentionState } from './menus/MentionMenu';
import { PickerPopover } from './menus/PickerPopover';
import type { DatabaseViewKind, SlashCommand } from './menus/slashCommands';
import {
  blockLink,
  createColumns,
  createDatabase,
  dissolveThinColumnsOps,
  duplicateBlocks,
  importFile,
  resolveDatabasePageId,
  seedSyncedBlock,
  seedTable,
} from './lib/slash-actions';
import { getImportSource } from './lib/embed-services';
import { useBlockDrag } from './dnd/useBlockDrag';
import { useHostKeymap } from './keyboard/hostKeymap';
import { consumeTrigger, insertAtom, textBeforeCaret } from './lib/model-helpers';
import { pointRect, rectFromDOMRect, type RectLike } from './lib/floating';
import { overlayDepth, Popover } from './ui/overlay';
import { ToastHost, toast } from './ui/toast';
import { EmojiPicker } from '../../components/EmojiPicker';
import { isImageFile, isVideoFile } from '../../lib/upload';
import { useWorkspaceTree } from '../../lib/queries';
import { usePresence } from '../../lib/presence';
import { api } from '../../lib/api-client';
import '../../styles/editor.css';

export interface EditorProps {
  pageId: string;
  workspaceId: string | null;
  snapshot: PageSnapshot | undefined;
  readOnly?: boolean;
  onNavigateToPage(pageId: string): void;
  /** App shell 用來顯示「儲存中 / 已儲存」 */
  onTransportState?(state: TransportState): void;
}

interface MenuAnchorState {
  blockIds: string[];
  anchor: RectLike;
}

export function Editor({
  pageId,
  workspaceId,
  snapshot,
  readOnly = false,
  onNavigateToPage,
  onTransportState,
}: EditorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { containerRef, host, transportState } = useEditorHost({
    pageId,
    workspaceId,
    snapshot,
    readOnly,
    navigateToPage: onNavigateToPage,
  });
  const editor = host?.editor ?? null;

  const [slashState, setSlashState] = useState<Parameters<typeof SlashMenu>[0]['state']>(null);
  const [mentionState, setMentionState] = useState<MentionState | null>(null);
  const [blockMenu, setBlockMenu] = useState<MenuAnchorState | null>(null);
  const [linkRequest, setLinkRequest] = useState(0);
  const [emojiTarget, setEmojiTarget] = useState<
    { kind: 'callout' | 'inline'; blockId: string; anchor: RectLike } | null
  >(null);
  const [equationInput, setEquationInput] = useState<{ anchor: RectLike; value: string } | null>(null);
  /** 「連結到頁面」/「資料來源的連結瀏覽模式」的次級面板 */
  const [picker, setPicker] = useState<{
    kind: 'page' | 'database';
    anchor: RectLike;
    blockId: string;
    offset: number;
  } | null>(null);
  /** 使用者主動關掉選單的那個 `/` 位置，避免同一個斜線一直重開 */
  const slashDismissedRef = useRef<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importSourceRef = useRef<string | null>(null);
  const tree = useWorkspaceTree(workspaceId);

  useEffect(() => {
    onTransportState?.(transportState);
  }, [transportState, onTransportState]);

  /* ── editor-core 的觸發事件 ─────────────────────────── */
  useEffect(() => {
    if (!editor) return;
    /*
     * 只吃「開啟」事件。
     *
     * editor-core 的 triggers.ts 只要 query 裡出現任何空白就把 trigger 收掉，
     * 但 Notion 的 `/` 選單是允許空白的（`/標題 1`、`/2 欄`、`/Google Drive`
     * 都要能打完）。那支檔案屬於 OT 代理，所以改成**宿主自己維護 query**：
     * editor-core 負責「什麼時候該開」（行首或空白後的 `/`）與 anchor rect，
     * 之後的 query 由下面的 transaction / selectionChange 重算。
     */
    const offSlash = editor.on('slashTrigger', (payload) => {
      if (!payload.open) return;
      if (slashDismissedRef.current === `${payload.blockId}:${payload.triggerOffset}`) return;
      setSlashState(payload);
    });
    /*
     * ⭐ BUG-16：`@` 不再跟 editor-core 的 `mentionTrigger` 走。
     *
     * `triggers.ts` 只在「行首或空白後」才開，所以「談談@」這種**緊接在文字後面**
     * 的 `@` 完全叫不出選單（Notion 是任何位置都開）；而且它看到 query 裡有空白
     * 就把 trigger 收掉，人員名字有空格就打不完。那支檔案屬於 OT 代理，
     * 所以改成跟 `[[` 同一套：開關與 query 都由宿主自己算（見下面的「行內觸發」）。
     */
    const offReconcile = editor.on('reconcile', (payload) => {
      // 開發期把它當錯誤看：代表輸入管線有漏洞
      console.warn('[kennote] reconcile ' + JSON.stringify(payload));
    });
    return () => {
      offSlash();
      offReconcile();
    };
  }, [editor]);

  /* ── slash 的觸發與 query 由宿主自己算 ───────────────
   * editor-core 的 triggers.ts 有兩條規則與 Notion 不同：
   *   1. `/` 前面不是空白就不開（Notion 在任何文字尾端都會開）
   *   2. query 裡只要有空白就關（Notion 允許 `/標題 1`、`/2 欄`）
   * 那支檔案屬於 OT 代理，所以這裡用 `[[` 同一套做法：聽 transaction 自己算。
   */
  useEffect(() => {
    if (!editor) return;
    const sync = (): void => setSlashState((current) => (current ? recomputeSlash(editor, current) : null));
    const onTransaction = (tx: { source?: string }): void => {
      // 被放棄的那個 `/` 一旦被刪掉，就不必再記著它了
      //（否則在同一個位置重打一次 `/` 會打不開選單）
      if (slashDismissedRef.current && !slashCharAt(editor, slashDismissedRef.current)) {
        slashDismissedRef.current = null;
      }
      setSlashState((current) => {
        if (current) return recomputeSlash(editor, current);
        if (tx.source !== 'user' && tx.source !== 'ime') return null;
        const before = textBeforeCaret(editor, 1);
        if (!before || !SLASH_CHARS.includes(before.text)) return null;
        const triggerOffset = before.offset - 1;
        if (slashDismissedRef.current === `${before.blockId}:${triggerOffset}`) return null;
        const rect = editor.getSelectionRect();
        return { open: true, blockId: before.blockId, triggerOffset, query: '', rect };
      });
    };
    const offTx = editor.on('transaction', onTransaction);
    const offSel = editor.on('selectionChange', sync);
    return () => {
      offTx();
      offSel();
    };
  }, [editor]);

  /* ── ⭐ BUG-17：block selection 模式下鍵盤會整個失聯 ──────
   *
   * Escape 進 block selection 時，editor-core 會把原生 DOM selection 清掉，
   * 於是 `document.activeElement` 掉回 `<body>`。可是它的 keydown listener
   * 掛在 `view.root`（`.kn-editor[data-kn-root]`）上 —— 焦點在 body 時
   * 事件根本不會經過那一層，Shift+↑ 擴選、Backspace 批次刪除、Tab 縮排
   * 全部按了沒反應（選取的藍底還在，看起來像當掉）。
   *
   * editor-core 屬於 OT 代理，所以在宿主這一側補：一進 block 模式就把焦點
   * 放回 editor 的 root（`tabIndex = -1`，mutation guard 的 `attributes: false`
   * 不會把它判成非法變更），鍵盤事件就回得到 editor-core。
   */
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const focusRoot = (): void => {
      if (editor.getSelection().type !== 'block') return;
      const root = containerRef.current?.querySelector<HTMLElement>('[data-kn-root]');
      if (!root) return;
      // ⚠️ 不能用 `root.tabIndex !== -1` 判斷：一般的 div 讀出來本來就是 -1，
      // 但那是「不可聚焦」的 -1，沒有 tabindex 屬性 focus() 會靜靜失敗。
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
      const active = root.ownerDocument.activeElement;
      if (active && root.contains(active)) return;
      root.focus({ preventScroll: true });
    };
    // 立刻試一次 + 排到下一個 task 再試一次：
    // 進 block 模式時 editor-core 會在同一輪裡清掉原生 selection，
    // 只在事件當下 focus 會被後面那一手洗掉。
    const keepFocus = (): void => {
      focusRoot();
      if (timer) clearTimeout(timer);
      timer = setTimeout(focusRoot, 0);
    };
    const offSel = editor.on('selectionChange', keepFocus);
    const offTx = editor.on('transaction', keepFocus);
    return () => {
      if (timer) clearTimeout(timer);
      offSel();
      offTx();
    };
  }, [editor, containerRef]);

  /** 關閉選單並記住這個斜線已經被放棄了 */
  const closeSlash = useCallback(() => {
    setSlashState((current) => {
      if (current) slashDismissedRef.current = `${current.blockId}:${current.triggerOffset}`;
      return null;
    });
  }, []);

  /* ── 行內觸發：`@` 提及 與 `[[` 頁面連結 ──────────────
   * 兩個都由宿主自己算（理由見上面 BUG-16 的註解）。`[[` 先比，兩者不會互搶。
   */
  useEffect(() => {
    if (!editor) return;
    const off = editor.on('transaction', (tx) => {
      if (tx.source !== 'user' && tx.source !== 'ime') return;
      setMentionState((current) => {
        if (current) {
          // 更新 query / 關閉
          const sel = editor.getSelection();
          if (sel.type !== 'text' || sel.focus.blockId !== current.blockId) return null;
          const start = current.triggerOffset + current.triggerLength;
          if (sel.focus.offset < start) return null;
          const block = editor.getBlock(current.blockId);
          if (!block) return null;
          const query = toOffsetText(rtSlice(block.content, start, sel.focus.offset));
          if (/\n/.test(query) || [...query].length > 40) return null;
          const rect = editor.getSelectionRect();
          return { ...current, query, rect: rect ? rectFromDOMRect(rect) : current.rect };
        }
        const two = textBeforeCaret(editor, 2);
        if (two && two.text === '[[') {
          const rect = editor.getSelectionRect();
          return {
            mode: 'page',
            blockId: two.blockId,
            triggerOffset: two.offset - 2,
            triggerLength: 2,
            query: '',
            rect: rect ? rectFromDOMRect(rect) : null,
          };
        }
        const one = textBeforeCaret(editor, 1);
        if (one && MENTION_CHARS.includes(one.text)) {
          const rect = editor.getSelectionRect();
          return {
            mode: 'mention',
            blockId: one.blockId,
            triggerOffset: one.offset - 1,
            triggerLength: 1,
            query: '',
            rect: rect ? rectFromDOMRect(rect) : null,
          };
        }
        return current;
      });
    });
    return off;
  }, [editor]);

  /* ── 拖曳 ───────────────────────────────────────────── */
  const getSelectedIds = useCallback(() => {
    if (!editor) return [];
    const sel = editor.getSelection();
    return sel.type === 'block' ? sel.blockIds : [];
  }, [editor]);
  const { drag, startDrag } = useBlockDrag({ editor, readOnly, getSelectedIds });

  /* ── 快捷鍵 ─────────────────────────────────────────── */
  useHostKeymap(wrapperRef, {
    editor,
    readOnly,
    onRequestLink: () => setLinkRequest((n) => n + 1),
    isOverlayOpen: () => overlayDepth() > 0,
  });

  /* ── 貼上 / 拖放檔案 ────────────────────────────────── */
  const insertFiles = useCallback(
    async (files: File[], afterBlockId: string | null) => {
      if (!host || files.length === 0) return;
      let anchorId = afterBlockId;
      for (const file of files) {
        const type: BlockType = isImageFile(file) ? 'image' : isVideoFile(file) ? 'video' : 'file';
        const blockId = host.insertAfter(anchorId, {
          type,
          props: { fileId: null, externalUrl: null, name: file.name, size: file.size },
        });
        if (!blockId) continue;
        anchorId = blockId;
        setUploadProgress(blockId, 0);
        try {
          const meta = await host.upload(file, (percent) => setUploadProgress(blockId, percent));
          host.updateProps(blockId, {
            fileId: meta.id,
            externalUrl: null,
            name: meta.name,
            size: meta.size,
          });
        } catch (error) {
          toast(error instanceof Error ? error.message : '上傳失敗', { kind: 'error' });
        } finally {
          setUploadProgress(blockId, null);
        }
      }
    },
    [host],
  );

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !host || readOnly) return;

    const currentBlockId = (): string | null => {
      const sel = host.editor.getSelection();
      if (sel.type === 'text') return sel.focus.blockId;
      if (sel.type === 'block') return sel.focusId;
      return host.doc.rootIds[host.doc.rootIds.length - 1] ?? null;
    };

    const onPaste = (event: ClipboardEvent): void => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void insertFiles(files, currentBlockId());
    };

    const onDragOver = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      el.setAttribute('data-file-drop', 'true');
    };
    const onDragLeave = (): void => el.removeAttribute('data-file-drop');
    const onDrop = (event: DragEvent): void => {
      const files = [...(event.dataTransfer?.files ?? [])];
      el.removeAttribute('data-file-drop');
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.target instanceof Element ? event.target.closest('[data-block-id]') : null;
      void insertFiles(files, target?.getAttribute('data-block-id') ?? currentBlockId());
    };

    // capture：要比 editor-core 掛在 view.root 的 paste handler 先跑
    el.addEventListener('paste', onPaste, true);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('paste', onPaste, true);
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, [host, readOnly, insertFiles]);

  /* ── slash 指令執行 ─────────────────────────────────── */
  const runSlashCommand = useCallback(
    (command: SlashCommand) => {
      if (!host) return;
      const state = slashState;
      setSlashState(null);
      slashDismissedRef.current = null;
      if (!state) return;
      const { blockId, triggerOffset, query } = state;
      consumeTrigger(host.editor, blockId, triggerOffset, query);

      const action = command.action;
      const anchorRect = (): RectLike | null => {
        const rect = host.editor.getSelectionRect();
        return rect ? rectFromDOMRect(rect) : null;
      };

      switch (action.kind) {
        case 'color': {
          host.updateProps(blockId, { color: action.color });
          host.focus(blockId, triggerOffset);
          return;
        }

        case 'columns': {
          createColumns(host, blockId, action.count);
          return;
        }

        case 'inline': {
          const anchor = anchorRect();
          if (action.inline === 'date') {
            const today = localDateISO();
            insertAtom(host.editor, { atom: 'date', data: { date: today, text: today } });
            return;
          }
          if (action.inline === 'emoji' && anchor) {
            setEmojiTarget({ kind: 'inline', blockId, anchor });
            return;
          }
          if (action.inline === 'equation' && anchor) {
            setEquationInput({ anchor, value: '' });
            return;
          }
          setMentionState({
            mode: action.inline === 'pageLink' ? 'page' : 'mention',
            blockId,
            triggerOffset,
            triggerLength: 0,
            query: '',
            rect: anchor,
          });
          return;
        }

        case 'linkToPage':
        case 'linkDatabase': {
          const anchor = anchorRect();
          if (!anchor) {
            toast('找不到游標位置，請再試一次', { kind: 'error' });
            return;
          }
          setPicker({
            kind: action.kind === 'linkToPage' ? 'page' : 'database',
            anchor,
            blockId,
            offset: triggerOffset,
          });
          return;
        }

        case 'database': {
          void runCreateDatabase(host, blockId, action.mode, action.view, onNavigateToPage);
          return;
        }

        case 'embed': {
          insertOrConvert(host, blockId, 'embed', { url: '', service: action.service });
          return;
        }

        case 'import': {
          const source = getImportSource(action.source);
          importSourceRef.current = action.source;
          const input = importInputRef.current;
          if (!input) return;
          input.accept = source?.accept ?? '';
          input.click();
          return;
        }

        case 'blockAction': {
          runBlockAction(host, blockId, action.action);
          return;
        }

        case 'soon': {
          toast(`「${action.feature}」即將推出`, { kind: 'info' });
          host.focus(blockId, triggerOffset);
          return;
        }

        case 'block': {
          const targetId = insertOrConvert(host, blockId, action.type, action.props, action.mode);
          if (!targetId) return;
          if (action.type === 'page') void host.createSubPage(targetId);
          if (action.type === 'table') seedTable(host, targetId);
          if (action.type === 'syncedBlock') seedSyncedBlock(host, targetId);
          if (host.getBlock(targetId)?.type === action.type && action.type !== 'divider') {
            host.focus(targetId, 0);
          }
          return;
        }

        default:
          return;
      }
    },
    [host, slashState, onNavigateToPage],
  );

  /* ── 匯入：選好檔案 → POST /api/import ───────────────── */
  const onImportFile = useCallback(
    async (file: File) => {
      if (!host) return;
      const source = getImportSource(importSourceRef.current);
      const id = toast(`正在匯入 ${file.name}…`, { kind: 'info' });
      void id;
      try {
        const result = await importFile(host, file);
        toast(`匯入完成，新增了 ${result.pages} 頁`, { kind: 'success' });
        if (result.firstPageId) onNavigateToPage(result.firstPageId);
      } catch (error) {
        const hint = source && !source.native ? `（${source.hint}）` : '';
        toast(`${error instanceof Error ? error.message : '匯入失敗'}${hint}`, { kind: 'error' });
      }
    },
    [host, onNavigateToPage],
  );

  /* ── mention 選定 ───────────────────────────────────── */
  const commitMention = useCallback(
    (atom: InlineAtom) => {
      if (!host || !mentionState) return;
      const { blockId, triggerOffset, triggerLength, query } = mentionState;
      setMentionState(null);
      if (triggerLength > 0) {
        const block = host.getBlock(blockId);
        if (block) {
          const to = triggerOffset + triggerLength + [...query].length;
          host.editor.dispatch({
            ops: [
              {
                type: 'block.update',
                blockId,
                patch: { content: deleteRange(block.content, triggerOffset, to) },
              },
            ],
            kind: 'structural',
            breakHistory: true,
            selectionAfter: {
              type: 'text',
              anchor: { blockId, offset: triggerOffset },
              focus: { blockId, offset: triggerOffset },
            },
          });
        }
      }
      insertAtom(host.editor, atom);
    },
    [host, mentionState],
  );

  /* ── callout icon 點擊 → emoji picker ───────────────── */
  const onWrapperClick = useCallback(
    (event: ReactMouseEvent) => {
      if (!host || readOnly) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const icon = target.closest<HTMLElement>('[data-callout-icon]');
      if (!icon) return;
      const blockEl = icon.closest('[data-block-id]');
      const blockId = blockEl?.getAttribute('data-block-id');
      if (!blockId) return;
      event.preventDefault();
      setEmojiTarget({ kind: 'callout', blockId, anchor: rectFromDOMRect(icon.getBoundingClientRect()) });
    },
    [host, readOnly],
  );

  /* ── 摺疊標題的箭頭 ─────────────────────────────────
   * editor-core 的 controller 看到 `data-toggle-arrow` 會把 block 轉成 toggle，
   * 所以可收合的標題改用 `data-heading-toggle`，由宿主在 capture 階段處理。
   */
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !host || readOnly) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const arrow = target.closest('[data-heading-toggle]');
      if (!arrow) return;
      const blockId = arrow.closest('[data-block-id]')?.getAttribute('data-block-id');
      if (!blockId) return;
      event.preventDefault();
      event.stopPropagation();
      const block = host.getBlock(blockId);
      if (block) host.updateProps(blockId, { collapsed: !block.props.collapsed });
    };
    el.addEventListener('pointerdown', onPointerDown, true);
    return () => el.removeEventListener('pointerdown', onPointerDown, true);
  }, [host, readOnly]);

  /**
   * ⭐ 在「自己有 UI 的 React block」裡面點一下時，不要把整塊選起來。
   *
   * `editor-core` 的 input controller 看到 pointerdown 落在「沒有 inline content」的 block
   * 上就會 `setSelection(blockSelection([id]))` —— 對圖片、書籤這種**整塊就是一個物件**的
   * block 是對的，但內嵌資料庫（collectionView）、簡易表格、按鈕這幾種**裡面還有互動元件**，
   * 點一顆工具列按鈕就讓整張表蓋上一層藍色半透明（`data-selected`）完全不是 Notion 的行為
   * （07c / 07d / 07k…的截圖就是整張表被塗藍）。
   *
   * 不能在這裡 `stopPropagation()`：React 18 的事件監聽掛在 root container（本元素的祖先），
   * 攔下來連元件自己的 onClick 都會消失。所以改成「讓它選，下一個 microtask 再取消」。
   */
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !editor) return;
    const INTERACTIVE = new Set(['collectionView', 'table', 'button', 'syncedBlock']);
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const container = target.closest('[data-kn-react-block]');
      const type = container?.getAttribute('data-kn-react-block');
      if (!type || !INTERACTIVE.has(type)) return;
      const blockId = container?.closest('[data-block-id]')?.getAttribute('data-block-id');
      const sel = editor.getSelection();
      if (sel.type === 'block' && sel.blockIds.length === 1 && sel.blockIds[0] === blockId) {
        editor.setSelection({ type: 'none' });
      }
    };
    // ⚠️ 掛在 **bubble** 階段：editor-core 的監聽器掛在 editor root（本元素的子孫），
    // bubble 是由內往外跑，所以這裡一定在它之後執行，看得到它剛設好的選取。
    // 用 capture + queueMicrotask 不行 —— microtask checkpoint 會在「每個監聽器之間」
    // 就排空，等於還是搶在 editor-core 前面跑。
    el.addEventListener('pointerdown', onPointerDown);
    return () => el.removeEventListener('pointerdown', onPointerDown);
  }, [editor]);

  /* ── 多欄版面的整潔度：少於 2 欄就自動解散（Notion 行為）── */
  useEffect(() => {
    if (!host || readOnly) return;
    const ops = dissolveThinColumnsOps(host.doc);
    if (ops.length > 0) host.applyOps(ops);
  }, [host, readOnly]);

  /* ── 右鍵選單 ───────────────────────────────────────── */
  const onContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (!host || readOnly) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const blockEl = target.closest('[data-block-id]');
      const blockId = blockEl?.getAttribute('data-block-id');
      if (!blockId) return;
      event.preventDefault();
      const selected = getSelectedIds();
      setBlockMenu({
        blockIds: selected.includes(blockId) ? selected : [blockId],
        anchor: pointRect(event.clientX, event.clientY),
      });
    },
    [host, readOnly, getSelectedIds],
  );

  /** 「轉換成」分組只在目前 block 有內容時出現（Notion 的行為） */
  const slashBlockHasContent = useMemo(() => {
    if (!host || !slashState) return false;
    const block = host.getBlock(slashState.blockId);
    if (!block) return false;
    // 觸發字串（`/xxx`）本身不算內容
    return rtLength(block.content) - 1 - [...slashState.query].length > 0;
  }, [host, slashState]);

  /**
   * `/` 打下去、還沒打搜尋字時，Notion 會在游標後面顯示灰字「輸入以搜尋」
   * （06-slash-menu-light.png）。
   *
   * 不能插 DOM 節點 —— 那會被 editor-core 的 mutation guard 判成非法變更，
   * 也會弄髒 model。所以只掛一個 `data-slash-hint` 屬性，字由 CSS 的
   * `::after` 畫（pseudo element 不在 DOM tree 裡，contenteditable 碰不到）。
   */
  useEffect(() => {
    const root = wrapperRef.current;
    if (!root) return undefined;
    if (!slashState || slashState.query !== '') return undefined;
    const target = root.querySelector<HTMLElement>(
      `[data-block-id="${slashState.blockId}"] [data-block-content]`,
    );
    if (!target) return undefined;
    target.setAttribute('data-slash-hint', 'true');
    return () => target.removeAttribute('data-slash-hint');
  }, [slashState]);

  /**
   * Presence：別人所在 block 的淡色外框 + 名牌（`lib/README-sync.md` §5）。
   *
   * `decorate()` 直接改 DOM（加 class / 補一個 `span.kn-presence-label`），
   * 所以掛在 `kn-editor-host` **外面**那一層 —— editor-core 的 mutation guard
   * 只盯著它自己的子樹，名牌加在 block 的最外層元素上不會被判成非法變更。
   * peers 或文件結構一變就重畫（presence 變動頻繁，重畫比 diff 划算）。
   */
  const { decorate } = usePresence(pageId);
  useEffect(() => decorate(wrapperRef.current), [decorate, host?.rev]);

  const empty = useMemo(() => {
    if (!host) return false;
    const ids = host.doc.rootIds;
    if (ids.length !== 1) return false;
    const only = host.doc.blocks[ids[0] as string];
    return !!only && only.type === 'paragraph' && rtLength(only.content) === 0;
  }, [host]);

  return (
    <div
      className="kn-editor-shell"
      ref={wrapperRef}
      data-empty={empty ? 'true' : undefined}
      onClick={onWrapperClick}
      onContextMenu={onContextMenu}
    >
      {/* ⭐ 永遠是同一個空 div：React 的 diff 進不去 editor-core 的子樹 */}
      <div className="kn-editor-host" ref={containerRef} />

      {host ? (
        <EditorHostContext.Provider value={host}>
          <BlockPortals />

          <BlockHandle
            host={host}
            wrapperRef={wrapperRef}
            dragging={drag !== null}
            onStartDrag={startDrag}
            onOpenMenu={(blockId, anchor) => setBlockMenu({ blockIds: [blockId], anchor })}
          />

          <SlashMenu
            state={slashState}
            blockHasContent={slashBlockHasContent}
            onClose={closeSlash}
            onSelect={runSlashCommand}
          />

          {/* 連結到頁面 / 連結既有資料來源 */}
          <PickerPopover
            anchor={picker?.anchor ?? null}
            open={picker !== null}
            title={picker?.kind === 'database' ? '選擇資料來源' : '連結到頁面'}
            placeholder={picker?.kind === 'database' ? '搜尋資料庫…' : '搜尋頁面…'}
            databasesOnly={picker?.kind === 'database'}
            nodes={tree.data ?? []}
            loading={tree.isLoading}
            onClose={() => setPicker(null)}
            onSelect={(node) => {
              const current = picker;
              setPicker(null);
              if (!current) return;
              if (current.kind === 'page') {
                const created = insertOrConvert(host, current.blockId, 'page', { pageId: node.id });
                if (created) host.focus(created, 0);
                return;
              }
              void linkExistingDatabase(host, current.blockId, node.id);
            }}
          />

          {/* 匯入：隱藏的檔案選擇器（accept 由選到的來源決定） */}
          <input
            ref={importInputRef}
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void onImportFile(file);
            }}
          />

          <MentionMenu
            state={mentionState}
            workspaceId={workspaceId}
            onClose={() => setMentionState(null)}
            onSelect={commitMention}
          />

          <BubbleMenu
            editor={host.editor}
            rev={host.rev}
            readOnly={readOnly}
            linkRequest={linkRequest}
            onConvert={(type) => {
              const ids = getSelectedIds();
              const sel = host.editor.getSelection();
              const target = ids.length > 0 ? ids : sel.type === 'text' ? [sel.focus.blockId] : [];
              if (target.length > 0) host.setType(target, type);
            }}
            onColor={(color) => {
              const sel = host.editor.getSelection();
              const ids = getSelectedIds();
              const target = ids.length > 0 ? ids : sel.type === 'text' ? [sel.focus.blockId] : [];
              for (const id of target) host.updateProps(id, { color });
            }}
          />

          <BlockMenu
            host={host}
            anchor={blockMenu?.anchor ?? null}
            blockIds={blockMenu?.blockIds ?? []}
            onClose={() => setBlockMenu(null)}
          />

          {/* emoji：callout 圖示 / 行內插入 */}
          <Popover
            anchor={emojiTarget?.anchor ?? null}
            open={emojiTarget !== null}
            onClose={() => setEmojiTarget(null)}
            className="kn-popover--emoji"
            role="dialog"
            allowFocus
            ariaLabel="選擇 emoji"
          >
            <EmojiPicker
              onSelect={(emoji) => {
                if (!emojiTarget) return;
                if (emojiTarget.kind === 'callout') host.updateProps(emojiTarget.blockId, { icon: emoji });
                else insertEmojiAtCaret(host, emoji);
                setEmojiTarget(null);
              }}
              onRemove={
                emojiTarget?.kind === 'callout'
                  ? () => {
                      host.updateProps(emojiTarget.blockId, { icon: '' });
                      setEmojiTarget(null);
                    }
                  : undefined
              }
            />
          </Popover>

          {/* 行內公式輸入 */}
          <Popover
            anchor={equationInput?.anchor ?? null}
            open={equationInput !== null}
            onClose={() => setEquationInput(null)}
            className="kn-popover--link"
            role="dialog"
            allowFocus
            ariaLabel="行內公式"
          >
            <form
              className="kn-link-form"
              onSubmit={(e) => {
                e.preventDefault();
                const value = equationInput?.value.trim() ?? '';
                setEquationInput(null);
                if (value) {
                  insertAtom(host.editor, { atom: 'equation', data: { expression: value, text: `$${value}$` } });
                }
              }}
            >
              <input
                className="kn-menu-search-input kn-input--mono"
                autoFocus
                value={equationInput?.value ?? ''}
                placeholder="LaTeX，例如 E = mc^2"
                onChange={(e) => setEquationInput((s) => (s ? { ...s, value: e.target.value } : s))}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button type="submit" className="kn-btn kn-btn--primary kn-btn--sm">
                插入
              </button>
            </form>
          </Popover>
        </EditorHostContext.Provider>
      ) : null}

      {/* 拖放指示線與幽靈元素（固定定位，掛在 body） */}
      {drag
        ? createPortal(
            <>
              {drag.indicator ? (
                <div
                  className="kn-drop-indicator"
                  data-vertical={drag.indicator.vertical ? 'true' : undefined}
                  style={{
                    top: drag.indicator.top,
                    left: drag.indicator.left,
                    width: drag.indicator.width,
                    height: drag.indicator.height,
                  }}
                />
              ) : null}
              <div className="kn-drag-ghost" style={{ top: drag.pointer.y + 12, left: drag.pointer.x + 12 }}>
                {drag.label}
              </div>
            </>,
            document.body,
          )
        : null}

      <ToastHost />
    </div>
  );
}

/* ── 小工具 ─────────────────────────────────────────── */

function insertEmojiAtCaret(host: EditorHostApi, emoji: string): void {
  const sel = host.editor.getSelection();
  if (sel.type !== 'text') return;
  const block = host.getBlock(sel.focus.blockId);
  if (!block) return;
  const content = rtInsertText(block.content, sel.focus.offset, emoji);
  const after = sel.focus.offset + [...emoji].length;
  host.editor.dispatch({
    ops: [{ type: 'block.update', blockId: block.id, patch: { content } }],
    kind: 'insertText',
    selectionAfter: {
      type: 'text',
      anchor: { blockId: block.id, offset: after },
      focus: { blockId: block.id, offset: after },
    },
  });
}

/* ── slash 指令用的小工具 ───────────────────────────── */

const SLASH_CHARS = ['/', '／', '、'];
/** `@` 的觸發字元（與 editor-core `triggers.ts` 的 MENTION_CHARS 一致） */
const MENTION_CHARS = ['@', '＠'];

/** `"<blockId>:<offset>"` 這個位置現在還是不是一個斜線？ */
function slashCharAt(editor: EditorHostApi['editor'], key: string): boolean {
  const index = key.lastIndexOf(':');
  if (index < 0) return false;
  const blockId = key.slice(0, index);
  const offset = Number(key.slice(index + 1));
  if (!Number.isFinite(offset)) return false;
  const block = editor.getBlock(blockId);
  if (!block) return false;
  return SLASH_CHARS.includes(toOffsetText(rtSlice(block.content, offset, offset + 1)));
}

/**
 * 重算 slash 選單的 query（取代 editor-core 的 triggers.update）。
 *
 * 關閉條件：游標離開該 block、游標跑到 `/` 前面、`/` 被刪掉、
 * 換行，或「`/` 後面第一個字就是空白」（那代表使用者只是想打一個斜線）。
 * **query 中間的空白不關**——`/標題 1` 必須打得完。
 */
function recomputeSlash(editor: EditorHostApi['editor'], state: MenuTriggerPayload): MenuTriggerPayload | null {
  const sel = editor.getSelection();
  if (sel.type !== 'text' || sel.focus.blockId !== state.blockId) return null;
  const block = editor.getBlock(state.blockId);
  if (!block) return null;
  const caret = sel.focus.offset;
  if (caret <= state.triggerOffset) return null;
  const trigger = toOffsetText(rtSlice(block.content, state.triggerOffset, state.triggerOffset + 1));
  if (!SLASH_CHARS.includes(trigger)) return null;
  const query = toOffsetText(rtSlice(block.content, state.triggerOffset + 1, caret));
  if (query.includes('\n') || query.includes('\r')) return null;
  if (/^\s/.test(query)) return null;
  return { ...state, open: true, query };
}

/**
 * 轉換目前 block，或在它下面插一個新的。
 * 規則照 Notion：目前 block 是空的就直接「變成」那個型別（不留空段落）。
 */
function insertOrConvert(
  host: EditorHostApi,
  blockId: string,
  type: BlockType,
  props?: Record<string, unknown>,
  mode: 'convert' | 'insert' = 'insert',
): string | null {
  const block = host.getBlock(blockId);
  const isEmpty = !block || rtLength(block.content) === 0;
  if (mode === 'convert' || isEmpty) {
    host.setType(blockId, type, props);
    return blockId;
  }
  return host.insertAfter(blockId, { type, ...(props ? { props } : {}) });
}

/** 資料庫：內嵌 → collectionView block；整頁 → 子頁面連結 */
async function runCreateDatabase(
  host: EditorHostApi,
  blockId: string,
  mode: 'inline' | 'fullPage',
  view: DatabaseViewKind,
  navigate: (pageId: string) => void,
): Promise<void> {
  try {
    const created = await createDatabase(host, { view, inline: mode === 'inline' });
    if (mode === 'inline') {
      const targetId = insertOrConvert(host, blockId, 'collectionView', {
        collectionId: created.collectionId,
        viewIds: created.viewIds,
      });
      if (targetId) host.focus(targetId, 0);
      return;
    }
    const pageId = created.pageId ?? (await resolveDatabasePageId(created.collectionId));
    if (!pageId) {
      toast('資料庫建立成功，但找不到對應的頁面', { kind: 'error' });
      return;
    }
    const targetId = insertOrConvert(host, blockId, 'page', { pageId });
    if (targetId) navigate(pageId);
  } catch (error) {
    toast(error instanceof Error ? error.message : '建立資料庫失敗', { kind: 'error' });
  }
}

/** 「動作」分組：與 block handle 選單共用同一套行為 */
function runBlockAction(
  host: EditorHostApi,
  blockId: string,
  action: 'copyLink' | 'duplicate' | 'moveTo' | 'delete',
): void {
  switch (action) {
    case 'copyLink':
      void navigator.clipboard
        ?.writeText(blockLink(blockId))
        .then(() => toast('已複製區塊連結', { kind: 'success' }))
        .catch(() => toast('複製失敗', { kind: 'error' }));
      return;
    case 'duplicate':
      duplicateBlocks(host, [blockId]);
      return;
    case 'moveTo':
      toast('跨頁面搬移會在 M3（頁面樹）開放', { kind: 'info' });
      return;
    case 'delete':
      host.remove([blockId]);
      return;
    default:
      return;
  }
}

/** 「資料來源的連結瀏覽模式」：把既有資料庫掛進 collectionView block */
async function linkExistingDatabase(host: EditorHostApi, blockId: string, pageId: string): Promise<void> {
  try {
    const page = await api.get<{ collectionId?: string | null }>(API_ROUTES.page(pageId));
    if (!page.collectionId) {
      toast('這一頁不是資料庫', { kind: 'error' });
      return;
    }
    const views = await api.get<{ id: string }[]>(API_ROUTES.databaseViews(page.collectionId));
    const created = insertOrConvert(host, blockId, 'collectionView', {
      collectionId: page.collectionId,
      viewIds: views.map((v) => v.id),
    });
    if (created) host.focus(created, 0);
  } catch (error) {
    toast(error instanceof Error ? error.message : '連結資料庫失敗', { kind: 'error' });
  }
}
