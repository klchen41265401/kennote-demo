/**
 * 浮層基礎元件（02 §4.4.5）。
 *
 * 為什麼自己寫：`packages/ui` 的 Popover / Menu / Dialog 由 UI 代理並行開發中，
 * 尚未 export。這裡提供編輯器需要的最小子集，介面刻意與 02 §4.4 對齊，
 * 之後換成 `@kennote/ui` 的版本只需改 import（見 README「決策」）。
 *
 * 規範遵循：
 *  - Esc 只關閉最上層（overlayStack）
 *  - 點外部關閉，關閉時還原焦點至觸發元素
 *  - Popover 不鎖捲動，但外層捲動時重算定位
 *  - 動畫用原生 CSS transition，遵循 prefers-reduced-motion
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { positionFloating, type Placement, type RectLike } from '../lib/floating';

/* ── overlay stack：Esc 只關最上層 ─────────────────────── */

const stack: { close: () => void }[] = [];

function attachStackListener(): void {
  if (stack.length !== 1) return;
  document.addEventListener('keydown', onStackKeyDown, true);
}

function detachStackListener(): void {
  if (stack.length !== 0) return;
  document.removeEventListener('keydown', onStackKeyDown, true);
}

function onStackKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (!top) return;
  event.preventDefault();
  event.stopPropagation();
  top.close();
}

export function useOverlayStack(open: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const entry = { close: () => closeRef.current() };
    stack.push(entry);
    attachStackListener();
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      detachStackListener();
    };
  }, [open]);
}

export function overlayDepth(): number {
  return stack.length;
}

/* ── 點外部關閉 ────────────────────────────────────────── */

export function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  handler: () => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onDown = (event: PointerEvent): void => {
      const el = ref.current;
      if (!el) return;
      const target = event.target;
      if (target instanceof Node && el.contains(target)) return;
      // 讓其他浮層也有機會處理（例如巢狀 popover）
      if (target instanceof Element && target.closest('[data-kn-overlay]') === el) return;
      handlerRef.current();
    };
    // 用 capture 讓它早於編輯器的 pointerdown
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [ref, enabled]);
}

/* ── 焦點還原 ──────────────────────────────────────────── */

export function useReturnFocus(open: boolean): void {
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    const el = previous.current;
    previous.current = null;
    if (el && document.contains(el)) el.focus({ preventScroll: true });
  }, [open]);
}

/* ── 行動版：bottom sheet / 虛擬鍵盤 ───────────────────── */

/** 規格 02 §2.5 的行動版斷點（與 editor.css 的 `@media (max-width: 720px)` 一致） */
export const MOBILE_QUERY = '(max-width: 720px)';

/** 目前是不是行動版寬度。SSR / 沒有 matchMedia 時一律回 false（桌機行為不變）。 */
export function useIsMobileViewport(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_QUERY).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (): void => setMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/**
 * 虛擬鍵盤佔掉之後，**還看得到的**可視區底緣（相對於 layout viewport 的 y）。
 *
 * iOS / Android 的軟鍵盤不會改變 `window.innerHeight`，只會把 `visualViewport`
 * 縮短；`offsetTop` 則是頁面被推上去的距離。兩者相加就是鍵盤上緣。
 * 沒有 `visualViewport`（或鍵盤沒開）時回 `null`，呼叫端就走原本的定位。
 */
export function keyboardTop(): number | null {
  const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
  if (!vv) return null;
  const bottom = vv.offsetTop + vv.height;
  // 少於 80px 的差距多半是網址列收合，不是鍵盤
  if (window.innerHeight - bottom < 80) return null;
  return bottom;
}

/** `visualViewport` 變動（鍵盤開合、捲動）時重新計算 */
export function useVisualViewport(enabled: boolean, onChange: () => void): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!enabled || !vv) return;
    const handler = (): void => cb.current();
    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    return () => {
      vv.removeEventListener('resize', handler);
      vv.removeEventListener('scroll', handler);
    };
  }, [enabled]);
}

/* ── Popover ───────────────────────────────────────────── */

export interface PopoverProps {
  anchor: RectLike | null;
  open: boolean;
  onClose(): void;
  placement?: Placement;
  offset?: number;
  children: ReactNode;
  className?: string;
  role?: 'menu' | 'dialog' | 'listbox';
  ariaLabel?: string;
  /** 為 true 時不攔截 pointerdown 的預設行為（例如需要讓輸入框取得焦點） */
  allowFocus?: boolean;
  /** 點外部是否關閉 */
  closeOnOutside?: boolean;
  maxHeight?: number;
  /**
   * 行動版改成「由下滑入、佔 60% 高」的 bottom sheet（規格 02 §2.5）。
   * 桌機寬度時這個 flag 完全沒作用，維持原本的 anchored popover。
   */
  sheetOnMobile?: boolean;
  /**
   * 行動版虛擬鍵盤打開時，把浮層吸在鍵盤上緣（`visualViewport`）。
   * 給浮動工具列用：鍵盤蓋住的位置放工具列等於沒有工具列。
   */
  keyboardAware?: boolean;
}

export function Popover({
  anchor,
  open,
  onClose,
  placement = 'bottom-start',
  offset = 6,
  children,
  className,
  role = 'menu',
  ariaLabel,
  allowFocus = false,
  closeOnOutside = true,
  maxHeight,
  sheetOnMobile = false,
  keyboardAware = false,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const mobile = useIsMobileViewport();
  const sheet = sheetOnMobile && mobile;

  useOverlayStack(open, onClose);
  useOutsideClick(ref, onClose, open && closeOnOutside);

  const reposition = useCallback(() => {
    const el = ref.current;
    if (!el || !anchor || sheet) return;
    const rect = el.getBoundingClientRect();
    const result = positionFloating(
      anchor,
      { width: rect.width || 260, height: rect.height || 200 },
      { placement, offset },
    );
    let top = result.top;
    let limit = result.maxHeight;
    // 鍵盤上緣吸附：浮層底部不能低於 visualViewport 的底緣
    const kb = keyboardAware ? keyboardTop() : null;
    if (kb !== null) {
      const h = rect.height || 40;
      top = Math.max(8, Math.min(top, kb - h - 8));
      limit = Math.min(limit, kb - top - 8);
    }
    setPos({ left: result.left, top, maxHeight: limit });
  }, [anchor, placement, offset, sheet, keyboardAware]);

  useVisualViewport(open && keyboardAware && !sheet, reposition);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (): void => reposition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, reposition]);

  if (!open || !anchor) return null;

  const onPointerDown = (event: ReactPointerEvent): void => {
    // 不讓編輯器失去 selection（除非浮層裡有輸入框）
    if (!allowFocus) event.preventDefault();
    event.stopPropagation();
  };

  if (sheet) {
    return createPortal(
      <>
        <div className="kn-sheet-backdrop" data-kn-sheet-backdrop="" onPointerDown={() => onClose()} />
        <div
          ref={ref}
          data-kn-overlay=""
          data-sheet="true"
          className={`kn-popover kn-popover--sheet ${className ?? ''}`}
          role={role}
          aria-label={ariaLabel}
          onPointerDown={onPointerDown}
        >
          <div className="kn-sheet-grip" aria-hidden="true" />
          {children}
        </div>
      </>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={ref}
      data-kn-overlay=""
      className={`kn-popover ${className ?? ''}`}
      role={role}
      aria-label={ariaLabel}
      style={{
        left: pos?.left ?? anchor.left,
        top: pos?.top ?? anchor.bottom + offset,
        maxHeight: maxHeight ?? pos?.maxHeight,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onPointerDown={onPointerDown}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ── 選單項目 ──────────────────────────────────────────── */

export interface MenuItemProps {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  description?: ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect?(): void;
  onMouseEnter?(): void;
}

export function MenuItem({
  icon,
  label,
  hint,
  description,
  active,
  danger,
  disabled,
  onSelect,
  onMouseEnter,
}: MenuItemProps) {
  return (
    <div
      className="kn-menu-item"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      data-active={active ? 'true' : undefined}
      data-danger={danger ? 'true' : undefined}
      onMouseEnter={onMouseEnter}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={() => {
        if (!disabled) onSelect?.();
      }}
    >
      {icon ? <span className="kn-menu-item-icon">{icon}</span> : null}
      <span className="kn-menu-item-body">
        <span className="kn-menu-item-label">{label}</span>
        {description ? <span className="kn-menu-item-desc">{description}</span> : null}
      </span>
      {hint ? <span className="kn-menu-item-hint">{hint}</span> : null}
    </div>
  );
}

export function MenuGroup({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="kn-menu-group" role="group">
      {title ? <div className="kn-menu-group-title">{title}</div> : null}
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div className="kn-menu-separator" role="separator" />;
}
