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
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  useOverlayStack(open, onClose);
  useOutsideClick(ref, onClose, open && closeOnOutside);

  const reposition = useCallback(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const rect = el.getBoundingClientRect();
    const result = positionFloating(
      anchor,
      { width: rect.width || 260, height: rect.height || 200 },
      { placement, offset },
    );
    setPos({ left: result.left, top: result.top, maxHeight: result.maxHeight });
  }, [anchor, placement, offset]);

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
      onPointerDown={(event) => {
        // 不讓編輯器失去 selection（除非浮層裡有輸入框）
        if (!allowFocus) event.preventDefault();
        event.stopPropagation();
      }}
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
