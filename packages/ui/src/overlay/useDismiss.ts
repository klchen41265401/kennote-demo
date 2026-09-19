import { useEffect, useRef, type RefObject } from 'react';
import { overlayStack } from './stack.js';

export interface UseDismissOptions {
  /** 是否啟用（浮層開著時才有意義）。 */
  enabled?: boolean;
  /** 點浮層外部時關閉，預設 true。 */
  outsidePress?: boolean;
  /** Esc 關閉（只關最上層），預設 true。 */
  escape?: boolean;
  /** 點錨點（觸發元素）時也關閉，預設 false —— 一般由觸發元素自行 toggle。 */
  referencePress?: boolean;
  /** 浮層根元素。 */
  floating: RefObject<HTMLElement | null>;
  /** 錨點元素。 */
  reference?: RefObject<Element | null>;
  onDismiss: () => void;
}

/**
 * 獨立的關閉行為 hook（可在不進 overlayStack 的簡單浮層上使用）。
 * 一律用原生 document 監聽：React 的合成事件會沿 React 樹冒泡，
 * portal 出去的浮層會誤判成「外部點擊」（§4.7.1）。
 * 判定為外部前會先問 overlayStack —— 若點擊落在更上層的浮層內，就不關自己。
 */
export function useDismiss(options: UseDismissOptions): void {
  const {
    enabled = true,
    outsidePress = true,
    escape = true,
    referencePress = false,
    floating,
    reference,
    onDismiss,
  } = options;

  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    const onPointerDown = (e: PointerEvent): void => {
      if (!outsidePress) return;
      const target = e.target as Node | null;
      const node = floating.current;
      if (node && target && node.contains(target)) return;
      const ref = reference?.current;
      if (!referencePress && ref && target && ref.contains(target)) return;
      // 巢狀：點在堆疊中任何一個「比自己更上層」的浮層內，不算外部。
      const entries = overlayStack.getSnapshot();
      const selfIdx = entries.findIndex((entry) => entry.element === node);
      if (selfIdx !== -1) {
        for (let i = entries.length - 1; i > selfIdx; i--) {
          const el = entries[i]?.element;
          if (el && target && el.contains(target)) return;
        }
      }
      onDismissRef.current();
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (!escape || e.key !== 'Escape') return;
      // 只有最上層才吃 Esc。沒進堆疊的浮層一律視為最上層。
      const node = floating.current;
      const entries = overlayStack.getSnapshot();
      const selfIdx = entries.findIndex((entry) => entry.element === node);
      if (selfIdx !== -1 && selfIdx !== entries.length - 1) return;
      e.preventDefault();
      e.stopPropagation();
      onDismissRef.current();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [enabled, outsidePress, escape, referencePress, floating, reference]);
}
