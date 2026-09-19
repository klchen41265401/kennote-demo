/**
 * 拖放落點計算（02 §4.1.2 / §4.6.3）。純函式，可在 Node 單測。
 *
 * `packages/ui` 的 `computeDropTarget` 由 UI 代理並行開發中，尚未 export；
 * 等它出來之後，這支可以整個換掉（介面刻意對齊：rects + 指標座標 → 落點）。
 */

export interface BlockRect {
  id: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** 巢狀深度（0 = 根層），用來決定要不要允許縮排 */
  depth: number;
  canHaveChildren: boolean;
  /** 是否為版面容器的直屬子層（column 內不允許再拖成欄） */
  inColumn: boolean;
}

export type DropPosition = 'before' | 'after' | 'child' | 'column-left' | 'column-right';

export interface DropTarget {
  id: string;
  position: DropPosition;
}

export interface DropOptions {
  /** 指標 X 超過 block 左緣多少才算「縮排成子層」 */
  indentThreshold?: number;
  /** 靠近左右邊緣多少比例時，落點改成「成為新欄」 */
  columnEdgeRatio?: number;
  /**
   * 「成為新欄」還要求指標落在 block 的**垂直中間帶**，佔 block 高度的比例。
   * 預設 0.5 = 上下各留 25% 給排序（before / after），與 Notion 一致：
   * 指標貼在上下邊界時使用者要的是「換順序」，不是「開一欄」。
   */
  columnVerticalBand?: number;
  /** 不能當落點的 block（自己 + 自己的子孫） */
  forbidden?: Set<string>;
  /** 是否允許建立多欄 */
  allowColumns?: boolean;
}

/**
 * 依指標座標算出落點。
 *  - 落在 block 上半 → before；下半 → after
 *  - X 偏移 > indentThreshold 且上一個目標支援 children → child
 *  - X 落在 block 左 / 右邊緣帶 → 成為新欄
 */
export function computeDropTarget(
  rects: BlockRect[],
  x: number,
  y: number,
  options: DropOptions = {},
): DropTarget | null {
  const indentThreshold = options.indentThreshold ?? 24;
  const columnEdgeRatio = options.columnEdgeRatio ?? 0.25;
  const columnVerticalBand = options.columnVerticalBand ?? 0.5;
  const forbidden = options.forbidden ?? new Set<string>();
  const allowColumns = options.allowColumns ?? true;

  const candidates = rects.filter((r) => !forbidden.has(r.id));
  if (candidates.length === 0) return null;

  // 找出 Y 命中的 block；在所有 block 之上 / 之下時夾到頭尾
  let hit = candidates.find((r) => y >= r.top && y <= r.bottom);
  if (!hit) {
    const first = candidates[0] as BlockRect;
    const last = candidates[candidates.length - 1] as BlockRect;
    if (y < first.top) return { id: first.id, position: 'before' };
    if (y > last.bottom) return { id: last.id, position: 'after' };
    // 落在兩個 block 的間隙：取最近的
    hit = candidates.reduce((best, r) =>
      Math.abs(centerY(r) - y) < Math.abs(centerY(best) - y) ? r : best,
    );
  }

  const width = hit.right - hit.left;
  // ⭐ BUG-14：左右「開新欄」的判斷以前只看 X，於是指標貼在 block 上下邊界
  //（使用者明明是要換順序）也會被判成 column-left/right，純排序幾乎拖不出來。
  // 改成必須同時落在 block 的垂直中間帶裡，邊界那一圈永遠留給 before / after。
  const halfBand = ((hit.bottom - hit.top) * columnVerticalBand) / 2;
  const inVerticalBand = Math.abs(y - centerY(hit)) <= halfBand;
  if (allowColumns && !hit.inColumn && width > 0 && inVerticalBand) {
    const edge = width * columnEdgeRatio;
    if (x > hit.right - edge) return { id: hit.id, position: 'column-right' };
    if (x < hit.left + edge && x >= hit.left) return { id: hit.id, position: 'column-left' };
  }

  const isUpperHalf = y < centerY(hit);
  if (!isUpperHalf && hit.canHaveChildren && x - hit.left > indentThreshold) {
    return { id: hit.id, position: 'child' };
  }
  return { id: hit.id, position: isUpperHalf ? 'before' : 'after' };
}

function centerY(rect: BlockRect): number {
  return (rect.top + rect.bottom) / 2;
}

/** drop indicator 的幾何（02 §4.6.4） */
export function indicatorGeometry(
  rect: BlockRect,
  position: DropPosition,
  indentThreshold = 24,
): { top: number; left: number; width: number; height: number; vertical: boolean } {
  if (position === 'column-left' || position === 'column-right') {
    return {
      top: rect.top,
      left: position === 'column-left' ? rect.left : rect.right - 2,
      width: 2,
      height: rect.bottom - rect.top,
      vertical: true,
    };
  }
  const indent = position === 'child' ? indentThreshold : 0;
  return {
    top: position === 'before' ? rect.top : rect.bottom,
    left: rect.left + indent,
    width: Math.max(0, rect.right - rect.left - indent),
    height: 2,
    vertical: false,
  };
}

/** 拖到視窗上下緣時的自動捲動速度（px / frame） */
export function autoScrollSpeed(y: number, viewportHeight: number, zone = 60): number {
  if (y < zone) return -Math.ceil(((zone - y) / zone) * 18);
  if (y > viewportHeight - zone) return Math.ceil(((y - (viewportHeight - zone)) / zone) * 18);
  return 0;
}
