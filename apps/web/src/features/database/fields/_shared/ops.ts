/**
 * 各欄位型別共用的純邏輯（沒有 React）。
 * 跟後端 field-types/common.ts 是**同一組語意的兩份實作**：
 * key 相同、運算子清單相同、比較語意相同，這樣前端樂觀更新排出來的順序
 * 才會跟後端重新查詢回來的一致。
 */
import type {
  AggregationFunction,
  FieldDefinition,
  FieldValue,
  FilterOperator,
  NumberFormat,
  SelectOption,
} from '@kennote/shared-types';

export const TEXT_OPS: FilterOperator[] = [
  'is',
  'isNot',
  'contains',
  'doesNotContain',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
];

export const NUMBER_OPS: FilterOperator[] = [
  'equals',
  'doesNotEqual',
  'greaterThan',
  'lessThan',
  'greaterThanOrEqualTo',
  'lessThanOrEqualTo',
  'isEmpty',
  'isNotEmpty',
];

export const DATE_OPS: FilterOperator[] = [
  'is',
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
  'isWithin',
  'isEmpty',
  'isNotEmpty',
];

export const SELECT_OPS: FilterOperator[] = [
  'is',
  'isNot',
  'isAnyOf',
  'isNoneOf',
  'isEmpty',
  'isNotEmpty',
];

export const CONTAINER_OPS: FilterOperator[] = [
  'contains',
  'doesNotContain',
  'isEmpty',
  'isNotEmpty',
];

export const EMPTY_ONLY_OPS: FilterOperator[] = ['isEmpty', 'isNotEmpty'];

export const COUNT_AGGS: AggregationFunction[] = [
  'none',
  'count',
  'countValues',
  'countUnique',
  'countEmpty',
  'countNotEmpty',
  'percentEmpty',
  'percentNotEmpty',
];

export const NUMBER_AGGS: AggregationFunction[] = [
  ...COUNT_AGGS,
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
];

export const DATE_AGGS: AggregationFunction[] = [...COUNT_AGGS, 'earliestDate', 'latestDate'];

export const BOOLEAN_AGGS: AggregationFunction[] = [
  'none',
  'count',
  'checked',
  'unchecked',
  'percentChecked',
];

/* ── 值的讀取 ─────────────────────────────────────────── */

export function optionList(def: FieldDefinition): SelectOption[] {
  return (def as { options?: SelectOption[] }).options ?? [];
}

export function optionOf(def: FieldDefinition, id: string | null | undefined): SelectOption | undefined {
  if (!id) return undefined;
  return optionList(def).find((o) => o.id === id);
}

export function plainTextOf(value: FieldValue | undefined): string {
  if (!value) return '';
  switch (value.type) {
    case 'title':
    case 'text':
      return value.plainText;
    case 'url':
      return value.url ?? '';
    case 'email':
      return value.email ?? '';
    case 'phone':
      return value.phone ?? '';
    default:
      return '';
  }
}

export function numberOf(value: FieldValue | undefined): number | null {
  if (!value) return null;
  if (value.type === 'number') return value.number;
  if (value.type === 'rating') return value.rating;
  return null;
}

export function dateStartOf(value: FieldValue | undefined): string | null {
  if (!value) return null;
  if (value.type === 'date' || value.type === 'createdTime' || value.type === 'lastEditedTime') {
    return value.start;
  }
  return null;
}

/** 日期區間的結束值；沒有結束時回 null（呼叫端自行退回 start） */
export function dateEndOf(value: FieldValue | undefined): string | null {
  if (!value) return null;
  if (value.type === 'date') return value.end ?? null;
  return null;
}

export function idsOf(value: FieldValue | undefined): string[] {
  if (!value) return [];
  if (value.type === 'multiSelect') return value.optionIds;
  if (value.type === 'person' || value.type === 'createdBy' || value.type === 'lastEditedBy') {
    return value.userIds;
  }
  if (value.type === 'relation') return value.pageIds;
  return [];
}

export function computedValueOf(value: FieldValue | undefined): string | number | boolean | null {
  if (!value) return null;
  if (value.type === 'formula' || value.type === 'rollup') return value.value;
  return null;
}

/* ── 比較 ─────────────────────────────────────────────── */

export function compareNullable<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  cmp: (x: T, y: T) => number,
): number {
  const aEmpty = a === null || a === undefined;
  const bEmpty = b === null || b === undefined;
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // 空值一律排最後（跟 SQL 的 NULLS LAST 一致）
  if (bEmpty) return -1;
  return cmp(a, b);
}

export function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hant');
}

export function compareTextValues(a: FieldValue | undefined, b: FieldValue | undefined): number {
  return compareNullable(plainTextOf(a) || null, plainTextOf(b) || null, compareText);
}

export function compareNumberValues(a: FieldValue | undefined, b: FieldValue | undefined): number {
  return compareNullable(numberOf(a), numberOf(b), (x, y) => x - y);
}

export function compareDateValues(a: FieldValue | undefined, b: FieldValue | undefined): number {
  return compareNullable(dateStartOf(a), dateStartOf(b), (x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

/* ── 格式化 ───────────────────────────────────────────── */

const CURRENCY_PREFIX: Partial<Record<NumberFormat, string>> = {
  currencyTwd: 'NT$',
  currencyUsd: '$',
  yen: '¥',
  euro: '€',
};

export function formatNumber(n: number | null, def: FieldDefinition): string {
  if (n === null) return '';
  const config = def as { numberFormat?: NumberFormat; precision?: number | null };
  const format = config.numberFormat ?? 'number';
  const precision = config.precision;
  const withPrecision = (v: number) =>
    precision === null || precision === undefined ? String(v) : v.toFixed(precision);

  if (format === 'percent') return `${withPrecision(n * 100)}%`;
  const prefix = CURRENCY_PREFIX[format];
  const body =
    format === 'numberWithCommas' || prefix
      ? Number(withPrecision(n)).toLocaleString('zh-Hant-TW', {
          minimumFractionDigits: precision ?? 0,
          maximumFractionDigits: precision ?? 3,
        })
      : withPrecision(n);
  return prefix ? `${prefix}${body}` : body;
}

/** 依欄位設定格式化日期。dateFormat 支援 YYYY/MM/DD 這種樣板 */
export function formatDateValue(iso: string | null, def: FieldDefinition): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const config = def as { dateFormat?: string; timeFormat?: string };
  const pattern = config.dateFormat ?? 'YYYY/MM/DD';
  const pad = (v: number) => String(v).padStart(2, '0');
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: pad(d.getDate()),
    D: String(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
  };
  const datePart = pattern.replace(/YYYY|MM|M|DD|D|HH|mm/g, (m) => map[m] ?? m);
  const hasTime = iso.includes('T') && !iso.endsWith('T00:00:00.000Z');
  return hasTime ? `${datePart} ${map.HH}:${map.mm}` : datePart;
}

/** <input type="date"> 需要 YYYY-MM-DD */
export function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export function emptyValue(value: FieldValue | undefined): boolean {
  if (!value) return true;
  const ids = idsOf(value);
  if (ids.length > 0) return false;
  switch (value.type) {
    case 'multiSelect':
    case 'person':
    case 'relation':
    case 'createdBy':
    case 'lastEditedBy':
      return true;
    case 'files':
      return value.files.length === 0;
    case 'number':
      return value.number === null;
    case 'rating':
      return value.rating === 0;
    case 'select':
      return !value.optionId;
    case 'checkbox':
      return false;
    case 'formula':
    case 'rollup':
      return value.value === null || value.value === '';
    default:
      return plainTextOf(value) === '' && dateStartOf(value) === null;
  }
}
