/**
 * 時程表（Timeline / 甘特圖）—— `07i-db-timeline-light.png` 的版面。
 *
 * 由上到下三段：
 *   1. 工具列：`»` 折疊左側表格欄、期間標題、`在日曆中管理`、`月 ⌄` 刻度、`‹ 今天 ›`
 *   2. 刻度尺：一格一個單位（日 / 週 / 月），今天那一格是紅底白字的圓
 *   3. 本體：左側（可折疊）表格欄 + 右側格線；每一列依「開始 / 結束」欄位畫一條長條，
 *      長條可以整條拖曳（平移日期）或拖兩端（改開始 / 結束）。
 *
 * 日期一律用「當地時區的 YYYY-MM-DD」計算，不做 UTC 轉換 ——
 * 時程表的一格是「一天」而不是「24 小時」，用 UTC 會在 +08:00 的時區整條差一格。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DatabaseRow, TimelineScale } from '@kennote/shared-types';
import { TIMELINE_SCALES, TIMELINE_SCALE_LABELS, richTextToPlainText } from '@kennote/shared-types';
import { Menu, MenuItem, Popover, UiIcon } from '../../_fallback';
import { useDatabaseContext } from '../../context';
import { dateEndOf, dateStartOf } from '../../fields/_shared/ops';
import { visibleProperties, type ViewProps } from '../types';
import styles from './TimelineView.module.css';

/* ── 日期工具（全部走當地時區的 YYYY-MM-DD）────────────── */

const DAY_MS = 86_400_000;

export function toKey(date: Date): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** 兩個日期相差幾天（只看年月日，不受時區 / 日光節約影響） */
export function diffDays(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / DAY_MS);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** 一個刻度單位涵蓋幾天（月份用當月天數，所以要傳日期進來） */
export function unitDays(scale: TimelineScale, at: Date): number {
  if (scale === 'day') return 1;
  if (scale === 'week') return 7;
  return new Date(at.getFullYear(), at.getMonth() + 1, 0).getDate();
}

/** 把一個日期對齊到它所屬單位的第一天 */
export function startOfUnit(date: Date, scale: TimelineScale): Date {
  if (scale === 'day') return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (scale === 'week') return addDays(date, -date.getDay());
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** 刻度尺上每一格的標籤 */
function tickLabel(date: Date, scale: TimelineScale): string {
  if (scale === 'month') return `${date.getMonth() + 1}月`;
  if (scale === 'week') return `${date.getMonth() + 1}/${date.getDate()}`;
  return String(date.getDate());
}

function rangeLabel(start: Date, end: Date): string {
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getFullYear()}年${start.getMonth() + 1}月`;
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${start.getFullYear()}年${start.getMonth() + 1}–${end.getMonth() + 1}月`;
  }
  return `${start.getFullYear()}年${start.getMonth() + 1}月 – ${end.getFullYear()}年${end.getMonth() + 1}月`;
}

/* ── 一列在時間軸上的位置 ───────────────────────────────── */

export interface TimelineSpan {
  row: DatabaseRow;
  start: Date;
  end: Date;
}

/** 把一列解析成 span；沒有開始日期就回 null（歸到「無日期」） */
export function rowSpan(
  row: DatabaseRow,
  startProperty: string,
  endProperty: string | null,
): TimelineSpan | null {
  const startIso = dateStartOf(row.properties[startProperty]);
  if (!startIso) return null;
  const endIso =
    (endProperty ? dateStartOf(row.properties[endProperty]) : null) ??
    dateEndOf(row.properties[startProperty]) ??
    startIso;
  const start = parseKey(startIso.slice(0, 10));
  const end = parseKey(endIso.slice(0, 10));
  return { row, start, end: end < start ? start : end };
}

/* ── 主元件 ─────────────────────────────────────────────── */

const TICK_WIDTH: Record<TimelineScale, number> = { day: 40, week: 56, month: 72 };
const ROW_HEIGHT = 37;

export function TimelineView(props: ViewProps) {
  const { view, schema, rows } = props;
  const { readOnly } = useDatabaseContext();
  const format = view.format ?? {};

  const dateProps = useMemo(
    () =>
      Object.entries(schema).filter(
        ([, def]) =>
          def?.type === 'date' || def?.type === 'createdTime' || def?.type === 'lastEditedTime',
      ),
    [schema],
  );
  const startProperty = format.timelineStartProperty ?? dateProps[0]?.[0] ?? null;
  const endProperty = format.timelineEndProperty ?? null;
  const scale: TimelineScale = format.timelineScale ?? 'month';
  const showTable = format.timelineShowTable ?? true;
  const tableWidth = format.timelineTableWidth ?? 200;

  const [cursor, setCursor] = useState(() => startOfUnit(new Date(), scale));
  const [scaleMenu, setScaleMenu] = useState<HTMLElement | null>(null);

  // 換刻度時把游標重新對齊，不然「週」切到「月」會停在月中
  useEffect(() => {
    setCursor((c) => startOfUnit(c, scale));
  }, [scale]);

  const spans = useMemo(() => {
    if (!startProperty) return [];
    return rows
      .map((row) => rowSpan(row, startProperty, endProperty))
      .filter((s): s is TimelineSpan => s !== null);
  }, [rows, startProperty, endProperty]);

  if (!startProperty) {
    return (
      <div className={styles.empty}>
        <p>時程表需要一個日期欄位。</p>
        <p className={styles.hint}>先新增一個「日期」屬性，或在「⋯ → 版面」選開始 / 結束欄位。</p>
      </div>
    );
  }

  const undated = rows.length - spans.length;

  /* 可視範圍：從 cursor 起算 TICKS 格 */
  const TICKS = scale === 'day' ? 18 : scale === 'week' ? 12 : 9;
  const tickWidth = TICK_WIDTH[scale];
  const ticks: Date[] = [];
  {
    let at = cursor;
    for (let i = 0; i < TICKS; i += 1) {
      ticks.push(at);
      at = addDays(at, unitDays(scale, at));
    }
  }
  const rangeStart = ticks[0] as Date;
  const lastTick = ticks[TICKS - 1] as Date;
  const rangeEnd = addDays(lastTick, unitDays(scale, lastTick));
  const totalDays = diffDays(rangeStart, rangeEnd);
  const pxPerDay = (tickWidth * TICKS) / totalDays;
  const today = new Date();
  const todayOffset = diffDays(rangeStart, today);

  function step(direction: -1 | 1): void {
    setCursor((c) => addDays(c, direction * unitDays(scale, c)));
  }

  function patchFormat(patch: Record<string, unknown>): void {
    props.updateView({ format: { ...format, ...patch } });
  }

  /** 拖曳結束 → 寫回日期（includeTime 交給後端正規化） */
  function commit(span: TimelineSpan, nextStart: Date, nextEnd: Date): void {
    if (!startProperty) return;
    const startKey = toKey(nextStart);
    const endKey = toKey(nextEnd);
    if (endProperty) {
      props.setCellValue(span.row.id, startProperty, {
        start: startKey,
        end: null,
        includeTime: false,
      });
      props.setCellValue(span.row.id, endProperty, { start: endKey, end: null, includeTime: false });
      return;
    }
    props.setCellValue(span.row.id, startProperty, {
      start: startKey,
      end: endKey === startKey ? null : endKey,
      includeTime: false,
    });
  }

  const columns = visibleProperties(schema, format).slice(0, 1);
  const isWeekend = (t: Date) => scale === 'day' && (t.getDay() === 0 || t.getDay() === 6);

  return (
    <div className={styles.wrapper}>
      <header className={styles.toolbar}>
        <button
          type="button"
          className={styles.collapse}
          aria-label={showTable ? '收合表格欄' : '展開表格欄'}
          aria-expanded={showTable}
          onClick={() => patchFormat({ timelineShowTable: !showTable })}
        >
          {showTable ? '«' : '»'}
        </button>
        <span className={styles.range}>{rangeLabel(rangeStart, addDays(rangeEnd, -1))}</span>

        <div className={styles.toolbarRight}>
          <button
            type="button"
            className={styles.manage}
            onClick={() => setCursor(startOfUnit(new Date(), scale))}
          >
            <UiIcon name="calendar" size={14} />
            在日曆中管理
          </button>
          <button type="button" className={styles.scale} onClick={(e) => setScaleMenu(e.currentTarget)}>
            {TIMELINE_SCALE_LABELS[scale]}
            <UiIcon name="chevronDown" size={12} />
          </button>
          <button type="button" className={styles.nav} aria-label="上一頁" onClick={() => step(-1)}>
            ‹
          </button>
          <button
            type="button"
            className={styles.today}
            onClick={() => setCursor(startOfUnit(new Date(), scale))}
          >
            今天
          </button>
          <button type="button" className={styles.nav} aria-label="下一頁" onClick={() => step(1)}>
            ›
          </button>
        </div>
      </header>

      <Popover
        open={scaleMenu !== null}
        anchor={scaleMenu}
        onClose={() => setScaleMenu(null)}
        placement="bottom-end"
      >
        <Menu>
          {TIMELINE_SCALES.map((s) => (
            <MenuItem
              key={s}
              selected={s === scale}
              onSelect={() => {
                patchFormat({ timelineScale: s });
                setScaleMenu(null);
              }}
            >
              {TIMELINE_SCALE_LABELS[s]}
            </MenuItem>
          ))}
        </Menu>
      </Popover>

      <div className={styles.body}>
        {showTable ? (
          <div className={styles.table} style={{ width: tableWidth }}>
            <div className={styles.tableHead}>
              {columns.map((c) => (
                <span key={c.property}>{schema[c.property]?.name ?? c.property}</span>
              ))}
            </div>
            {spans.map((span) => (
              <button
                key={span.row.id}
                type="button"
                className={styles.tableRow}
                style={{ height: ROW_HEIGHT }}
                onClick={() => props.openRow(span.row.id)}
              >
                {richTextToPlainText(span.row.title) || '未命名'}
              </button>
            ))}
            {!readOnly ? (
              <button
                type="button"
                className={styles.add}
                style={{ height: ROW_HEIGHT }}
                onClick={() => props.createRow()}
              >
                <UiIcon name="plus" size={12} />
                新增
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={styles.scroller}>
          <div className={styles.grid} style={{ width: tickWidth * TICKS }}>
            <div className={styles.ruler}>
              {ticks.map((t) => {
                const isToday = scale === 'day' && diffDays(t, today) === 0;
                return (
                  <span
                    key={toKey(t)}
                    className={styles.tick}
                    style={{ width: tickWidth }}
                    data-weekend={isWeekend(t) ? 'true' : undefined}
                  >
                    <span className={isToday ? styles.tickToday : undefined}>{tickLabel(t, scale)}</span>
                  </span>
                );
              })}
            </div>

            <div
              className={styles.lanes}
              style={{ height: Math.max(spans.length + 1, 4) * ROW_HEIGHT }}
            >
              {ticks.map((t) => (
                <span
                  key={toKey(t)}
                  className={styles.column}
                  style={{ width: tickWidth }}
                  data-weekend={isWeekend(t) ? 'true' : undefined}
                />
              ))}

              {todayOffset >= 0 && todayOffset < totalDays ? (
                <span className={styles.todayLine} style={{ left: todayOffset * pxPerDay }} />
              ) : null}

              {spans.map((span, index) => (
                <TimelineBar
                  key={span.row.id}
                  span={span}
                  top={index * ROW_HEIGHT}
                  height={ROW_HEIGHT}
                  rangeStart={rangeStart}
                  pxPerDay={pxPerDay}
                  readOnly={readOnly}
                  onOpen={() => props.openRow(span.row.id)}
                  onCommit={(s, e) => commit(span, s, e)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {undated > 0 ? <p className={styles.undated}>無日期（{undated} 個）</p> : null}
    </div>
  );
}

/* ── 長條 ───────────────────────────────────────────────── */

type DragMode = 'move' | 'start' | 'end';

function TimelineBar({
  span,
  top,
  height,
  rangeStart,
  pxPerDay,
  readOnly,
  onOpen,
  onCommit,
}: {
  span: TimelineSpan;
  top: number;
  height: number;
  rangeStart: Date;
  pxPerDay: number;
  readOnly: boolean;
  onOpen: () => void;
  onCommit: (start: Date, end: Date) => void;
}) {
  const [drag, setDrag] = useState<{ mode: DragMode; deltaDays: number } | null>(null);
  /**
   * 拖完之後瀏覽器照樣會補一發 click（pointerdown 的 preventDefault 擋不掉），
   * 那一發會誤觸 onOpen 把列的 peek 打開。拖過就先記下來，讓下一發 click 作廢。
   */
  const suppressClickRef = useRef(false);

  const baseOffset = diffDays(rangeStart, span.start);
  const baseLength = diffDays(span.start, span.end) + 1;

  let offset = baseOffset;
  let length = baseLength;
  if (drag) {
    if (drag.mode === 'move') offset = baseOffset + drag.deltaDays;
    if (drag.mode === 'start') {
      const clamped = Math.min(drag.deltaDays, baseLength - 1);
      offset = baseOffset + clamped;
      length = baseLength - clamped;
    }
    if (drag.mode === 'end') length = Math.max(1, baseLength + drag.deltaDays);
  }

  function startDrag(mode: DragMode, e: React.PointerEvent<HTMLElement>): void {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const originX = e.clientX;
    let deltaDays = 0;
    let moved = false;

    const move = (ev: PointerEvent) => {
      deltaDays = Math.round((ev.clientX - originX) / pxPerDay);
      moved = true;
      setDrag({ mode, deltaDays });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (moved) suppressClickRef.current = true;
      if (!moved || deltaDays === 0) return;
      if (mode === 'move') onCommit(addDays(span.start, deltaDays), addDays(span.end, deltaDays));
      else if (mode === 'start') {
        onCommit(addDays(span.start, Math.min(deltaDays, baseLength - 1)), span.end);
      } else {
        onCommit(span.start, addDays(span.end, Math.max(deltaDays, 1 - baseLength)));
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div
      className={drag ? `${styles.bar} ${styles.barDragging}` : styles.bar}
      style={{
        top: top + 6,
        left: offset * pxPerDay,
        width: Math.max(length * pxPerDay, 12),
        height: height - 12,
      }}
      role="button"
      tabIndex={0}
      title={richTextToPlainText(span.row.title) || '未命名'}
      onPointerDown={(e) => startDrag('move', e)}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
    >
      {!readOnly ? (
        <span
          className={styles.handleStart}
          onPointerDown={(e) => startDrag('start', e)}
          aria-hidden="true"
        />
      ) : null}
      <span className={styles.barLabel}>{richTextToPlainText(span.row.title) || '未命名'}</span>
      {!readOnly ? (
        <span
          className={styles.handleEnd}
          onPointerDown={(e) => startDrag('end', e)}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
