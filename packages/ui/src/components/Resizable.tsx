import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import styles from './Display.module.css';
import { cx } from './cx.js';

export type ResizeSide = 'right' | 'left' | 'bottom' | 'top';

export interface ResizableProps {
  /** 受控尺寸（px）。 */
  size?: number;
  defaultSize?: number;
  min?: number;
  max?: number;
  /** 把手在哪一邊。'right'/'left' 改寬度，'bottom'/'top' 改高度。 */
  side?: ResizeSide;
  onResize?: (size: number) => void;
  /** 放開時呼叫一次（適合拿來寫回設定）。 */
  onResizeEnd?: (size: number) => void;
  /** 雙擊把手時重設回這個值。 */
  resetSize?: number;
  disabled?: boolean;
  /** 鍵盤調整的步進，預設 16px（Shift 為 4 倍）。 */
  step?: number;
  handleLabel?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * 拖曳把手改寬度／高度。用於側邊欄、右側面板、資料庫表格欄寬。
 * Pointer Events + setPointerCapture，拖曳中禁止文字選取；也支援鍵盤（←→/↑↓）。
 */
export function Resizable({
  size: controlledSize,
  defaultSize = 260,
  min = 120,
  max = 640,
  side = 'right',
  onResize,
  onResizeEnd,
  resetSize,
  disabled = false,
  step = 16,
  handleLabel = '調整大小',
  className,
  style,
  children,
}: ResizableProps): JSX.Element {
  const [uncontrolled, setUncontrolled] = useState(defaultSize);
  const isControlled = controlledSize !== undefined;
  const size = isControlled ? controlledSize : uncontrolled;
  const [resizing, setResizing] = useState(false);
  const startRef = useRef({ pos: 0, size: 0 });
  const horizontal = side === 'right' || side === 'left';

  const apply = useCallback(
    (next: number) => {
      const clamped = clamp(Math.round(next), min, max);
      if (!isControlled) setUncontrolled(clamped);
      onResize?.(clamped);
      return clamped;
    },
    [isControlled, min, max, onResize],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      startRef.current = { pos: horizontal ? e.clientX : e.clientY, size };
      setResizing(true);
      document.documentElement.classList.add('kn-dragging');
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* jsdom */
      }

      let latest = size;
      const move = (ev: PointerEvent): void => {
        if (ev.pointerId !== e.pointerId) return;
        const delta = (horizontal ? ev.clientX : ev.clientY) - startRef.current.pos;
        const signed = side === 'right' || side === 'bottom' ? delta : -delta;
        latest = apply(startRef.current.size + signed);
      };
      const up = (ev: PointerEvent): void => {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        document.documentElement.classList.remove('kn-dragging');
        setResizing(false);
        onResizeEnd?.(latest);
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
    },
    [disabled, horizontal, side, size, apply, onResizeEnd],
  );

  const handleClass = {
    right: styles['handleRight'],
    left: styles['handleLeft'],
    bottom: styles['handleBottom'],
    top: styles['handleTop'],
  }[side];

  return (
    <div
      className={cx(styles['resizable'], className)}
      style={{ ...(horizontal ? { width: size } : { height: size }), ...style }}
    >
      {children}
      <div
        role="separator"
        aria-label={handleLabel}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuenow={size}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={disabled ? -1 : 0}
        data-resizing={resizing || undefined}
        className={cx(styles['resizeHandle'], handleClass)}
        onPointerDown={onPointerDown}
        onDoubleClick={() => {
          if (resetSize !== undefined) onResizeEnd?.(apply(resetSize));
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          const inc = e.shiftKey ? step * 4 : step;
          const grow = side === 'right' || side === 'bottom';
          let delta = 0;
          if (e.key === (horizontal ? 'ArrowRight' : 'ArrowDown')) delta = grow ? inc : -inc;
          else if (e.key === (horizontal ? 'ArrowLeft' : 'ArrowUp')) delta = grow ? -inc : inc;
          else if (e.key === 'Home') delta = min - size;
          else if (e.key === 'End') delta = max - size;
          else return;
          e.preventDefault();
          onResizeEnd?.(apply(size + delta));
        }}
      />
    </div>
  );
}
