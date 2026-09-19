export type {
  Align,
  ArrowOptions,
  ArrowResult,
  ComputePositionOptions,
  Placement,
  PositionResult,
  RectLike,
  Side,
  SizeLike,
} from './types.js';
export { applyPosition, computePosition, joinPlacement, parsePlacement } from './computePosition.js';
export { autoUpdate, positionStyle } from './autoUpdate.js';
export type { AnchorSource, AutoUpdateOptions } from './autoUpdate.js';
export { clamp, makeRect, rectsEqual, toRect } from './rect.js';
export { getCaretRect, getSelectionRect } from './caret.js';
