/**
 * 自研表格（04 §8 M4 交付物 6）。不用 TanStack Table / ag-grid。
 *
 * 這一支負責的事：
 *   · 欄寬拖曳、欄位隱藏／排序、凍結標題欄（sticky left）
 *   · 儲存格鍵盤導航：Tab / Shift+Tab / 方向鍵 / Enter 進入編輯 / Escape 退出
 *   · 行內編輯（EditableCell，與 Board / RowPeek 共用同一組編輯器）
 *   · 列 hover 顯示「開啟」與拖曳把手、底部「＋ 新增」、聚合列
 *   · VirtualList 虛擬捲動（1000 列時 DOM 節點數 < 100）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AggregationFunction, DatabaseRow } from '@kennote/shared-types';
import { AGGREGATION_LABELS, richTextToPlainText } from '@kennote/shared-types';
import { FieldIcon, Menu, MenuItem, MenuLabel, MenuSeparator, Popover, UiIcon, VirtualList } from '../../_fallback';
import { EditableCell } from '../../EditableCell';
import { FieldConfigPopover } from '../../FieldConfigPopover';
import { useDatabaseContext } from '../../context';
import { getFieldType } from '../../fields/types';
import type { ViewProps } from '../types';
import { visibleProperties } from '../types';
import styles from './TableView.module.css';

const ROW_HEIGHT = 32;

interface ActiveCell {
  rowIndex: number;
  colIndex: number;
}

export function TableView(props: ViewProps) {
  const { view, schema, rows, aggregations, hasMore, isFetching, loadMore, updateView } = props;
  const { readOnly } = useDatabaseContext();
  const columns = visibleProperties(schema, view.format);
  const freeze = view.format?.tableFreezeColumns ?? 1;

  const [active, setActive] = useState<ActiveCell | null>(null);
  const [editing, setEditing] = useState(false);
  const [menuFor, setMenuFor] = useState<{ property: string; anchor: HTMLElement } | null>(null);
  const [configFor, setConfigFor] = useState<{ property: string; anchor: HTMLElement } | null>(null);
  const [aggFor, setAggFor] = useState<{ property: string; anchor: HTMLElement } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  /* ── 欄寬拖曳 ── */
  const [resizing, setResizing] = useState<{ property: string; startX: number; startWidth: number } | null>(
    null,
  );
  const [widthOverride, setWidthOverride] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
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
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
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
      <div className={styles.row} key={row.id} role="row" aria-rowindex={rowIndex + 2}>
        <div className={styles.rowGutter}>
          <span className={styles.rowHandle} aria-hidden="true">
            <UiIcon name="drag" size={12} />
          </span>
        </div>
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
              }`}
              style={{ width: widthOf(column.property, column.width), left: frozen ? 32 : undefined }}
              onKeyDown={(e) => onCellKeyDown(e, { rowIndex, colIndex })}
              onMouseDown={() => setActive({ rowIndex, colIndex })}
            >
              <EditableCell
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
    <div className={styles.wrapper}>
      <div ref={gridRef} className={styles.grid} role="grid" aria-rowcount={rows.length + 1}>
        {/* 標題列：sticky top，灰字 14px */}
        <div className={styles.headerRow} role="row">
          <div className={styles.rowGutter} />
          {columns.map((column, colIndex) => {
            const def = schema[column.property];
            if (!def) return null;
            const frozen = colIndex < freeze;
            return (
              <div
                key={column.property}
                role="columnheader"
                className={`${styles.headerCell} ${frozen ? styles.frozen : ''}`}
                style={{ width: widthOf(column.property, column.width), left: frozen ? 32 : undefined }}
              >
                <button
                  type="button"
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
                  onMouseDown={(e) => {
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
                  新增
                </button>
              ) : null}
              {isFetching ? <div className={styles.loading}>載入中…</div> : null}
            </>
          }
        />

        {/* 聚合列 */}
        <div className={styles.aggRow} role="row">
          <div className={styles.rowGutter} />
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
                style={{ width: widthOf(column.property, column.width), left: frozen ? 32 : undefined }}
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
