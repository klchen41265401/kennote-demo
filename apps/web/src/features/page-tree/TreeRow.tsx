/**
 * 側邊欄的一列頁面。負責：展開/收合、hover 的 `⋯` 與 `+`、右鍵選單、拖曳來源。
 * 資料操作一律呼叫上層傳進來的 actions（這一層不直接打 API）。
 */
import React, { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, Menu, MenuItem, MenuSeparator, Tooltip, useContextMenu, useDraggable } from '@kennote/ui';
import type { TreeNode } from './tree';
import { displayTitle } from './tree';
import styles from './Sidebar.module.css';

export interface TreeRowActions {
  navigate(id: string): void;
  toggle(id: string): void;
  createChild(parentId: string): void;
  rename(id: string, title: string): void;
  duplicate(id: string): void;
  trash(id: string): void;
  copyLink(id: string): void;
  toggleFavorite(id: string, next: boolean): void;
  moveTo(id: string): void;
  /** O-17：在同一層的兄弟之間上 / 下移一格（拖曳的鍵盤替代路徑） */
  reorder(id: string, direction: -1 | 1): void;
  openInNewTab(id: string): void;
}

export interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  active: boolean;
  favorite: boolean;
  actions: TreeRowActions;
  /** 拖曳用的 kind；收藏區與私人區用不同 kind 以免互相落點 */
  dragKind: string;
  /**
   * 拖曳來源 id。**同一頁可能同時出現在「最近」與「私人」兩區**，
   * 而 DragController 的來源表是以 id 為鍵 —— 兩邊用同一個 id 會互相覆蓋，
   * 結果是「不可拖曳的那一列」把「可拖曳的那一列」蓋掉。所以每區要有自己的前綴。
   * 沒給就用 node.id。
   */
  dragId?: string;
  draggable?: boolean;
}

const INDENT = 18;
const BASE_PAD = 8;

export function TreeRow({
  node,
  depth,
  expanded,
  hasChildren,
  active,
  favorite,
  actions,
  dragKind,
  dragId,
  draggable = true,
}: TreeRowProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const ctx = useContextMenu();
  const title = displayTitle(node.title);

  const { setNodeRef, handleProps, isDragging } = useDraggable({
    id: dragId ?? node.id,
    kind: dragKind,
    data: { pageId: node.id, parentId: node.parentId, title },
    disabled: !draggable,
  });

  /**
   * ⚠️ `@kennote/ui` 的 `useDraggable` 在 React 18 StrictMode 下會把自己註銷掉：
   * ref callback 先 `registerSource()`，接著 StrictMode 會把掛載 effect 跑「setup → cleanup → setup」，
   * 而它的 cleanup 就是 `cleanupRef.current?.()` ＝ 反註冊；ref 不會再被呼叫，來源就消失了。
   * 這個 effect 在第二次 setup 時把節點重新註冊回去（`setNodeRef` 本身是冪等的）。
   * 等 primitives 修好（把註銷改成只在真正 unmount 時做）就可以整段刪掉。
   */
  const rowRef = useRef<HTMLDivElement | null>(null);
  const attachRow = useCallback(
    (el: HTMLDivElement | null) => {
      rowRef.current = el;
      setNodeRef(el);
    },
    [setNodeRef],
  );
  useEffect(() => {
    if (rowRef.current) setNodeRef(rowRef.current);
  }, [setNodeRef]);

  /**
   * 為什麼用 pointerup 導頁而不是 click：
   * `useDraggable` 在 pointerdown 就 `setPointerCapture()`，Chrome 會把後續的
   * mouseup / click 重新指派到別的節點（實測 click 的 target 變成 <html>），
   * 於是 React 掛在這一列上的 onClick 永遠收不到 —— 點側邊欄就沒反應了。
   * 這裡改成「pointerdown 記位置、pointerup 沒移動就當成點擊」，
   * 並保留 onClick 當作鍵盤 / 輔助技術的後備（400ms 內不重複導頁）。
   */
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const navigatedAt = useRef(0);

  function go(): void {
    if (renaming) return;
    navigatedAt.current = Date.now();
    actions.navigate(node.id);
  }

  /**
   * ⚠️ `<Menu>` / `<Tooltip>` 的浮層是用 `createPortal` 掛到 overlay root 的，
   * 但 **React 的事件仍然沿著 React 樹冒泡** —— 也就是說在選單項目上按下滑鼠，
   * 這一列的 `onPointerDown` 照樣會收到。接著 `useDraggable` 就 `setPointerCapture()`
   * 到這一列上，後續的 pointerup / click 全被重新指派到列身上：
   * 選單項目收不到 click（重新命名 / 收藏 / 複本 / 移動到 / 垃圾桶全部失效），
   * 反而變成「點了一下這一列」而跳頁。
   * 所以所有列層級的指標 / 鍵盤處理都要先確認事件真的發生在這一列的 DOM 子樹裡。
   */
  function isInsideRow(target: EventTarget | null): boolean {
    const row = rowRef.current;
    return !!row && target instanceof Node && row.contains(target);
  }

  function onPointerDownRow(e: React.PointerEvent<HTMLDivElement>): void {
    if (!isInsideRow(e.target)) return;
    pressRef.current = { x: e.clientX, y: e.clientY };
    if (!draggable) return;
    /**
     * ⚠️ `@kennote/ui` 的 DragController 用 `event.currentTarget` 決定要在哪個元素上
     * `setPointerCapture()`。但它拿到的是 React **合成事件的 nativeEvent**，
     * 而 React 18 的原生監聽掛在 root container 上 —— 於是 `currentTarget` 是 `#root`，
     * 指標就被 `#root` 捕獲，接下來的 pointerup / mouseup / click 全部被重新指派到 `#root`，
     * 側邊欄這一列再也收不到點擊（實測：點了沒反應）。
     * 這裡在把事件交出去之前，先把 `currentTarget` 指回這一列。
     */
    const row = rowRef.current;
    if (row) {
      try {
        Object.defineProperty(e.nativeEvent, 'currentTarget', {
          value: row,
          configurable: true,
        });
      } catch {
        /* 不支援就算了，頂多退回原本的行為 */
      }
    }
    handleProps.onPointerDown(e);
  }

  function onPointerUpRow(e: React.PointerEvent<HTMLDivElement>): void {
    if (!isInsideRow(e.target)) return;
    const start = pressRef.current;
    pressRef.current = null;
    if (!start) return; // pointerdown 被 ⋯ / ＋ / 箭頭攔下了
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return; // 這是拖曳
    go();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (!isInsideRow(e.target)) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      actions.navigate(node.id);
    } else if (e.key === 'ArrowRight' && hasChildren && !expanded) {
      e.preventDefault();
      actions.toggle(node.id);
    } else if (e.key === 'ArrowLeft' && hasChildren && expanded) {
      e.preventDefault();
      actions.toggle(node.id);
    }
  }

  /**
   * O-17（第十三輪）：側邊欄排序的鍵盤替代路徑。
   *
   * 樹狀的搬移有兩個自由度（換父層、換順序）。「移動到」選單早就涵蓋了
   * **換父層**，缺的一直是**同一層之內的順序** —— 那件事只有拖曳做得到。
   * Alt + ↑/↓ 補的就是這一格；`aria-live` 的播報由 Sidebar 統一發
   *（搬完這一列會被重新排序，訊息掛在列上會跟著消失）。
   *
   * ⚠️ 不帶 Alt 的 ↑/↓ 留給樹的巡覽，跟 `onKeyDown` 那幾條同一個理由。
   */
  function onReorderKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (!isInsideRow(e.target)) return;
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    if (!draggable) return;
    actions.reorder(node.id, e.key === 'ArrowUp' ? -1 : 1);
  }

  const menuContent = (
    <>
      <MenuItem
        icon={<Icon name={favorite ? 'star-filled' : 'star'} size={16} />}
        onSelect={() => actions.toggleFavorite(node.id, !favorite)}
      >
        {favorite ? '從收藏中移除' : '加入收藏'}
      </MenuItem>
      <MenuItem icon={<Icon name="link" size={16} />} shortcut="mod+l" onSelect={() => actions.copyLink(node.id)}>
        拷貝連結
      </MenuItem>
      <MenuItem icon={<Icon name="duplicate" size={16} />} shortcut="mod+d" onSelect={() => actions.duplicate(node.id)}>
        建立複本
      </MenuItem>
      <MenuItem icon={<Icon name="text" size={16} />} onSelect={() => setRenaming(true)}>
        重新命名
      </MenuItem>
      <MenuItem icon={<Icon name="arrow-right" size={16} />} onSelect={() => actions.moveTo(node.id)}>
        移動到
      </MenuItem>
      {/* O-17：選單也給一份 —— Alt 組合鍵沒有人會自己猜到，選單是可發現的那一條 */}
      <MenuItem
        icon={<Icon name="chevron-up" size={16} />}
        shortcut="alt+↑"
        onSelect={() => actions.reorder(node.id, -1)}
      >
        上移
      </MenuItem>
      <MenuItem
        icon={<Icon name="chevron-down" size={16} />}
        shortcut="alt+↓"
        onSelect={() => actions.reorder(node.id, 1)}
      >
        下移
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Icon name="trash" size={16} />} danger onSelect={() => actions.trash(node.id)}>
        移至垃圾桶
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Icon name="external-link" size={16} />} onSelect={() => actions.openInNewTab(node.id)}>
        在新分頁中開啟
      </MenuItem>
    </>
  );

  return (
    <>
      <div
        ref={attachRow}
        data-kn-dnd-item=""
        data-id={node.id}
        data-depth={depth}
        data-accepts-children="true"
        className={[
          styles.row,
          active ? styles.rowActive : '',
          isDragging ? styles.rowDragging : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: `${BASE_PAD + depth * INDENT}px` }}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={active}
        tabIndex={0}
        onClick={(e) => {
          // 浮層（選單 / 提示）雖然 portal 出去了，React 事件還是會冒泡到這一列
          if (!isInsideRow(e.target)) return;
          // 點在 ⋯ / ＋ / 展開箭頭上時不要導頁
          if ((e.target as HTMLElement).closest('[data-row-action]')) return;
          if (Date.now() - navigatedAt.current < 400) return;
          go();
        }}
        onKeyDown={(e) => {
          if (e.altKey) {
            onReorderKeyDown(e);
            return;
          }
          onKeyDown(e);
        }}
        onContextMenu={(e) => {
          if (!isInsideRow(e.target)) return;
          ctx.onContextMenu(e);
        }}
        onPointerDown={onPointerDownRow}
        onPointerUp={onPointerUpRow}
      >
        {/* Notion 的側邊欄只有**一個** 20px 欄位：平常放頁面 icon，
            hover 到有子頁的列時，icon 原地換成展開箭頭（UI-SPEC §2.4）。 */}
        <span className={styles.iconSlot}>
          {hasChildren && (
            <button
              type="button"
              className={`${styles.twisty} ${expanded ? styles.twistyOpen : ''}`}
              data-row-action="true"
              aria-label={expanded ? '收合' : '展開'}
              onClick={(e) => {
                e.stopPropagation();
                actions.toggle(node.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Icon name="chevron-right" size={14} />
            </button>
          )}
          <span className={styles.rowIcon} aria-hidden="true">
            {node.icon ? node.icon : <Icon name={node.isDatabase ? 'table' : 'page'} size={17} />}
          </span>
        </span>

        {renaming ? (
          <input
            className={styles.rowLabel}
            defaultValue={node.title}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              actions.rename(node.id, e.currentTarget.value);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                actions.rename(node.id, e.currentTarget.value);
                setRenaming(false);
              } else if (e.key === 'Escape') {
                setRenaming(false);
              }
              e.stopPropagation();
            }}
            style={{ background: 'transparent', border: 0, outline: 'none', padding: 0 }}
          />
        ) : (
          <span className={styles.rowLabel}>{title}</span>
        )}

        <span className={`${styles.rowActions} ${menuOpen ? styles.rowActionsOpen : ''}`}>
          <Menu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            placement="bottom-start"
            trigger={
              <button
                type="button"
                className={styles.rowAction}
                data-row-action="true"
                aria-label={`${title} 的更多選項`}
                /* ⚠️ 這裡**不能** stopPropagation：
                   `Popover` 把開關選單的 onClick 掛在包住 trigger 的外層 <span> 上，
                   在按鈕上擋掉冒泡，選單就永遠打不開（實測：側邊欄的 ⋯ 沒反應）。
                   不讓這一列被導頁改由 row 的 onClick 檢查 data-row-action 負責。 */
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Icon name="more-horizontal" size={16} />
              </button>
            }
          >
            {menuContent}
          </Menu>
          <Tooltip content="新增子頁面">
            <button
              type="button"
              className={styles.rowAction}
              data-row-action="true"
              aria-label={`在 ${title} 底下新增頁面`}
              onClick={(e) => {
                e.stopPropagation();
                actions.createChild(node.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Icon name="plus" size={16} />
            </button>
          </Tooltip>
        </span>
      </div>

      {ctx.anchor && (
        <Menu anchor={ctx.anchor} open={ctx.open} onOpenChange={ctx.setOpen} placement="bottom-start">
          {menuContent}
        </Menu>
      )}
    </>
  );
}
