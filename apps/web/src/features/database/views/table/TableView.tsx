/**
 * 自研表格（04 §8 M4 交付物 6）。不用 TanStack Table / ag-grid。
 *
 * 這一支負責的事：
 *   · 欄寬拖曳、欄位隱藏／排序、凍結標題欄（sticky left）
 *   · 儲存格鍵盤導航：Tab / Shift+Tab / 方向鍵 / Enter 進入編輯 / Escape 退出
 *   · 行內編輯（EditableCell，與 Board / RowPeek 共用同一組編輯器）
 *   · 列 hover 顯示「開啟」與拖曳把手（⭐ 把手浮在表格**外面**，不佔欄寬）
 *   · 列選取（hover 出現勾選框、Shift 連選）＋ 頂部浮出的批次列
 *   · 列拖曳排序（把手 → HTML5 DnD → `POST /rows/reorder` 寫回 sort_key）
 *   · 表頭最右端的「＋ 新增欄位」、底部「＋ 新增」、聚合列
 *   · VirtualList 虛擬捲動（1000 列時 DOM 節點數 < 100）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AggregationFunction, DatabaseRow, FieldType } from '@kennote/shared-types';
import { AGGREGATION_LABELS, richTextToPlainText } from '@kennote/shared-types';
import { FieldIcon, Menu, MenuItem, MenuLabel, MenuSeparator, Popover, UiIcon, VirtualList } from '../../_fallback';
import { EditableCell } from '../../EditableCell';
import { FieldConfigPopover } from '../../FieldConfigPopover';
import { useDatabaseContext } from '../../context';
// O-20：批次「加到收藏」走側邊欄同一支 API（列 = 頁）
import { setFavorite } from '../../../../lib/queries';
import { toast } from '@kennote/ui';
import { fieldTypeGroups, getFieldType } from '../../fields/types';
import { relatedTitle } from '../../fields/relation/titles';
import type { ViewProps } from '../types';
import { alignViewProperties, visibleProperties } from '../types';
import styles from './TableView.module.css';

const ROW_HEIGHT = 32;

interface ActiveCell {
  rowIndex: number;
  colIndex: number;
}

export function TableView(props: ViewProps) {
  const { view, schema, rows, aggregations, hasMore, isFetching, loadMore, updateView } = props;
  const { readOnly, applySchemaOps, workspaceId } = useDatabaseContext();
  const columns = visibleProperties(schema, view.format);
  const freeze = view.format?.tableFreezeColumns ?? 1;

  const [active, setActive] = useState<ActiveCell | null>(null);
  const [editing, setEditing] = useState(false);
  const [menuFor, setMenuFor] = useState<{ property: string; anchor: HTMLElement } | null>(null);
  const [configFor, setConfigFor] = useState<{ property: string; anchor: HTMLElement } | null>(null);
  const [aggFor, setAggFor] = useState<{ property: string; anchor: HTMLElement } | null>(null);
  /** 表頭最右端的「＋ 新增欄位」型別選單 */
  const [addColAnchor, setAddColAnchor] = useState<HTMLElement | null>(null);
  /** 剛新增出來、等著「捲過去 ＋ 開欄位設定並聚焦名稱」的 propertyId */
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  /** 欄位設定浮層開起來之後要聚焦名稱輸入的那個 propertyId */
  const [focusName, setFocusName] = useState<string | null>(null);
  /**
   * ⭐ 把手不再是表格裡的一欄（見 .module.css 的 `.handle`）：
   * 只畫**一顆**浮在表格左邊的把手，位置跟著目前 hover 的那一列走。
   */
  const [handleTop, setHandleTop] = useState<number | null>(null);
  /** 把手目前對應的列（拖曳排序要知道抓的是誰） */
  const [handleRowId, setHandleRowId] = useState<string | null>(null);

  /* ── 列選取（Notion：hover 出現勾選框、Shift 連選）── */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  /** Shift 連選的錨點 */
  const anchorRef = useRef<string | null>(null);

  /* ── 拖曳排序 ── */
  /**
   * O-17（第十三輪）：**視圖有排序條件時不能手動拖曳。**
   *
   * 手動順序寫的是 `pages.sort_key`，而畫面的順序來自 `view.query.sort` ——
   * 兩者同時存在時，拖完放手、下一次重查就彈回去了。
   * 這不是「不會壞」，是**寫進去的東西看不見**：使用者只會覺得拖曳偶爾失效。
   * Notion 在這個情況下直接把把手停用，並說明原因。
   */
  const sortedByQuery = (view.query?.sort ?? []).length > 0;
  const canReorderRows = !readOnly && props.reorderRow !== undefined && !sortedByQuery;
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  /** 放開時要插在哪一列之後（null = 最前面、undefined = 沒有落點） */
  const [dropAfter, setDropAfter] = useState<string | null | undefined>(undefined);

  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);

  /** 列被重新載入時，把已經不存在的選取清掉 */
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(rowIds);
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rowIds]);

  function toggleSelect(rowId: string, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      const anchor = anchorRef.current;
      if (shiftKey && anchor && anchor !== rowId) {
        // Shift 連選：錨點到這一列之間全部選起來（Notion 只加不減）
        const from = rowIds.indexOf(anchor);
        const to = rowIds.indexOf(rowId);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          for (let i = lo; i <= hi; i += 1) {
            const id = rowIds[i];
            if (id) next.add(id);
          }
          return next;
        }
      }
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      anchorRef.current = rowId;
      return next;
    });
  }

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allSelected = rows.length > 0 && selected.size === rows.length;

  /** 匯出選取的列：直接在瀏覽器組 CSV（欄序＝目前視圖，title 第一欄） */
  function exportSelected() {
    const header = columns.map((c) => schema[c.property]?.name ?? c.property);
    const lines = [header.map(csvCell).join(',')];
    for (const row of selectedRows) {
      lines.push(
        columns
          .map((c) => {
            const def = schema[c.property];
            if (!def) return '';
            const value = row.properties[c.property];
            if (def.type === 'relation') {
              const ids = value && value.type === 'relation' ? value.pageIds : [];
              return csvCell(ids.map(relatedTitle).join(', '));
            }
            return csvCell(getFieldType(def.type).toPlainText(value, def));
          })
          .join(','),
      );
    }
    // BOM：Excel 開 UTF-8 CSV 不加 BOM 中文會亂碼（跟後端 export.csv 一致）
    const blob = new Blob([BOM + lines.join(CRLF) + CRLF], {
      type: 'text/csv;charset=utf-8',
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `selection-${selectedRows.length}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  /** O-20：把選取的列加進收藏（列 = 頁，走側邊欄同一支 API） */
  async function favoriteSelected(): Promise<void> {
    const ids = [...selected];
    setSelected(new Set());
    let ok = 0;
    for (const id of ids) {
      try {
        await setFavorite(id, workspaceId, true);
        ok += 1;
      } catch {
        /* 個別失敗不要打斷整批 */
      }
    }
    if (ok > 0) toast.success(`已加入收藏（${ok} 頁）`);
    else toast.error('加入收藏失敗');
  }

  /*
   * 第六輪 BUG-34：列的拖曳排序走的是 **HTML5 DnD**（`draggable` + `dragstart`），
   * 而行動瀏覽器**不會**從觸控觸發 `dragstart` —— 加上把手只在 `mousemove`
   * 時才浮出來，手機上根本連把手都看不到。結果是「資料庫表格在觸控下
   * 完全沒有排序的路」。
   *
   * 這裡補一條**只看 touch**的路，語意對齊 `@kennote/ui` 的 dnd：
   * 長按 400ms（Android 的系統長按值）啟動，期間移動超過 5px 視為想捲動 → 取消。
   * 啟動後用 `elementFromPoint` 找目前指在哪一列，沿用既有的 `dropAfter`
   * 指示線與 `commitDrop()`。滑鼠行為一個位元都沒動。
   *
   * 註：正解是整個 database 改用 `@kennote/ui` 的 `useDraggable/useDroppable`
   * （側邊欄樹就是那一套，觸控本來就能動）。那是跨 5 個 view 的改動，
   * 這一輪先讓表格有路可走，看板 / 日曆 / 屬性排序仍然是觸控死的（見 round6 §4）。
   */
  const touchHoldRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(
    null,
  );

  function cancelTouchHold(): void {
    if (touchHoldRef.current) clearTimeout(touchHoldRef.current.timer);
    touchHoldRef.current = null;
  }

  function onRowPointerDown(event: React.PointerEvent<HTMLDivElement>, rowId: string): void {
    if (event.pointerType !== 'touch') return;
    if (!canReorderRows) return;
    cancelTouchHold();
    const startX = event.clientX;
    const startY = event.clientY;

    const move = (e: PointerEvent): void => {
      const hold = touchHoldRef.current;
      if (hold) {
        // 門檻前移動 → 使用者想捲動，不是想拖
        if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 5) {
          cancelTouchHold();
          window.removeEventListener('pointermove', move, true);
          window.removeEventListener('pointerup', up, true);
          window.removeEventListener('pointercancel', up, true);
        }
        return;
      }
      e.preventDefault();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = el?.closest('[data-row-id]') as HTMLElement | null;
      const overId = target?.dataset['rowId'];
      if (!overId) return;
      const idx = rows.findIndex((r) => r.id === overId);
      if (idx < 0) return;
      const box = target!.getBoundingClientRect();
      setDropAfter(e.clientY - box.top < box.height / 2 ? (rows[idx - 1]?.id ?? null) : overId);
    };

    const up = (): void => {
      const wasPending = touchHoldRef.current !== null;
      cancelTouchHold();
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (!wasPending) commitDrop();
    };

    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);

    touchHoldRef.current = {
      x: startX,
      y: startY,
      timer: setTimeout(() => {
        touchHoldRef.current = null;
        setDragRowId(rowId);
        setHandleRowId(rowId);
        navigator.vibrate?.(10);
      }, 400),
    };
  }

  useEffect(() => cancelTouchHold, []);

  /** 拖曳放開：把 dragRowId 插到 dropAfter 後面 */
  function commitDrop() {
    const rowId = dragRowId;
    const afterId = dropAfter;
    setDragRowId(null);
    setDropAfter(undefined);
    if (!rowId || afterId === undefined || afterId === rowId) return;
    props.reorderRow?.(rowId, afterId);
  }
  const gridRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  /* ── 欄寬拖曳 ── */
  const [resizing, setResizing] = useState<{ property: string; startX: number; startWidth: number } | null>(
    null,
  );
  const [widthOverride, setWidthOverride] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!resizing) return;
    function onMove(e: PointerEvent) {
      if (!resizing) return;
      const next = Math.max(64, Math.min(720, resizing.startWidth + e.clientX - resizing.startX));
      setWidthOverride((prev) => ({ ...prev, [resizing.property]: next }));
    }
    function onUp() {
      setWidthOverride((prev) => {
        const width = prev[resizing?.property ?? ''];
        if (resizing && width) commitWidth(resizing.property, width);
        return prev;
      });
      setResizing(null);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    // 相依陣列刻意手寫：只有這幾個值變了才該重跑
  }, [resizing]);

  function commitWidth(property: string, width: number) {
    const existing = view.format?.properties ?? [];
    const next = existing.some((p) => p.property === property)
      ? existing.map((p) => (p.property === property ? { ...p, width } : p))
      : [...existing, { property, visible: true, width }];
    updateView({ format: { ...view.format, properties: next } });
  }

  function widthOf(property: string, fallback: number): number {
    return widthOverride[property] ?? fallback;
  }

  /* ── 欄位操作（排序 / 隱藏 / 刪除 / 插入） ── */

  function sortBy(property: string, direction: 'ascending' | 'descending') {
    updateView({ query: { ...view.query, sort: [{ property, direction }] } });
    setMenuFor(null);
  }

  function hideProperty(property: string) {
    const existing = view.format?.properties ?? columns.map((c) => ({ ...c, visible: true }));
    const next = existing.some((p) => p.property === property)
      ? existing.map((p) => (p.property === property ? { ...p, visible: false } : p))
      : [...existing, { property, visible: false }];
    updateView({ format: { ...view.format, properties: next } });
    setMenuFor(null);
  }

  /**
   * 表頭最右端的「＋ 新增欄位」（Notion 最常用的新增路徑）。
   * 沿用 PropertyList / FieldConfigPopover 的同一條流程：
   * registry 的 defaultConfig → `PATCH /schema` 的 add op → 接到 format.properties 尾端。
   */
  async function addColumn(type: FieldType) {
    setAddColAnchor(null);
    const fieldType = getFieldType(type);
    const taken = new Set(Object.values(schema).map((d) => d?.name));
    let name = fieldType.label;
    let n = 2;
    while (taken.has(name)) name = `${fieldType.label} ${n++}`;
    const added = await applySchemaOps([{ op: 'add', definition: fieldType.defaultConfig(name) }]);
    const propertyId = added[0];
    if (!propertyId) return;
    // BUG-8：新欄位要排在最後，不是 jsonb 的 key 順序
    updateView({
      format: { ...view.format, properties: alignViewProperties(view.format, schema, added) },
    });
    setPendingFocus(propertyId);
  }

  /** 新欄位渲染出來之後：橫捲到它、打開欄位設定（名稱輸入框有 data-autofocus） */
  useEffect(() => {
    if (!pendingFocus) return;
    const cell = gridRef.current?.querySelector<HTMLElement>(
      `[role="columnheader"][data-property="${pendingFocus}"]`,
    );
    if (!cell) return; // schema / format 還沒回來，等下一次 render
    cell.scrollIntoView({ block: 'nearest', inline: 'end' });
    const button = cell.querySelector<HTMLElement>('[data-header-button]') ?? cell;
    setConfigFor({ property: pendingFocus, anchor: button });
    setPendingFocus(null);
    setFocusName(pendingFocus);
    // 相依陣列刻意手寫：schema / 欄數變了才需要再找一次
  }, [pendingFocus, schema, columns.length]);

  /**
   * 欄位設定浮層開起來之後，把游標放到名稱輸入框上（Notion 新增欄位就是這個手感）。
   * ⚠️ `_fallback/Popover` 只是**約定** `data-autofocus`，並沒有真的去 focus，
   * 所以這裡自己補一手；也刻意跟上面那個 effect 分開 —— 寫在一起的話
   * `setPendingFocus(null)` 會讓 effect 立刻重跑，cleanup 先把 timer 清掉。
   */
  useEffect(() => {
    if (!focusName || configFor?.property !== focusName) return;
    const timer = setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[role="dialog"] input[data-autofocus]',
      );
      input?.focus();
      input?.select();
      setFocusName(null);
    }, 60);
    return () => clearTimeout(timer);
  }, [focusName, configFor]);

  /* ── 列把手（浮在表格外面）── */

  /**
   * Notion 的 ⠿ 把手在表格**左邊的頁面留白**上，不是表格裡的一欄
   * （`HANDOFF-round8.md` §2-A：kennote 的 `.rowGutter { flex: 0 0 32px }`
   * 把整張表往右推 32px，07/07b/07c/07d 的 dx +4~+5 全是這個）。
   *
   * 因為 `.grid` 有 `overflow-x: auto`（往左溢出會被裁掉、還會生出捲軸）、
   * 列本身又在 VirtualList 的垂直捲動容器裡，把手只能放在**不捲動的外層**
   * （`.wrapper`），再由 hover 事件算出那一列相對於 wrapper 的 y。
   */
  function trackHandle(e: React.MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    if (target.closest('[data-row-handle]')) return; // 滑到把手上不要讓它消失
    const rowEl = target.closest<HTMLElement>('[data-row-index]');
    const wrap = wrapperRef.current;
    if (!rowEl || !wrap) {
      setHandleTop(null);
      setHandleRowId(null);
      return;
    }
    setHandleTop(rowEl.getBoundingClientRect().top - wrap.getBoundingClientRect().top);
    setHandleRowId(rowEl.dataset.rowId ?? null);
  }

  /* ── 鍵盤導航 ── */

  const focusCell = useCallback((cell: ActiveCell | null) => {
    if (!cell || !gridRef.current) return;
    const node = gridRef.current.querySelector<HTMLElement>(
      `[data-row="${cell.rowIndex}"][data-col="${cell.colIndex}"]`,
    );
    node?.focus({ preventScroll: false });
  }, []);

  useEffect(() => {
    if (!editing) focusCell(active);
  }, [active, editing, focusCell]);

  function move(dRow: number, dCol: number) {
    setActive((prev) => {
      const base = prev ?? { rowIndex: 0, colIndex: 0 };
      let rowIndex = base.rowIndex + dRow;
      let colIndex = base.colIndex + dCol;
      if (colIndex >= columns.length) {
        colIndex = 0;
        rowIndex += 1;
      }
      if (colIndex < 0) {
        colIndex = columns.length - 1;
        rowIndex -= 1;
      }
      rowIndex = Math.max(0, Math.min(rows.length - 1, rowIndex));
      return { rowIndex, colIndex };
    });
  }

  function onCellKeyDown(e: React.KeyboardEvent, cell: ActiveCell) {
    if (editing) {
      if (e.key === 'Escape') {
        setEditing(false);
        setActive(cell);
      }
      return;
    }
    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        setActive(cell);
        move(0, e.shiftKey ? -1 : 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        setActive(cell);
        move(0, 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        setActive(cell);
        move(0, -1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActive(cell);
        move(1, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive(cell);
        move(-1, 0);
        break;
      case 'Enter':
        e.preventDefault();
        setActive(cell);
        setEditing(true);
        break;
      case 'Escape':
        setActive(null);
        break;
      default:
        break;
    }
  }

  /* ── 渲染 ── */

  function renderRow(row: DatabaseRow, rowIndex: number) {
    return (
      <div
        className={`${styles.row} ${selected.has(row.id) ? styles.rowSelected : ''} ${
          dropAfter !== undefined && dropAfter === (rowIndex === 0 ? null : (rows[rowIndex - 1]?.id ?? null))
            ? styles.dropBefore
            : ''
        }`}
        key={row.id}
        role="row"
        data-row-index={rowIndex}
        data-row-id={row.id}
        aria-rowindex={rowIndex + 2}
        aria-selected={selected.has(row.id)}
        /* 第六輪 BUG-34：觸控長按 400ms 才能拖（HTML5 DnD 在手機上不會觸發） */
        onPointerDown={(e) => onRowPointerDown(e, row.id)}
        style={dragRowId === row.id ? { touchAction: 'none' } : undefined}
        onDragOver={(e) => {
          if (!dragRowId) return;
          e.preventDefault();
          // 指標在上半 → 插在這一列之前；下半 → 插在它之後
          const box = e.currentTarget.getBoundingClientRect();
          const after =
            e.clientY - box.top < box.height / 2
              ? (rows[rowIndex - 1]?.id ?? null)
              : row.id;
          setDropAfter(after);
        }}
        onDrop={(e) => {
          if (!dragRowId) return;
          e.preventDefault();
          commitDrop();
        }}
      >
        {columns.map((column, colIndex) => {
          const def = schema[column.property];
          if (!def) return null;
          const isActive = active?.rowIndex === rowIndex && active.colIndex === colIndex;
          const frozen = colIndex < freeze;
          return (
            <div
              key={column.property}
              role="gridcell"
              tabIndex={isActive ? 0 : -1}
              data-row={rowIndex}
              data-col={colIndex}
              className={`${styles.cellWrap} ${frozen ? styles.frozen : ''} ${
                isActive ? styles.cellActive : ''
              } ${column.property === 'title' ? styles.titleCell : ''}`}
              style={{ width: widthOf(column.property, column.width), left: frozen ? 0 : undefined }}
              onKeyDown={(e) => onCellKeyDown(e, { rowIndex, colIndex })}
              /**
               * ⭐ 一定要用 `onPointerDown` 而**不是** `onMouseDown`。
               *
               * 內嵌資料庫住在編輯器裡，而 `editor-core` 的 input controller 在
               * `pointerdown` 上看到「這個 block 沒有 inline content」（collectionView 就是）
               * 就會 `event.preventDefault()` 去做整塊選取。依 Pointer Events 規範，
               * 被取消的 pointerdown **不會再產生相容的 mousedown**，
               * 所以 React 的 onMouseDown 在內嵌資料庫裡永遠收不到 ——
               * 07d 的「儲存格選取態」因此一直畫不出來（藍框 + 右下角小方塊都在，只是沒人觸發）。
               */
              onPointerDown={() => setActive({ rowIndex, colIndex })}
            >
              <EditableCell
                className={styles.tableCell}
                propertyId={column.property}
                def={def}
                row={row}
                value={row.properties[column.property]}
                readOnly={readOnly}
                editing={isActive && editing}
                onEditingChange={(next) => {
                  setActive({ rowIndex, colIndex });
                  setEditing(next);
                }}
                onCommit={(value) => {
                  if (column.property === 'title') {
                    props.setRowTitle(row.id, typeof value === 'string' ? value : '');
                  } else {
                    props.setCellValue(row.id, column.property, value);
                  }
                }}
              />
              {column.property === 'title' && !readOnly ? (
                /**
                 * Notion 的列勾選框壓在**名稱欄左側**（07c 實測 x42..57），
                 * 打開時名稱欄的文字往右讓 20px（`.titleCell` 的 padding-left）。
                 */
                <input
                  type="checkbox"
                  className={styles.rowCheckbox}
                  checked={selected.has(row.id)}
                  aria-label={`選取「${richTextToPlainText(row.title) || '未命名'}」`}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    toggleSelect(row.id, (e.nativeEvent as unknown as MouseEvent).shiftKey)
                  }
                />
              ) : null}
              {column.property === 'title' ? (
                <button
                  type="button"
                  className={styles.openButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.openRow(row.id);
                  }}
                  title={richTextToPlainText(row.title) || '未命名'}
                >
                  <UiIcon name="expand" size={12} />
                  開啟
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  const aggregationByProperty = new Map(aggregations?.map((a) => [a.property, a]) ?? []);

  return (
    <div
      className={styles.wrapper}
      ref={wrapperRef}
      onMouseOver={trackHandle}
      onMouseLeave={() => setHandleTop(null)}
      /* 捲動時列的 y 就不準了；Notion 也是捲動中先收起把手 */
      onScroll={() => setHandleTop(null)}
    >
      {handleTop !== null ? (
        <span
          className={styles.rowHandle}
          data-row-handle=""
          data-testid="row-handle"
          style={{ top: handleTop }}
          title={sortedByQuery ? '這個視圖有排序條件，請先移除排序才能手動調整順序' : '拖曳排序'}
          data-reorder-disabled={sortedByQuery ? '' : undefined}
          aria-disabled={sortedByQuery || undefined}
          /* 拖曳排序：HTML5 DnD（與側邊欄 / 看板同一套，不加套件） */
          draggable={canReorderRows}
          onDragStart={(e) => {
            if (!handleRowId) return;
            setDragRowId(handleRowId);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', handleRowId);
          }}
          onDragEnd={() => {
            setDragRowId(null);
            setDropAfter(undefined);
          }}
        >
          <UiIcon name="drag" size={12} />
        </span>
      ) : null}

      {/* 批次列：選了列才浮出來（Notion 在表格頂端） */}
      {selected.size > 0 ? (
        <div className={styles.batchBar} role="toolbar" aria-label="批次操作">
          <label className={styles.batchCheck}>
            <input
              type="checkbox"
              checked={allSelected}
              aria-label="全選"
              onChange={(e) => setSelected(e.target.checked ? new Set(rowIds) : new Set())}
            />
            已選取 {selected.size} 列
          </label>
          <span className={styles.batchSpacer} />
          <button type="button" className={styles.batchButton} onClick={() => exportSelected()}>
            匯出選取
          </button>
          {/*
           * O-20（第十三輪，部分）：批次列原本只有「匯出 / 複製 / 刪除」。
           * 資料庫的每一列**就是一頁**，所以「加到收藏」用的是側邊欄同一支
           * `setFavorite()` —— 不是資料庫自己的第二套收藏。
           * （「移動到」仍未做：`moveTo` overlay 一次只吃一個 moveTargetId。）
           */}
          <button
            type="button"
            className={styles.batchButton}
            onClick={() => void favoriteSelected()}
          >
            加到收藏
          </button>
          <button
            type="button"
            className={styles.batchButton}
            disabled={readOnly}
            onClick={() => {
              for (const id of selected) props.duplicateRow(id);
              setSelected(new Set());
            }}
          >
            複製
          </button>
          <button
            type="button"
            className={`${styles.batchButton} ${styles.batchDanger}`}
            disabled={readOnly}
            onClick={() => {
              const ids = [...selected];
              setSelected(new Set());
              if (props.deleteRows) props.deleteRows(ids);
              else for (const id of ids) props.deleteRow(id);
            }}
          >
            刪除
          </button>
          <button type="button" className={styles.batchButton} onClick={() => setSelected(new Set())}>
            取消
          </button>
        </div>
      ) : null}
      <div ref={gridRef} className={styles.grid} role="grid" aria-rowcount={rows.length + 1}>
        {/* 標題列：sticky top，灰字 14px */}
        <div className={styles.headerRow} role="row">
          {columns.map((column, colIndex) => {
            const def = schema[column.property];
            if (!def) return null;
            const frozen = colIndex < freeze;
            return (
              <div
                key={column.property}
                role="columnheader"
                data-property={column.property}
                className={`${styles.headerCell} ${frozen ? styles.frozen : ''}`}
                style={{ width: widthOf(column.property, column.width), left: frozen ? 0 : undefined }}
              >
                <button
                  type="button"
                  data-header-button=""
                  className={styles.headerButton}
                  onClick={(e) => setMenuFor({ property: column.property, anchor: e.currentTarget })}
                >
                  <FieldIcon type={def.type} />
                  <span className={styles.headerName}>{def.name}</span>
                </button>
                <span
                  className={styles.resizeHandle}
                  role="separator"
                  aria-label={`調整 ${def.name} 欄寬`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setResizing({
                      property: column.property,
                      startX: e.clientX,
                      startWidth: widthOf(column.property, column.width),
                    });
                  }}
                />
              </div>
            );
          })}
          {/* Notion 表頭最右端的「＋ 新增欄位」：與表頭同高、hover 淡灰底 */}
          {!readOnly ? (
            <button
              type="button"
              className={styles.addColumn}
              aria-label="新增欄位"
              title="新增欄位"
              onClick={(e) => setAddColAnchor(e.currentTarget)}
            >
              <UiIcon name="plus" size={14} />
            </button>
          ) : null}
        </div>

        <VirtualList
          items={rows}
          itemHeight={ROW_HEIGHT}
          className={styles.body}
          onEndReached={hasMore ? loadMore : undefined}
          ariaLabel="資料列"
          renderItem={(row, index) => renderRow(row, index)}
          footer={
            <>
              {!readOnly ? (
                <button type="button" className={styles.newRow} onClick={() => void props.createRow()}>
                  <UiIcon name="plus" size={14} />
                  新頁面
                </button>
              ) : null}
              {isFetching ? <div className={styles.loading}>載入中…</div> : null}
            </>
          }
        />

        {/* 聚合列 */}
        <div className={styles.aggRow} role="row">
          {columns.map((column, colIndex) => {
            const def = schema[column.property];
            if (!def) return null;
            const fn = view.query?.aggregations?.[column.property] ?? 'none';
            const result = aggregationByProperty.get(column.property);
            const frozen = colIndex < freeze;
            return (
              <div
                key={column.property}
                className={`${styles.aggCell} ${frozen ? styles.frozen : ''}`}
                style={{ width: widthOf(column.property, column.width), left: frozen ? 0 : undefined }}
              >
                <button
                  type="button"
                  className={styles.aggButton}
                  onClick={(e) => setAggFor({ property: column.property, anchor: e.currentTarget })}
                >
                  {fn === 'none' ? (
                    <span className={styles.aggPlaceholder}>計算</span>
                  ) : (
                    <>
                      <span className={styles.aggLabel}>{AGGREGATION_LABELS[fn]}</span>
                      <span className={styles.aggValue}>{result?.value ?? '—'}</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 表頭「＋ 新增欄位」的型別選單（與 PropertyList 同一份 registry） */}
      <Popover open={addColAnchor !== null} anchor={addColAnchor} onClose={() => setAddColAnchor(null)}>
        <Menu ariaLabel="新增欄位">
          {fieldTypeGroups().map((group) => (
            <div key={group.group}>
              <MenuLabel>{group.label}</MenuLabel>
              {group.types
                .filter((t) => t.type !== 'title')
                .map((t) => (
                  <MenuItem
                    key={t.type}
                    icon={<FieldIcon type={t.type} />}
                    onSelect={() => void addColumn(t.type)}
                  >
                    {t.label}
                  </MenuItem>
                ))}
            </div>
          ))}
        </Menu>
      </Popover>

      {/* 欄位選單 */}
      <Popover
        open={menuFor !== null}
        anchor={menuFor?.anchor ?? null}
        onClose={() => setMenuFor(null)}
      >
        {menuFor ? (
          <Menu ariaLabel="欄位選單">
            <MenuItem
              onSelect={(() => {
                const anchor = menuFor.anchor;
                const property = menuFor.property;
                return () => {
                  setMenuFor(null);
                  setConfigFor({ property, anchor });
                };
              })()}
            >
              編輯屬性
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => sortBy(menuFor.property, 'ascending')}>遞增排序</MenuItem>
            <MenuItem onSelect={() => sortBy(menuFor.property, 'descending')}>遞減排序</MenuItem>
            <MenuSeparator />
            <MenuItem
              disabled={menuFor.property === 'title'}
              onSelect={() => hideProperty(menuFor.property)}
            >
              隱藏欄位
            </MenuItem>
          </Menu>
        ) : null}
      </Popover>

      {/* 欄位設定（改名 / 改型別 / 型別專屬設定） */}
      {configFor ? (
        <FieldConfigPopover
          propertyId={configFor.property}
          anchor={configFor.anchor}
          onClose={() => setConfigFor(null)}
        />
      ) : null}

      {/* 聚合函式選單 */}
      <Popover open={aggFor !== null} anchor={aggFor?.anchor ?? null} onClose={() => setAggFor(null)}>
        {aggFor
          ? (() => {
              const def = schema[aggFor.property];
              const options = def ? getFieldType(def.type).aggregations : [];
              return (
                <Menu ariaLabel="聚合函式">
                  <MenuLabel>計算</MenuLabel>
                  {options.map((fn: AggregationFunction) => (
                    <MenuItem
                      key={fn}
                      selected={(view.query?.aggregations?.[aggFor.property] ?? 'none') === fn}
                      onSelect={() => {
                        updateView({
                          query: {
                            ...view.query,
                            aggregations: { ...(view.query?.aggregations ?? {}), [aggFor.property]: fn },
                          },
                        });
                        setAggFor(null);
                      }}
                    >
                      {AGGREGATION_LABELS[fn]}
                    </MenuItem>
                  ))}
                </Menu>
              );
            })()
          : null}
      </Popover>
    </div>
  );
}


/** CSV 的逃脫規則（與後端 `service.ts` 的 `csvCell()` 相同） */
const BOM = '\uFEFF';
const CRLF = '\r\n';
const CSV_SPECIAL = /["\n\r,]/;

function csvCell(value: string): string {
  if (value === '') return '';
  if (CSV_SPECIAL.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}
