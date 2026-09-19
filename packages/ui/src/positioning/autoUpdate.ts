import type * as React from 'react';
import { rectsEqual, toRect } from './rect.js';
import type { PositionResult, RectLike } from './types.js';

export interface AutoUpdateOptions {
  /** 監聽 scroll（capture 階段，涵蓋所有祖先捲動容器），預設 true。 */
  scroll?: boolean;
  /** 監聽 window resize，預設 true。 */
  resize?: boolean;
  /** 以 ResizeObserver 監看錨點與浮層尺寸變化，預設 true。 */
  observeSize?: boolean;
  /**
   * 以 rAF 迴圈持續追蹤錨點 rect（§4.5.5 的 trackAnchor）。
   * inline 工具列 / slash menu 必須開；一般 popover 可關以省成本。預設 false。
   */
  animationFrame?: boolean;
}

export type AnchorSource = Element | RectLike | (() => Element | RectLike | null);

function resolveAnchor(anchor: AnchorSource): RectLike | null {
  const value = typeof anchor === 'function' ? anchor() : anchor;
  if (!value) return null;
  return toRect(value);
}

/**
 * 在錨點可能移動時重新定位，回傳 cleanup 函式。
 * rAF 模式只有在錨點 rect「真的變了」時才呼叫 cb，避免每幀重排。
 */
export function autoUpdate(
  anchor: AnchorSource,
  floating: HTMLElement | null,
  cb: (rect: RectLike | null) => void,
  options: AutoUpdateOptions = {},
): () => void {
  const { scroll = true, resize = true, observeSize = true, animationFrame = false } = options;

  let disposed = false;
  let last: RectLike | null = null;
  let frame = 0;

  const emit = (): void => {
    if (disposed) return;
    const rect = resolveAnchor(anchor);
    last = rect;
    cb(rect);
  };

  const schedule = (): void => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      emit();
    });
  };

  const cleanups: Array<() => void> = [];

  if (typeof window !== 'undefined') {
    if (scroll) {
      const onScroll = (): void => schedule();
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
      cleanups.push(() => window.removeEventListener('scroll', onScroll, { capture: true }));
    }
    if (resize) {
      const onResize = (): void => schedule();
      window.addEventListener('resize', onResize, { passive: true });
      cleanups.push(() => window.removeEventListener('resize', onResize));
    }
  }

  if (observeSize && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => schedule());
    const anchorValue = typeof anchor === 'function' ? anchor() : anchor;
    if (anchorValue instanceof Element) ro.observe(anchorValue);
    if (floating) ro.observe(floating);
    cleanups.push(() => ro.disconnect());
  }

  if (animationFrame && typeof requestAnimationFrame !== 'undefined') {
    let raf = 0;
    const tick = (): void => {
      if (disposed) return;
      const rect = resolveAnchor(anchor);
      if (!rectsEqual(rect, last)) {
        last = rect;
        cb(rect);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    cleanups.push(() => cancelAnimationFrame(raf));
  }

  emit();

  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    for (const fn of cleanups) fn();
  };
}

/** 把 PositionResult 轉成 React inline style 物件。 */
export function positionStyle(pos: PositionResult | null): React.CSSProperties {
  if (!pos) {
    return { position: 'fixed', left: 0, top: 0, visibility: 'hidden', pointerEvents: 'none' };
  }
  const style: React.CSSProperties = {
    position: 'fixed',
    left: 0,
    top: 0,
    transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
    maxHeight: pos.maxHeight,
  };
  if (pos.width !== undefined) style.width = pos.width;
  return style;
}
