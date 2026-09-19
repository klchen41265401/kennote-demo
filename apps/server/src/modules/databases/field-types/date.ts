/**
 * date 欄位 + 日期篩選的共用邏輯（createdTime / lastEditedTime 也用這裡的 buildDateFilterSql）。
 *
 * 兩個刻意的決定：
 * 1. **比較用文字（ISO 8601）而不是 ::timestamptz**。ISO 8601 的字典序 == 時間序，
 *    而且不會因為某一列被寫進壞資料就讓整個查詢炸掉（cast 失敗會讓整批查詢失敗）。
 * 2. **相對日期一律在產生 SQL 時才展開**（03 §6.5）。存 'today'、查詢時展開，
 *    「今天到期」每天才會是對的；而且要用使用者的時區算日界線。
 */
import type { DateFilterValue, FilterOperator } from '@kennote/shared-types';
import { z } from 'zod';
import { AppError } from '../../../lib/errors.js';
import { sql, type Sql } from '../../../db/sql.js';
import { DATE_AGGS, DATE_OPS, baseDef, invalidValue, parseDef } from './common.js';
import { compareNullable, defineFieldType, propText } from './types.js';

const DAY_MS = 86_400_000;

/** 取某個時刻在指定時區的「當地日期」，回 YYYY-MM-DD */
export function localDateString(at: Date, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(at); // en-CA 就是 YYYY-MM-DD
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function shiftDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * DAY_MS);
}

function shiftMonths(at: Date, months: number): Date {
  const out = new Date(at.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

function nextDay(dateString: string): string {
  const d = new Date(`${dateString}T00:00:00Z`);
  return new Date(d.getTime() + DAY_MS).toISOString().slice(0, 10);
}

export interface DateRange {
  /** 含（>=） */
  start: string;
  /** 不含（<）；null 代表沒有上界 */
  end: string | null;
}

/** 把篩選條件的值展開成絕對區間 */
export function expandDateFilterValue(raw: unknown, now: Date, timeZone: string): DateRange {
  const value = normalizeDateFilterValue(raw);

  if (value.kind === 'exact') {
    const start = value.start;
    const end = value.end ?? (start.length === 10 ? nextDay(start) : null);
    return { start, end };
  }

  const today = localDateString(now, timeZone);

  if (value.kind === 'relativeN') {
    const at =
      value.unit === 'month'
        ? shiftMonths(now, value.value)
        : value.unit === 'year'
          ? shiftMonths(now, value.value * 12)
          : shiftDays(now, value.value * (value.unit === 'week' ? 7 : 1));
    const day = localDateString(at, timeZone);
    return { start: day, end: nextDay(day) };
  }

  switch (value.relative) {
    case 'today':
      return { start: today, end: nextDay(today) };
    case 'tomorrow': {
      const d = nextDay(today);
      return { start: d, end: nextDay(d) };
    }
    case 'yesterday': {
      const d = localDateString(shiftDays(now, -1), timeZone);
      return { start: d, end: today };
    }
    case 'oneWeekAgo': {
      const d = localDateString(shiftDays(now, -7), timeZone);
      return { start: d, end: nextDay(d) };
    }
    case 'oneWeekFromNow': {
      const d = localDateString(shiftDays(now, 7), timeZone);
      return { start: d, end: nextDay(d) };
    }
    case 'oneMonthAgo': {
      const d = localDateString(shiftMonths(now, -1), timeZone);
      return { start: d, end: nextDay(d) };
    }
    case 'oneMonthFromNow': {
      const d = localDateString(shiftMonths(now, 1), timeZone);
      return { start: d, end: nextDay(d) };
    }
    case 'pastWeek':
      return { start: localDateString(shiftDays(now, -7), timeZone), end: nextDay(today) };
    case 'pastMonth':
      return { start: localDateString(shiftMonths(now, -1), timeZone), end: nextDay(today) };
    case 'pastYear':
      return { start: localDateString(shiftMonths(now, -12), timeZone), end: nextDay(today) };
    case 'nextWeek':
      return { start: today, end: nextDay(localDateString(shiftDays(now, 7), timeZone)) };
    case 'nextMonth':
      return { start: today, end: nextDay(localDateString(shiftMonths(now, 1), timeZone)) };
    case 'nextYear':
      return { start: today, end: nextDay(localDateString(shiftMonths(now, 12), timeZone)) };
    default:
      throw new AppError('INVALID_FILTER', '不認得的相對日期');
  }
}

const dateFilterSchema = z.union([
  z.object({
    kind: z.literal('exact'),
    start: z.string().min(4).max(40),
    end: z.string().min(4).max(40).nullable().optional(),
  }),
  z.object({ kind: z.literal('relative'), relative: z.string().min(1).max(40) }),
  z.object({
    kind: z.literal('relativeN'),
    unit: z.enum(['day', 'week', 'month', 'year']),
    value: z.number().int().min(-3650).max(3650),
  }),
]);

function normalizeDateFilterValue(raw: unknown): DateFilterValue {
  // 允許直接傳字串（'2026-09-30'）或 { start }
  if (typeof raw === 'string') return { kind: 'exact', start: raw };
  const parsed = dateFilterSchema.safeParse(raw);
  if (!parsed.success) {
    if (raw !== null && typeof raw === 'object' && 'start' in raw) {
      const start = (raw as { start?: unknown }).start;
      if (typeof start === 'string') return { kind: 'exact', start };
    }
    throw new AppError('INVALID_FILTER', '日期篩選條件格式不正確');
  }
  return parsed.data as DateFilterValue;
}

/** 日期運算子 → SQL。expr 必須是投影成 ISO 字串的欄位 */
export function buildDateFilterSql(
  expr: Sql,
  operator: FilterOperator,
  value: unknown,
  now: Date,
  timeZone: string,
): Sql {
  if (operator === 'isEmpty') return sql`(${expr}) IS NULL`;
  if (operator === 'isNotEmpty') return sql`(${expr}) IS NOT NULL`;

  const range = expandDateFilterValue(value, now, timeZone);

  switch (operator) {
    case 'is':
    case 'isWithin':
      return range.end === null
        ? sql`(${expr}) >= ${range.start}`
        : sql`((${expr}) >= ${range.start} AND (${expr}) < ${range.end})`;
    case 'isBefore':
      return sql`(${expr}) < ${range.start}`;
    case 'isOnOrBefore':
      return range.end === null ? sql`(${expr}) <= ${range.start}` : sql`(${expr}) < ${range.end}`;
    case 'isAfter':
      return range.end === null ? sql`(${expr}) > ${range.start}` : sql`(${expr}) >= ${range.end}`;
    case 'isOnOrAfter':
      return sql`(${expr}) >= ${range.start}`;
    default:
      throw new AppError('INVALID_FILTER', `日期欄位不支援運算子 ${operator}`);
  }
}

/* ── date 欄位本身 ─────────────────────────────────────── */

defineFieldType({
  type: 'date',
  label: '日期',
  kind: 'date',
  computed: false,
  groupable: true,
  sortable: true,
  sqlCapable: true,
  validateConfig: (d) =>
    parseDef(
      z.object({
        ...baseDef,
        type: z.literal('date'),
        dateFormat: z.string().max(40).optional(),
        timeFormat: z.string().max(40).optional(),
        includeTimeDefault: z.boolean().optional(),
      }),
      d,
    ),
  defaultValue: () => null,
  normalize: (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'string') {
      return { type: 'date', start: v, end: null, includeTime: v.includes('T') };
    }
    const parsed = z
      .object({
        start: z.string().min(1).max(40),
        end: z.string().max(40).nullable().optional(),
        includeTime: z.boolean().optional(),
        timeZone: z.string().max(60).nullable().optional(),
      })
      .safeParse(v);
    if (!parsed.success) throw invalidValue('日期欄位格式不正確');
    if (Number.isNaN(new Date(parsed.data.start).getTime())) {
      throw invalidValue('無法解析的日期');
    }
    return {
      type: 'date',
      start: parsed.data.start,
      end: parsed.data.end ?? null,
      includeTime: parsed.data.includeTime ?? parsed.data.start.includes('T'),
      timeZone: parsed.data.timeZone ?? null,
    };
  },
  toSqlExpr: (propertyId) => propText(propertyId, 'start'),
  // 分組依「日」，不然每一筆時間戳都自成一組
  toGroupKeySql: (propertyId) => sql`left(p.properties -> ${propertyId} ->> 'start', 10)`,
  toFilterSql: (ctx) =>
    buildDateFilterSql(ctx.expr, ctx.operator, ctx.value, ctx.now, ctx.timeZone),
  filterOperators: DATE_OPS,
  aggregations: DATE_AGGS,
  compare: (a, b) =>
    compareNullable(
      a && a.type === 'date' ? a.start : null,
      b && b.type === 'date' ? b.start : null,
      (x, y) => (x < y ? -1 : x > y ? 1 : 0),
    ),
  groupKeys: (v) => [v && v.type === 'date' ? v.start.slice(0, 10) : null],
  groupLabel: (key) => ({ label: key ?? '無日期' }),
  toPlainText: (v) => {
    if (!v || v.type !== 'date') return '';
    return v.end ? `${v.start} → ${v.end}` : v.start;
  },
  fromPlainText: (text) => {
    const trimmed = text.trim();
    if (trimmed === '') return null;
    if (Number.isNaN(new Date(trimmed).getTime())) return null;
    return { type: 'date', start: trimmed, end: null, includeTime: trimmed.includes('T') };
  },
});
