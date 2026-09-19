/**
 * 看板（04 §8 M4 交付物 13）。
 *
 * 分組泳道由後端一次查回（每組前 N 張卡 + 每組總數，03 §7.3 的 window function），
 * 拖曳換欄 = 樂觀更新該列的分組欄位值（02 §4.3.4）。
 */
import { useState } from 'react';
import type { DatabaseRow, RowGroup } from '@kennote/shared-types';
import { richTextToPlainText } from '@kennote/shared-types';
import { UiIcon, useDragHandle, useDropZone } from '../../_fallback';
import { EditableCell } from '../../EditableCell';
import { useDatabaseContext } from '../../context';
import { getFieldType } from '../../fields/types';
import type { ViewProps } from '../types';
import { visibleProperties } from '../types';
import styles from './BoardView.module.css';

export function BoardView(props: ViewProps) {
  const { view, schema, groups, rows } = props;
  const { readOnly } = useDatabaseContext();
  const groupProperty = view.query?.groupBy?.property;
  const columnWidth = view.format?.boardColumnWidth ?? 260;

  if (!groupProperty || !schema[groupProperty]) {
    return (
      <div className={styles.empty}>
        <p>看板需要先選一個分組欄位。</p>
        <p className={styles.hint}>在工具列的「⋯ → 分組」選一個單選、多選、人員或核取方塊欄位。</p>
      </div>
    );
  }

  const groupable = getFieldType(schema[groupProperty].type).groupable;
  if (!groupable) {
    return <div className={styles.empty}>「{schema[groupProperty].name}」不能用來分組。</div>;
  }

  const lanes: RowGroup[] =
    groups ??
    // 後端沒回分組（例如剛切成看板還沒重查）時，先在前端分一次，畫面不會空白
    localGroups(rows, groupProperty, schema);

  const hiddenKeys = new Set(
    (view.query?.groupBy?.groups ?? []).filter((g) => g.visible === false).map((g) => g.key),
  );

  return (
    <div className={styles.board}>
      {lanes
        .filter((lane) => !hiddenKeys.has(lane.key))
        .map((lane) => (
          <BoardColumn
            key={lane.key ?? '__empty__'}
            lane={lane}
            width={columnWidth}
            groupProperty={groupProperty}
            readOnly={readOnly}
            {...props}
          />
        ))}
    </div>
  );
}

function localGroups(
  rows: DatabaseRow[],
  groupProperty: string,
  schema: ViewProps['schema'],
): RowGroup[] {
  const def = schema[groupProperty];
  if (!def) return [];
  const fieldType = getFieldType(def.type);
  const buckets = new Map<string | null, DatabaseRow[]>();
  for (const row of rows) {
    for (const key of fieldType.groupKeys(row.properties[groupProperty], def)) {
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }
  }
  return [...buckets.entries()].map(([key, groupRows]) => {
    const label = fieldType.groupLabel(key, def);
    return {
      key,
      label: label.label,
      ...(label.color ? { color: label.color } : {}),
      count: groupRows.length,
      rows: groupRows,
      hasMore: false,
    };
  });
}

interface ColumnProps extends ViewProps {
  lane: RowGroup;
  width: number;
  groupProperty: string;
  readOnly: boolean;
}

function BoardColumn({ lane, width, groupProperty, readOnly, ...props }: ColumnProps) {
  const { schema, view } = props;
  const [collapsed, setCollapsed] = useState(false);

  const { over, handlers } = useDropZone({
    accept: 'row',
    onDrop: (payload) => {
      if (payload.from === lane.key) return;
      const def = schema[groupProperty];
      if (!def) return;
      // 拖到哪一欄就把該列的分組欄位設成那一欄的值
      const value =
        lane.key === null ? null : def.type === 'multiSelect' ? [lane.key] : lane.key;
      props.setCellValue(payload.id, groupProperty, value);
    },
  });

  const cardProperties = visibleProperties(schema, view.format).filter(
    (c) => c.property !== 'title',
  );

  return (
    <section
      className={`${styles.column} ${over ? styles.columnOver : ''}`}
      style={{ width: collapsed ? 44 : width }}
      {...handlers}
    >
      <header className={styles.columnHeader}>
        <button
          type="button"
          className={styles.collapse}
          aria-label={collapsed ? '展開分組' : '收合分組'}
          onClick={() => setCollapsed((v) => !v)}
        >
          <UiIcon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
        </button>
        {collapsed ? null : (
          <>
            <span className={styles.columnLabel} data-color={lane.color ?? 'default'}>
              {lane.label}
            </span>
            <span className={styles.columnCount}>{lane.count}</span>
          </>
        )}
      </header>

      {collapsed ? null : (
        <>
          <div className={styles.cards}>
            {lane.rows.map((row) => (
              <BoardCard
                key={row.id}
                row={row}
                laneKey={lane.key}
                properties={cardProperties}
                {...props}
              />
            ))}
            {lane.hasMore ? (
              <button type="button" className={styles.loadMore} onClick={props.loadMore}>
                載入更多（共 {lane.count} 張）
              </button>
            ) : null}
          </div>
          {!readOnly ? (
            <button
              type="button"
              className={styles.newCard}
              onClick={() => void props.createRow({ group: { property: groupProperty, key: lane.key } })}
            >
              <UiIcon name="plus" size={14} />
              新頁面
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

interface CardProps extends ViewProps {
  row: DatabaseRow;
  laneKey: string | null;
  properties: Array<{ property: string }>;
}

function BoardCard({ row, laneKey, properties, ...props }: CardProps) {
  const { schema } = props;
  const { dragging, handlers } = useDragHandle({ kind: 'row', id: row.id, from: laneKey });

  return (
    <article
      className={`${styles.card} ${dragging ? styles.cardDragging : ''}`}
      {...handlers}
      onClick={() => props.openRow(row.id)}
    >
      <h4 className={styles.cardTitle}>{richTextToPlainText(row.title) || '未命名'}</h4>
      {properties.map(({ property }) => {
        const def = schema[property];
        if (!def) return null;
        const value = row.properties[property];
        if (!value) return null;
        return (
          <div key={property} className={styles.cardProperty} onClick={(e) => e.stopPropagation()}>
            <EditableCell
              propertyId={property}
              def={def}
              row={row}
              value={value}
              compact
              onCommit={(next) => props.setCellValue(row.id, property, next)}
            />
          </div>
        );
      })}
    </article>
  );
}
