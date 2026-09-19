import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { Icon } from '../icons/Icon.js';
import { Popover, type PopoverProps } from './Popover.js';
import { MenuList, useMenuItem, useMenuListContext, type MenuListProps } from './MenuList.js';
import { Kbd } from './Kbd.js';
import styles from './Menu.module.css';
import { cx } from './cx.js';

/** 子選單 hover 開啟的延遲（§4.7.4）。 */
const SUBMENU_OPEN_DELAY = 300;

export interface MenuProps extends Omit<PopoverProps, 'role' | 'padded' | 'children'> {
  /** 傳給內層 MenuList。 */
  listProps?: Omit<MenuListProps, 'children'>;
  /** 'menu'（預設）或 'listbox'。 */
  listRole?: 'menu' | 'listbox';
  children?: ReactNode;
}

/**
 * Notion 風格的下拉選單。
 * 定位走 §4.5、堆疊走 §4.7.2、鍵盤導覽走 MenuList（roving tabindex + 打字搜尋）。
 */
export function Menu({
  listProps,
  listRole = 'menu',
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  trapFocus = true,
  ...popover
}: MenuProps): JSX.Element {
  // 選到項目後要能自己關掉，所以非受控時也要握有 open 狀態。
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolled;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  return (
    <Popover
      role="none"
      haspopup={listRole}
      padded={false}
      trapFocus={trapFocus}
      open={open}
      onOpenChange={setOpen}
      {...popover}
    >
      <MenuList role={listRole} onSelected={close} {...listProps}>
        {children}
      </MenuList>
    </Popover>
  );
}

export interface MenuItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  /** 左側圖示。 */
  icon?: ReactNode;
  /** 主文字；為了打字搜尋，非字串時請一併給 textValue。 */
  children?: ReactNode;
  /** 打字搜尋比對用的文字。 */
  textValue?: string;
  /** 第二行說明（slash menu 用）。 */
  description?: ReactNode;
  /** 右側快捷鍵，例如 'mod+k'。 */
  shortcut?: string;
  /** 右側自訂內容（會蓋掉 shortcut）。 */
  trailing?: ReactNode;
  /** 顯示勾勾（多選選單）。 */
  checked?: boolean;
  disabled?: boolean;
  /** 危險操作（紅字）。 */
  danger?: boolean;
  /** 選取時呼叫；預設會關閉選單。 */
  onSelect?: () => void;
  /** 選取後不要關閉選單（多選）。 */
  closeOnSelect?: boolean;
}

export function MenuItem({
  icon,
  children,
  textValue,
  description,
  shortcut,
  trailing,
  checked,
  disabled = false,
  danger = false,
  onSelect,
  closeOnSelect = true,
  className,
  onPointerEnter,
  ...rest
}: MenuItemProps): JSX.Element {
  const text = textValue ?? (typeof children === 'string' ? children : '');
  const ctxRef = useRef<ReturnType<typeof useMenuListContext>>(null);

  const select = useCallback(() => {
    if (disabled) return;
    onSelect?.();
    if (closeOnSelect) ctxRef.current?.onSelected();
  }, [disabled, onSelect, closeOnSelect]);

  const item = useMenuItem({ disabled, text, onSelect: select });
  ctxRef.current = item.ctx;

  return (
    <div
      ref={item.ref}
      role="menuitem"
      tabIndex={item.isActive ? 0 : -1}
      data-active={item.isActive || undefined}
      data-disabled={disabled || undefined}
      data-danger={danger || undefined}
      aria-disabled={disabled || undefined}
      className={cx(styles['item'], className)}
      onClick={select}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        if (!disabled && !item.ctx?.isPointerSafe()) item.ctx?.setActiveId(item.id);
      }}
      {...rest}
    >
      {icon ? <span className={styles['itemIcon']}>{icon}</span> : null}
      <span className={styles['itemBody']}>
        <span className={styles['itemLabel']}>{children}</span>
        {description ? <span className={styles['itemDescription']}>{description}</span> : null}
      </span>
      {trailing ?? (shortcut ? <span className={styles['itemTrailing']}><Kbd keys={shortcut} /></span> : null)}
      {checked ? (
        <span className={styles['itemCheck']}>
          <Icon name="check" size={16} />
        </span>
      ) : null}
    </div>
  );
}

export type MenuSeparatorProps = HTMLAttributes<HTMLDivElement>;

export function MenuSeparator({ className, ...rest }: MenuSeparatorProps): JSX.Element {
  return <div role="separator" className={cx(styles['separator'], className)} {...rest} />;
}

export interface MenuGroupProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
  children?: ReactNode;
}

export function MenuGroup({ label, children, className, ...rest }: MenuGroupProps): JSX.Element {
  return (
    <div role="group" aria-label={typeof label === 'string' ? label : undefined} className={cx(styles['group'], className)} {...rest}>
      {label ? <div className={styles['groupLabel']}>{label}</div> : null}
      {children}
    </div>
  );
}

export interface SubMenuProps {
  icon?: ReactNode;
  label: ReactNode;
  textValue?: string;
  disabled?: boolean;
  children?: ReactNode;
}

/**
 * 子選單。hover 300ms 延遲開啟 + 安全三角形（滑鼠往子選單移動時不切換項目）。
 * ArrowRight / Enter 也能開啟；子選單會登記在 overlayStack 的上一層，Esc 只關它。
 */
export function SubMenu({ icon, label, textValue, disabled = false, children }: SubMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = textValue ?? (typeof label === 'string' ? label : '');

  const item = useMenuItem({
    disabled,
    text,
    onSelect: () => setOpen(true),
    openSubmenu: () => setOpen(true),
  });

  const clear = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => clear, []);

  // 子選單開啟後把它的 rect 給父層，做安全三角形判定。
  const floatingRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const ctx = item.ctx;
    if (!ctx) return;
    if (!open) {
      ctx.setSafeRect(null);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const rect = floatingRef.current?.getBoundingClientRect();
      ctx.setSafeRect(rect ?? null);
    });
    return () => {
      cancelAnimationFrame(raf);
      ctx.setSafeRect(null);
    };
  }, [open, item.ctx]);

  return (
    <>
      <div
        ref={(node) => {
          anchorRef.current = node;
          item.ref(node);
        }}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={item.isActive ? 0 : -1}
        data-active={item.isActive || open || undefined}
        data-disabled={disabled || undefined}
        className={styles['item']}
        onPointerEnter={() => {
          if (disabled) return;
          if (item.ctx?.isPointerSafe()) return;
          item.ctx?.setActiveId(item.id);
          clear();
          timerRef.current = setTimeout(() => setOpen(true), SUBMENU_OPEN_DELAY);
        }}
        onPointerLeave={clear}
        onClick={() => !disabled && setOpen(true)}
      >
        {icon ? <span className={styles['itemIcon']}>{icon}</span> : null}
        <span className={styles['itemBody']}>
          <span className={styles['itemLabel']}>{label}</span>
        </span>
        <span className={styles['itemTrailing']}>
          <Icon name="chevron-right" size={16} />
        </span>
      </div>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchor={() => anchorRef.current}
        placement="right-start"
        offset={4}
        role="none"
        haspopup="menu"
        padded={false}
        trapFocus
      >
        <MenuList
          role="menu"
          onSelected={() => {
            setOpen(false);
            item.ctx?.onSelected();
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setOpen(false);
            }
          }}
        >
          <span
            hidden
            ref={(node) => {
              // 把子選單的實際 DOM 交給父層做安全三角形判定。
              floatingRef.current = node?.parentElement ?? null;
            }}
          />
          {children}
        </MenuList>
      </Popover>
    </>
  );
}
