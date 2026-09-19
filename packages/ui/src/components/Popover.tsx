import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { OverlayPortal } from '../overlay/OverlayRoot.js';
import { useOverlay } from '../overlay/useOverlay.js';
import { createFocusTrap } from '../overlay/focus-trap.js';
import type { OverlayLevel } from '../overlay/stack.js';
import type { AutoUpdateOptions, Placement } from '../positioning/index.js';
import { useFloating, type FloatingAnchor } from './useFloating.js';
import { cloneTrigger } from './trigger.js';
import styles from './Popover.module.css';
import { cx } from './cx.js';

export interface PopoverProps {
  /** 受控模式。不給就是非受控（由 trigger 自行 toggle）。 */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * 錨點。可以是：
   *  - 不給 → 用 trigger 元素
   *  - DOM 元素
   *  - DOMRect / RectLike（浮動工具列、slash menu 的 caret rect）
   *  - 回傳上述兩者的函式（每次重新定位時呼叫）
   */
  anchor?: FloatingAnchor;
  /**
   * 觸發元素。onClick / aria-* / ref 會用 cloneElement **直接合併到這個元素上**
   * （asChild 語意），所以 trigger 內部即使 stopPropagation() 也照常開得起來。
   * 原本的 onClick 會先被呼叫；它若 preventDefault() 就不會 toggle。
   */
  trigger?: ReactNode;
  /**
   * `false` 時改回「包一層 inline-flex span」的舊行為（trigger 不是單一元素時也會自動退回）。
   * 預設 `true`。
   */
  asChild?: boolean;
  placement?: Placement;
  offset?: number;
  flip?: boolean;
  shift?: boolean;
  padding?: number;
  /** 寬度對齊錨點（下拉選單常用）。 */
  matchWidth?: boolean;
  /** 顯示指向錨點的小箭頭。 */
  arrow?: boolean;
  level?: OverlayLevel;
  closeOnOutside?: boolean;
  closeOnEsc?: boolean;
  /** 開啟時把焦點關在浮層內（選單、表單類浮層建議開）。 */
  trapFocus?: boolean;
  /** 開啟時先聚焦的元素。 */
  initialFocus?: RefObject<HTMLElement | null>;
  autoUpdateOptions?: AutoUpdateOptions;
  /** 浮層本身的 role。內容自帶 role（例如 MenuList）時請傳 'none'，避免巢狀重複 role。 */
  role?: 'dialog' | 'menu' | 'listbox' | 'tooltip' | 'none';
  /** trigger 的 aria-haspopup；預設由 role 推導。 */
  haspopup?: 'dialog' | 'menu' | 'listbox' | false;
  'aria-label'?: string;
  className?: string;
  style?: CSSProperties;
  /** 內距（選單自己控制內距時設 false）。 */
  padded?: boolean;
  children?: ReactNode;
}

/**
 * 錨定浮層。§4.5 的定位 + §4.7.2 的堆疊。
 * anchor 可為 Element 或 DOMRect —— 後者供 inline 浮動工具列與 slash menu 使用。
 */
export function Popover(props: PopoverProps): JSX.Element {
  const {
    open: controlledOpen,
    defaultOpen = false,
    onOpenChange,
    anchor,
    trigger,
    asChild = true,
    placement = 'bottom-start',
    offset = 6,
    flip = true,
    shift = true,
    padding = 8,
    matchWidth = false,
    arrow = false,
    level = 'dropdown',
    closeOnOutside = true,
    closeOnEsc = true,
    trapFocus = false,
    initialFocus,
    autoUpdateOptions,
    role = 'dialog',
    haspopup,
    className,
    style,
    padded = true,
    children,
  } = props;

  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolled;
  const triggerRef = useRef<HTMLElement | null>(null);
  const floatingElRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const overlay = useOverlay({
    open,
    level,
    closeOnOutside,
    closeOnEsc,
    trapFocus,
    onClose: () => setOpen(false),
    anchor: () => triggerRef.current,
  });

  const resolvedAnchor: FloatingAnchor = anchor ?? (() => triggerRef.current);
  const floating = useFloating({
    open,
    anchor: resolvedAnchor,
    placement,
    offset,
    flip,
    shift,
    padding,
    matchWidth,
    ...(arrow ? { arrow: true as const } : {}),
    ...(autoUpdateOptions ? { autoUpdateOptions } : {}),
  });

  // focus trap（§4.7.3）。關閉時會自動把焦點還給觸發元素。
  useEffect(() => {
    if (!open || !trapFocus) return;
    const node = floatingElRef.current;
    if (!node) return;
    return createFocusTrap(node, {
      initialFocus: initialFocus?.current ?? null,
      restoreFocus: true,
    });
  }, [open, trapFocus, initialFocus, floating.position !== null]);

  const setFloatingNode = useCallback(
    (node: HTMLDivElement | null) => {
      floatingElRef.current = node;
      floating.setFloating(node);
      overlay.setFloating(node);
    },
    [floating, overlay],
  );

  const triggerAria = {
    'aria-expanded': open,
    'aria-haspopup':
      haspopup === false
        ? undefined
        : (haspopup ?? (role === 'none' || role === 'tooltip' ? undefined : role)),
    'aria-controls': open ? id : undefined,
  };
  const toggle = useCallback(() => setOpen(!open), [setOpen, open]);
  const setTriggerNode = useCallback((node: HTMLElement | null) => {
    triggerRef.current = node;
  }, []);

  /**
   * ⚠️ 開關用的 onClick 必須掛在 trigger 元素本身，不能掛在包住它的 <span>：
   * 外層 span 收的是冒泡上來的事件，trigger 內部只要 stopPropagation()（很常見，
   * 例如一列同時有導頁與 ⋯ 按鈕），選單就永遠打不開。
   */
  const clonedTrigger = asChild
    ? cloneTrigger(trigger, {
        props: { ...triggerAria, onClick: toggle },
        ref: setTriggerNode,
        compose: ['onClick'],
      })
    : null;

  const triggerNode =
    clonedTrigger ??
    (trigger ? (
      // trigger 不是單一 React 元素（字串、fragment…）時才需要一個實體錨點。
      <span ref={setTriggerNode} className={styles['anchor']} onClick={toggle} {...triggerAria}>
        {trigger}
      </span>
    ) : null);

  return (
    <>
      {triggerNode}
      {open ? (
        <OverlayPortal>
          <div
            ref={setFloatingNode}
            id={overlay.id ?? id}
            role={role === 'none' ? undefined : role}
            aria-label={props['aria-label']}
            data-side={floating.position?.side}
            data-placement={floating.position?.placement}
            className={cx(
              styles['surface'],
              styles['animate'],
              padded && styles['padded'],
              'kn-scroll',
              className,
            )}
            style={{ ...floating.style, zIndex: overlay.zIndex, ...style }}
          >
            {children}
            {arrow && floating.position?.arrow ? (
              <span
                className={styles['arrow']}
                style={{ left: floating.position.arrow.x, top: floating.position.arrow.y }}
              />
            ) : null}
          </div>
        </OverlayPortal>
      ) : null}
    </>
  );
}

/** 讓任意元素成為 Popover 觸發器的小工具（保留原本的 onClick）。 */
export function asTrigger(
  element: ReactNode,
  extra: { onClick?: () => void },
): ReactNode {
  if (!isValidElement(element)) return element;
  const el = element as ReactElement<{ onClick?: (e: unknown) => void }>;
  return cloneElement(el, {
    onClick: (e: unknown) => {
      el.props.onClick?.(e);
      extra.onClick?.();
    },
  });
}
