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
  /**
   * 第十一輪：≤767px 時改成 **bottom sheet**（貼著視窗底部、滿寬）。
   *
   * 為什麼不是「把 popover 縮小」：篩選 / 排序 / 屬性面板在手機上會蓋住
   * 觸發按鈕本身，而且定位演算法一旦撞到視窗邊界就會翻到上面去 ——
   * 使用者按「篩選」，面板卻出現在手指的另一端。
   * 形狀對的做法是 sheet：位置固定、永遠從底部長出來、拇指構得到。
   * 編輯器的 `ui/overlay` 早就有同名的 prop，這裡沿用同一個名字與同一種行為。
   */
  sheetOnMobile?: boolean;
  className?: string;
}

const MOBILE_QUERY = '(max-width: 767px)';

function useIsMobile(enabled: boolean): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = (): void => setMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [enabled]);
  return enabled && mobile;
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
  sheetOnMobile = false,
  className,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const sheet = useIsMobile(sheetOnMobile);

  useLayoutEffect(() => {
    // sheet 模式的位置由 CSS 決定（fixed bottom），量了也用不到
    if (sheet) return;
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
  }, [open, anchor, placement, children, sheet]);

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
      className={`${styles.popover} ${sheet ? styles.popoverSheet : ''} ${
        flush ? styles.popoverFlush : ''
      } ${className ?? ''}`}
      style={sheet ? undefined : { top: position.top, left: position.left, minWidth }}
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  );
}
