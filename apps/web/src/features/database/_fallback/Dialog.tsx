import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './fallback.module.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** side peek（Notion 的資料庫列預設樣式）vs 置中 modal */
  variant?: 'center' | 'side';
  width?: number;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  variant = 'center',
  width,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement;
    const timer = setTimeout(() => {
      const target = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current;
      target?.focus();
    }, 0);
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !ref.current) return;
      // focus trap：Tab 不要跑出對話框
      const focusable = [
        ...ref.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      restoreFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.dialogOverlay} onMouseDown={onClose}>
      <div
        ref={ref}
        className={variant === 'side' ? styles.dialogSide : styles.dialogCenter}
        style={width ? { width } : undefined}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title ? <header className={styles.dialogHeader}>{title}</header> : null}
        <div className={styles.dialogBody}>{children}</div>
        {footer ? <footer className={styles.dialogFooter}>{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
