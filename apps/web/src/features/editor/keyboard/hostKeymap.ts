/**
 * 宿主層鍵盤快捷鍵（02 §4.1.6 中 editor-core 尚未實作的那幾條）。
 *
 * editor-core 的 keymap 只處理「不牽涉宿主 UI」的行為（導航、選取、格式、undo）。
 * 這裡補的是需要浮層或頁面知識的：
 *   Ctrl+K 連結 / Ctrl+Shift+1~9 轉型別 / Ctrl+Enter 型別相依動作 /
 *   Ctrl+D 複製一份 / Ctrl+Shift+↑↓ 移動 block / Cmd+A 三段式
 *
 * 綁定集中在這一支：禁止各元件自己 addEventListener('keydown')。
 * 用 capture 掛在編輯器外層，確保比 editor-core（掛在 view.root）先跑。
 */
import { useEffect, useRef, type RefObject } from 'react';
import { blockSelection, flattenDoc, length as rtLength, type Editor } from '@kennote/editor-core';
import type { BlockType } from '@kennote/shared-types';
import { duplicateBlockOps } from '../lib/model-helpers';

const TYPE_BY_DIGIT: Record<string, BlockType> = {
  '0': 'paragraph',
  '1': 'heading1',
  '2': 'heading2',
  '3': 'heading3',
  '4': 'bulletedList',
  '5': 'numberedList',
  '6': 'todo',
  '7': 'toggle',
  '8': 'quote',
  '9': 'callout',
};

function isMod(event: KeyboardEvent): boolean {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  return isMac ? event.metaKey : event.ctrlKey;
}

export interface HostKeymapOptions {
  editor: Editor | null;
  readOnly: boolean;
  /** Ctrl+K：請 BubbleMenu 開啟連結輸入 */
  onRequestLink(): void;
  /** 有浮層開著時不要處理（由浮層自己吃掉） */
  isOverlayOpen(): boolean;
}

export function useHostKeymap(
  target: RefObject<HTMLElement | null>,
  { editor, readOnly, onRequestLink, isOverlayOpen }: HostKeymapOptions,
): void {
  const selectAllCount = useRef(0);
  const optionsRef = useRef({ onRequestLink, isOverlayOpen, readOnly });
  optionsRef.current = { onRequestLink, isOverlayOpen, readOnly };

  useEffect(() => {
    const el = target.current;
    if (!el || !editor) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.keyCode === 229) return;
      const { readOnly: ro, onRequestLink: requestLink, isOverlayOpen: overlayOpen } = optionsRef.current;
      const mod = isMod(event);

      if (!(mod && (event.key === 'a' || event.key === 'A'))) selectAllCount.current = 0;
      if (!mod) return;

      // Ctrl/Cmd + A：三段式（02 §4.1.3）
      if (event.key === 'a' || event.key === 'A') {
        const handled = handleSelectAll(editor, selectAllCount.current);
        if (handled) {
          selectAllCount.current += 1;
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (ro) return;

      // Ctrl/Cmd + K：連結
      if ((event.key === 'k' || event.key === 'K') && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        requestLink();
        return;
      }

      // Ctrl/Cmd + D：複製一份
      if ((event.key === 'd' || event.key === 'D') && !event.shiftKey) {
        const ids = selectionIds(editor);
        if (ids.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const doc = editor.getDoc();
        const ops = ids.flatMap((id) => duplicateBlockOps(doc, id, editor.newId).ops);
        if (ops.length > 0) editor.dispatch({ ops, kind: 'structural', breakHistory: true });
        return;
      }

      // Ctrl/Cmd + Enter：型別相依動作
      if (event.key === 'Enter') {
        const ids = selectionIds(editor);
        const id = ids[0];
        if (!id) return;
        const block = editor.getBlock(id);
        if (!block) return;
        if (block.type === 'todo') {
          event.preventDefault();
          event.stopPropagation();
          editor.setBlockType(id, 'todo', { ...block.props, checked: !block.props.checked });
        } else if (block.type === 'toggle') {
          event.preventDefault();
          event.stopPropagation();
          editor.setBlockType(id, 'toggle', { ...block.props, collapsed: !block.props.collapsed });
        }
        return;
      }

      if (!event.shiftKey) return;

      // Ctrl/Cmd + Shift + 1~9 / 0：快速轉型別
      const type = TYPE_BY_DIGIT[event.key];
      if (type) {
        const ids = selectionIds(editor);
        if (ids.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        editor.setBlockType(ids, type);
        return;
      }

      // Ctrl/Cmd + Shift + ↑ / ↓：在同層之間移動 block
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (overlayOpen()) return;
        const ids = selectionIds(editor);
        const id = ids[0];
        if (!id) return;
        event.preventDefault();
        event.stopPropagation();
        moveWithinSiblings(editor, id, event.key === 'ArrowUp' ? -1 : 1);
      }
    };

    el.addEventListener('keydown', onKeyDown, true);
    return () => el.removeEventListener('keydown', onKeyDown, true);
  }, [target, editor]);
}

function selectionIds(editor: Editor): string[] {
  const sel = editor.getSelection();
  if (sel.type === 'block') return sel.blockIds;
  if (sel.type === 'text') return [sel.focus.blockId];
  return [];
}

/**
 * 三段式全選：
 *   1 → 目前 block 全文
 *   2 → 同層（同一個 parent）的所有 block
 *   3 → 整頁
 */
export function handleSelectAll(editor: Editor, pressCount: number): boolean {
  const doc = editor.getDoc();
  const sel = editor.getSelection();
  const focusId = sel.type === 'text' ? sel.focus.blockId : sel.type === 'block' ? sel.focusId : null;
  if (!focusId) return false;

  if (pressCount === 0 && sel.type === 'text') {
    const block = doc.blocks[focusId];
    if (!block) return false;
    const len = rtLength(block.content);
    if (sel.anchor.offset === 0 && sel.focus.offset === len && len > 0) {
      // 已經是全文 → 直接跳到第二段
      return handleSelectAll(editor, 1);
    }
    editor.setSelection({
      type: 'text',
      anchor: { blockId: focusId, offset: 0 },
      focus: { blockId: focusId, offset: len },
    });
    return true;
  }

  if (pressCount <= 1) {
    const block = doc.blocks[focusId];
    const siblings = block?.parentId ? (doc.blocks[block.parentId]?.children ?? []) : doc.rootIds;
    if (siblings.length === 0) return false;
    editor.setSelection(blockSelection(siblings, siblings[0] as string, focusId));
    return true;
  }

  const all = flattenDoc(doc).filter((id) => doc.blocks[id]?.parentId === null);
  if (all.length === 0) return false;
  editor.setSelection(blockSelection(all, all[0] as string, all[all.length - 1] as string));
  return true;
}

function moveWithinSiblings(editor: Editor, blockId: string, delta: number): void {
  const doc = editor.getDoc();
  const block = doc.blocks[blockId];
  if (!block) return;
  const siblings = block.parentId ? (doc.blocks[block.parentId]?.children ?? []) : doc.rootIds;
  const index = siblings.indexOf(blockId);
  if (index < 0) return;
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= siblings.length) return;
  // 往上：放到「上一個兄弟」的前面；往下：放到「下一個兄弟」的後面
  const afterId =
    delta < 0 ? (index - 2 >= 0 ? (siblings[index - 2] as string) : null) : (siblings[index + 1] as string);
  editor.moveBlock(blockId, block.parentId, afterId);
}
