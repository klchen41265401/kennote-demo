import {
  useCallback,
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { OverlayPortal } from '../overlay/OverlayRoot.js';
import { useOverlay } from '../overlay/useOverlay.js';
import { createFocusTrap } from '../overlay/focus-trap.js';
import { Icon } from '../icons/Icon.js';
import { IconButton } from './IconButton.js';
import styles from './Dialog.module.css';
import { cx } from './cx.js';

export type DialogSize = 'sm' | 'md' | 'lg' | 'search' | 'full';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: DialogSize;
  /** 'center'（預設）或 'top'（搜尋型 modal，距頂端 15vh）。 */
  align?: 'center' | 'top';
  /** 右上角關閉鈕，預設 true。 */
  showClose?: boolean;
  /** 點遮罩關閉，預設 true。 */
  closeOnBackdrop?: boolean;
  /** Esc 關閉，預設 true。 */
  closeOnEsc?: boolean;
  /** 開啟時先聚焦的元素。 */
  initialFocus?: RefObject<HTMLElement | null>;
  /** 設為 inert 的背景根元素（通常 document.getElementById('root')）。 */
  inertRoot?: HTMLElement | null;
  footer?: ReactNode;
  /** body 不要內距（例如整塊是清單）。 */
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Modal 對話框。
 * focus trap + inert 背景 + 捲動鎖 + role="dialog"/aria-modal（§4.4.5、§4.7.3）。
 * 動畫：遮罩淡入、面板淡入 + 上移 8px，reduced-motion 下即時顯示。
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  align = 'center',
  showClose = true,
  closeOnBackdrop = true,
  closeOnEsc = true,
  initialFocus,
  inertRoot,
  footer,
  flush = false,
  className,
  style,
  children,
}: DialogProps): JSX.Element | null {
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  const autoId = useId();
  const titleId = `${autoId}-title`;
  const descId = `${autoId}-desc`;

  const overlay = useOverlay({
    open,
    level: 'modal',
    closeOnOutside: closeOnBackdrop,
    closeOnEsc,
    trapFocus: true,
    lockScroll: true,
    onClose,
  });

  useEffect(() => {
    if (!open || !panelEl) return;
    return createFocusTrap(panelEl, {
      initialFocus: initialFocus?.current ?? null,
      restoreFocus: true,
      inertRoot: inertRoot ?? null,
    });
  }, [open, panelEl, initialFocus, inertRoot]);

  const setPanel = useCallback(
    (node: HTMLDivElement | null) => {
      setPanelEl(node);
      overlay.setFloating(node);
    },
    [overlay],
  );

  if (!open) return null;

  return (
    <OverlayPortal>
      <div
        className={cx(styles['backdrop'], align === 'top' ? styles['alignTop'] : styles['alignCenter'])}
        style={{ zIndex: overlay.zIndex }}
        onPointerDown={(e) => {
          // 只認「按在遮罩本身」，避免從面板內拖曳到遮罩時誤關。
          if (closeOnBackdrop && e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={setPanel}
          id={overlay.id ?? autoId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descId : undefined}
          className={cx(styles['panel'], styles[size], className)}
          style={style}
        >
          {title || showClose ? (
            <div className={styles['header']}>
              {title ? (
                <h2 id={titleId} className={styles['title']}>
                  {title}
                </h2>
              ) : (
                <span className={styles['title']} />
              )}
              {showClose ? (
                <IconButton
                  className={styles['closeButton']}
                  label="關閉"
                  size="sm"
                  onClick={onClose}
                >
                  <Icon name="close" size={16} />
                </IconButton>
              ) : null}
            </div>
          ) : null}
          {description ? (
            <p id={descId} className={styles['description']}>
              {description}
            </p>
          ) : null}
          <div className={cx(styles['body'], flush && styles['bodyFlush'], 'kn-scroll')}>{children}</div>
          {footer ? <div className={styles['footer']}>{footer}</div> : null}
        </div>
      </div>
    </OverlayPortal>
  );
}
