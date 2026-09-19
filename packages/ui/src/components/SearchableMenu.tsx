import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Icon } from '../icons/Icon.js';
import { Popover, type PopoverProps } from './Popover.js';
import { Kbd } from './Kbd.js';
import styles from './Menu.module.css';
import { cx } from './cx.js';

export interface SearchableMenuItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  /** 額外的比對關鍵字（例如 'h1' 對應「標題 1」）。 */
  keywords?: readonly string[];
  shortcut?: string;
  /** 分組標題；同一個 group 的項目會被收在一起。 */
  group?: string;
  disabled?: boolean;
}

export interface SearchableMenuHandle {
  /** 上下移動高亮（供外部鍵盤處理，例如 slash menu 在編輯器裡打字時）。 */
  move: (delta: number) => void;
  /** 選取目前高亮的項目。 */
  selectActive: () => boolean;
  activeId: string | null;
}

export interface SearchableMenuProps
  extends Omit<PopoverProps, 'role' | 'padded' | 'children' | 'trapFocus'> {
  items: readonly SearchableMenuItem[];
  /** 受控查詢字串（slash menu 由編輯器輸入時用）。 */
  query?: string;
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;
  /** 顯示內建搜尋框，預設 true。設 false 時請用 query 從外部餵。 */
  searchable?: boolean;
  placeholder?: string;
  emptyMessage?: ReactNode;
  /** 分組顯示順序；沒列到的照第一次出現的順序排在後面。 */
  groupOrder?: readonly string[];
  /** 自訂過濾；預設比對 label + keywords（不分大小寫、子字串）。 */
  filter?: (item: SearchableMenuItem, query: string) => boolean;
  onSelect?: (item: SearchableMenuItem) => void;
  footer?: ReactNode;
  maxHeight?: number;
  handleRef?: Ref<SearchableMenuHandle>;
}

function defaultFilter(item: SearchableMenuItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.label.toLowerCase().includes(q)) return true;
  if (item.description?.toLowerCase().includes(q)) return true;
  return (item.keywords ?? []).some((k) => k.toLowerCase().includes(q));
}

/**
 * 可搜尋選單：slash menu、快速尋找、屬性型別選單共用。
 * 自己管理高亮索引（而非交給 MenuList），這樣 query 改變時可以立刻把高亮拉回第一筆，
 * 也能把 move/selectActive 交給外部（編輯器裡打字時焦點不在選單上）。
 */
export function SearchableMenu({
  items,
  query: controlledQuery,
  defaultQuery = '',
  onQueryChange,
  searchable = true,
  placeholder = '搜尋…',
  emptyMessage = '沒有符合的項目',
  groupOrder,
  filter = defaultFilter,
  onSelect,
  footer,
  maxHeight = 320,
  handleRef,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
  ...popover
}: SearchableMenuProps): JSX.Element {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpenControlled = controlledOpen !== undefined;
  const open = isOpenControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isOpenControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isOpenControlled, onOpenChange],
  );

  const [uncontrolledQuery, setUncontrolledQuery] = useState(defaultQuery);
  const query = controlledQuery ?? uncontrolledQuery;
  const setQuery = useCallback(
    (next: string) => {
      if (controlledQuery === undefined) setUncontrolledQuery(next);
      onQueryChange?.(next);
    },
    [controlledQuery, onQueryChange],
  );

  const filtered = useMemo(() => items.filter((i) => filter(i, query)), [items, query, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, SearchableMenuItem[]>();
    for (const item of filtered) {
      const key = item.group ?? '';
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    const keys = [...map.keys()];
    if (groupOrder) {
      keys.sort((a, b) => {
        const ia = groupOrder.indexOf(a);
        const ib = groupOrder.indexOf(b);
        return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
      });
    }
    return keys.map((key) => [key, map.get(key) ?? []] as const);
  }, [filtered, groupOrder]);

  const selectable = useMemo(() => filtered.filter((i) => !i.disabled), [filtered]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // query 或項目變動時把高亮拉回第一筆。
  useEffect(() => {
    setActiveId(selectable[0]?.id ?? null);
  }, [selectable]);

  const move = useCallback(
    (delta: number) => {
      if (selectable.length === 0) return;
      const current = selectable.findIndex((i) => i.id === activeId);
      const next = current === -1 ? (delta > 0 ? 0 : selectable.length - 1) : current + delta;
      const wrapped = ((next % selectable.length) + selectable.length) % selectable.length;
      const target = selectable[wrapped];
      if (!target) return;
      setActiveId(target.id);
      const nodes = listRef.current?.querySelectorAll<HTMLElement>('[data-item-id]');
      if (nodes) {
        for (const node of nodes) {
          if (node.dataset['itemId'] === target.id) {
            node.scrollIntoView?.({ block: 'nearest' });
            break;
          }
        }
      }
    },
    [selectable, activeId],
  );

  const choose = useCallback(
    (item: SearchableMenuItem) => {
      if (item.disabled) return;
      onSelect?.(item);
      setOpen(false);
    },
    [onSelect, setOpen],
  );

  const selectActive = useCallback((): boolean => {
    const item = selectable.find((i) => i.id === activeId);
    if (!item) return false;
    choose(item);
    return true;
  }, [selectable, activeId, choose]);

  useImperativeHandle(handleRef, () => ({ move, selectActive, activeId }), [
    move,
    selectActive,
    activeId,
  ]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        const first = selectable[0];
        if (first) setActiveId(first.id);
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = selectable[selectable.length - 1];
        if (last) setActiveId(last.id);
      } else if (e.key === 'Enter') {
        if (selectActive()) e.preventDefault();
      }
    },
    [move, selectActive, selectable],
  );

  return (
    <Popover
      role="none"
      haspopup="menu"
      padded={false}
      trapFocus={searchable}
      open={open}
      onOpenChange={setOpen}
      className={cx(styles['searchable'], className)}
      {...popover}
    >
      <div
        style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight }}
        onKeyDown={onKeyDown}
      >
        {searchable ? (
          <div className={styles['searchBox']}>
            <Icon name="search" size={16} />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              className={styles['searchInput']}
              value={query}
              placeholder={placeholder}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={placeholder}
            />
          </div>
        ) : null}
        <div ref={listRef} className={cx(styles['searchResults'], 'kn-scroll')} role="menu">
          {filtered.length === 0 ? (
            <div className={styles['empty']}>{emptyMessage}</div>
          ) : (
            groups.map(([groupName, groupItems]) => (
              <div key={groupName || '_'} className={styles['group']} role="group">
                {groupName ? <div className={styles['groupLabel']}>{groupName}</div> : null}
                {groupItems.map((item) => (
                  <div
                    key={item.id}
                    role="menuitem"
                    tabIndex={-1}
                    data-item-id={item.id}
                    data-active={item.id === activeId || undefined}
                    data-disabled={item.disabled || undefined}
                    aria-disabled={item.disabled || undefined}
                    className={styles['item']}
                    onPointerEnter={() => !item.disabled && setActiveId(item.id)}
                    onClick={() => choose(item)}
                  >
                    {item.icon ? <span className={styles['itemIcon']}>{item.icon}</span> : null}
                    <span className={styles['itemBody']}>
                      <span className={styles['itemLabel']}>{item.label}</span>
                      {item.description ? (
                        <span className={styles['itemDescription']}>{item.description}</span>
                      ) : null}
                    </span>
                    {item.shortcut ? (
                      <span className={styles['itemTrailing']}>
                        <Kbd keys={item.shortcut} />
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        {footer ? <div className={styles['footer']}>{footer}</div> : null}
      </div>
    </Popover>
  );
}
