import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import styles from './Menu.module.css';
import { cx } from './cx.js';

/** 打字搜尋的緩衝重置時間。 */
const TYPEAHEAD_RESET_MS = 600;

interface ItemMeta {
  node: HTMLElement;
  disabled: boolean;
  text: string;
  onSelect?: () => void;
  openSubmenu?: () => void;
}

export interface MenuListContextValue {
  register: (id: string, meta: ItemMeta) => () => void;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  /** 由 Menu 注入：選擇項目後要不要關閉整個選單。 */
  onSelected: () => void;
  /** 滑鼠正在往子選單移動（安全三角形），此時忽略其他項目的 hover。 */
  isPointerSafe: () => boolean;
  setSafeRect: (rect: DOMRect | null) => void;
  notePointer: (x: number, y: number) => void;
}

const MenuListContext = createContext<MenuListContextValue | null>(null);

export function useMenuListContext(): MenuListContextValue | null {
  return useContext(MenuListContext);
}

export interface MenuListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  /** 'menu'（預設）或 'listbox'（Select 用）。 */
  role?: 'menu' | 'listbox' | 'group';
  /** 選到項目後呼叫（Menu 用來關閉浮層）。 */
  onSelected?: () => void;
  /** 掛載後自動聚焦第一個項目，預設 true。 */
  autoFocus?: boolean;
  /** 關閉打字搜尋（SearchableMenu 有自己的輸入框）。 */
  typeahead?: boolean;
  children?: ReactNode;
}

/**
 * 選單容器：roving tabindex、↑↓/Home/End、打字搜尋、Enter/Space 選取。
 * 項目順序依 DOM 位置決定，所以 MenuGroup / 條件渲染都不會弄亂導覽。
 */
export function MenuList({
  role = 'menu',
  onSelected,
  autoFocus = true,
  typeahead = true,
  className,
  children,
  onKeyDown,
  ...rest
}: MenuListProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(new Map<string, ItemMeta>());
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const bufferRef = useRef('');
  const bufferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safeRectRef = useRef<DOMRect | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const prevPointerRef = useRef<{ x: number; y: number } | null>(null);

  const setActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveIdState(id);
    if (id) itemsRef.current.get(id)?.node.focus({ preventScroll: true });
  }, []);

  /** 依 DOM 順序取得可用項目。 */
  const ordered = useCallback((): Array<[string, ItemMeta]> => {
    const entries = [...itemsRef.current.entries()];
    entries.sort(([, a], [, b]) => {
      const pos = a.node.compareDocumentPosition(b.node);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return entries;
  }, []);

  const enabled = useCallback(
    () => ordered().filter(([, meta]) => !meta.disabled),
    [ordered],
  );

  const register = useCallback((id: string, meta: ItemMeta) => {
    itemsRef.current.set(id, meta);
    return () => {
      itemsRef.current.delete(id);
      if (activeIdRef.current === id) {
        activeIdRef.current = null;
        setActiveIdState(null);
      }
    };
  }, []);

  // 開啟時聚焦第一個項目（§4.4.5.2）。
  useEffect(() => {
    if (!autoFocus) return;
    const first = enabled()[0];
    if (first) setActiveId(first[0]);
    else containerRef.current?.focus({ preventScroll: true });
    // 只在掛載時做一次。
  }, []);

  const move = useCallback(
    (delta: number) => {
      const list = enabled();
      if (list.length === 0) return;
      const current = list.findIndex(([id]) => id === activeIdRef.current);
      const next = current === -1 ? (delta > 0 ? 0 : list.length - 1) : current + delta;
      const wrapped = ((next % list.length) + list.length) % list.length;
      const target = list[wrapped];
      if (target) {
        setActiveId(target[0]);
        target[1].node.scrollIntoView?.({ block: 'nearest' });
      }
    },
    [enabled, setActiveId],
  );

  const jump = useCallback(
    (where: 'first' | 'last') => {
      const list = enabled();
      const target = where === 'first' ? list[0] : list[list.length - 1];
      if (target) {
        setActiveId(target[0]);
        target[1].node.scrollIntoView?.({ block: 'nearest' });
      }
    },
    [enabled, setActiveId],
  );

  const runTypeahead = useCallback(
    (char: string) => {
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
      bufferRef.current += char.toLowerCase();
      bufferTimerRef.current = setTimeout(() => {
        bufferRef.current = '';
      }, TYPEAHEAD_RESET_MS);

      const list = enabled();
      const buffer = bufferRef.current;
      const startAt = list.findIndex(([id]) => id === activeIdRef.current);
      // 從目前項目的下一個開始找，這樣連按同一個字母會在同字首項目間循環。
      const rotated = buffer.length === 1 ? [...list.slice(startAt + 1), ...list.slice(0, startAt + 1)] : list;
      const hit = rotated.find(([, meta]) => meta.text.toLowerCase().startsWith(buffer));
      if (hit) {
        setActiveId(hit[0]);
        hit[1].node.scrollIntoView?.({ block: 'nearest' });
      }
    },
    [enabled, setActiveId],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          move(1);
          return;
        case 'ArrowUp':
          e.preventDefault();
          move(-1);
          return;
        case 'Home':
          e.preventDefault();
          jump('first');
          return;
        case 'End':
          e.preventDefault();
          jump('last');
          return;
        case 'Enter':
        case ' ': {
          const meta = activeIdRef.current ? itemsRef.current.get(activeIdRef.current) : null;
          if (meta && !meta.disabled) {
            e.preventDefault();
            meta.onSelect?.();
          }
          return;
        }
        case 'ArrowRight': {
          const meta = activeIdRef.current ? itemsRef.current.get(activeIdRef.current) : null;
          if (meta?.openSubmenu) {
            e.preventDefault();
            meta.openSubmenu();
          }
          return;
        }
        default:
          break;
      }
      if (typeahead && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        runTypeahead(e.key);
      }
    },
    [move, jump, runTypeahead, typeahead, onKeyDown],
  );

  /**
   * 安全三角形（§4.7.4）：子選單開啟後，滑鼠往子選單方向移動時不要切換項目。
   * 判定：上一個指標位置 → 子選單左上 / 左下 構成的三角形。
   */
  const isPointerSafe = useCallback(() => {
    const rect = safeRectRef.current;
    const curr = pointerRef.current;
    const prev = prevPointerRef.current;
    if (!rect || !curr || !prev) return false;
    // 三角形：上一個指標位置 → 子選單靠近父選單那一側的上下兩角。
    const edgeX = rect.left >= prev.x ? rect.left : rect.right;
    const ax = prev.x;
    const ay = prev.y;
    const sign = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number =>
      (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    const d1 = sign(curr.x, curr.y, ax, ay, edgeX, rect.top);
    const d2 = sign(curr.x, curr.y, edgeX, rect.top, edgeX, rect.bottom);
    const d3 = sign(curr.x, curr.y, edgeX, rect.bottom, ax, ay);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  }, []);

  const contextValue = useMemo<MenuListContextValue>(
    () => ({
      register,
      activeId,
      setActiveId,
      onSelected: () => onSelected?.(),
      isPointerSafe,
      setSafeRect: (rect) => {
        safeRectRef.current = rect;
      },
      notePointer: (x, y) => {
        prevPointerRef.current = pointerRef.current;
        pointerRef.current = { x, y };
      },
    }),
    [register, activeId, setActiveId, onSelected, isPointerSafe],
  );

  useEffect(
    () => () => {
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
    },
    [],
  );

  return (
    <MenuListContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        role={role}
        tabIndex={-1}
        className={cx(styles['list'], className)}
        onKeyDown={handleKeyDown}
        onPointerMove={(e) => contextValue.notePointer(e.clientX, e.clientY)}
        {...rest}
      >
        {children}
      </div>
    </MenuListContext.Provider>
  );
}

/** 讓 MenuItem 取得自己的 id 並登記到容器。 */
export function useMenuItem(meta: {
  disabled: boolean;
  text: string;
  onSelect?: () => void;
  openSubmenu?: () => void;
}): {
  id: string;
  ref: (node: HTMLElement | null) => void;
  isActive: boolean;
  ctx: MenuListContextValue | null;
} {
  const ctx = useMenuListContext();
  const id = useId();
  const nodeRef = useRef<HTMLElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const metaRef = useRef(meta);
  metaRef.current = meta;
  // ctx 的身分每次 activeId 改變都會變；若放進 ref callback 的 deps，
  // React 會在每次 re-render 重跑 ref（先 null 再 node），把剛設定的 active 清掉。
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const ref = useCallback(
    (node: HTMLElement | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      nodeRef.current = node;
      const current = ctxRef.current;
      if (!node || !current) return;
      cleanupRef.current = current.register(id, {
        node,
        get disabled() {
          return metaRef.current.disabled;
        },
        get text() {
          return metaRef.current.text;
        },
        onSelect: () => metaRef.current.onSelect?.(),
        openSubmenu: metaRef.current.openSubmenu ? () => metaRef.current.openSubmenu?.() : undefined,
      } as ItemMeta);
    },
    [id],
  );

  useEffect(() => () => cleanupRef.current?.(), []);

  return { id, ref, isActive: ctx?.activeId === id, ctx };
}
