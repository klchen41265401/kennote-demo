/**
 * Model 層的選取狀態。DOM 的 Selection 只是它的投影。
 *
 * 兩種互斥模式（見 04 §4.1 路線 C）：
 *  - text  ：單一 block 內的文字選取，交給瀏覽器原生 Selection 呈現。
 *  - block ：跨 block 的整塊選取，完全自繪（清掉原生 selection，用 data-selected 上色）。
 */

export interface TextPoint {
  blockId: string;
  /** code point offset */
  offset: number;
}

export type EditorSelection =
  | { type: 'text'; anchor: TextPoint; focus: TextPoint }
  | { type: 'block'; blockIds: string[]; anchorId: string; focusId: string }
  | { type: 'none' };

/** 04 §4.3 用的舊名，保留為別名方便對照規格。 */
export type ModelSelection = EditorSelection;

export const NO_SELECTION: EditorSelection = { type: 'none' };

export function textSelection(blockId: string, anchor: number, focus = anchor): EditorSelection {
  return { type: 'text', anchor: { blockId, offset: anchor }, focus: { blockId, offset: focus } };
}

export function blockSelection(blockIds: string[], anchorId?: string, focusId?: string): EditorSelection {
  const first = blockIds[0] ?? '';
  const last = blockIds[blockIds.length - 1] ?? first;
  return { type: 'block', blockIds, anchorId: anchorId ?? first, focusId: focusId ?? last };
}

export function isCollapsed(sel: EditorSelection): boolean {
  return sel.type === 'text' && sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset;
}

/** text 選取是否落在單一 block 內。 */
export function isWithinOneBlock(sel: EditorSelection): sel is { type: 'text'; anchor: TextPoint; focus: TextPoint } {
  return sel.type === 'text' && sel.anchor.blockId === sel.focus.blockId;
}

/** 取得 text 選取的正規範圍（start <= end）。跨 block 時回傳 null。 */
export function orderedRange(sel: EditorSelection): { blockId: string; start: number; end: number } | null {
  if (!isWithinOneBlock(sel)) return null;
  const a = sel.anchor.offset;
  const b = sel.focus.offset;
  return { blockId: sel.anchor.blockId, start: Math.min(a, b), end: Math.max(a, b) };
}

/** 選取涉及的 block id。 */
export function selectionBlockIds(sel: EditorSelection): string[] {
  if (sel.type === 'text') {
    return sel.anchor.blockId === sel.focus.blockId ? [sel.anchor.blockId] : [sel.anchor.blockId, sel.focus.blockId];
  }
  if (sel.type === 'block') return sel.blockIds;
  return [];
}

export function selectionEquals(a: EditorSelection, b: EditorSelection): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 游標所在的 block（text 模式）或 focus 的 block（block 模式）。 */
export function focusBlockIdOf(sel: EditorSelection): string | null {
  if (sel.type === 'text') return sel.focus.blockId;
  if (sel.type === 'block') return sel.focusId;
  return null;
}
