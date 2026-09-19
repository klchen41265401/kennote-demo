/** person（多值，指向 workspace 成員）與 files（共用上傳管線的附件清單）。 */
import { z } from 'zod';
import { sql } from '../../../db/sql.js';
import { buildArrayFilterSql } from './array-filter.js';
import {
  CONTAINER_OPS,
  COUNT_AGGS,
  EMPTY_ONLY_OPS,
  baseDef,
  invalidValue,
  parseDef,
  unwrap,
} from './common.js';
import { compareNullable, defineFieldType } from './types.js';

/* ── person ── */
defineFieldType({
  type: 'person',
  label: '人員',
  kind: 'array',
  computed: false,
  groupable: true,
  sortable: true,
  sqlCapable: true,
  validateConfig: (d) =>
    parseDef(
      z.object({ ...baseDef, type: z.literal('person'), allowMultiple: z.boolean().optional() }),
      d,
    ),
  defaultValue: () => null,
  normalize: (v, def) => {
    if (v === null || v === undefined) return null;
    const raw = Array.isArray(v) ? v : (unwrap(v, 'userIds') ?? []);
    const ids = z.array(z.string().uuid()).safeParse(raw);
    if (!ids.success) throw invalidValue('人員欄位必須是使用者 id 陣列');
    if (ids.data.length === 0) return null;
    const unique = [...new Set(ids.data)];
    const allowMultiple = (def as { allowMultiple?: boolean }).allowMultiple ?? true;
    return { type: 'person', userIds: allowMultiple ? unique : unique.slice(0, 1) };
  },
  toSqlExpr: (propertyId) => sql`(p.properties -> ${propertyId} -> 'userIds' ->> 0)`,
  toFilterSql: (ctx) => buildArrayFilterSql(ctx.propertyId, 'userIds', ctx.operator, ctx.value),
  filterOperators: [...CONTAINER_OPS, 'isAnyOf'],
  aggregations: COUNT_AGGS,
  compare: (a, b) =>
    compareNullable(
      a && a.type === 'person' && a.userIds.length > 0 ? (a.userIds[0] as string) : null,
      b && b.type === 'person' && b.userIds.length > 0 ? (b.userIds[0] as string) : null,
      (x, y) => (x < y ? -1 : x > y ? 1 : 0),
    ),
  groupKeys: (v) =>
    v && v.type === 'person' && v.userIds.length > 0 ? [...v.userIds] : [null],
  groupLabel: (key) => ({ label: key ?? '未指派' }),
  // 使用者名稱由呼叫端（service）另外 join；這裡只給 id，CSV 才不會因為缺 join 就爆
  toPlainText: (v) => (v && v.type === 'person' ? v.userIds.join(', ') : ''),
});

/* ── files ── */
const fileRefSchema = z.object({
  fileId: z.string().uuid().optional(),
  externalUrl: z.string().max(2000).optional(),
  name: z.string().max(300).default('附件'),
});

defineFieldType({
  type: 'files',
  label: '檔案與媒體',
  kind: 'array',
  computed: false,
  groupable: false,
  sortable: false,
  sqlCapable: true,
  validateConfig: (d) =>
    parseDef(
      z.object({
        ...baseDef,
        type: z.literal('files'),
        maxFiles: z.number().int().min(1).max(100).optional(),
      }),
      d,
    ),
  defaultValue: () => null,
  normalize: (v, def) => {
    if (v === null || v === undefined) return null;
    const raw = Array.isArray(v) ? v : (unwrap(v, 'files') ?? []);
    const parsed = z.array(fileRefSchema).safeParse(raw);
    if (!parsed.success) throw invalidValue('檔案欄位格式不正確');
    if (parsed.data.length === 0) return null;
    for (const f of parsed.data) {
      if (!f.fileId && !f.externalUrl) throw invalidValue('每個附件必須有 fileId 或 externalUrl');
    }
    const max = (def as { maxFiles?: number }).maxFiles ?? 20;
    return { type: 'files', files: parsed.data.slice(0, max) };
  },
  toSqlExpr: (propertyId) => sql`(p.properties -> ${propertyId} -> 'files' -> 0 ->> 'name')`,
  toFilterSql: (ctx) => buildArrayFilterSql(ctx.propertyId, 'files', ctx.operator, ctx.value),
  filterOperators: EMPTY_ONLY_OPS,
  aggregations: COUNT_AGGS,
  compare: (a, b) => {
    const count = (v: typeof a) => (v && v.type === 'files' ? v.files.length : 0);
    return count(a) - count(b);
  },
  groupKeys: () => [null],
  groupLabel: (key) => ({ label: key ?? '無附件' }),
  toPlainText: (v) => (v && v.type === 'files' ? v.files.map((f) => f.name).join(', ') : ''),
});
