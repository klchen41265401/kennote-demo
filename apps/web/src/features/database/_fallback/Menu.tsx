import { useEffect, useRef, type ReactNode } from 'react';
import styles from './fallback.module.css';

interface MenuProps {
  children: ReactNode;
  /** 掛載後把焦點放到第一個項目（鍵盤操作） */
  autoFocus?: boolean;
  ariaLabel?: string;
}

/** 極簡選單：方向鍵移動、Enter 觸發、Home/End 跳頭尾 */
export function Menu({ children, autoFocus = true, ariaLabel }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
  }, [autoFocus]);

  function onKeyDown(e: React.KeyboardEvent) {
    const items = [
      ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
    ];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  return (
    <div ref={ref} className={styles.menu} role="menu" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

interface MenuItemProps {
  onSelect?: () => void;
  icon?: ReactNode;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  selected?: boolean;
  /** 右側的次要文字（快捷鍵、目前值） */
  hint?: ReactNode;
}

export function MenuItem({
  onSelect,
  icon,
  children,
  danger,
  disabled,
  selected,
  hint,
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${styles.menuItem} ${danger ? styles.menuItemDanger : ''} ${
        selected ? styles.menuItemSelected : ''
      }`}
      disabled={disabled}
      onClick={() => onSelect?.()}
    >
      {icon ? <span className={styles.menuItemIcon}>{icon}</span> : null}
      <span className={styles.menuItemLabel}>{children}</span>
      {hint ? <span className={styles.menuItemHint}>{hint}</span> : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div className={styles.menuSeparator} role="separator" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className={styles.menuLabel}>{children}</div>;
}
