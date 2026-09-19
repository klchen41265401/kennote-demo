/** select / multiSelect。值存 optionId（03 §4.6：改選項名稱不必 rewrite 每一列）。 */
import type { FieldValue } from '@kennote/shared-types';
import { z } from 'zod';
import { sql } from '../../../db/sql.js';
import { buildArrayFilterSql } from './array-filter.js';
import {
  COUNT_AGGS,
  CONTAINER_OPS,
  SELECT_OPS,
  baseDef,
  invalidValue,
  labelOfOption,
  optionByLabel,
  optionIdSet,
  optionList,
  parseDef,
  selectOptionSchema,
  unwrap,
} from './common.js';
import { compareNullable, defineFieldType, propText } from './types.js';

/* ── select ── */
defineFieldType({
  type: 'select',
  label: '單選',
  kind: 'text',
  computed: false,
  groupable: true,
  sortable: true,
  sqlCapable: true,
  validateConfig: (d) =>
    parseDef(
      z.object({
        ...baseDef,
        type: z.literal('select'),
        options: z.array(selectOptionSchema).max(500).default([]),
      }),
      d,
    ),
  defaultValue: () => null,
  normalize: (v, def) => {
    if (v === null || v === undefined) return null;
    const id = unwrap(v, 'optionId');
    if (id === null || id === undefined || id === '') return null;
    if (typeof id !== 'string' || !optionIdSet(def).has(id)) {
      throw invalidValue('選項不存在於欄位定義中', { optionId: String(id) });
    }
    return { type: 'select', optionId: id };
  },
  toSqlExpr: (propertyId) => propText(propertyId, 'optionId'),
  filterOperators: SELECT_OPS,
  aggregations: COUNT_AGGS,
  // 排序依「選項在 schema 裡的順序」，不是字母序 —— 使用者拖曳選項就是在定義順序
  compare: (a, b, def) => {
    const order = optionList(def).map((o) => o.id);
    const idx = (v: FieldValue | undefined) =>
      v && v.type === 'select' && v.optionId ? order.indexOf(v.optionId) : -1;
    return compareNullable(
      idx(a) >= 0 ? idx(a) : null,
      idx(b) >= 0 ? idx(b) : null,
      (x, y) => x - y,
    );
  },
  groupKeys: (v) => [v && v.type === 'select' ? v.optionId : null],
  groupLabel: (key, def) => {
    if (key === null) return { label: '無' };
    const option = optionList(def).find((o) => o.id === key);
    return { label: option?.value ?? key, color: option?.color };
  },
  toPlainText: (v, def) =>
    v && v.type === 'select' ? labelOfOption(def, v.optionId) : '',
  fromPlainText: (text, def) => {
    // multiSelect → select 時只保留第一個對得上的值（02 §4.3.1 的轉換矩陣）
    for (const part of text.split(/[,、;]/)) {
      const option = optionByLabel(def, part);
      if (option) return { type: 'select', optionId: option.id };
    }
    return null;
  },
});

/* ── multiSelect ── */
defineFieldType({
  type: 'multiSelect',
  label: '多選',
  kind: 'array',
  computed: false,
  groupable: true,
  sortable: true,
  sqlCapable: true,
  validateConfig: (d) =>
    parseDef(
      z.object({
        ...baseDef,
        type: z.literal('multiSelect'),
        options: z.array(selectOptionSchema).max(500).default([]),
      }),
      d,
    ),
  defaultValue: () => null,
  normalize: (v, def) => {
    if (v === null || v === undefined) return null;
    const raw = Array.isArray(v) ? v : (unwrap(v, 'optionIds') ?? []);
    const ids = z.array(z.string()).safeParse(raw);
    if (!ids.success) throw invalidValue();
    if (ids.data.length === 0) return null;
    const valid = optionIdSet(def);
    for (const id of ids.data) {
      if (!valid.has(id)) throw invalidValue('選項不存在於欄位定義中', { optionId: id });
    }
    // 去重但保留使用者拖曳的順序
    return { type: 'multiSelect', optionIds: [...new Set(ids.data)] };
  },
  // 排序鍵用第一個選項；filter 走 @> 容器查詢（吃得到 GIN，03 §7.3）
  toSqlExpr: (propertyId) => sql`(p.properties -> ${propertyId} -> 'optionIds' ->> 0)`,
  toFilterSql: (ctx) => buildArrayFilterSql(ctx.propertyId, 'optionIds', ctx.operator, ctx.value),
  filterOperators: [...CONTAINER_OPS, 'isAnyOf'],
  aggregations: COUNT_AGGS,
  compare: (a, b, def) => {
    const order = optionList(def).map((o) => o.id);
    const idx = (v: FieldValue | undefined) => {
      if (!v || v.type !== 'multiSelect' || v.optionIds.length === 0) return null;
      const first = v.optionIds[0] as string;
      const i = order.indexOf(first);
      return i >= 0 ? i : null;
    };
    return compareNullable(idx(a), idx(b), (x, y) => x - y);
  },
  // 一張卡可以同時出現在多個泳道（Notion 的行為）
  groupKeys: (v) =>
    v && v.type === 'multiSelect' && v.optionIds.length > 0 ? [...v.optionIds] : [null],
  groupLabel: (key, def) => {
    if (key === null) return { label: '無' };
    const option = optionList(def).find((o) => o.id === key);
    return { label: option?.value ?? key, color: option?.color };
  },
  toPlainText: (v, def) =>
    v && v.type === 'multiSelect'
      ? v.optionIds.map((id) => labelOfOption(def, id)).filter(Boolean).join(', ')
      : '',
  fromPlainText: (text, def) => {
    const ids = text
      .split(/[,、;]/)
      .map((part) => optionByLabel(def, part)?.id)
      .filter((id): id is string => Boolean(id));
    return ids.length === 0 ? null : { type: 'multiSelect', optionIds: [...new Set(ids)] };
  },
});
