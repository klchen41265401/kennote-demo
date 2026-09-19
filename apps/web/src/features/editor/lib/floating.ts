/**
 * 自製浮層定位（02 §4.5）。約 100 行，零依賴。
 *
 * 之所以放在 features/editor 而不是直接用 `@kennote/ui` 的 positioning：
 * 寫這支的時候 `packages/ui` 還沒 export `computePosition`（UI 代理進行中）。
 * 等它 export 之後，把 `positionFloating` 換成薄薄一層轉接即可（見 README「決策」）。
 */

export type Placement =
  | 'bottom-start'
  | 'bottom-end'
  | 'bottom'
  | 'top-start'
  | 'top-end'
  | 'top'
  | 'right-start'
  | 'left-start';

export interface RectLike {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PositionOptions {
  placement?: Placement;
  /** 錨點與浮層之間的間距 */
  offset?: number;
  /** 與視窗邊緣的最小留白 */
  padding?: number;
  viewport?: Size;
}

export interface PositionResult {
  left: number;
  top: number;
  /** 實際採用的 placement（可能因空間不足而翻轉） */
  placement: Placement;
  /** 可用的最大高度，浮層可據此設定 maxHeight + overflow */
  maxHeight: number;
}

function flipVertical(placement: Placement): Placement {
  if (placement.startsWith('bottom')) return placement.replace('bottom', 'top') as Placement;
  if (placement.startsWith('top')) return placement.replace('top', 'bottom') as Placement;
  return placement;
}

/**
 * 純函式：給錨點 rect（可以是元素的，也可以是 caret Range 的）與浮層大小，
 * 算出應該擺在哪裡。可在 Node 環境直接單測。
 */
export function positionFloating(
  anchor: RectLike,
  size: Size,
  options: PositionOptions = {},
): PositionResult {
  const offset = options.offset ?? 4;
  const padding = options.padding ?? 8;
  const viewport = options.viewport ?? {
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight,
  };

  let placement = options.placement ?? 'bottom-start';

  const spaceBelow = viewport.height - anchor.bottom - offset - padding;
  const spaceAbove = anchor.top - offset - padding;

  // 下方放不下、且上方空間比較大 → 翻轉
  if (placement.startsWith('bottom') && size.height > spaceBelow && spaceAbove > spaceBelow) {
    placement = flipVertical(placement);
  } else if (placement.startsWith('top') && size.height > spaceAbove && spaceBelow > spaceAbove) {
    placement = flipVertical(placement);
  }

  let top: number;
  let maxHeight: number;
  if (placement.startsWith('top')) {
    top = anchor.top - offset - size.height;
    maxHeight = spaceAbove;
  } else if (placement.startsWith('bottom')) {
    top = anchor.bottom + offset;
    maxHeight = spaceBelow;
  } else {
    top = anchor.top;
    maxHeight = viewport.height - anchor.top - padding;
  }

  let left: number;
  if (placement.endsWith('-end')) left = anchor.right - size.width;
  else if (placement === 'bottom' || placement === 'top') {
    left = anchor.left + anchor.width / 2 - size.width / 2;
  } else if (placement === 'right-start') left = anchor.right + offset;
  else if (placement === 'left-start') left = anchor.left - offset - size.width;
  else left = anchor.left;

  // shift：夾在視窗內
  left = Math.min(Math.max(padding, left), Math.max(padding, viewport.width - size.width - padding));
  top = Math.min(Math.max(padding, top), Math.max(padding, viewport.height - Math.min(size.height, maxHeight) - padding));

  return { left, top, placement, maxHeight: Math.max(120, maxHeight) };
}

export function rectFromDOMRect(rect: DOMRect | RectLike): RectLike {
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/** 把一個點（例如右鍵座標）包成 0x0 的 rect */
export function pointRect(x: number, y: number): RectLike {
  return { top: y, left: x, right: x, bottom: y, width: 0, height: 0 };
}
