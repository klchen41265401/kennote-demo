import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './fallback.module.css';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** 對齊的觸發元素 */
  anchor: HTMLElement | null;
  children: ReactNode;
  placement?: 'bottom-start' | 'bottom-end' | 'right-start';
  /** 最小寬度；不給就跟著內容 */
  minWidth?: number;
  /**
   * 去掉浮層自己的 8px 內距，讓子元件自己控制寬度與留白。
   * Notion 的篩選 / 排序 / 設定面板是「滿版」的（面板邊緣就是浮層邊緣），
   * 以前靠子元件 `margin: -8px` 抵銷，但 `.popover` 有 `overflow: auto`，
   * 負外距會被裁掉 → 實測面板只有 284 寬而不是 292。
   */
  flush?: boolean;
  className?: string;
}

/** 極簡浮層：portal + 視窗邊界翻轉 + 點外面/Esc 關閉 + focus trap 的最低限度 */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  placement = 'bottom-start',
  minWidth,
  flush,
  className,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const rect = anchor.getBoundingClientRect();
    const box = ref.current.getBoundingClientRect();
    let top = placement === 'right-start' ? rect.top : rect.bottom + 4;
    let left = placement === 'bottom-end' ? rect.right - box.width : rect.left;
    if (placement === 'right-start') left = rect.right + 4;

    // 視窗邊界翻轉：寧可蓋住觸發元素，也不要跑到畫面外
    if (left + box.width > window.innerWidth - 8) left = window.innerWidth - box.width - 8;
    if (left < 8) left = 8;
    if (top + box.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - box.height - 4);
    }
    setPosition({ top, left });
  }, [open, anchor, placement, children]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, anchor, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      className={`${styles.popover} ${flush ? styles.popoverFlush : ''} ${className ?? ''}`}
      style={{ top: position.top, left: position.left, minWidth }}
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  );
}
