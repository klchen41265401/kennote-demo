/**
 * 進階欄位：relation（雙向）/ rollup（沿 relation 聚合）/ formula（自研運算式）。
 *
 * relation 的值（pageIds）是真值，row_relations 是同交易內維護的投影（03 §4.8）。
 * rollup / formula 是**計算欄位**：sqlCapable = false，
 * 由 service 在取回資料後於記憶體計算，filter/sort 也在記憶體做（見 ADR 0003）。
 */
import type { FieldValue, FilterOperator } from '@kennote/shared-types';
import { AGGREGATION_FUNCTIONS, compileFieldFormula } from '@kennote/shared-types';
import { z } from 'zod';
import { sql } from '../../../db/sql.js';
import { buildArrayFilterSql } from './array-filter.js';
import {
  CONTAINER_OPS,
  COUNT_AGGS,
  DATE_OPS,
  NUMBER_AGGS,
  NUMBER_OPS,
  TEXT_OPS,
  baseDef,
  invalidValue,
  parseDef,
  unwrap,
} from './common.js';
import { compareNullable, defineFieldType } from './types.js';

/* ── relation ── */
defineFieldType({
  type: 'relation',
  label: '關聯',
  kind: 'array',
  computed: false,
  groupable: false,
  sortable: false,
  sqlCapable: true,
  validateConfig: (d) =>
    parseDef(
      z.object({
        ...baseDef,
        type: z.literal('relation'),
        collectionId: z.string().uuid().nullable().default(null),
        dualProperty: z.string().max(16).nullable().optional(),
        allowMultiple: z.boolean().optional(),
        limit: z.number().int().min(1).max(1000).nullable().optional(),
      }),
      d,
    ),
  defaultValue: () => null,
  normalize: (v, def) => {
    if (v === null || v === undefined) return null;
    const raw = Array.isArray(v) ? v : (unwrap(v, 'pageIds') ?? []);
    const ids = z.array(z.string().uuid()).safeParse(raw);
    if (!ids.success) throw invalidValue('關聯欄位必須是頁面 id 陣列');
    if (ids.data.length === 0) return null;
    const unique = [...new Set(ids.data)];
    const config = def as { allowMultiple?: boolean; limit?: number | null };
    const limit = config.allowMultiple === false ? 1 : (config.limit ?? 1000);
    return { type: 'relation', pageIds: unique.slice(0, limit) };
  },
  toSqlExpr: (propertyId) => sql`(p.properties -> ${propertyId} -> 'pageIds' ->> 0)`,
  toFilterSql: (ctx) => buildArrayFilterSql(ctx.propertyId, 'pageIds', ctx.operator, ctx.value),
  filterOperators: CONTAINER_OPS,
  aggregations: COUNT_AGGS,
  compare: (a, b) => {
    const count = (v: FieldValue | undefined) => (v && v.type === 'relation' ? v.pageIds.length : 0);
    return count(a) - count(b);
  },
  groupKeys: () => [null],
  groupLabel: (key) => ({ label: key ?? '無關聯' }),
  // CSV 匯出給 id；要顯示標題請走 API（要多一次 join，不值得讓匯出變慢）
  toPlainText: (v) => (v && v.type === 'relation' ? v.pageIds.join(', ') : ''),
});

/** rollup / formula 的可用運算子：結果型別要跑起來才知道，所以給聯集 */
const COMPUTED_OPS: FilterOperator[] = [
  ...new Set<FilterOperator>([...TEXT_OPS, ...NUMBER_OPS, ...DATE_OPS]),
];

/* ── rollup ── */
defineFieldType({
  type: 'rollup',
  label: '匯總',
  kind: 'text',
  computed: true,
  groupable: false,
  sortable: true,
  sqlCapable: false,
  validateConfig: (d, ctx) => {
    const def = parseDef(
      z.object({
        ...baseDef,
        type: z.literal('rollup'),
        relationProperty: z.string().max(16).nullable().default(null),
        targetProperty: z.string().max(16).nullable().default(null),
        function: z.enum(AGGREGATION_FUNCTIONS).default('count'),
      }),
      d,
    );
    const config = def as { relationProperty?: string | null };
    if (config.relationProperty) {
      const relation = ctx.schema[config.relationProperty];
      if (relation && relation.type !== 'relation') {
        throw invalidValue('匯總欄位的來源必須是關聯欄位', {
          relationProperty: config.relationProperty,
        });
      }
    }
    return def;
  },
  defaultValue: () => null,
  normalize: () => null, // 計算值，寫入一律忽略
  toSqlExpr: (propertyId) => sql`(p.properties -> ${propertyId} ->> 'value')`,
  filterOperators: COMPUTED_OPS,
  aggregations: NUMBER_AGGS,
  compare: (a, b) =>
    compareNullable(
      a && a.type === 'rollup' ? a.value : null,
      b && b.type === 'rollup' ? b.value : null,
      (x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0),
    ),
  groupKeys: (v) => [v && v.type === 'rollup' && v.value !== null ? String(v.value) : null],
  groupLabel: (key) => ({ label: key ?? '無' }),
  toPlainText: (v) => {
    if (!v || v.type !== 'rollup') return '';
    if (v.items) return v.items.map((i) => (i === null ? '' : String(i))).join(', ');
    return v.value === null ? '' : String(v.value);
  },
});

/* ── formula ── */
defineFieldType({
  type: 'formula',
  label: '公式',
  kind: 'text',
  computed: true,
  groupable: false,
  sortable: true,
  sqlCapable: false,
  validateConfig: (d, ctx) => {
    const parsed = parseDef(
      z.object({
        ...baseDef,
        type: z.literal('formula'),
        expression: z.string().max(4000).default(''),
        // ast / resultType / dependsOn 由後端重新編譯，前端傳什麼都不算數
        ast: z.unknown().optional(),
        resultType: z.string().optional(),
        dependsOn: z.array(z.string()).optional(),
        error: z.string().nullable().optional(),
      }),
      d,
    );
    const expression = (parsed as { expression?: string }).expression ?? '';
    // 編譯時把自己從 schema 拿掉，否則 prop("自己") 會直接構成自我循環而不報錯
    const schemaWithoutSelf = { ...ctx.schema };
    delete schemaWithoutSelf[ctx.propertyId];
    const compiled = compileFieldFormula(expression, schemaWithoutSelf);
    return {
      ...(parsed as object),
      type: 'formula',
      expression,
      ast: compiled.ast,
      resultType: compiled.resultType,
      dependsOn: compiled.dependsOn,
      error: compiled.error ?? null,
    } as never;
  },
  defaultValue: () => null,
  normalize: () => null, // 計算值，寫入一律忽略
  toSqlExpr: (propertyId) => sql`(p.properties -> ${propertyId} ->> 'value')`,
  filterOperators: COMPUTED_OPS,
  aggregations: NUMBER_AGGS,
  compare: (a, b) =>
    compareNullable(
      a && a.type === 'formula' ? a.value : null,
      b && b.type === 'formula' ? b.value : null,
      (x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0),
    ),
  groupKeys: (v) => [v && v.type === 'formula' && v.value !== null ? String(v.value) : null],
  groupLabel: (key) => ({ label: key ?? '無' }),
  toPlainText: (v) => {
    if (!v || v.type !== 'formula') return '';
    if (v.error) return '';
    return v.value === null ? '' : String(v.value);
  },
});
