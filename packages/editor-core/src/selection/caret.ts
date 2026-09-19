/**
 * Caret 幾何相關的跨瀏覽器 shim。
 *
 * - getSelectionRect：浮動工具列 / slash menu 的定位錨點。
 * - caretPositionFromPoint：上下鍵跨 block 時，用「螢幕座標」反推 DOM 位置（goalX）。
 * - isOnFirstVisualLine / isOnLastVisualLine：判斷要不要跨 block（軟換行時 offset 判斷會失準）。
 */

export interface CaretPoint {
  node: Node;
  offset: number;
}

interface CaretPositionLike {
  offsetNode: Node;
  offset: number;
}

type DocumentWithCaret = Document & {
  caretPositionFromPoint?(x: number, y: number): CaretPositionLike | null;
  caretRangeFromPoint?(x: number, y: number): Range | null;
};

/** Firefox 用 caretPositionFromPoint，其他用 caretRangeFromPoint。 */
export function caretPositionFromPoint(doc: Document, x: number, y: number): CaretPoint | null {
  const d = doc as DocumentWithCaret;
  if (typeof d.caretPositionFromPoint === 'function') {
    const pos = d.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  if (typeof d.caretRangeFromPoint === 'function') {
    const range = d.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}

/** 目前選取範圍的螢幕矩形。collapsed 時回傳游標的細長矩形。 */
export function getSelectionRect(doc: Document): DOMRect | null {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  return rectOfRange(range);
}

export function rectOfRange(range: Range): DOMRect | null {
  let rect: DOMRect | null = null;
  try {
    rect = range.getBoundingClientRect();
  } catch {
    rect = null;
  }
  if (rect && (rect.width !== 0 || rect.height !== 0 || rect.top !== 0 || rect.left !== 0)) return rect;
  // Safari 在部分情況回傳全 0 的 rect → fallback 到 client rects
  try {
    const rects = range.getClientRects();
    if (rects.length > 0) return rects[0]!;
  } catch {
    /* jsdom 沒有實作，忽略 */
  }
  if (rect) return rect;
  // collapsed 在元素邊界時，退而求其次量父元素
  const container = range.startContainer;
  const el = container.nodeType === 1 ? (container as HTMLElement) : container.parentElement;
  return el ? el.getBoundingClientRect() : null;
}

/** 游標是否位於該元素的第一個「視覺行」（軟換行後 offset 判斷會失準，必須量幾何）。 */
export function isOnFirstVisualLine(contentEl: HTMLElement, range: Range): boolean {
  const caret = rectOfRange(range);
  if (!caret) return true;
  const host = contentEl.getBoundingClientRect();
  const lineHeight = estimateLineHeight(contentEl);
  return caret.top - host.top < lineHeight * 0.5;
}

export function isOnLastVisualLine(contentEl: HTMLElement, range: Range): boolean {
  const caret = rectOfRange(range);
  if (!caret) return true;
  const host = contentEl.getBoundingClientRect();
  const lineHeight = estimateLineHeight(contentEl);
  return host.bottom - caret.bottom < lineHeight * 0.5;
}

export function estimateLineHeight(el: HTMLElement): number {
  const win = el.ownerDocument.defaultView;
  if (!win) return 20;
  const cs = win.getComputedStyle(el);
  const lh = parseFloat(cs.lineHeight);
  if (!Number.isNaN(lh) && lh > 0) return lh;
  const fs = parseFloat(cs.fontSize);
  return !Number.isNaN(fs) && fs > 0 ? fs * 1.5 : 20;
}
