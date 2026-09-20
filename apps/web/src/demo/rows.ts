/**
 * 純 JS 的 rows 查詢引擎（filter / sort / group / aggregation）。
 *
 * 對應伺服器的 `apps/server/src/modules/databases/query-builder.ts` +
 * `service.ts` 的 `queryRows()`，只是把 SQL 換成記憶體運算 ——
 * demo 的資料量是幾十列，全部掃一遍完全不是問題。
 *
 * 公式（formula）直接用 `@kennote/shared-types` 的自研引擎，**不另寫一份**。
 */
import type {
  AggregationFunction,
  AggregationResult,
  CollectionSchema,
  DatabaseRow,
  FieldDefinition,
  FieldValue,
  FilterCondition,
  FilterGroup,
  Page,
  RelativeDate,
  RowGroup,
  RowProperties,
  SelectColor,
  SortSpec,
  ViewQuery,
} from '@kennote/shared-types';
import {
  evaluateFieldFormula,
  formulaValueSortKey,
  isFilterGroup,
  serializeFormulaValue,
} from '@kennote/shared-types';
import { plain } from './util';

/* ── 值的正規化 ─────────────────────────────────────────── */

/** 把 FieldValue 攤平成「可比較 / 可搜尋」的純量 */
export function scalarOf(value: FieldValue | undefined, def: FieldDefinition | undefined): unknown {
  if (!value) return null;
  switch (value.type) {
    case 'title':
    case 'text':
      return value.plainText ?? plain(value.richText);
    case 'number':
      return value.number;
    case 'select':
      return value.optionId;
    case 'multiSelect':
      return value.optionIds;
    case 'date':
    case 'createdTime':
    case 'lastEditedTime':
      return value.start ?? null;
    case 'checkbox':
      return value.checkbox;
    case 'url':
      return value.url;
    case 'email':
      return value.email;
    case 'phone':
      return value.phone;
    case 'person':
    case 'createdBy':
    case 'lastEditedBy':
      return value.userIds;
    case 'files':
      return value.files.map((f) => f.name);
    case 'rating':
      return value.rating;
    case 'relation':
      return value.pageIds;
    case 'formula':
    case 'rollup':
      return value.value;
    default:
      return def ? null : null;
  }
}

/** 顯示用字串（搜尋 / CSV 匯出 / group label 用） */
export function displayOf(
  value: FieldValue | undefined,
  def: FieldDefinition | undefined,
): string {
  const scalar = scalarOf(value, def);
  if (scalar === null || scalar === undefined) return '';
  if (Array.isArray(scalar)) {
    if (def && (def.type === 'select' || def.type === 'multiSelect')) {
      return scalar.map((id) => optionLabel(def, String(id))).join(', ');
    }
    return scalar.map((v) => String(v)).join(', ');
  }
  if (typeof scalar === 'boolean') return scalar ? 'true' : 'false';
  if (def?.type === 'select') return optionLabel(def, String(scalar));
  return String(scalar);
}

export function optionLabel(def: FieldDefinition | undefined, optionId: string): string {
  if (!def || (def.type !== 'select' && def.type !== 'multiSelect')) return optionId;
  return def.options.find((o) => o.id === optionId)?.value ?? optionId;
}

export function optionColor(
  def: FieldDefinition | undefined,
  optionId: string,
): SelectColor | undefined {
  if (!def || (def.type !== 'select' && def.type !== 'multiSelect')) return undefined;
  return def.options.find((o) => o.id === optionId)?.color;
}

function isEmptyValue(scalar: unknown): boolean {
  if (scalar === null || scalar === undefined || scalar === '') return true;
  if (Array.isArray(scalar)) return scalar.length === 0;
  if (scalar === false) return true;
  return false;
}

/* ── 相對日期展開（與 server 的 query-builder 同語意）────── */

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function expandRelativeDate(
  relative: RelativeDate,
  now: Date,
): { start: Date; end: Date } {
  const today = startOfDay(now);
  const day = 86_400_000;
  const plusDays = (n: number): Date => new Date(today.getTime() + n * day);
  const range = (a: Date, b: Date) => ({ start: a, end: b });
  switch (relative) {
    case 'today':
      return range(today, plusDays(1));
    case 'tomorrow':
      return range(plusDays(1), plusDays(2));
    case 'yesterday':
      return range(plusDays(-1), today);
    case 'oneWeekAgo':
      return range(plusDays(-7), plusDays(-6));
    case 'oneWeekFromNow':
      return range(plusDays(7), plusDays(8));
    case 'oneMonthAgo':
      return range(plusDays(-30), plusDays(-29));
    case 'oneMonthFromNow':
      return range(plusDays(30), plusDays(31));
    case 'pastWeek':
      return range(plusDays(-7), plusDays(1));
    case 'pastMonth':
      return range(plusDays(-30), plusDays(1));
    case 'pastYear':
      return range(plusDays(-365), plusDays(1));
    case 'nextWeek':
      return range(today, plusDays(7));
    case 'nextMonth':
      return range(today, plusDays(30));
    case 'nextYear':
      return range(today, plusDays(365));
    default:
      return range(today, plusDays(1));
  }
}

function dateFilterRange(raw: unknown, now: Date): { start: Date; end: Date } | null {
  if (raw && typeof raw === 'object') {
    const v = raw as { kind?: string; start?: string; end?: string | null; relative?: RelativeDate; unit?: string; value?: number };
    if (v.kind === 'relative' && v.relative) return expandRelativeDate(v.relative, now);
    if (v.kind === 'relativeN' && typeof v.value === 'number') {
      const units: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
      const days = (units[v.unit ?? 'day'] ?? 1) * v.value;
      const today = startOfDay(now);
      const target = new Date(today.getTime() + days * 86_400_000);
      return days >= 0 ? { start: today, end: target } : { start: target, end: today };
    }
    if (v.kind === 'exact' && v.start) {
      const start = new Date(v.start);
      const end = v.end ? new Date(v.end) : new Date(start.getTime() + 86_400_000);
      return { start, end };
    }
  }
  if (typeof raw === 'string' && raw) {
    const start = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
    if (Number.isNaN(start.getTime())) return null;
    return { start, end: new Date(start.getTime() + 86_400_000) };
  }
  return null;
}

/* ── 單一條件 ────────────────────────────────────────────── */

export function matchesCondition(
  schema: CollectionSchema,
  properties: RowProperties,
  condition: FilterCondition,
  now: Date,
): boolean {
  const def = schema[condition.property];
  const value = properties[condition.property];
  const scalar = scalarOf(value, def);
  const op = condition.operator;

  if (op === 'isEmpty') return isEmptyValue(scalar);
  if (op === 'isNotEmpty') return !isEmptyValue(scalar);

  const raw = condition.value;

  // 日期家族
  if (def && (def.type === 'date' || def.type === 'createdTime' || def.type === 'lastEditedTime')) {
    const range = dateFilterRange(raw, now);
    if (!range) return true;
    if (typeof scalar !== 'string' || !scalar) return false;
    const at = new Date(scalar.length === 10 ? `${scalar}T00:00:00` : scalar).getTime();
    if (Number.isNaN(at)) return false;
    switch (op) {
      case 'is':
      case 'equals':
        return at >= range.start.getTime() && at < range.end.getTime();
      case 'isNot':
      case 'doesNotEqual':
        return !(at >= range.start.getTime() && at < range.end.getTime());
      case 'isBefore':
      case 'lessThan':
        return at < range.start.getTime();
      case 'isAfter':
      case 'greaterThan':
        return at >= range.end.getTime();
      case 'isOnOrBefore':
      case 'lessThanOrEqualTo':
        return at < range.end.getTime();
      case 'isOnOrAfter':
      case 'greaterThanOrEqualTo':
        return at >= range.start.getTime();
      case 'isWithin':
        return at >= range.start.getTime() && at < range.end.getTime();
      default:
        return true;
    }
  }

  // 多值家族（multiSelect / person / relation / files）
  if (Array.isArray(scalar)) {
    const ids = scalar.map((v) => String(v));
    const wanted = Array.isArray(raw) ? raw.map((v) => String(v)) : raw == null ? [] : [String(raw)];
    switch (op) {
      case 'contains':
      case 'is':
      case 'isAnyOf':
        return wanted.length === 0 || wanted.some((w) => ids.includes(w));
      case 'doesNotContain':
      case 'isNot':
      case 'isNoneOf':
        return wanted.length === 0 || !wanted.some((w) => ids.includes(w));
      default:
        return true;
    }
  }

  // 布林
  if (typeof scalar === 'boolean' || def?.type === 'checkbox') {
    const wanted = raw === true || raw === 'true' || raw === 1 || raw === '1';
    const actual = scalar === true;
    if (op === 'is' || op === 'equals') return actual === wanted;
    if (op === 'isNot' || op === 'doesNotEqual') return actual !== wanted;
    return true;
  }

  // 數字家族
  if (typeof scalar === 'number' || def?.type === 'number' || def?.type === 'rating') {
    const n = typeof scalar === 'number' ? scalar : null;
    const target = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isNaN(target)) return true;
    if (n === null) return op === 'doesNotEqual' || op === 'isNot';
    switch (op) {
      case 'equals':
      case 'is':
        return n === target;
      case 'doesNotEqual':
      case 'isNot':
        return n !== target;
      case 'greaterThan':
        return n > target;
      case 'lessThan':
        return n < target;
      case 'greaterThanOrEqualTo':
        return n >= target;
      case 'lessThanOrEqualTo':
        return n <= target;
      default:
        return true;
    }
  }

  // 字串家族（含 select 的 optionId）
  const s = scalar === null || scalar === undefined ? '' : String(scalar);
  const needleRaw = raw == null ? '' : String(raw);
  const a = s.toLocaleLowerCase();
  const b = needleRaw.toLocaleLowerCase();
  switch (op) {
    case 'is':
    case 'equals':
      return def?.type === 'select' ? s === needleRaw : a === b;
    case 'isNot':
    case 'doesNotEqual':
      return def?.type === 'select' ? s !== needleRaw : a !== b;
    case 'contains':
      return a.includes(b);
    case 'doesNotContain':
      return !a.includes(b);
    case 'startsWith':
      return a.startsWith(b);
    case 'endsWith':
      return a.endsWith(b);
    case 'isAnyOf':
      return Array.isArray(raw) ? raw.map(String).includes(s) : a === b;
    case 'isNoneOf':
      return Array.isArray(raw) ? !raw.map(String).includes(s) : a !== b;
    default:
      return true;
  }
}

export function matchesFilter(
  schema: CollectionSchema,
  properties: RowProperties,
  filter: FilterGroup | FilterCondition | null | undefined,
  now: Date,
): boolean {
  if (!filter) return true;
  if (!isFilterGroup(filter)) return matchesCondition(schema, properties, filter, now);
  if (filter.filters.length === 0) return true;
  const results = filter.filters.map((f) => matchesFilter(schema, properties, f, now));
  return filter.operator === 'or' ? results.some(Boolean) : results.every(Boolean);
}

/* ── 排序 ────────────────────────────────────────────────── */

function sortValue(row: DatabaseRow, schema: CollectionSchema, property: string): number | string | null {
  if (property === 'title') return plain(row.title).toLocaleLowerCase();
  const def = schema[property];
  const scalar = scalarOf(row.properties[property], def);
  if (scalar === null || scalar === undefined) return null;
  if (Array.isArray(scalar)) return scalar.map(String).join(',');
  if (typeof scalar === 'boolean') return scalar ? 1 : 0;
  if (typeof scalar === 'number') return scalar;
  if (def && (def.type === 'date' || def.type === 'createdTime' || def.type === 'lastEditedTime')) {
    const t = new Date(String(scalar)).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (def?.type === 'select' || def?.type === 'multiSelect') {
    return optionLabel(def, String(scalar)).toLocaleLowerCase();
  }
  return String(scalar).toLocaleLowerCase();
}

export function sortRows(rows: DatabaseRow[], schema: CollectionSchema, sort: SortSpec[] | undefined): DatabaseRow[] {
  if (!sort || sort.length === 0) return rows;
  return [...rows].sort((ra, rb) => {
    for (const spec of sort) {
      const a = sortValue(ra, schema, spec.property);
      const b = sortValue(rb, schema, spec.property);
      // 空值永遠排在最後（與 Notion / 伺服器的 NULLS LAST 一致）
      if (a === null && b === null) continue;
      if (a === null) return 1;
      if (b === null) return -1;
      if (a === b) continue;
      const cmp = a < b ? -1 : 1;
      return spec.direction === 'descending' ? -cmp : cmp;
    }
    return 0;
  });
}

/* ── 分組 ────────────────────────────────────────────────── */

export function groupKeyOf(
  row: DatabaseRow,
  schema: CollectionSchema,
  property: string,
): string | null {
  const def = schema[property];
  const scalar = scalarOf(row.properties[property], def);
  if (scalar === null || scalar === undefined || scalar === '') return null;
  if (Array.isArray(scalar)) return scalar.length > 0 ? String(scalar[0]) : null;
  if (typeof scalar === 'boolean') return scalar ? 'true' : 'false';
  return String(scalar);
}

export function buildGroups(
  rows: DatabaseRow[],
  schema: CollectionSchema,
  property: string,
  hideEmptyGroups: boolean,
): RowGroup[] {
  const def = schema[property];
  const buckets = new Map<string | null, DatabaseRow[]>();
  // 先把 schema 定義的所有 option 都放進來（空泳道也要畫）
  if (def && (def.type === 'select' || def.type === 'multiSelect')) {
    for (const o of def.options) buckets.set(o.id, []);
  } else if (def?.type === 'checkbox') {
    buckets.set('true', []);
    buckets.set('false', []);
  }
  buckets.set(null, buckets.get(null) ?? []);

  for (const row of rows) {
    const key = groupKeyOf(row, schema, property);
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  const groups: RowGroup[] = [];
  for (const [key, list] of buckets) {
    if (hideEmptyGroups && list.length === 0) continue;
    const label =
      key === null
        ? '未設定'
        : def?.type === 'checkbox'
          ? key === 'true'
            ? '已勾選'
            : '未勾選'
          : optionLabel(def, key);
    const color = key === null ? undefined : optionColor(def, key);
    groups.push({
      key,
      label,
      ...(color ? { color } : {}),
      count: list.length,
      rows: list,
      hasMore: false,
    });
  }
  // 未設定排最後（與 Notion 一致）
  groups.sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : 0));
  return groups;
}

/* ── 聚合 ────────────────────────────────────────────────── */

export function aggregate(
  rows: DatabaseRow[],
  schema: CollectionSchema,
  property: string,
  fn: AggregationFunction,
): number | string | null {
  const def = schema[property];
  const values = rows.map((r) =>
    property === 'title' ? plain(r.title) : scalarOf(r.properties[property], def),
  );
  const notEmpty = values.filter((v) => !isEmptyValue(v));
  const numbers = values.filter((v): v is number => typeof v === 'number');
  const dates = values
    .filter((v): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v)))
    .map((v) => Date.parse(v));
  const pct = (n: number): number => (rows.length === 0 ? 0 : Math.round((n / rows.length) * 100));

  switch (fn) {
    case 'none':
      return null;
    case 'count':
      return rows.length;
    case 'countValues':
      return values.reduce<number>((sum, v) => sum + (Array.isArray(v) ? v.length : isEmptyValue(v) ? 0 : 1), 0);
    case 'countUnique':
      return new Set(notEmpty.map((v) => JSON.stringify(v))).size;
    case 'countEmpty':
      return rows.length - notEmpty.length;
    case 'countNotEmpty':
      return notEmpty.length;
    case 'percentEmpty':
      return pct(rows.length - notEmpty.length);
    case 'percentNotEmpty':
      return pct(notEmpty.length);
    case 'sum':
      return numbers.reduce((a, b) => a + b, 0);
    case 'average':
      return numbers.length === 0 ? null : numbers.reduce((a, b) => a + b, 0) / numbers.length;
    case 'median': {
      if (numbers.length === 0) return null;
      const s = [...numbers].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? ((s[mid - 1]! + s[mid]!) / 2) : s[mid]!;
    }
    case 'min':
      return numbers.length === 0 ? null : Math.min(...numbers);
    case 'max':
      return numbers.length === 0 ? null : Math.max(...numbers);
    case 'range':
      return numbers.length === 0 ? null : Math.max(...numbers) - Math.min(...numbers);
    case 'earliestDate':
      return dates.length === 0 ? null : new Date(Math.min(...dates)).toISOString();
    case 'latestDate':
      return dates.length === 0 ? null : new Date(Math.max(...dates)).toISOString();
    case 'checked':
      return values.filter((v) => v === true).length;
    case 'unchecked':
      return values.filter((v) => v !== true).length;
    case 'percentChecked':
      return pct(values.filter((v) => v === true).length);
    case 'showOriginal':
      return notEmpty.length > 0 ? String(notEmpty[0]) : null;
    default:
      return null;
  }
}

/* ── 一列的「物化」（含計算欄位）───────────────────────── */

export interface MaterializeDeps {
  /** rollup 用：目標 collection 的列 */
  rowsOfCollection?(collectionId: string): DatabaseRow[];
}

export function materializeRow(
  page: Page,
  collectionId: string,
  schema: CollectionSchema,
  deps: MaterializeDeps = {},
  now: Date = new Date(),
): DatabaseRow {
  const stored = (page.properties ?? {}) as RowProperties;
  const properties: RowProperties = { ...stored };
  properties.title = { type: 'title', richText: page.title ?? [], plainText: plain(page.title) };

  for (const [propertyId, def] of Object.entries(schema)) {
    if (!def) continue;
    switch (def.type) {
      case 'createdTime':
        properties[propertyId] = { type: 'createdTime', start: page.createdAt };
        break;
      case 'lastEditedTime':
        properties[propertyId] = { type: 'lastEditedTime', start: page.updatedAt };
        break;
      case 'createdBy':
        properties[propertyId] = { type: 'createdBy', userIds: page.createdBy ? [page.createdBy] : [] };
        break;
      case 'lastEditedBy':
        properties[propertyId] = {
          type: 'lastEditedBy',
          userIds: page.updatedBy ? [page.updatedBy] : [],
        };
        break;
      case 'rollup': {
        const relationDef = def.relationProperty ? schema[def.relationProperty] : undefined;
        const targets =
          relationDef?.type === 'relation' && relationDef.collectionId && deps.rowsOfCollection
            ? deps.rowsOfCollection(relationDef.collectionId)
            : [];
        const value = properties[def.relationProperty ?? ''];
        const ids = value && value.type === 'relation' ? value.pageIds : [];
        const linked = targets.filter((r) => ids.includes(r.id));
        const targetSchema = schema;
        const agg = def.targetProperty
          ? aggregate(linked, targetSchema, def.targetProperty, def.function)
          : linked.length;
        properties[propertyId] = {
          type: 'rollup',
          value: agg,
          valueType: typeof agg === 'number' ? 'number' : 'string',
          computedAt: now.toISOString(),
        };
        break;
      }
      case 'formula': {
        try {
          const raw = evaluateFieldFormula(def, { schema, properties, now });
          const serialized = serializeFormulaValue(raw);
          properties[propertyId] = {
            type: 'formula',
            value: serialized,
            valueType: def.resultType,
            computedAt: now.toISOString(),
          };
        } catch (error) {
          properties[propertyId] = {
            type: 'formula',
            value: null,
            valueType: def.resultType,
            error: error instanceof Error ? error.message : '公式錯誤',
          };
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    id: page.id,
    collectionId,
    title: page.title ?? [],
    icon: page.icon,
    cover: page.cover,
    properties,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    createdBy: page.createdBy,
    updatedBy: page.updatedBy,
  };
}

/* ── 主查詢 ──────────────────────────────────────────────── */

export interface RunQueryOptions {
  schema: CollectionSchema;
  query: ViewQuery;
  rows: DatabaseRow[];
  limit: number;
  offset: number;
  search?: string;
  now?: Date;
}

export interface RunQueryResult {
  rows: DatabaseRow[];
  groups?: RowGroup[];
  aggregations: AggregationResult[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
}

export function runQuery(opts: RunQueryOptions): RunQueryResult {
  const now = opts.now ?? new Date();
  const { schema, query } = opts;

  let rows = opts.rows.filter((r) => matchesFilter(schema, r.properties, query.filter, now));

  const search = (opts.search ?? query.searchQuery ?? '').trim();
  if (search) {
    const needle = search.toLocaleLowerCase();
    rows = rows.filter((row) => {
      if (plain(row.title).toLocaleLowerCase().includes(needle)) return true;
      return Object.entries(schema).some(([id, def]) =>
        displayOf(row.properties[id], def).toLocaleLowerCase().includes(needle),
      );
    });
  }

  rows = sortRows(rows, schema, query.sort);

  const aggregations: AggregationResult[] = Object.entries(query.aggregations ?? {})
    .filter(([, fn]) => fn && fn !== 'none')
    .map(([property, fn]) => ({ property, function: fn, value: aggregate(rows, schema, property, fn) }));

  const total = rows.length;

  if (query.groupBy?.property && schema[query.groupBy.property]) {
    const groups = buildGroups(rows, schema, query.groupBy.property, query.groupBy.hideEmptyGroups ?? false);
    return {
      rows: groups.flatMap((g) => g.rows),
      groups,
      aggregations,
      total,
      hasMore: false,
      nextOffset: total,
    };
  }

  const page = rows.slice(opts.offset, opts.offset + opts.limit);
  return {
    rows: page,
    aggregations,
    total,
    hasMore: opts.offset + opts.limit < total,
    nextOffset: opts.offset + opts.limit,
  };
}

export { formulaValueSortKey };
