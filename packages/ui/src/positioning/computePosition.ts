import { clamp, makeRect, toRect } from './rect.js';
import type {
  Align,
  ArrowResult,
  ComputePositionOptions,
  Placement,
  PositionResult,
  RectLike,
  Side,
  SizeLike,
} from './types.js';

const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

export function parsePlacement(placement: Placement): { side: Side; align: Align | null } {
  const dash = placement.indexOf('-');
  if (dash === -1) return { side: placement as Side, align: null };
  return {
    side: placement.slice(0, dash) as Side,
    align: placement.slice(dash + 1) as Align,
  };
}

export function joinPlacement(side: Side, align: Align | null): Placement {
  return (align ? `${side}-${align}` : side) as Placement;
}

function isVertical(side: Side): boolean {
  return side === 'top' || side === 'bottom';
}

function measureFloating(floating: HTMLElement | SizeLike): SizeLike {
  const maybeElement = floating as Partial<HTMLElement>;
  if (typeof maybeElement.getBoundingClientRect !== 'function') {
    return { width: (floating as SizeLike).width, height: (floating as SizeLike).height };
  }
  const el = floating as HTMLElement;
  const r = el.getBoundingClientRect();
  // display:none 或未掛載時 rect 全 0，退回 offset 尺寸（§4.5.3 的量測陷阱）。
  return { width: r.width || el.offsetWidth || 0, height: r.height || el.offsetHeight || 0 };
}

function defaultBoundary(): RectLike {
  const w = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const h = typeof window === 'undefined' ? 768 : window.innerHeight;
  return makeRect(0, 0, w, h);
}

/** 主軸上某一側相對錨點的可用空間（已扣掉 offset 與 padding）。 */
function spaceOn(
  side: Side,
  anchor: RectLike,
  boundary: RectLike,
  offset: number,
  padding: number,
): number {
  switch (side) {
    case 'top':
      return anchor.top - boundary.top - offset - padding;
    case 'bottom':
      return boundary.bottom - anchor.bottom - offset - padding;
    case 'left':
      return anchor.left - boundary.left - offset - padding;
    case 'right':
      return boundary.right - anchor.right - offset - padding;
  }
}

function mainAxisCoord(side: Side, anchor: RectLike, size: SizeLike, offset: number): number {
  switch (side) {
    case 'top':
      return anchor.top - size.height - offset;
    case 'bottom':
      return anchor.bottom + offset;
    case 'left':
      return anchor.left - size.width - offset;
    case 'right':
      return anchor.right + offset;
  }
}

function crossAxisCoord(side: Side, align: Align | null, anchor: RectLike, size: SizeLike): number {
  if (isVertical(side)) {
    if (align === 'start') return anchor.left;
    if (align === 'end') return anchor.right - size.width;
    return anchor.left + (anchor.width - size.width) / 2;
  }
  if (align === 'start') return anchor.top;
  if (align === 'end') return anchor.bottom - size.height;
  return anchor.top + (anchor.height - size.height) / 2;
}

/**
 * 已知錨點矩形與浮層尺寸，求浮層的 x/y，並在超出邊界時修正。
 * 步驟：主軸放置 → 次軸對齊 → flip → shift → maxHeight → arrow（02-UI架構 §4.5.3）。
 * 純函式：不讀 DOM 以外的狀態、不寫任何 DOM。
 */
export function computePosition(options: ComputePositionOptions): PositionResult {
  const {
    placement = 'bottom-start',
    offset = 6,
    flip = true,
    shift = true,
    padding = 8,
    matchWidth = false,
    arrow,
  } = options;

  const anchorRect = toRect(options.anchor);
  const boundary = options.boundary ?? defaultBoundary();
  const measured = measureFloating(options.floating);
  const size: SizeLike = matchWidth
    ? { width: anchorRect.width, height: measured.height }
    : measured;

  const parsed = parsePlacement(placement);
  let side = parsed.side;
  const align = parsed.align;

  // 步驟 3｜flip：主軸空間不足時比較反方向空間，反方向較大才翻。
  if (flip) {
    const needed = isVertical(side) ? size.height : size.width;
    const own = spaceOn(side, anchorRect, boundary, offset, padding);
    if (own < needed) {
      const opposite = OPPOSITE[side];
      const other = spaceOn(opposite, anchorRect, boundary, offset, padding);
      if (other > own) side = opposite;
    }
  }

  // 步驟 1 + 2｜主軸放置與次軸對齊。
  let x: number;
  let y: number;
  if (isVertical(side)) {
    y = mainAxisCoord(side, anchorRect, size, offset);
    x = crossAxisCoord(side, align, anchorRect, size);
  } else {
    x = mainAxisCoord(side, anchorRect, size, offset);
    y = crossAxisCoord(side, align, anchorRect, size);
  }

  // 步驟 4｜shift：只推次軸；主軸不足是 flip 與 maxHeight 的責任。
  if (shift) {
    if (isVertical(side)) {
      x = clamp(x, boundary.left + padding, boundary.right - size.width - padding);
    } else {
      y = clamp(y, boundary.top + padding, boundary.bottom - size.height - padding);
    }
  }

  // 步驟 5｜maxHeight / maxWidth：與其超出畫面，不如變矮並內部捲動。
  const mainSpace = Math.max(0, spaceOn(side, anchorRect, boundary, offset, padding));
  const crossSpace = Math.max(
    0,
    (isVertical(side) ? boundary.width : boundary.height) - padding * 2,
  );

  const result: PositionResult = {
    x: Math.round(x),
    y: Math.round(y),
    placement: joinPlacement(side, align),
    side,
    align,
    maxHeight: Math.round(isVertical(side) ? mainSpace : crossSpace),
    maxWidth: Math.round(isVertical(side) ? crossSpace : mainSpace),
    anchorRect,
  };
  if (matchWidth) result.width = Math.round(anchorRect.width);

  // 步驟 6｜arrow：沿次軸置於錨點中心，但夾在浮層圓角之內。
  if (arrow) {
    const opts = typeof arrow === 'object' ? arrow : {};
    const arrowSize = opts.size ?? 8;
    const radius = opts.radius ?? 6;
    const inset = opts.padding ?? 4;
    const vertical = isVertical(side);
    const floatLength = vertical ? size.width : size.height;
    const anchorCenter = vertical
      ? anchorRect.left + anchorRect.width / 2
      : anchorRect.top + anchorRect.height / 2;
    const floatStart = vertical ? x : y;
    const min = radius + inset;
    const max = Math.max(min, floatLength - radius - arrowSize - inset);
    const along = clamp(anchorCenter - floatStart - arrowSize / 2, min, max);
    const arrowResult: ArrowResult = vertical
      ? {
          x: Math.round(along),
          y: Math.round(side === 'top' ? size.height : -arrowSize),
          side: OPPOSITE[side],
        }
      : {
          x: Math.round(side === 'left' ? size.width : -arrowSize),
          y: Math.round(along),
          side: OPPOSITE[side],
        };
    result.arrow = arrowResult;
  }

  return result;
}

/**
 * 把計算結果套到浮層元素上。
 * 依 §4.5.3「三個必守細節」：position:fixed + translate3d、座標取整、transform 不加 transition。
 */
export function applyPosition(floating: HTMLElement, pos: PositionResult): void {
  floating.style.position = 'fixed';
  floating.style.left = '0';
  floating.style.top = '0';
  floating.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
  floating.style.maxHeight = `${pos.maxHeight}px`;
  if (pos.width !== undefined) floating.style.width = `${pos.width}px`;
  floating.dataset['placement'] = pos.placement;
  floating.dataset['side'] = pos.side;
}
