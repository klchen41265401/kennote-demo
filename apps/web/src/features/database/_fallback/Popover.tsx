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

interface StackEntry {
  ref: { current: HTMLDivElement | null };
}

/**
 * 目前打開的浮層堆疊（照打開順序）。
 * 巢狀浮層都 portal 到 `document.body`，父浮層用 `contains()` 認不出子浮層，
 * 所以要靠這個堆疊判斷「target 是不是落在疊在我上面的浮層裡」。
 */
const openStack: StackEntry[] = [];

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
    const entry: StackEntry = { ref };
    openStack.push(entry);

    /** 這個浮層之後才打開的浮層（＝疊在它上面的子浮層）有沒有包住 target */
    function inLaterPopover(target: Node): boolean {
      const mine = openStack.indexOf(entry);
      if (mine < 0) return false;
      for (let i = mine + 1; i < openStack.length; i += 1) {
        if (openStack[i]?.ref.current?.contains(target)) return true;
      }
      return false;
    }

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      // 巢狀浮層：子浮層是 portal 到 document.body 的，DOM 上不在自己裡面。
      // 沒有這一關，點子浮層的項目會先把父浮層關掉 → 子浮層跟著卸載 → click 永遠不會送出。
      if (inLaterPopover(target)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Escape 只關最上面那一層（document 上的多個 listener 不吃 stopPropagation）
      if (openStack[openStack.length - 1] !== entry) return;
      e.stopPropagation();
      onClose();
    }
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      const i = openStack.indexOf(entry);
      if (i >= 0) openStack.splice(i, 1);
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
