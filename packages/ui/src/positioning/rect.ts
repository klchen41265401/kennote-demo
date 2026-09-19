import type { RectLike } from './types.js';

/** 由 x/y/width/height 造出完整 RectLike（測試與純計算用）。 */
export function makeRect(x: number, y: number, width: number, height: number): RectLike {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height };
}

export function isRectLike(value: unknown): value is RectLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RectLike).width === 'number' &&
    typeof (value as RectLike).height === 'number' &&
    typeof (value as RectLike).top === 'number' &&
    typeof (value as RectLike).left === 'number'
  );
}

/** 把 Element 或 RectLike 一律正規化成 RectLike。 */
export function toRect(anchor: Element | RectLike): RectLike {
  if (isRectLike(anchor)) {
    // DOMRect 本身就符合 RectLike，直接複製成純物件避免 live rect。
    return {
      x: anchor.x,
      y: anchor.y,
      width: anchor.width,
      height: anchor.height,
      top: anchor.top,
      right: anchor.right,
      bottom: anchor.bottom,
      left: anchor.left,
    };
  }
  const r = anchor.getBoundingClientRect();
  return makeRect(r.left, r.top, r.width, r.height);
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function rectsEqual(a: RectLike | null, b: RectLike | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
