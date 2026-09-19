/**
 * 記憶體版的 filter / sort。
 *
 * 只有在條件或排序牽涉到**計算欄位**（formula / rollup）時才會用到：
 * 那兩種欄位的值不在 JSONB 裡（是查詢時算出來的），SQL 沒辦法下推。
 * 這條路徑會先撈回上限 MEMORY_SCAN_LIMIT 筆再處理，並關閉 cursor 分頁。
 * 取捨寫在 docs/adr/0003。
 */
import type {
  CollectionSchema,
  FieldValue,
  FilterCondition,
  FilterGroup,
  RowProperties,
  SortSpec,
} from '@kennote/shared-types';
import { isFilterGroup } from '@kennote/shared-types';
import { getFieldType, type ServerFieldType } from './field-types/index.js';
import { expandDateFilterValue } from './field-types/date.js';
import type { QueryContext } from './query-builder.js';

export const MEMORY_SCAN_LIMIT = 2000;

function scalarOf(value: FieldValue | undefined, fieldType: ServerFieldType): unknown {
  if (value === undefined) return null;
  switch (value.type) {
    case 'number':
      return value.number;
    case 'rating':
      return value.rating;
    case 'checkbox':
      return value.checkbox;
    case 'date':
    case 'createdTime':
    case 'lastEditedTime':
      return value.start;
    case 'rollup':
    case 'formula':
      return value.value;
    default:
      return fieldType.toPlainText(value, { name: '', type: value.type } as never) || null;
  }
}

function arrayOf(value: FieldValue | undefined): string[] | null {
  if (!value) return null;
  if (value.type === 'multiSelect') return value.optionIds;
  if (value.type === 'person' || value.type === 'createdBy' || value.type === 'lastEditedBy') {
    return value.userIds;
  }
  if (value.type === 'relation') return value.pageIds;
  if (value.type === 'files') return value.files.map((f) => f.name);
  return null;
}

function isEmpty(scalar: unknown, arr: string[] | null): boolean {
  if (arr) return arr.length === 0;
  if (scalar === null || scalar === undefined) return true;
  if (typeof scalar === 'string') return scalar === '';
  return false;
}

function compareLoose(a: unknown, b: unknown): number {
  const an = typeof a === 'number' ? a : Number(a);
  const bn = typeof b === 'number' ? b : Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  const as = String(a ?? '');
  const bs = String(b ?? '');
  return as < bs ? -1 : as > bs ? 1 : 0;
}

export function matchesCondition(
  schema: CollectionSchema,
  properties: RowProperties,
  cond: FilterCondition,
  ctx: QueryContext,
): boolean {
  const def = schema[cond.property];
  if (!def) return true; // 欄位被刪了 → 條件視為不生效，而不是整列消失
  const fieldType = getFieldType(def.type);
  const raw = properties[cond.property];
  const arr = arrayOf(raw);
  const scalar = scalarOf(raw, fieldType);
  const value = cond.value;

  switch (cond.operator) {
    case 'isEmpty':
      return isEmpty(scalar, arr);
    case 'isNotEmpty':
      return !isEmpty(scalar, arr);
    default:
      break;
  }

  if (arr) {
    const needle = String(value);
    switch (cond.operator) {
      case 'contains':
      case 'is':
        return arr.includes(needle);
      case 'doesNotContain':
      case 'isNot':
        return !arr.includes(needle);
      case 'isAnyOf': {
        const list = (Array.isArray(value) ? value : [value]).map(String);
        return arr.some((v) => list.includes(v));
      }
      case 'isNoneOf': {
        const list = (Array.isArray(value) ? value : [value]).map(String);
        return !arr.some((v) => list.includes(v));
      }
      default:
        return true;
    }
  }

  if (fieldType.kind === 'date') {
    const iso = scalar === null ? null : String(scalar);
    if (iso === null) return false;
    const range = expandDateFilterValue(value, ctx.now, ctx.timeZone);
    switch (cond.operator) {
      case 'is':
      case 'isWithin':
        return iso >= range.start && (range.end === null || iso < range.end);
      case 'isBefore':
        return iso < range.start;
      case 'isOnOrBefore':
        return range.end === null ? iso <= range.start : iso < range.end;
      case 'isAfter':
        return range.end === null ? iso > range.start : iso >= range.end;
      case 'isOnOrAfter':
        return iso >= range.start;
      default:
        return true;
    }
  }

  const text = scalar === null || scalar === undefined ? '' : String(scalar);
  const needle = value === null || value === undefined ? '' : String(value);

  switch (cond.operator) {
    case 'is':
    case 'equals':
      return fieldType.kind === 'boolean'
        ? Boolean(scalar) === (value === true || value === 'true')
        : compareLoose(scalar, value) === 0;
    case 'isNot':
    case 'doesNotEqual':
      return compareLoose(scalar, value) !== 0;
    case 'contains':
      return text.toLowerCase().includes(needle.toLowerCase());
    case 'doesNotContain':
      return !text.toLowerCase().includes(needle.toLowerCase());
    case 'startsWith':
      return text.toLowerCase().startsWith(needle.toLowerCase());
    case 'endsWith':
      return text.toLowerCase().endsWith(needle.toLowerCase());
    case 'greaterThan':
      return scalar !== null && compareLoose(scalar, value) > 0;
    case 'lessThan':
      return scalar !== null && compareLoose(scalar, value) < 0;
    case 'greaterThanOrEqualTo':
      return scalar !== null && compareLoose(scalar, value) >= 0;
    case 'lessThanOrEqualTo':
      return scalar !== null && compareLoose(scalar, value) <= 0;
    case 'isAnyOf':
      return (Array.isArray(value) ? value : [value]).some((v) => compareLoose(scalar, v) === 0);
    case 'isNoneOf':
      return !(Array.isArray(value) ? value : [value]).some((v) => compareLoose(scalar, v) === 0);
    default:
      return true;
  }
}

export function matchesFilter(
  schema: CollectionSchema,
  properties: RowProperties,
  filter: FilterGroup | FilterCondition | null | undefined,
  ctx: QueryContext,
): boolean {
  if (!filter) return true;
  if (isFilterGroup(filter)) {
    if (filter.filters.length === 0) return true;
    return filter.operator === 'or'
      ? filter.filters.some((f) => matchesFilter(schema, properties, f, ctx))
      : filter.filters.every((f) => matchesFilter(schema, properties, f, ctx));
  }
  return matchesCondition(schema, properties, filter, ctx);
}

/** 多欄記憶體排序。比較子一律來自 registry，語意才會跟 SQL 與前端一致 */
export function sortInMemory<T extends { properties: RowProperties; id: string }>(
  rows: T[],
  schema: CollectionSchema,
  sorts: SortSpec[] | undefined,
): T[] {
  const specs = (sorts ?? []).filter((s) => schema[s.property]);
  if (specs.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const def = schema[spec.property];
      if (!def) continue;
      const fieldType = getFieldType(def.type);
      const cmp = fieldType.compare(a.properties[spec.property], b.properties[spec.property], def);
      if (cmp !== 0) return spec.direction === 'descending' ? -cmp : cmp;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
