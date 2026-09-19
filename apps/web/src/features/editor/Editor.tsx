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
  type Operation,
} from '@kennote/editor-core';
import type { BlockType, PageSnapshot } from '@kennote/shared-types';
import { EditorHostContext, type EditorHostApi } from './context';
import { useEditorHost } from './useEditorHost';
import type { TransportState } from './transport';
import { BlockPortals } from './blocks/BlockPortals';
import { setUploadProgress } from './blocks/uploadStatus';
import { SlashMenu } from './menus/SlashMenu';
import { BubbleMenu } from './menus/BubbleMenu';
import { BlockHandle } from './menus/BlockHandle';
import { BlockMenu } from './menus/BlockMenu';
import { MentionMenu, type MentionState } from './menus/MentionMenu';
import type { SlashCommand } from './menus/slashCommands';
import { useBlockDrag } from './dnd/useBlockDrag';
import { useHostKeymap } from './keyboard/hostKeymap';
import { consumeTrigger, insertAtom, textBeforeCaret } from './lib/model-helpers';
import { pointRect, rectFromDOMRect, type RectLike } from './lib/floating';
import { overlayDepth, Popover } from './ui/overlay';
import { ToastHost, toast } from './ui/toast';
import { EmojiPicker } from '../../components/EmojiPicker';
import { isImageFile, isVideoFile } from '../../lib/upload';
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

  useEffect(() => {
    onTransportState?.(transportState);
  }, [transportState, onTransportState]);

  /* ── editor-core 的觸發事件 ─────────────────────────── */
  useEffect(() => {
    if (!editor) return;
    const offSlash = editor.on('slashTrigger', (payload) => {
      setSlashState(payload.open ? payload : null);
    });
    const offMention = editor.on('mentionTrigger', (payload) => {
      if (!payload.open) {
        setMentionState((s) => (s?.mode === 'mention' ? null : s));
        return;
      }
      setMentionState({
        mode: 'mention',
        blockId: payload.blockId,
        triggerOffset: payload.triggerOffset,
        triggerLength: 1,
        query: payload.query,
        rect: payload.rect ? rectFromDOMRect(payload.rect) : null,
      });
    });
    const offReconcile = editor.on('reconcile', (payload) => {
      // 開發期把它當錯誤看：代表輸入管線有漏洞
      console.warn('[kennote] reconcile ' + JSON.stringify(payload));
    });
    return () => {
      offSlash();
      offMention();
      offReconcile();
    };
  }, [editor]);

  /* ── `[[` 頁面連結觸發 ──────────────────────────────── */
  useEffect(() => {
    if (!editor) return;
    const off = editor.on('transaction', (tx) => {
      if (tx.source !== 'user' && tx.source !== 'ime') return;
      setMentionState((current) => {
        if (current?.mode === 'page') {
          // 更新 query / 關閉
          const sel = editor.getSelection();
          if (sel.type !== 'text' || sel.focus.blockId !== current.blockId) return null;
          const start = current.triggerOffset + current.triggerLength;
          if (sel.focus.offset < start) return null;
          const block = editor.getBlock(current.blockId);
          if (!block) return null;
          const query = toOffsetText(rtSlice(block.content, start, sel.focus.offset));
          if (/\n/.test(query)) return null;
          const rect = editor.getSelectionRect();
          return { ...current, query, rect: rect ? rectFromDOMRect(rect) : current.rect };
        }
        const before = textBeforeCaret(editor, 2);
        if (!before || before.text !== '[[') return current;
        const rect = editor.getSelectionRect();
        return {
          mode: 'page',
          blockId: before.blockId,
          triggerOffset: before.offset - 2,
          triggerLength: 2,
          query: '',
          rect: rect ? rectFromDOMRect(rect) : null,
        };
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
      if (!state) return;
      const { blockId, triggerOffset, query } = state;
      consumeTrigger(host.editor, blockId, triggerOffset, query);

      const action = command.action;
      if (action.kind === 'color') {
        host.updateProps(blockId, { color: action.color });
        host.focus(blockId, triggerOffset);
        return;
      }

      if (action.kind === 'columns') {
        createColumns(host, blockId, action.count);
        return;
      }

      if (action.kind === 'inline') {
        const rect = host.editor.getSelectionRect();
        const anchor = rect ? rectFromDOMRect(rect) : null;
        if (action.inline === 'date') {
          const today = new Date().toISOString().slice(0, 10);
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

      // block 型別
      const block = host.getBlock(blockId);
      const isEmpty = !block || rtLength(block.content) === 0;
      let targetId = blockId;
      if (action.mode === 'convert' || isEmpty) {
        host.setType(blockId, action.type, action.props);
      } else {
        const created = host.insertAfter(blockId, { type: action.type, props: action.props });
        if (!created) return;
        targetId = created;
      }

      if (action.type === 'page') void host.createSubPage(targetId);
      if (action.type === 'table') seedTable(host, targetId);
      if (host.getBlock(targetId)?.type === action.type && action.type !== 'divider') host.focus(targetId, 0);
    },
    [host, slashState],
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

          <SlashMenu state={slashState} onClose={() => setSlashState(null)} onSelect={runSlashCommand} />

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

/** `/2 欄版面`：建立 columnList + N 個 column，並把目前 block 搬進第一欄 */
function createColumns(host: EditorHostApi, blockId: string, count: number): void {
  const editor = host.editor;
  const block = host.getBlock(blockId);
  if (!block) return;
  const listId = editor.newId();
  const ops: Operation[] = [
    {
      type: 'block.insert',
      blockId: listId,
      parentId: block.parentId,
      afterId: blockId,
      blockType: 'columnList',
      props: {},
      content: [],
    },
  ];
  const ratio = Math.round((1 / count) * 1000) / 1000;
  let prevColumn: string | null = null;
  const columnIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const columnId = editor.newId();
    columnIds.push(columnId);
    ops.push({
      type: 'block.insert',
      blockId: columnId,
      parentId: listId,
      afterId: prevColumn,
      blockType: 'column',
      props: { ratio },
      content: [],
    });
    prevColumn = columnId;
  }
  ops.push({ type: 'block.move', blockId, parentId: columnIds[0] as string, afterId: null });
  for (let i = 1; i < count; i += 1) {
    ops.push({
      type: 'block.insert',
      blockId: editor.newId(),
      parentId: columnIds[i] as string,
      afterId: null,
      blockType: 'paragraph',
      props: {},
      content: [],
    });
  }
  editor.dispatch({ ops, kind: 'structural', breakHistory: true });
}

/** 新表格先給 3 列（含標題列） */
function seedTable(host: EditorHostApi, tableId: string): void {
  const table = host.getBlock(tableId);
  const columnCount = Number(table?.props.columnCount ?? 3);
  const editor = host.editor;
  const ops: Operation[] = [];
  let after: string | null = null;
  for (let i = 0; i < 3; i += 1) {
    const rowId = editor.newId();
    ops.push({
      type: 'block.insert',
      blockId: rowId,
      parentId: tableId,
      afterId: after,
      blockType: 'tableRow',
      props: { cells: Array.from({ length: columnCount }, () => []) },
      content: [],
    });
    after = rowId;
  }
  editor.dispatch({ ops, kind: 'structural', breakHistory: true });
}
