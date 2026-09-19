/** number + checkbox。兩者都是「純量、可直接轉型比較」的型別。 */
import { z } from 'zod';
import { sql } from '../../../db/sql.js';
import {
  BOOLEAN_AGGS,
  NUMBER_AGGS,
  NUMBER_OPS,
  baseDef,
  invalidValue,
  parseDef,
  unwrap,
} from './common.js';
import { compareNullable, defineFieldType, propText } from './types.js';

/* ── number ── */
defineFieldType({
  type: 'number',
  label: '數字',
  kind: 'number',
  computed: false,
  groupable: true,
  sortable: true,
  sqlCapable: true,
  validateConfig: (d) =>
    parseDef(
      z.object({
        ...baseDef,
        type: z.literal('number'),
        numberFormat: z
          .enum([
            'number',
            'numberWithCommas',
            'percent',
            'currencyTwd',
            'currencyUsd',
            'yen',
            'euro',
          ])
          .optional(),
        precision: z.number().int().min(0).max(10).nullable().optional(),
      }),
      d,
    ),
  defaultValue: () => null,
  normalize: (v) => {
    if (v === null || v === undefined || v === '') return null;
    const raw = unwrap(v, 'number');
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw invalidValue('數值欄位必須是數字');
    return { type: 'number', number: n };
  },
  // ::numeric 讓 > < 比較用數值語意；沒有這一層轉型，'9' > '10' 會是 true
  toSqlExpr: (propertyId) => sql`((p.properties -> ${propertyId} ->> 'number')::numeric)`,
  toGroupKeySql: (propertyId) => propText(propertyId, 'number'),
  filterOperators: NUMBER_OPS,
  aggregations: NUMBER_AGGS,
  compare: (a, b) =>
    compareNullable(
      a && a.type === 'number' ? a.number : null,
      b && b.type === 'number' ? b.number : null,
      (x, y) => x - y,
    ),
  groupKeys: (v) => [v && v.type === 'number' && v.number !== null ? String(v.number) : null],
  groupLabel: (key) => ({ label: key ?? '空白' }),
  toPlainText: (v) => (v && v.type === 'number' && v.number !== null ? String(v.number) : ''),
  fromPlainText: (text) => {
    const trimmed = text.trim().replace(/[,\s]/g, '');
    if (trimmed === '') return null;
    const n = Number(trimmed.replace(/%$/, ''));
    if (!Number.isFinite(n)) return null;
    return { type: 'number', number: trimmed.endsWith('%') ? n / 100 : n };
  },
});

/* ── checkbox ── */
defineFieldType({
  type: 'checkbox',
  label: '核取方塊',
  kind: 'boolean',
  computed: false,
  groupable: true,
  sortable: true,
  sqlCapable: true,
  validateConfig: (d) => parseDef(z.object({ ...baseDef, type: z.literal('checkbox') }), d),
  defaultValue: () => ({ type: 'checkbox', checkbox: false }),
  normalize: (v) => {
    if (v === null || v === undefined) return null;
    const raw = unwrap(v, 'checkbox');
    const checked = raw === true || raw === 'true' || raw === 1 || raw === '1';
    // checkbox 的 false 也要存：否則 filter is=false 會跟「從未設定」混淆
    return { type: 'checkbox', checkbox: checked };
  },
  toSqlExpr: (propertyId) =>
    sql`coalesce((p.properties -> ${propertyId} ->> 'checkbox')::boolean, false)`,
  toGroupKeySql: (propertyId) =>
    sql`(CASE WHEN coalesce((p.properties -> ${propertyId} ->> 'checkbox')::boolean, false)
              THEN 'true' ELSE 'false' END)`,
  filterOperators: ['is'],
  aggregations: BOOLEAN_AGGS,
  compare: (a, b) => {
    const x = a && a.type === 'checkbox' && a.checkbox ? 1 : 0;
    const y = b && b.type === 'checkbox' && b.checkbox ? 1 : 0;
    return x - y;
  },
  groupKeys: (v) => [v && v.type === 'checkbox' && v.checkbox ? 'true' : 'false'],
  groupLabel: (key) => ({ label: key === 'true' ? '已勾選' : '未勾選' }),
  toPlainText: (v) => (v && v.type === 'checkbox' && v.checkbox ? '是' : '否'),
  fromPlainText: (text) => {
    const t = text.trim().toLowerCase();
    return { type: 'checkbox', checkbox: ['是', 'true', 'yes', '1', 'y', 'v'].includes(t) };
  },
});
