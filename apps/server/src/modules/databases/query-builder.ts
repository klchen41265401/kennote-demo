/**
 * filter / sort → SQL（03 §7.3、04 §10.2）。
 *
 * 安全規則（這一支是全專案唯一會動態組 SQL 的地方，所以規則寫在最上面）：
 *   1. **欄位名一律走白名單**：propertyId 必須存在於 collection.schema，
 *      否則直接丟 INVALID_FILTER。propertyId 本身也只當作參數值傳給 `->`，
 *      不會被拼進 SQL 文字。
 *   2. **值一律參數化**：所有 operand 都經過 sql`` 變成 $n。
 *   3. 運算子只能從該欄位型別宣告的 filterOperators 取，不接受任意字串。
 */
import type {
  CollectionSchema,
  FilterCondition,
  FilterGroup,
  FilterOperator,
  SortSpec,
} from '@kennote/shared-types';
import { isFilterGroup } from '@kennote/shared-types';
import { AppError } from '../../lib/errors.js';
import { sql, type Sql } from '../../db/sql.js';
import { getFieldType } from './field-types/index.js';

const MAX_FILTER_DEPTH = 5;

function resolveField(schema: CollectionSchema, propertyId: string) {
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

function buildCondition(schema: CollectionSchema, cond: FilterCondition): Sql {
  const { def, fieldType } = resolveField(schema, cond.property);
  assertOperator(fieldType.filterOperators, cond.operator, cond.property);
  const expr = fieldType.toSqlExpr(cond.property, def, sql);
  const v = cond.value;

  // 容器型別（多選 / 人員）用 jsonb 的 @> 判斷包含，不用純量投影
  const containerKey =
    def.type === 'multiSelect' ? 'optionIds' : def.type === 'person' ? 'userIds' : null;
  if (containerKey) {
    const arrayExpr = sql`(p.properties -> ${cond.property} -> ${containerKey})`;
    switch (cond.operator) {
      case 'contains':
        return sql`${arrayExpr} @> to_jsonb(${String(v)}::text)`;
      case 'doesNotContain':
        return sql`NOT coalesce(${arrayExpr} @> to_jsonb(${String(v)}::text), false)`;
      case 'isEmpty':
        return sql`coalesce(jsonb_array_length(${arrayExpr}), 0) = 0`;
      case 'isNotEmpty':
        return sql`coalesce(jsonb_array_length(${arrayExpr}), 0) > 0`;
      default:
        throw new AppError('INVALID_FILTER', `不支援的運算子：${cond.operator}`);
    }
  }

  switch (cond.operator) {
    case 'isEmpty':
      return sql`(${expr}) IS NULL`;
    case 'isNotEmpty':
      return sql`(${expr}) IS NOT NULL`;
    case 'is':
    case 'equals':
      return def.type === 'checkbox'
        ? sql`(${expr}) = ${v === true || v === 'true'}`
        : sql`(${expr}) = ${castOperand(def.type, v)}`;
    case 'isNot':
    case 'doesNotEqual':
      return sql`(${expr}) IS DISTINCT FROM ${castOperand(def.type, v)}`;
    case 'contains':
      return sql`(${expr}) ILIKE ${`%${escapeLike(String(v))}%`}`;
    case 'doesNotContain':
      return sql`coalesce((${expr}) NOT ILIKE ${`%${escapeLike(String(v))}%`}, true)`;
    case 'startsWith':
      return sql`(${expr}) ILIKE ${`${escapeLike(String(v))}%`}`;
    case 'endsWith':
      return sql`(${expr}) ILIKE ${`%${escapeLike(String(v))}`}`;
    case 'greaterThan':
    case 'isAfter':
      return sql`(${expr}) > ${castOperand(def.type, v)}`;
    case 'lessThan':
    case 'isBefore':
      return sql`(${expr}) < ${castOperand(def.type, v)}`;
    case 'greaterThanOrEqualTo':
    case 'isOnOrAfter':
      return sql`(${expr}) >= ${castOperand(def.type, v)}`;
    case 'lessThanOrEqualTo':
    case 'isOnOrBefore':
      return sql`(${expr}) <= ${castOperand(def.type, v)}`;
    case 'isAnyOf': {
      const list = Array.isArray(v) ? v : [v];
      if (list.length === 0) return sql`false`;
      return sql`(${expr}) = ANY(${list.map((x) => String(x))}::text[])`;
    }
    default:
      throw new AppError('INVALID_FILTER', `不支援的運算子：${cond.operator}`);
  }
}

function castOperand(fieldType: string, value: unknown): unknown {
  if (fieldType === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new AppError('INVALID_FILTER', '數值篩選條件必須是數字');
    return n;
  }
  if (value === null || value === undefined) return null;
  return String(value);
}

/** ILIKE 的萬用字元跳脫，避免使用者輸入的 % 變成「任意字元」 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function buildFilterSql(
  schema: CollectionSchema,
  filter: FilterGroup | FilterCondition | null | undefined,
  depth = 0,
): Sql | null {
  if (!filter) return null;
  if (depth > MAX_FILTER_DEPTH) throw new AppError('INVALID_FILTER', '篩選條件巢狀過深');

  if (isFilterGroup(filter)) {
    const parts = filter.filters
      .map((f) => buildFilterSql(schema, f, depth + 1))
      .filter((p): p is Sql => p !== null);
    if (parts.length === 0) return null;
    const joiner = filter.operator === 'or' ? ' OR ' : ' AND ';
    return sql`(${sql.join(parts, joiner)})`;
  }
  return buildCondition(schema, filter);
}

export function buildOrderSql(schema: CollectionSchema, sorts: SortSpec[] | undefined): Sql {
  const specs = (sorts ?? []).slice(0, 5);
  if (specs.length === 0) return sql`p.sort_key ASC, p.created_at ASC`;

  const parts = specs.map((s) => {
    const { def, fieldType } = resolveField(schema, s.property);
    const expr = fieldType.toSqlExpr(s.property, def, sql);
    // direction 是封閉枚舉，不是使用者自由字串 → 這裡用 sql.raw 是安全的
    const dir = sql.raw(s.direction === 'descending' ? 'DESC NULLS LAST' : 'ASC NULLS LAST');
    return sql`(${expr}) ${dir}`;
  });
  return sql`${sql.join(parts, ', ')}, p.sort_key ASC`;
}
