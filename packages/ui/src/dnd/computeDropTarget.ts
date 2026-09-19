/**
 * 落點解析（02-UI架構 §4.6.4）。純函式，頁面樹與 block 排序共用。
 * 完全不碰 DOM：呼叫端負責把 rect 快取餵進來（§4.6.3 的 RectCache）。
 */

export interface Point {
  x: number;
  y: number;
}

export interface DropItemRect {
  id: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** 縮排層級（頁面樹 / block 用），預設 0。 */
  depth?: number;
  /** 是否可以把東西放「進裡面」成為子項，預設 true。 */
  acceptsChildren?: boolean;
}

export type DropPosition = 'before' | 'inside' | 'after';

export interface DropTarget {
  /** 目標項目 id。 */
  id: string;
  position: DropPosition;
  /** 目標在陣列中的索引。 */
  itemIndex: number;
  /** 插入後在同層清單中的索引（inside 時為 0 —— 成為第一個子項）。 */
  index: number;
  /** 落點的縮排層級。 */
  depth: number;
  /** 指示器幾何：'inside' 時為整列外框，其餘為一條線。 */
  indicator: DropIndicatorGeometry;
}

export interface DropIndicatorGeometry {
  type: 'line' | 'box';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputeDropTargetOptions {
  /**
   * 'tree'：三段式 before / inside / after（中段刻意佔 50%，因為「放進資料夾」是頁面樹最常見的意圖）。
   * 'list'：兩段式 before / after（看板、單純排序用）。
   * 預設 'tree'。
   */
  mode?: 'tree' | 'list';
  /** 水平偏移 ≥ 此值即判定為「進裡面」，預設 24（= --block-indent）。 */
  insideThreshold?: number;
  /** 每層縮排寬度，預設 24。 */
  indentUnit?: number;
  /** 內容左緣；沒給就用目標項目的 left。 */
  contentLeft?: number;
  /** 三段式的上下緣比例，預設 0.25。 */
  edgeRatio?: number;
  /** 不可作為落點的 id（拖曳來源自身與其子孫）。命中這些會回傳 null。 */
  disabledIds?: readonly string[];
  /** 允許最深層級，預設 Infinity。 */
  maxDepth?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(Math.max(v, lo), hi);
}

/**
 * 依指標位置與項目 rect 陣列算出落點。
 *
 * - 垂直軸決定 before / inside / after。
 * - 水平軸決定縮排層級；偏移 ≥ insideThreshold 時升級為「進裡面」。
 * - items 必須依 top 由小到大排序。
 */
export function computeDropTarget(
  pointer: Point,
  items: readonly DropItemRect[],
  options: ComputeDropTargetOptions = {},
): DropTarget | null {
  if (items.length === 0) return null;
  const {
    mode = 'tree',
    insideThreshold = 24,
    indentUnit = 24,
    contentLeft,
    edgeRatio = 0.25,
    disabledIds,
    maxDepth = Number.POSITIVE_INFINITY,
  } = options;

  // ── 命中測試：落在哪個項目上；超出頭尾時夾到第一個 / 最後一個 ──
  let index = -1;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (pointer.y >= it.top && pointer.y <= it.bottom) {
      index = i;
      break;
    }
  }
  let forcedPosition: DropPosition | null = null;
  if (index === -1) {
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (pointer.y < first.top) {
      index = 0;
      forcedPosition = 'before';
    } else if (pointer.y > last.bottom) {
      index = items.length - 1;
      forcedPosition = 'after';
    } else {
      // 落在項目之間的間隙：取最近的下一個項目的上緣。
      index = items.findIndex((it) => it.top > pointer.y);
      if (index === -1) index = items.length - 1;
      forcedPosition = 'before';
    }
  }

  const item = items[index]!;
  if (disabledIds?.includes(item.id)) return null;

  const itemDepth = item.depth ?? 0;
  const left = contentLeft ?? item.left;
  const offsetX = pointer.x - left;
  const height = Math.max(1, item.bottom - item.top);
  const ratio = (pointer.y - item.top) / height;
  const acceptsChildren = item.acceptsChildren !== false;

  // ── 決定 position ──
  let position: DropPosition;
  if (forcedPosition) {
    position = forcedPosition;
  } else if (mode === 'list') {
    position = ratio < 0.5 ? 'before' : 'after';
  } else {
    const inMiddleBand = ratio >= edgeRatio && ratio < 1 - edgeRatio;
    const indentedIn = offsetX >= insideThreshold;
    if (acceptsChildren && (inMiddleBand || indentedIn)) position = 'inside';
    else position = ratio < 0.5 ? 'before' : 'after';
  }
  if (position === 'inside' && !acceptsChildren) position = ratio < 0.5 ? 'before' : 'after';

  // ── 決定 depth ──
  let depth: number;
  if (position === 'inside') {
    depth = itemDepth + 1;
  } else {
    const raw = Math.round(offsetX / indentUnit);
    const neighbour = position === 'after' ? items[index + 1] : items[index - 1];
    const maxAllowed = itemDepth + (acceptsChildren ? 1 : 0);
    const minAllowed = position === 'after' ? (neighbour?.depth ?? 0) : 0;
    depth = clamp(raw, Math.min(minAllowed, maxAllowed), maxAllowed);
  }
  depth = clamp(depth, 0, maxDepth);

  // ── 指示器幾何 ──
  const width = Math.max(0, item.right - item.left);
  const indicator: DropIndicatorGeometry =
    position === 'inside'
      ? { type: 'box', x: item.left, y: item.top, width, height: item.bottom - item.top }
      : {
          type: 'line',
          x: item.left + depth * indentUnit,
          y: position === 'before' ? item.top : item.bottom,
          width: Math.max(0, width - depth * indentUnit),
          height: 2,
        };

  const insertIndex = position === 'inside' ? 0 : position === 'after' ? index + 1 : index;

  return { id: item.id, position, itemIndex: index, index: insertIndex, depth, indicator };
}

/**
 * 看板 / 單純排序用的便利函式：找出插入索引。
 * 「第一個中心點在指標之下的卡片」的索引即為插入位置（§4.6.4 C）。
 */
export function computeInsertIndex(
  pointer: Point,
  items: readonly DropItemRect[],
  orientation: 'vertical' | 'horizontal' = 'vertical',
): number {
  const coord = orientation === 'vertical' ? pointer.y : pointer.x;
  const index = items.findIndex((it) => {
    const center = orientation === 'vertical' ? (it.top + it.bottom) / 2 : (it.left + it.right) / 2;
    return center > coord;
  });
  return index === -1 ? items.length : index;
}
