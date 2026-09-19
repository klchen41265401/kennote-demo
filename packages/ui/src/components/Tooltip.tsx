import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { OverlayPortal } from '../overlay/OverlayRoot.js';
import { OVERLAY_Z_INDEX } from '../overlay/stack.js';
import type { Placement } from '../positioning/index.js';
import { useFloating } from './useFloating.js';
import { cloneTrigger } from './trigger.js';
import { Kbd } from './Kbd.js';
import styles from './Popover.module.css';
import { cx } from './cx.js';

/** 開啟延遲（§4.4.1 的 500ms 放寬為 400ms，實測更跟手）。 */
export const TOOLTIP_OPEN_DELAY = 400;
/** 關閉延遲。 */
export const TOOLTIP_CLOSE_DELAY = 100;
/** 離開後多久內再 hover 另一個 tooltip 免延遲（跨元件共享的 delay group）。 */
const GROUP_GRACE = 300;

/** 模組層級的共享狀態：同群組內連續 hover 免延遲。 */
const delayGroup = {
  lastClosedAt: 0,
  openCount: 0,
};

function skipDelay(): boolean {
  if (delayGroup.openCount > 0) return true;
  return Date.now() - delayGroup.lastClosedAt < GROUP_GRACE;
}

/** 觸控裝置不顯示 tooltip（沒有 hover 概念，且會擋住內容）。 */
function isTouch(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

export interface TooltipProps {
  /** 提示內容。 */
  content: ReactNode;
  /** 右側快捷鍵提示，例如 'mod+b'。 */
  shortcut?: string;
  placement?: Placement;
  offset?: number;
  /** 覆寫開啟延遲。 */
  delay?: number;
  disabled?: boolean;
  /** 觸發元素。必須能接受 ref 與滑鼠事件。 */
  children: ReactNode;
}

/**
 * Tooltip：400ms 延遲開啟、100ms 延遲關閉、同群組連續 hover 免延遲、觸控裝置不顯示。
 * 永遠在最上層（z-index 700），且不搶焦點。
 */
export function Tooltip({
  content,
  shortcut,
  placement = 'top',
  offset = 6,
  delay = TOOLTIP_OPEN_DELAY,
  disabled = false,
  children,
}: TooltipProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const floating = useFloating({
    open,
    anchor: () => anchorRef.current,
    placement,
    offset,
    flip: true,
    shift: true,
  });

  const setAnchorNode = useCallback((node: HTMLElement | null) => {
    anchorRef.current = node;
  }, []);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const show = useCallback(() => {
    if (disabled || isTouch()) return;
    clear();
    const wait = skipDelay() ? 0 : delay;
    timerRef.current = setTimeout(() => {
      delayGroup.openCount += 1;
      setOpen(true);
    }, wait);
  }, [disabled, delay, clear]);

  const hide = useCallback(() => {
    clear();
    timerRef.current = setTimeout(() => {
      setOpen((wasOpen) => {
        if (wasOpen) {
          delayGroup.openCount = Math.max(0, delayGroup.openCount - 1);
          delayGroup.lastClosedAt = Date.now();
        }
        return false;
      });
    }, TOOLTIP_CLOSE_DELAY);
  }, [clear]);

  useEffect(
    () => () => {
      clear();
      if (open) delayGroup.openCount = Math.max(0, delayGroup.openCount - 1);
    },
    // 卸載時清乾淨，避免 openCount 洩漏。
    [],
  );

  // Esc 關閉（tooltip 不進 overlayStack，自己處理）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, hide]);

  // props 直接合併到子元素上（asChild 語意）；子元素原本的 handler 會先被呼叫，不會被蓋掉。
  const trigger = cloneTrigger(children, {
    props: {
      onPointerEnter: show,
      onPointerLeave: hide,
      onFocus: show,
      onBlur: hide,
      'aria-describedby': open ? id : undefined,
    },
    ref: setAnchorNode,
    compose: ['onPointerEnter', 'onPointerLeave', 'onFocus', 'onBlur'],
  }) ?? (
    <span
      ref={anchorRef as RefObject<HTMLSpanElement>}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
    </span>
  );

  return (
    <>
      {trigger}
      {open && content ? (
        <OverlayPortal>
          <div
            ref={floating.setFloating}
            id={id}
            role="tooltip"
            data-side={floating.position?.side}
            className={cx(styles['tooltip'])}
            style={{ ...floating.style, zIndex: OVERLAY_Z_INDEX.tooltip }}
          >
            {content}
            {shortcut ? (
              <span className={styles['tooltipShortcut']}>
                <Kbd keys={shortcut} />
              </span>
            ) : null}
          </div>
        </OverlayPortal>
      ) : null}
    </>
  );
}
