/**
 * 看板（04 §8 M4 交付物 13）。
 *
 * 分組泳道由後端一次查回（每組前 N 張卡 + 每組總數，03 §7.3 的 window function），
 * 拖曳換欄 = 樂觀更新該列的分組欄位值（02 §4.3.4）。
 */
import { useState } from 'react';
import type { DatabaseRow, RowGroup } from '@kennote/shared-types';
import { richTextToPlainText } from '@kennote/shared-types';
import { UiIcon } from '../../_fallback';
import { useCardDrag, useCardZone } from '../../dnd';
import { useKeyboardReorder, useReorderAnnouncer } from '../../../../lib/keyboard-reorder';
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

  const visibleLanes = lanes.filter((lane) => !hiddenKeys.has(lane.key));

  return (
    <BoardBody
      lanes={visibleLanes}
      width={columnWidth}
      groupProperty={groupProperty}
      readOnly={readOnly}
      {...props}
    />
  );
}

/**
 * O-17（第十三輪）：換欄的鍵盤替代路徑。
 *
 * 看板換欄原本**只有**「長按卡片拖到另一欄」一條路 —— 鍵盤使用者
 * 連改一張卡片的狀態都做不到（卡片上的分組欄位本身不在卡面上，
 * 它就是欄位名稱）。Alt + ←/→ 把卡片移到前 / 後一欄，
 * 走的是跟拖放完全相同的出口（`setCellValue`），不是第二套邏輯。
 *
 * `announcer` 提到這一層，是因為**整個看板共用一個 live region**：
 * 每一欄各放一個的話，卡片換欄的瞬間發出訊息的那個節點會跟著被卸載，
 * 訊息就不會被念出來。
 */
interface BoardBodyProps extends ViewProps {
  lanes: RowGroup[];
  width: number;
  groupProperty: string;
  readOnly: boolean;
}

function BoardBody({ lanes, width, groupProperty, readOnly, ...props }: BoardBodyProps) {
  const announcer = useReorderAnnouncer();

  return (
    <div className={styles.board}>
      {lanes.map((lane, laneIndex) => (
        <BoardColumn
          key={lane.key ?? '__empty__'}
          lane={lane}
          lanes={lanes}
          laneIndex={laneIndex}
          announce={announcer.announce}
          width={width}
          groupProperty={groupProperty}
          readOnly={readOnly}
          {...props}
        />
      ))}
      {announcer.live}
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
  lanes: RowGroup[];
  laneIndex: number;
  announce: (message: string) => void;
  width: number;
  groupProperty: string;
  readOnly: boolean;
}

function BoardColumn({
  lane,
  lanes,
  laneIndex,
  announce,
  width,
  groupProperty,
  readOnly,
  ...props
}: ColumnProps) {
  const { schema, view } = props;
  const [collapsed, setCollapsed] = useState(false);

  const { isOver, zoneRef } = useCardZone({
    accept: 'row',
    onDrop: (payload) => {
      if (payload.from === lane.key) return;
      moveRowToLane(payload.id, lane.key);
    },
  });

  /** 拖放與鍵盤共用的唯一出口（兩套實作就會有一套是錯的，第十一輪 §的教訓） */
  function moveRowToLane(rowId: string, targetKey: string | null): void {
    const def = schema[groupProperty];
    if (!def) return;
    // 丟到哪一欄就把該列的分組欄位設成那一欄的值
    const value = targetKey === null ? null : def.type === 'multiSelect' ? [targetKey] : targetKey;
    props.setCellValue(rowId, groupProperty, value);
  }

  const cardProperties = visibleProperties(schema, view.format).filter(
    (c) => c.property !== 'title',
  );

  return (
    <section
      ref={zoneRef}
      className={`${styles.column} ${isOver ? styles.columnOver : ''}`}
      style={{ width: collapsed ? 44 : width }}
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
                laneIndex={laneIndex}
                laneCount={lanes.length}
                readOnly={readOnly}
                announce={announce}
                onMoveToLane={(to) => {
                  const target = lanes[to];
                  if (target) moveRowToLane(row.id, target.key);
                }}
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
  laneIndex: number;
  laneCount: number;
  readOnly: boolean;
  announce: (message: string) => void;
  onMoveToLane: (to: number) => void;
  properties: Array<{ property: string }>;
}

function BoardCard({
  row,
  laneKey,
  laneIndex,
  laneCount,
  readOnly,
  announce,
  onMoveToLane,
  properties,
  ...props
}: CardProps) {
  const { schema } = props;
  // 第十一輪：長按 400ms 才進入拖曳（Pointer Events），所以卡片的 onClick 仍然正常
  const { isDragging, dragRef, handleProps } = useCardDrag('row', row.id, { from: laneKey });
  const title = richTextToPlainText(row.title) || '未命名';
  // O-17：整張卡就是把手，所以鍵盤入口也掛在卡片本身（Alt + ←/→）
  const keyboardProps = useKeyboardReorder({
    label: title,
    index: laneIndex,
    count: laneCount,
    axis: 'horizontal',
    onMove: onMoveToLane,
    announce,
    disabled: readOnly,
    disabledReason: '這個資料庫是唯讀的，不能換欄',
  });

  return (
    <article
      ref={dragRef}
      className={`${styles.card} ${isDragging ? styles.cardDragging : ''}`}
      {...handleProps}
      {...keyboardProps}
      aria-label={`${title}（${keyboardProps['aria-label']}）`}
      onClick={() => props.openRow(row.id)}
    >
      <h4 className={styles.cardTitle}>{title}</h4>
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
