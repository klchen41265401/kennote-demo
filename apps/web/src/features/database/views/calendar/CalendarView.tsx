/**
 * 月曆（01 §5.3 M4.3.5）。依某個 date 欄位把列擺進格子，拖曳卡片改日期。
 *
 * 月曆格線用「固定 6 週 × 7 天」：不同月份格數不同會讓高度跳動，
 * 固定 42 格反而簡單又穩定（Notion 也是這樣）。
 */
import { useMemo, useState } from 'react';
import type { DatabaseRow } from '@kennote/shared-types';
import { richTextToPlainText } from '@kennote/shared-types';
import { UiIcon } from '../../_fallback';
import { useCardDrag, useCardZone } from '../../dnd';
import { useDatabaseContext } from '../../context';
import { dateStartOf } from '../../fields/_shared/ops';
import type { ViewProps } from '../types';
import styles from './CalendarView.module.css';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function toKey(date: Date): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfCalendar(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  return new Date(year, month, 1 - first.getDay());
}

export function CalendarView(props: ViewProps) {
  const { view, schema, rows } = props;
  const { readOnly } = useDatabaseContext();
  const [cursor, setCursor] = useState(() => new Date());

  const dateProperty =
    view.format?.calendarDateProperty ??
    Object.entries(schema).find(([, def]) => def?.type === 'date')?.[0] ??
    null;

  const byDay = useMemo(() => {
    const map = new Map<string, DatabaseRow[]>();
    if (!dateProperty) return map;
    for (const row of rows) {
      const iso = dateStartOf(row.properties[dateProperty]);
      if (!iso) continue;
      const key = iso.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [rows, dateProperty]);

  if (!dateProperty) {
    return (
      <div className={styles.empty}>
        <p>月曆需要一個日期欄位。</p>
        <p className={styles.hint}>先新增一個「日期」屬性，或在「⋯ → 版面」選一個日期欄位。</p>
      </div>
    );
  }

  const start = startOfCalendar(cursor.getFullYear(), cursor.getMonth());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const todayKey = toKey(new Date());

  return (
    <div className={styles.wrapper}>
      <header className={styles.toolbar}>
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          aria-label="上個月"
        >
          ‹
        </button>
        <span className={styles.month}>
          {cursor.getFullYear()} 年 {cursor.getMonth() + 1} 月
        </span>
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          aria-label="下個月"
        >
          ›
        </button>
        <button type="button" className={styles.today} onClick={() => setCursor(new Date())}>
          今天
        </button>
      </header>

      <div className={styles.weekdays}>
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className={styles.grid}>
        {days.map((day) => (
          <DayCell
            key={toKey(day)}
            {...props}
            day={day}
            inMonth={day.getMonth() === cursor.getMonth()}
            isToday={toKey(day) === todayKey}
            dayRows={byDay.get(toKey(day)) ?? []}
            dateProperty={dateProperty}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

interface DayCellProps extends ViewProps {
  day: Date;
  inMonth: boolean;
  isToday: boolean;
  dayRows: DatabaseRow[];
  dateProperty: string;
  readOnly: boolean;
}

function DayCell({ day, inMonth, isToday, dayRows, dateProperty, readOnly, ...props }: DayCellProps) {
  const key = toKey(day);
  const { isOver, zoneRef } = useCardZone({
    accept: 'row',
    onDrop: (payload) => {
      // 拖到哪一格就把日期改成那一天（保留原本的 includeTime 設定交給後端正規化）
      props.setCellValue(payload.id, dateProperty, { start: key, end: null, includeTime: false });
    },
  });

  return (
    <div
      ref={zoneRef}
      className={`${styles.day} ${inMonth ? '' : styles.dayOut} ${isOver ? styles.dayOver : ''}`}
    >
      <div className={styles.dayHeader}>
        <span className={isToday ? styles.dayNumberToday : styles.dayNumber}>{day.getDate()}</span>
        {!readOnly ? (
          <button
            type="button"
            className={styles.dayAdd}
            aria-label={`在 ${key} 新增`}
            // 建立後由容器重新查詢；日期在 RowPeek 裡補
            onClick={() => props.createRow()}
          >
            <UiIcon name="plus" size={12} />
          </button>
        ) : null}
      </div>
      <div className={styles.dayItems}>
        {dayRows.map((row) => (
          <CalendarChip key={row.id} row={row} onOpen={() => props.openRow(row.id)} />
        ))}
      </div>
    </div>
  );
}

function CalendarChip({ row, onOpen }: { row: DatabaseRow; onOpen: () => void }) {
  const { isDragging, dragRef, handleProps } = useCardDrag('row', row.id);
  return (
    <button
      ref={dragRef}
      type="button"
      className={`${styles.chip} ${isDragging ? styles.chipDragging : ''}`}
      onClick={onOpen}
      {...handleProps}
    >
      {richTextToPlainText(row.title) || '未命名'}
    </button>
  );
}
