/**
 * 自製定位引擎的型別（02-UI架構 §4.5）。
 * 零依賴、純函式，故意不直接吃 DOM 型別，讓單元測試可手動餵 rect。
 */

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'end';
export type Placement = Side | `${Side}-${Align}`;

/** DOMRect 的結構子集，jsdom 測試可用純物件建立。 */
export interface RectLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** 只需要尺寸的浮層描述（浮層還沒掛上 DOM 時也能算）。 */
export interface SizeLike {
  readonly width: number;
  readonly height: number;
}

export interface ArrowOptions {
  /** 箭頭邊長（正方形旋轉 45°），預設 8。 */
  size?: number;
  /** 浮層圓角，用來把箭頭夾在圓角之內，預設 6。 */
  radius?: number;
  /** 額外的內縮，預設 4。 */
  padding?: number;
}

export interface ComputePositionOptions {
  /** 錨點：DOM 元素、DOMRect（浮動工具列用 Range rect）皆可。 */
  anchor: Element | RectLike;
  /** 浮層：DOM 元素或已知尺寸。元素會即時量測。 */
  floating: HTMLElement | SizeLike;
  /** 預設 'bottom-start'。 */
  placement?: Placement;
  /** 錨點與浮層的間距，預設 6。 */
  offset?: number;
  /** 空間不足時翻到反向，預設 true。 */
  flip?: boolean;
  /** 沿次軸推回邊界內，預設 true。 */
  shift?: boolean;
  /** 可用邊界，預設為 viewport。 */
  boundary?: RectLike | null;
  /** 與邊界的最小距離，預設 8。 */
  padding?: number;
  /** 浮層寬度對齊錨點（下拉選單常用）。 */
  matchWidth?: boolean;
  /** 需要箭頭時傳入設定（或 true 取預設值）。 */
  arrow?: ArrowOptions | boolean;
}

export interface ArrowResult {
  /** 相對浮層左上角的座標。 */
  x: number;
  y: number;
  /** 箭頭指向的那一邊（浮層的哪一側貼著錨點）。 */
  side: Side;
}

export interface PositionResult {
  /** 相對 viewport 的座標，已 Math.round。 */
  x: number;
  y: number;
  /** 實際採用的 placement（可能已翻轉）。 */
  placement: Placement;
  side: Side;
  align: Align | null;
  /** 主軸方向的可用空間，浮層自行套 max-height + overflow-y:auto。 */
  maxHeight: number;
  /** 次軸方向的可用空間。 */
  maxWidth: number;
  /** matchWidth 時回傳應套用的寬度。 */
  width?: number;
  arrow?: ArrowResult;
  /** 本次計算用到的錨點 rect（供呼叫端做變化偵測）。 */
  anchorRect: RectLike;
}
