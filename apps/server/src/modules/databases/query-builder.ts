/**
 * filter / sort / group / aggregation / keyset 分頁 → SQL（03 §7.3、04 §8 M4 交付物 10）。
 *
 * 安全規則（這一支是全專案唯一會動態組 SQL 的地方，所以規則寫在最上面）：
 *   1. **欄位名一律走白名單**：propertyId 必須存在於 collection.schema，
 *      否則直接丟 INVALID_FILTER。propertyId 本身也只當作參數值傳給 `->`，
 *      不會被拼進 SQL 文字。
 *   2. **值一律參數化**：所有 operand 都經過 sql`` 變成 $n。
 *   3. 運算子只能從該欄位型別宣告的 filterOperators 取，不接受任意字串。
 *   4. 唯一用到 sql.raw() 的地方是排序方向（ASC/DESC）與欄位別名，
 *      兩者都是封閉枚舉，而且 sql.raw() 本身有識別字白名單。
 *
 * 計算欄位（formula / rollup）的 sqlCapable = false：
 *   牽涉到它們的 filter/sort 無法下推到 SQL，由 service 取回後在記憶體處理
 *   （並關閉 cursor 分頁）。取捨寫在 docs/adr/0003。
 */
import type {
  AggregationFunction,
  CollectionSchema,
  FieldDefinition,
  FilterCondition,
  FilterGroup,
  FilterOperator,
  SortSpec,
  ViewQuery,
} from '@kennote/shared-types';
import { isFilterGroup, VALUELESS_OPERATORS } from '@kennote/shared-types';
import { AppError } from '../../lib/errors.js';
import { sql, type Sql } from '../../db/sql.js';
import { getFieldType, type ServerFieldType } from './field-types/index.js';

const MAX_FILTER_DEPTH = 5;
const MAX_FILTER_NODES = 100;
const MAX_SORTS = 5;

export interface QueryContext {
  /** 相對日期展開用的「現在」。同一次查詢必須共用同一個時間點 */
  now: Date;
  /** 使用者時區（03 §6.5：相對日期要用使用者的時區算日界線） */
  timeZone: string;
}

export function defaultQueryContext(timeZone = 'Asia/Taipei'): QueryContext {
  return { now: new Date(), timeZone };
}

function resolveField(
  schema: CollectionSchema,
  propertyId: string,
): { def: FieldDefinition; fieldType: ServerFieldType } {
  const def = schema[propertyId];
  if (!def) {
    throw new AppError('INVALID_FILTER', `欄位不存在：${propertyId}`, { property: propertyId });
  }
  return { def, fieldType: getFieldType(def.type) };
}

function assertOperator(
  allowed: FilterOperator[],
  operator: FilterOperator,
  propertyId: string,
): void {
  if (!allowed.includes(operator)) {
    throw new AppError('INVALID_FILTER', `欄位 ${propertyId} 不支援運算子 ${operator}`, {
      property: propertyId,
      operator,
    });
  }
}

/** ILIKE 的萬用字元跳脫，避免使用者輸入的 % 變成「任意字元」 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => '\\' + m);
}

function castOperand(fieldType: ServerFieldType, value: unknown): unknown {
  if (fieldType.kind === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new AppError('INVALID_FILTER', '數值篩選條件必須是數字');
    return n;
  }
  if (fieldType.kind === 'boolean') return value === true || value === 'true';
  if (value === null || value === undefined) return null;
  return String(value);
}

/** 預設的純量 filter（型別沒有自己覆寫 toFilterSql 時走這裡） */
function buildScalarFilter(
  expr: Sql,
  fieldType: ServerFieldType,
  operator: FilterOperator,
  value: unknown,
): Sql {
  switch (operator) {
    case 'isEmpty':
      return sql`(${expr}) IS NULL`;
    case 'isNotEmpty':
      return sql`(${expr}) IS NOT NULL`;
    case 'is':
    case 'equals': {
      const operand = castOperand(fieldType, value);
      // null 不要變成參數：`= $n` 的 $n 是未定型的 NULL，PostgreSQL 推不出型別
      return operand === null ? sql`(${expr}) IS NULL` : sql`(${expr}) = ${operand}`;
    }
    case 'isNot':
    case 'doesNotEqual': {
      const operand = castOperand(fieldType, value);
      return operand === null
        ? sql`(${expr}) IS NOT NULL`
        : sql`(${expr}) IS DISTINCT FROM ${operand}`;
    }
    case 'contains':
      return sql`(${expr}) ILIKE ${'%' + escapeLike(String(value)) + '%'}`;
    case 'doesNotContain':
      return sql`coalesce((${expr}) NOT ILIKE ${'%' + escapeLike(String(value)) + '%'}, true)`;
    case 'startsWith':
      return sql`(${expr}) ILIKE ${escapeLike(String(value)) + '%'}`;
    case 'endsWith':
      return sql`(${expr}) ILIKE ${'%' + escapeLike(String(value))}`;
    case 'greaterThan':
    case 'isAfter':
      return sql`(${expr}) > ${castOperand(fieldType, value)}`;
    case 'lessThan':
    case 'isBefore':
      return sql`(${expr}) < ${castOperand(fieldType, value)}`;
    case 'greaterThanOrEqualTo':
    case 'isOnOrAfter':
      return sql`(${expr}) >= ${castOperand(fieldType, value)}`;
    case 'lessThanOrEqualTo':
    case 'isOnOrBefore':
      return sql`(${expr}) <= ${castOperand(fieldType, value)}`;
    case 'isAnyOf': {
      const list = (Array.isArray(value) ? value : [value]).map((v) => castOperand(fieldType, v));
      if (list.length === 0) return sql`false`;
      return sql`(${sql.join(
        list.map((v) => sql`(${expr}) = ${v}`),
        ' OR ',
      )})`;
    }
    case 'isNoneOf': {
      const list = (Array.isArray(value) ? value : [value]).map((v) => castOperand(fieldType, v));
      if (list.length === 0) return sql`true`;
      return sql`NOT (${sql.join(
        list.map((v) => sql`(${expr}) IS NOT DISTINCT FROM ${v}`),
        ' OR ',
      )})`;
    }
    default:
      throw new AppError('INVALID_FILTER', `不支援的運算子：${operator}`);
  }
}

function buildCondition(
  schema: CollectionSchema,
  cond: FilterCondition,
  ctx: QueryContext,
): Sql {
  const { def, fieldType } = resolveField(schema, cond.property);
  assertOperator(fieldType.filterOperators, cond.operator, cond.property);
  if (!VALUELESS_OPERATORS.includes(cond.operator) && cond.value === undefined) {
    throw new AppError('INVALID_FILTER', `運算子 ${cond.operator} 需要一個值`, {
      property: cond.property,
    });
  }

  const expr = fieldType.toSqlExpr(cond.property, def);
  if (fieldType.toFilterSql) {
    return fieldType.toFilterSql({
      propertyId: cond.property,
      def,
      operator: cond.operator,
      value: cond.value,
      expr,
      now: ctx.now,
      timeZone: ctx.timeZone,
    });
  }
  return buildScalarFilter(expr, fieldType, cond.operator, cond.value);
}

/** 條件樹裡有沒有用到無法下推 SQL 的欄位（formula / rollup） */
export function filterNeedsMemory(
  schema: CollectionSchema,
  filter: FilterGroup | FilterCondition | null | undefined,
): boolean {
  if (!filter) return false;
  if (isFilterGroup(filter)) return filter.filters.some((f) => filterNeedsMemory(schema, f));
  const def = schema[filter.property];
  if (!def) return false;
  return !getFieldType(def.type).sqlCapable;
}

export function sortNeedsMemory(schema: CollectionSchema, sorts: SortSpec[] | undefined): boolean {
  return (sorts ?? []).some((s) => {
    const def = schema[s.property];
    return def ? !getFieldType(def.type).sqlCapable : false;
  });
}

export function buildFilterSql(
  schema: CollectionSchema,
  filter: FilterGroup | FilterCondition | null | undefined,
  ctx: QueryContext = defaultQueryContext(),
  depth = 0,
  budget = { nodes: 0 },
): Sql | null {
  if (!filter) return null;
  if (depth > MAX_FILTER_DEPTH) throw new AppError('INVALID_FILTER', '篩選條件巢狀過深');
  budget.nodes += 1;
  if (budget.nodes > MAX_FILTER_NODES) throw new AppError('INVALID_FILTER', '篩選條件過多');

  if (isFilterGroup(filter)) {
    const parts = filter.filters
      .map((f) => buildFilterSql(schema, f, ctx, depth + 1, budget))
      .filter((p): p is Sql => p !== null);
    if (parts.length === 0) return null;
    const joiner = filter.operator === 'or' ? ' OR ' : ' AND ';
    return sql`(${sql.join(parts, joiner)})`;
  }
  return buildCondition(schema, filter, ctx);
}

/** 視圖內的快速搜尋：標題子字串（吃 0005 建的 pg_trgm GIN 索引） */
export function buildSearchSql(searchQuery: string | null | undefined): Sql | null {
  const q = (searchQuery ?? '').trim();
  if (q === '') return null;
  return sql`p.title_plain ILIKE ${'%' + escapeLike(q) + '%'}`;
}

/* ── 排序 ─────────────────────────────────────────────── */

export interface CompiledSort {
  /** ORDER BY 片段（已含 id tie-break） */
  order: Sql;
  /** 每一層排序鍵的投影式，cursor 會把它們 SELECT 出來 */
  exprs: Sql[];
  specs: SortSpec[];
}

export function buildOrderSql(
  schema: CollectionSchema,
  sorts: SortSpec[] | undefined,
): CompiledSort {
  const specs = (sorts ?? [])
    // 欄位一律走白名單：不存在就丟錯，不要默默忽略（默默忽略 = 使用者看到錯的順序）
    .filter((s) => getFieldType(resolveField(schema, s.property).def.type).sqlCapable)
    .slice(0, MAX_SORTS);

  if (specs.length === 0) {
    // 預設：使用者手動排序用的 sort_key，再以 id 當 tie-break（keyset 分頁必備）
    return { order: sql`p.sort_key ASC, p.id ASC`, exprs: [sql`p.sort_key`], specs: [] };
  }

  const exprs = specs.map((s) => {
    const { def, fieldType } = resolveField(schema, s.property);
    return fieldType.toSqlExpr(s.property, def);
  });

  const parts = exprs.map((expr, i) => {
    // direction 是封閉枚舉，不是使用者自由字串 → sql.raw 是安全的
    const dir = sql.raw(specs[i]?.direction === 'descending' ? 'DESC NULLS LAST' : 'ASC NULLS LAST');
    return sql`(${expr}) ${dir}`;
  });
  return { order: sql`${sql.join(parts, ', ')}, p.id ASC`, exprs, specs };
}

/* ── keyset（cursor）分頁 ──────────────────────────────── */

export interface CursorPayload {
  /** 上一頁最後一列的各層排序鍵值 */
  keys: Array<string | number | null>;
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
    if (!parsed || typeof parsed.id !== 'string' || !Array.isArray(parsed.keys)) {
      throw new Error('bad shape');
    }
    return parsed;
  } catch {
    throw new AppError('BAD_REQUEST', '分頁游標不正確，請重新載入');
  }
}

/**
 * 產生「接在游標之後」的條件。
 *
 * 為什麼不用 PostgreSQL 的 row-value 比較 `(a,b,id) > ($1,$2,$3)`？
 * 因為它要求所有欄位同方向，而多欄排序可以 ASC/DESC 混用，
 * 而且 NULLS LAST 的語意 row-value 也表達不出來。所以展開成字典序的 OR 鏈：
 *   (k1 之後) OR (k1 相同 AND k2 之後) OR (全部相同 AND id > 游標 id)
 */
export function buildCursorSql(compiled: CompiledSort, cursor: CursorPayload): Sql {
  const { exprs, specs } = compiled;
  const clauses: Sql[] = [];
  const equalities: Sql[] = [];

  exprs.forEach((expr, i) => {
    const key = cursor.keys[i] ?? null;
    const descending = specs[i]?.direction === 'descending';

    // NULLS LAST：游標停在 NULL 上時，同層已經沒有「更後面」的非 NULL 值了
    const after =
      key === null
        ? null
        : descending
          ? sql`((${expr}) < ${key} OR (${expr}) IS NULL)`
          : sql`((${expr}) > ${key} OR (${expr}) IS NULL)`;

    if (after) {
      clauses.push(
        equalities.length === 0 ? after : sql`(${sql.join([...equalities, after], ' AND ')})`,
      );
    }
    // key 為 null 時不要送 NULL 參數：未定型的 $n 會讓 PostgreSQL 推不出型別而報錯
    equalities.push(
      key === null ? sql`(${expr}) IS NULL` : sql`(${expr}) IS NOT DISTINCT FROM ${key}`,
    );
  });

  const tail = sql`(${sql.join([...equalities, sql`p.id > ${cursor.id}`], ' AND ')})`;
  clauses.push(tail);
  return sql`(${sql.join(clauses, ' OR ')})`;
}

/** 從一列的排序鍵欄位（sk0, sk1…）產生下一頁的游標 */
export function cursorFromRow(
  row: Record<string, unknown>,
  compiled: CompiledSort,
): CursorPayload {
  const keys = compiled.exprs.map((_, i) => {
    const raw = row[`sk${i}`];
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return raw;
    return String(raw);
  });
  return { keys, id: String(row.id) };
}

/** SELECT 清單裡的排序鍵別名（給 cursorFromRow 讀） */
export function sortKeySelectSql(compiled: CompiledSort): Sql {
  if (compiled.exprs.length === 0) return sql.empty;
  const parts = compiled.exprs.map(
    (expr, i) => sql`(${expr})::text AS ${sql.raw('sk' + String(i))}`,
  );
  return sql`, ${sql.join(parts, ', ')}`;
}

/* ── 分組（Board 泳道） ───────────────────────────────── */

export function buildGroupKeySql(schema: CollectionSchema, propertyId: string): Sql {
  const { def, fieldType } = resolveField(schema, propertyId);
  if (!fieldType.groupable) {
    throw new AppError('INVALID_FILTER', `欄位 ${def.name} 不能用來分組`, { property: propertyId });
  }
  const expr = fieldType.toGroupKeySql
    ? fieldType.toGroupKeySql(propertyId, def)
    : fieldType.toSqlExpr(propertyId, def);
  return sql`(${expr})::text`;
}

/* ── 聚合列 ───────────────────────────────────────────── */

export function buildAggregationSql(
  schema: CollectionSchema,
  propertyId: string,
  fn: AggregationFunction,
): Sql | null {
  if (fn === 'none' || fn === 'showOriginal') return null;
  const { def, fieldType } = resolveField(schema, propertyId);
  if (!fieldType.sqlCapable) return null;
  if (!fieldType.aggregations.includes(fn)) {
    throw new AppError('INVALID_FILTER', `欄位 ${def.name} 不支援聚合函式 ${fn}`);
  }
  const expr = fieldType.toSqlExpr(propertyId, def);
  const numeric =
    fieldType.kind === 'number' ? sql`(${expr})` : sql`nullif((${expr})::text, '')::numeric`;

  switch (fn) {
    case 'count':
      return sql`count(*)::text`;
    case 'countValues':
    case 'countNotEmpty':
      return sql`count(${expr})::text`;
    case 'countUnique':
      return sql`count(DISTINCT ${expr})::text`;
    case 'countEmpty':
      return sql`(count(*) - count(${expr}))::text`;
    case 'percentEmpty':
      return sql`round(((count(*) - count(${expr}))::numeric * 100) / nullif(count(*), 0), 1)::text`;
    case 'percentNotEmpty':
      return sql`round((count(${expr})::numeric * 100) / nullif(count(*), 0), 1)::text`;
    case 'sum':
      return sql`sum(${numeric})::text`;
    case 'average':
      return sql`round(avg(${numeric}), 4)::text`;
    case 'median':
      return sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${numeric})::text`;
    case 'min':
      return fieldType.kind === 'date' ? sql`min(${expr})::text` : sql`min(${numeric})::text`;
    case 'max':
      return fieldType.kind === 'date' ? sql`max(${expr})::text` : sql`max(${numeric})::text`;
    case 'range':
      return sql`(max(${numeric}) - min(${numeric}))::text`;
    case 'earliestDate':
      return sql`min(${expr})::text`;
    case 'latestDate':
      return sql`max(${expr})::text`;
    case 'checked':
      return sql`count(*) FILTER (WHERE (${expr}))::text`;
    case 'unchecked':
      return sql`count(*) FILTER (WHERE NOT (${expr}))::text`;
    case 'percentChecked':
      return sql`round((count(*) FILTER (WHERE (${expr})))::numeric * 100 / nullif(count(*), 0), 1)::text`;
    default:
      return null;
  }
}

/* ── 一次把整個 view.query 編譯好 ─────────────────────── */

export interface CompiledQuery {
  /** filter + search 合起來的 WHERE（不含 collection_id / deleted_at） */
  where: Sql | null;
  sort: CompiledSort;
  /** filter 牽涉到計算欄位，必須在記憶體做 */
  memoryFilter: boolean;
  /** sort 牽涉到計算欄位，必須在記憶體做（同時關閉 cursor 分頁） */
  memorySort: boolean;
}

export function compileViewQuery(
  schema: CollectionSchema,
  query: ViewQuery | null | undefined,
  ctx: QueryContext = defaultQueryContext(),
): CompiledQuery {
  const memoryFilter = filterNeedsMemory(schema, query?.filter ?? null);
  const memorySort = sortNeedsMemory(schema, query?.sort);

  const parts: Sql[] = [];
  if (!memoryFilter) {
    const filterSql = buildFilterSql(schema, query?.filter ?? null, ctx);
    if (filterSql) parts.push(filterSql);
  }
  const searchSql = buildSearchSql(query?.searchQuery);
  if (searchSql) parts.push(searchSql);

  return {
    where: parts.length === 0 ? null : sql`(${sql.join(parts, ' AND ')})`,
    sort: buildOrderSql(schema, query?.sort),
    memoryFilter,
    memorySort,
  };
}
