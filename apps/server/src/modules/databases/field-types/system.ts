/**
 * 系統欄位：createdTime / lastEditedTime / createdBy / lastEditedBy。
 *
 * 03 §6.3：「值不存在 properties 裡，由 pages 的實體欄位投影」。
 * 所以 normalize 永遠回 null（寫入一律忽略），值在查詢時由 service 補進 row.properties。
 */
import type { FieldValue } from '@kennote/shared-types';
import { z } from 'zod';
import { AppError } from '../../../lib/errors.js';
import { sql, type Sql } from '../../../db/sql.js';
import { COUNT_AGGS, CONTAINER_OPS, DATE_AGGS, DATE_OPS, baseDef, parseDef } from './common.js';
import { buildDateFilterSql } from './date.js';
import { compareNullable, defineFieldType } from './types.js';

/** timestamptz → ISO 8601 文字，與 date 欄位的比較語意一致 */
function isoExpr(column: Sql): Sql {
  return sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
}

const TIME_FIELDS = [
  { type: 'createdTime', label: '建立時間', column: sql`p.created_at` },
  { type: 'lastEditedTime', label: '最後編輯時間', column: sql`p.updated_at` },
] as const;

for (const spec of TIME_FIELDS) {
  defineFieldType({
    type: spec.type,
    label: spec.label,
    kind: 'date',
    computed: true,
    groupable: true,
    sortable: true,
    sqlCapable: true,
    validateConfig: (d) =>
      parseDef(
        z.object({
          ...baseDef,
          type: z.literal(spec.type),
          dateFormat: z.string().max(40).optional(),
        }),
        d,
      ),
    defaultValue: () => null,
    normalize: () => null, // 唯讀
    toSqlExpr: () => isoExpr(spec.column),
    toGroupKeySql: () => sql`to_char(${spec.column} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
    toFilterSql: (ctx) =>
      buildDateFilterSql(ctx.expr, ctx.operator, ctx.value, ctx.now, ctx.timeZone),
    filterOperators: DATE_OPS,
    aggregations: DATE_AGGS,
    compare: (a, b) =>
      compareNullable(
        a && (a.type === 'createdTime' || a.type === 'lastEditedTime') ? a.start : null,
        b && (b.type === 'createdTime' || b.type === 'lastEditedTime') ? b.start : null,
        (x, y) => (x < y ? -1 : x > y ? 1 : 0),
      ),
    groupKeys: (v) =>
      v && (v.type === 'createdTime' || v.type === 'lastEditedTime') ? [v.start.slice(0, 10)] : [null],
    groupLabel: (key) => ({ label: key ?? '無' }),
    toPlainText: (v) =>
      v && (v.type === 'createdTime' || v.type === 'lastEditedTime') ? v.start : '',
  });
}

const USER_FIELDS = [
  { type: 'createdBy', label: '建立者', column: sql`p.created_by` },
  { type: 'lastEditedBy', label: '最後編輯者', column: sql`p.updated_by` },
] as const;

for (const spec of USER_FIELDS) {
  defineFieldType({
    type: spec.type,
    label: spec.label,
    kind: 'text',
    computed: true,
    groupable: true,
    sortable: true,
    sqlCapable: true,
    validateConfig: (d) => parseDef(z.object({ ...baseDef, type: z.literal(spec.type) }), d),
    defaultValue: () => null,
    normalize: () => null, // 唯讀
    toSqlExpr: () => sql`(${spec.column})::text`,
    toFilterSql: (ctx) => {
      switch (ctx.operator) {
        case 'isEmpty':
          return sql`(${ctx.expr}) IS NULL`;
        case 'isNotEmpty':
          return sql`(${ctx.expr}) IS NOT NULL`;
        case 'contains':
        case 'is':
          return sql`(${ctx.expr}) = ${String(ctx.value)}`;
        case 'doesNotContain':
        case 'isNot':
          return sql`(${ctx.expr}) IS DISTINCT FROM ${String(ctx.value)}`;
        default:
          throw new AppError('INVALID_FILTER', `${spec.label}不支援運算子 ${ctx.operator}`);
      }
    },
    filterOperators: CONTAINER_OPS,
    aggregations: COUNT_AGGS,
    compare: (a, b) => {
      const first = (v: FieldValue | undefined) =>
        v && (v.type === 'createdBy' || v.type === 'lastEditedBy') && v.userIds.length > 0
          ? (v.userIds[0] as string)
          : null;
      return compareNullable(first(a), first(b), (x, y) => (x < y ? -1 : x > y ? 1 : 0));
    },
    groupKeys: (v) =>
      v && (v.type === 'createdBy' || v.type === 'lastEditedBy') && v.userIds.length > 0
        ? [v.userIds[0] as string]
        : [null],
    groupLabel: (key) => ({ label: key ?? '無' }),
    toPlainText: (v) =>
      v && (v.type === 'createdBy' || v.type === 'lastEditedBy') ? v.userIds.join(', ') : '',
  });
}
