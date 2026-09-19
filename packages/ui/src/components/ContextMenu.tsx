import { useCallback, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { makeRect, type RectLike } from '../positioning/index.js';
import { Menu, type MenuProps } from './Menu.js';

export interface UseContextMenuResult {
  /** 掛到目標元素的 onContextMenu。 */
  onContextMenu: (e: ReactMouseEvent) => void;
  /** 以指標位置為錨點的 rect（Popover 支援 DOMRect 錨點）。 */
  anchor: RectLike | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** 以任意座標開啟（例如長按觸發）。 */
  openAt: (x: number, y: number) => void;
  close: () => void;
}

/** 右鍵選單的狀態管理。錨點是指標位置，不是元素。 */
export function useContextMenu(): UseContextMenuResult {
  const [anchor, setAnchor] = useState<RectLike | null>(null);

  const openAt = useCallback((x: number, y: number) => {
    setAnchor(makeRect(x, y, 0, 0));
  }, []);

  const onContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openAt(e.clientX, e.clientY);
    },
    [openAt],
  );

  return {
    onContextMenu,
    anchor,
    open: anchor !== null,
    setOpen: (next: boolean) => {
      if (!next) setAnchor(null);
    },
    openAt,
    close: () => setAnchor(null),
  };
}

export interface ContextMenuProps extends Omit<MenuProps, 'anchor' | 'trigger' | 'open'> {
  /** 要掛右鍵選單的內容。 */
  children?: ReactNode;
  /** 選單內容。 */
  menu: ReactNode;
  disabled?: boolean;
  /** 包住 children 的容器 className。 */
  className?: string;
}

/**
 * 右鍵選單。錨定於指標位置，role="menu" + 方向鍵導覽 + 首字母跳轉（§4.4.6）。
 * 需要更細控制時改用 useContextMenu() + <Menu anchor={rect} />。
 */
export function ContextMenu({
  children,
  menu,
  disabled = false,
  className,
  placement = 'bottom-start',
  ...menuProps
}: ContextMenuProps): JSX.Element {
  const ctx = useContextMenu();
  return (
    <>
      <div className={className} onContextMenu={disabled ? undefined : ctx.onContextMenu}>
        {children}
      </div>
      <Menu
        open={ctx.open}
        onOpenChange={ctx.setOpen}
        anchor={ctx.anchor}
        placement={placement}
        offset={2}
        {...menuProps}
      >
        {menu}
      </Menu>
    </>
  );
}
