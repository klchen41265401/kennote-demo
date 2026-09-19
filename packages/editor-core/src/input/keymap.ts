/**
 * 快捷鍵表。
 *
 * 原則（02 §4.1.6）：所有綁定集中在這裡，不讓各元件自己 addEventListener('keydown')，
 * 否則衝突排查成本極高，也做不出「快捷鍵一覽表」與未來的自訂功能。
 *
 * 內容輸入（文字、Enter、Backspace）一律走 beforeinput，不在這裡處理，
 * 這裡只負責「瀏覽器不會產生 beforeinput 的」行為：導航、選取、格式快捷鍵、undo/redo。
 */
import type { Editor } from '../core.js';
import { blockSelection, textSelection, orderedRange, type EditorSelection } from '../selection/types.js';
import { blockRange, flattenDoc } from '../model/document.js';
import { length as rtLength } from '../text/richtext.js';
import { extendBlockSelection } from '../transaction/builders.js';
import { indent, outdent, toggleMarkCommand } from './commands.js';
import { caretPositionFromPoint, isOnFirstVisualLine, isOnLastVisualLine, rectOfRange } from '../selection/caret.js';
import { domToModel, getContentEl } from '../selection/dom-mapper.js';

export interface KeymapHost {
  /** 上下鍵的水平記憶。 */
  goalX: number | null;
  isComposing: boolean;
  /** 開啟 block selection 模式。 */
  enterBlockMode(blockId: string): void;
  exitBlockMode(): void;
  /** Ctrl/Cmd+A 的連按次數。 */
  selectAllCount: number;
}

function isMod(event: KeyboardEvent): boolean {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  return isMac ? event.metaKey : event.ctrlKey;
}

/** 回傳 true 代表已處理（呼叫端會 preventDefault）。 */
export function handleKeyDown(editor: Editor, host: KeymapHost, event: KeyboardEvent): boolean {
  // IME 組字期間完全不處理（keyCode 229 是各家瀏覽器的共同訊號）
  if (host.isComposing || event.isComposing || event.keyCode === 229) return false;

  const sel = editor.getSelection();
  const mod = isMod(event);

  // 非上下鍵 → 清除 goal column
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') host.goalX = null;
  if (!(mod && (event.key === 'a' || event.key === 'A'))) host.selectAllCount = 0;

  // ── block selection 模式 ──────────────────────────────
  if (sel.type === 'block') {
    switch (event.key) {
      case 'Escape': {
        const id = sel.focusId;
        host.exitBlockMode();
        editor.focusBlock(id, 0);
        return true;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        const dir = event.key === 'ArrowUp' ? -1 : 1;
        if (event.shiftKey) {
          editor.setSelection(extendBlockSelection(editor.getDoc(), sel, dir));
        } else {
          const order = flattenDoc(editor.getDoc());
          const i = order.indexOf(sel.focusId);
          const next = order[Math.max(0, Math.min(order.length - 1, i + dir))];
          if (next) editor.setSelection(blockSelection([next], next, next));
        }
        return true;
      }
      case 'Backspace':
      case 'Delete': {
        editor.deleteBlocks(sel.blockIds);
        host.exitBlockMode();
        return true;
      }
      case 'Enter': {
        const id = sel.focusId;
        host.exitBlockMode();
        const block = editor.getBlock(id);
        editor.focusBlock(id, block ? rtLength(block.content) : 0);
        return true;
      }
      case 'Tab': {
        if (event.shiftKey) outdent(editor);
        else indent(editor);
        return true;
      }
      default:
        break;
    }
    if (mod && (event.key === 'a' || event.key === 'A')) {
      editor.setSelection(blockSelection(flattenDoc(editor.getDoc())));
      return true;
    }
    // Ctrl/Cmd+C、Ctrl/Cmd+X 交給 copy/cut 事件處理
    if (mod && ['c', 'x', 'C', 'X', 'z', 'Z', 'y', 'Y'].includes(event.key)) {
      if (event.key.toLowerCase() === 'z') {
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return true;
      }
      if (event.key.toLowerCase() === 'y') {
        editor.redo();
        return true;
      }
      return false;
    }
    return false;
  }

  // ── text 模式 ────────────────────────────────────────
  if (mod) {
    switch (event.key.toLowerCase()) {
      case 'b':
        return toggleMarkCommand(editor, { t: 'b' }) || true;
      case 'i':
        return toggleMarkCommand(editor, { t: 'i' }) || true;
      case 'u':
        return toggleMarkCommand(editor, { t: 'u' }) || true;
      case 'e':
        return toggleMarkCommand(editor, { t: 'code' }) || true;
      case 'z':
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return true;
      case 'y':
        editor.redo();
        return true;
      case 'a': {
        host.selectAllCount += 1;
        const range = orderedRange(sel);
        if (host.selectAllCount === 1 && range) {
          const block = editor.getBlock(range.blockId);
          if (!block) return false;
          const total = rtLength(block.content);
          // 已經全選了 → 直接升級成整頁 block selection
          if (range.start === 0 && range.end === total) {
            editor.setSelection(blockSelection(flattenDoc(editor.getDoc())));
            return true;
          }
          editor.setSelection(textSelection(range.blockId, 0, total));
          return true;
        }
        editor.setSelection(blockSelection(flattenDoc(editor.getDoc())));
        return true;
      }
      default:
        break;
    }
    if (event.shiftKey && event.key.toLowerCase() === 's') return toggleMarkCommand(editor, { t: 's' }) || true;
  }

  switch (event.key) {
    case 'Escape': {
      if (sel.type !== 'text') return false;
      host.enterBlockMode(sel.focus.blockId);
      return true;
    }
    case 'Tab': {
      if (sel.type !== 'text') return false;
      const ok = event.shiftKey ? outdent(editor) : indent(editor);
      return ok || true; // 即使沒動作也吃掉 Tab，避免焦點跑掉
    }
    case 'ArrowLeft':
      return handleHorizontal(editor, sel, -1, event);
    case 'ArrowRight':
      return handleHorizontal(editor, sel, 1, event);
    case 'ArrowUp':
      return handleVertical(editor, host, sel, -1, event);
    case 'ArrowDown':
      return handleVertical(editor, host, sel, 1, event);
    default:
      return false;
  }
}

function textBlocksInOrder(editor: Editor): string[] {
  const doc = editor.getDoc();
  return flattenDoc(doc).filter((id) => {
    const block = doc.blocks[id];
    return !!block && editor.registry.get(block.type).hasInlineContent;
  });
}

function siblingTextBlock(editor: Editor, blockId: string, dir: -1 | 1): string | null {
  const list = textBlocksInOrder(editor);
  const i = list.indexOf(blockId);
  if (i < 0) return null;
  const next = list[i + dir];
  return next ?? null;
}

function handleHorizontal(editor: Editor, sel: EditorSelection, dir: -1 | 1, event: KeyboardEvent): boolean {
  if (sel.type !== 'text') return false;
  const range = orderedRange(sel);
  if (!range || range.start !== range.end) return false; // 有選取 → 交給瀏覽器
  const block = editor.getBlock(range.blockId);
  if (!block) return false;
  const total = rtLength(block.content);
  const atEdge = dir === -1 ? range.start === 0 : range.start === total;
  if (!atEdge) return false;

  const targetId = siblingTextBlock(editor, range.blockId, dir);
  if (!targetId) return false;

  if (event.shiftKey) {
    // 跨 block 的 shift+方向鍵 → 升級成整塊選取
    editor.setSelection(blockSelection(blockRange(editor.getDoc(), range.blockId, targetId), range.blockId, targetId));
    return true;
  }
  const target = editor.getBlock(targetId)!;
  editor.focusBlock(targetId, dir === -1 ? rtLength(target.content) : 0);
  return true;
}

function handleVertical(editor: Editor, host: KeymapHost, sel: EditorSelection, dir: -1 | 1, event: KeyboardEvent): boolean {
  if (sel.type !== 'text') return false;
  const blockId = sel.focus.blockId;
  const contentEl = editor.view.getContentEl(blockId);
  const range = editor.selection.getCurrentRange();
  if (!contentEl) return false;

  // 軟換行時要靠幾何判斷是否位於首／末行
  if (range) {
    const onEdge = dir === -1 ? isOnFirstVisualLine(contentEl, range) : isOnLastVisualLine(contentEl, range);
    if (!onEdge) return false;
  }

  const targetId = siblingTextBlock(editor, blockId, dir);
  if (!targetId) return false;

  if (event.shiftKey) {
    editor.setSelection(blockSelection(blockRange(editor.getDoc(), blockId, targetId), blockId, targetId));
    return true;
  }

  // goal column：記住使用者「想要的」水平位置
  const caretRect = range ? rectOfRange(range) : null;
  if (host.goalX === null && caretRect) host.goalX = caretRect.left;

  const targetEl = editor.view.getContentEl(targetId);
  const targetBlock = editor.getBlock(targetId);
  if (!targetEl || !targetBlock) return false;

  const goalX = host.goalX;
  if (goalX !== null) {
    const rect = targetEl.getBoundingClientRect();
    const y = dir === -1 ? rect.bottom - 4 : rect.top + 4;
    const pos = caretPositionFromPoint(targetEl.ownerDocument, goalX, y);
    if (pos && targetEl.contains(pos.node)) {
      const contentRoot = getContentEl(editor.view.getBlockEl(targetId)!) ?? targetEl;
      const offset = domToModel(contentRoot, pos.node, pos.offset);
      editor.focusBlock(targetId, offset);
      return true;
    }
  }

  // 沒有幾何資訊（jsdom / 舊瀏覽器）→ 退回首尾
  editor.focusBlock(targetId, dir === -1 ? rtLength(targetBlock.content) : 0);
  return true;
}
