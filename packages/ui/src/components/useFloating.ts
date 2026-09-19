import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  autoUpdate,
  computePosition,
  type AutoUpdateOptions,
  type ComputePositionOptions,
  type Placement,
  type PositionResult,
  type RectLike,
} from '../positioning/index.js';

export type FloatingAnchor = Element | RectLike | null | (() => Element | RectLike | null);

export interface UseFloatingOptions
  extends Pick<ComputePositionOptions, 'offset' | 'flip' | 'shift' | 'padding' | 'matchWidth' | 'arrow'> {
  open: boolean;
  anchor: FloatingAnchor;
  placement?: Placement;
  /** 錨點追蹤策略（inline 工具列 / slash menu 要開 animationFrame）。 */
  autoUpdateOptions?: AutoUpdateOptions;
}

export interface UseFloatingResult {
  setFloating: (node: HTMLElement | null) => void;
  position: PositionResult | null;
  /** 直接套到浮層的 style。 */
  style: CSSProperties;
  /** 手動重算。 */
  update: () => void;
}

function resolve(anchor: FloatingAnchor): Element | RectLike | null {
  return typeof anchor === 'function' ? anchor() : anchor;
}

/** 把 §4.5 的定位引擎接成 React hook。 */
export function useFloating(options: UseFloatingOptions): UseFloatingResult {
  const { open, anchor, placement = 'bottom-start', autoUpdateOptions, ...positionOptions } = options;
  const [floating, setFloatingState] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<PositionResult | null>(null);
  const optionsRef = useRef({ placement, ...positionOptions });
  optionsRef.current = { placement, ...positionOptions };
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  const update = useCallback(() => {
    const node = floating;
    if (!node) return;
    const a = resolve(anchorRef.current);
    if (!a) {
      setPosition(null);
      return;
    }
    setPosition(computePosition({ anchor: a, floating: node, ...optionsRef.current }));
  }, [floating]);

  useLayoutEffect(() => {
    if (!open || !floating) {
      setPosition(null);
      return;
    }
    return autoUpdate(
      () => resolve(anchorRef.current),
      floating,
      () => update(),
      autoUpdateOptions,
    );
    // autoUpdateOptions 以物件字面量傳入時每次都不同，這裡只認 open/floating/update。
  }, [open, floating, update]);

  const setFloating = useCallback((node: HTMLElement | null) => {
    setFloatingState(node);
  }, []);

  const style: CSSProperties = position
    ? {
        position: 'fixed',
        left: 0,
        top: 0,
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        maxHeight: position.maxHeight,
        ...(position.width !== undefined ? { width: position.width } : {}),
      }
    : { position: 'fixed', left: 0, top: 0, opacity: 0, pointerEvents: 'none' };

  return { setFloating, position, style, update };
}
