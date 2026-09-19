/**
 * 編輯命令：把「使用者意圖」變成 transaction。
 *
 * beforeinput 分派表與 keymap 都呼叫這裡，確保同一個行為只有一份實作
 * （例如 Backspace 可能來自 deleteContentBackward，也可能來自 keydown fallback）。
 */
import type { BlockType, Mark, RichText } from '../model/types.js';
import type { Editor } from '../core.js';
import type { EditorDoc } from '../model/types.js';
import type { Operation } from '../transaction/operation.js';
import { applyOps } from '../transaction/apply.js';
import { orderedRange, textSelection, type EditorSelection } from '../selection/types.js';
import {
  deleteRangeOps,
  exitBlockOps,
  indentOps,
  insertInlineOps,
  insertTextOps,
  mergeBackwardOps,
  mergeForwardOps,
  outdentOps,
  splitBlockOps,
  toggleMarkOps,
} from '../transaction/builders.js';
import { inheritMarksAt, length as rtLength, toOffsetText } from '../text/richtext.js';
import { nextGrapheme, nextWordBoundary, prevGrapheme, prevWordBoundary } from '../text/grapheme.js';

export interface ActiveRange {
  blockId: string;
  start: number;
  end: number;
  collapsed: boolean;
}

export function activeRange(editor: Editor): ActiveRange | null {
  const range = orderedRange(editor.getSelection());
  if (!range) return null;
  if (!editor.getBlock(range.blockId)) return null;
  return { ...range, collapsed: range.start === range.end };
}

/** 插入文字（會先刪掉選取範圍），並套用 markdown 行內捷徑。 */
export function insertText(editor: Editor, text: string, options?: { marks?: Mark[]; skipInputRules?: boolean }): boolean {
  const range = activeRange(editor);
  if (!range) return false;
  const block = editor.getBlock(range.blockId)!;
  const marks = options?.marks ?? (range.collapsed ? inheritMarksAt(block.content, range.start) : undefined);
  const built = insertTextOps(editor.getDoc(), range.blockId, range.start, range.end, text, marks);
  const ok = editor.dispatchBuild(built, { kind: 'insertText', source: 'user' });
  return ok;
}

/** 插入 inline 內容（atom / 片段）。 */
export function insertInline(editor: Editor, nodes: RichText): boolean {
  const range = activeRange(editor);
  if (!range) return false;
  return editor.dispatchBuild(insertInlineOps(editor.getDoc(), range.blockId, range.start, range.end, nodes), {
    kind: 'insertText',
    breakHistory: true,
  });
}

/** Shift+Enter：軟換行（model 裡就是一個 '\n'，靠 CSS white-space: pre-wrap 呈現）。 */
export function insertSoftBreak(editor: Editor): boolean {
  return insertText(editor, '\n', { skipInputRules: true });
}

/** Enter：分割 block；空的清單項則跳出清單。 */
export function splitBlock(editor: Editor): boolean {
  const range = activeRange(editor);
  if (!range) return false;
  const block = editor.getBlock(range.blockId)!;
  const def = editor.registry.get(block.type);

  // code block 的 Enter 是軟換行
  if (def.splitBehavior === 'none' && def.hasInlineContent) return insertSoftBreak(editor);

  const total = rtLength(block.content);
  if (total === 0 && def.exitInto) {
    const exit = exitBlockOps(editor.getDoc(), range.blockId, editor.builderCtx);
    if (exit) {
      editor.history.breakpoint();
      return editor.dispatchBuild(exit, { kind: 'structural', breakHistory: true });
    }
  }

  // 先刪掉選取範圍再分割
  let doc = editor.getDoc();
  const ops: Operation[] = [];
  if (!range.collapsed) {
    const del = deleteRangeOps(doc, range.blockId, range.start, range.end);
    ops.push(...del.ops);
    doc = applyOpsSafe(doc, del.ops);
  }
  const built = splitBlockOps(doc, range.blockId, range.start, editor.builderCtx);
  ops.push(...built.ops);
  editor.history.breakpoint();
  return editor.dispatch({
    ops,
    selectionAfter: built.selectionAfter,
    kind: 'structural',
    breakHistory: true,
  });
}

/** 在同一個 transaction 內連續建 ops 時，需要「假裝已套用」的中間狀態。 */
function applyOpsSafe(doc: EditorDoc, ops: Operation[]): EditorDoc {
  try {
    return applyOps(doc, ops);
  } catch {
    return doc;
  }
}

/** Backspace。 */
export function deleteBackward(editor: Editor, unit: 'grapheme' | 'word' | 'softline' = 'grapheme'): boolean {
  const sel = editor.getSelection();
  if (sel.type === 'block') return editor.deleteBlocks(sel.blockIds);

  const range = activeRange(editor);
  if (!range) return false;
  const block = editor.getBlock(range.blockId)!;

  if (!range.collapsed) {
    return editor.dispatchBuild(deleteRangeOps(editor.getDoc(), range.blockId, range.start, range.end), {
      kind: 'deleteText',
    });
  }

  if (range.start === 0) {
    // 行首：先降級 → 再取消縮排 → 最後才合併
    const def = editor.registry.get(block.type);
    if (block.type !== 'paragraph' && def.hasInlineContent) {
      editor.history.breakpoint();
      return editor.setBlockType(block.id, 'paragraph');
    }
    if (block.parentId !== null) {
      const out = outdentOps(editor.getDoc(), block.id, textSelection(block.id, 0));
      if (out) {
        editor.history.breakpoint();
        return editor.dispatchBuild(out, { kind: 'structural', breakHistory: true });
      }
    }
    const merged = mergeBackwardOps(editor.getDoc(), block.id, editor.builderCtx);
    if (!merged) return false;
    editor.history.breakpoint();
    return editor.dispatchBuild(merged, { kind: 'structural', breakHistory: true });
  }

  const plain = toOffsetText(block.content);
  let from: number;
  if (unit === 'word') from = prevWordBoundary(plain, range.start);
  else if (unit === 'softline') from = 0;
  else from = prevGrapheme(plain, range.start);
  if (from === range.start) from = Math.max(0, range.start - 1);

  return editor.dispatchBuild(deleteRangeOps(editor.getDoc(), range.blockId, from, range.start), {
    kind: 'deleteText',
  });
}

/** Delete。 */
export function deleteForward(editor: Editor, unit: 'grapheme' | 'word' | 'softline' = 'grapheme'): boolean {
  const sel = editor.getSelection();
  if (sel.type === 'block') return editor.deleteBlocks(sel.blockIds);

  const range = activeRange(editor);
  if (!range) return false;
  const block = editor.getBlock(range.blockId)!;

  if (!range.collapsed) {
    return editor.dispatchBuild(deleteRangeOps(editor.getDoc(), range.blockId, range.start, range.end), {
      kind: 'deleteText',
    });
  }

  const total = rtLength(block.content);
  if (range.start >= total) {
    const merged = mergeForwardOps(editor.getDoc(), block.id, editor.builderCtx);
    if (!merged) return false;
    editor.history.breakpoint();
    return editor.dispatchBuild(merged, { kind: 'structural', breakHistory: true });
  }

  const plain = toOffsetText(block.content);
  let to: number;
  if (unit === 'word') to = nextWordBoundary(plain, range.start);
  else if (unit === 'softline') to = total;
  else to = nextGrapheme(plain, range.start);
  if (to === range.start) to = Math.min(total, range.start + 1);

  return editor.dispatchBuild(deleteRangeOps(editor.getDoc(), range.blockId, range.start, to), { kind: 'deleteText' });
}

export function indent(editor: Editor): boolean {
  const sel = editor.getSelection();
  const ids = sel.type === 'block' ? sel.blockIds : sel.type === 'text' ? [sel.focus.blockId] : [];
  if (ids.length === 0) return false;
  let doc = editor.getDoc();
  const ops: Operation[] = [];
  for (const id of ids) {
    const built = indentOps(doc, id, sel);
    if (!built) continue;
    ops.push(...built.ops);
    doc = applyOpsSafe(doc, built.ops);
  }
  if (ops.length === 0) return false;
  editor.history.breakpoint();
  return editor.dispatch({ ops, selectionAfter: sel, kind: 'structural', breakHistory: true });
}

export function outdent(editor: Editor): boolean {
  const sel = editor.getSelection();
  const ids = sel.type === 'block' ? sel.blockIds : sel.type === 'text' ? [sel.focus.blockId] : [];
  if (ids.length === 0) return false;
  let doc = editor.getDoc();
  const ops: Operation[] = [];
  for (const id of ids) {
    const built = outdentOps(doc, id, sel);
    if (!built) continue;
    ops.push(...built.ops);
    doc = applyOpsSafe(doc, built.ops);
  }
  if (ops.length === 0) return false;
  editor.history.breakpoint();
  return editor.dispatch({ ops, selectionAfter: sel, kind: 'structural', breakHistory: true });
}

export function toggleMarkCommand(editor: Editor, mark: Mark): boolean {
  const range = activeRange(editor);
  if (!range || range.collapsed) return false;
  editor.history.breakpoint();
  return editor.dispatchBuild(toggleMarkOps(editor.getDoc(), range.blockId, range.start, range.end, mark), {
    kind: 'format',
    breakHistory: true,
  });
}

export function setBlockTypeCommand(editor: Editor, type: BlockType): boolean {
  const sel = editor.getSelection();
  const ids = sel.type === 'block' ? sel.blockIds : sel.type === 'text' ? [sel.focus.blockId] : [];
  if (ids.length === 0) return false;
  return editor.setBlockType(ids, type);
}

export function selectionOf(editor: Editor): EditorSelection {
  return editor.getSelection();
}
