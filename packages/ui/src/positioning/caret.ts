import { makeRect } from './rect.js';
import type { RectLike } from './types.js';

const ZERO_WIDTH_SPACE = '​';

/**
 * 取得 caret 的矩形（§4.5.4）。slash menu / @ 提及選單用。
 * collapsed range 在部分瀏覽器回傳全 0 的 rect，此時插入零寬空格探針量測後移除。
 */
export function getCaretRect(): RectLike | null {
  if (typeof window === 'undefined') return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  let rect: DOMRect | null = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    const probe = document.createElement('span');
    probe.textContent = ZERO_WIDTH_SPACE;
    try {
      range.insertNode(probe);
      rect = probe.getBoundingClientRect();
    } catch {
      rect = null;
    } finally {
      const parent = probe.parentNode;
      probe.remove();
      // 插入 / 移除探針會切碎 text node，事後務必正規化。
      parent?.normalize();
    }
  }
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return makeRect(rect.left, rect.top, rect.width, rect.height);
}

/**
 * 取得選取範圍的錨點 rect（inline 工具列用）。
 * 多行選取時取「第一個」client rect —— 工具列出現在選取的起始行上方比出現在整塊中央更符合直覺。
 */
export function getSelectionRect(): RectLike | null {
  if (typeof window === 'undefined') return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const rects = range.getClientRects();
  const r = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return null;
  return makeRect(r.left, r.top, r.width, r.height);
}
