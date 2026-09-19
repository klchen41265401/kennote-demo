/**
 * MVP 的 8 種欄位型別（+ title）。範圍刻意砍到這些（04 §10.2）；
 * relation / rollup / formula 一律排在 MVP 之後，registry 保證日後能補。
 */
import type { FieldDefinition, FieldValue, SelectOption } from '@kennote/shared-types';
import { richTextToPlainText } from '@kennote/shared-types';
import { z } from 'zod';
import { AppError } from '../../../lib/errors.js';
import { sql } from '../../../db/sql.js';
import { defineFieldType } from './types.js';

export * from './types.js';

const TEXT_OPS = [
  'is',
  'isNot',
  'contains',
  'doesNotContain',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
] as const;
const NUMBER_OPS = [
  'equals',
  'doesNotEqual',
  'greaterThan',
  'lessThan',
  'greaterThanOrEqualTo',
  'lessThanOrEqualTo',
  'isEmpty',
  'isNotEmpty',
] as const;
const DATE_OPS = [
  'is',
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
  'isEmpty',
  'isNotEmpty',
] as const;

const selectOptionSchema = z.object({
  id: z.string().min(1).max(40),
  value: z.string().max(200),
  color: z
    .enum(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'])
    .default('default'),
});

const baseDef = { name: z.string().min(1).max(200), description: z.string().max(1000).optional() };

function parseDef<T extends z.ZodType>(schema: T, input: unknown): FieldDefinition {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('INVALID_FIELD_TYPE', '欄位定義格式不正確', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data as FieldDefinition;
}

const richTextLike = z.array(z.record(z.unknown()));

function textValue(type: 'title' | 'text', value: unknown): FieldValue | null {
  if (value === null || value === undefined) return null;
  // 允許直接給純字串（CSV 匯入、API 快捷用法）
  if (typeof value === 'string') {
    return value === '' ? null : { type, richText: [{ text: value }], plainText: value };
  }
  const parsed = z
    .object({ richText: richTextLike.optional(), plainText: z.string().optional() })
    .passthrough()
    .safeParse(value);
  if (!parsed.success) throw new AppError('INVALID_FIELD_VALUE');
  const richText = (parsed.data.richText ?? []) as never;
  const plainText = parsed.data.plainText ?? richTextToPlainText(richText);
  if (plainText === '' && (parsed.data.richText ?? []).length === 0) return null;
  return { type, richText, plainText };
}

/* ── title（每個 collection 有且僅有一個，key 固定為 'title'） ── */
defineFieldType({
  type: 'title',
  validateConfig: (d) => parseDef(z.object({ ...baseDef, type: z.literal('title') }), d),
  normalize: (v) => textValue('title', v),
  // title 的真值在 pages.title（generated column title_plain），不在 properties
  toSqlExpr: () => sql`p.title_plain`,
  filterOperators: [...TEXT_OPS],
  toPlainText: (v) => (v && v.type === 'title' ? v.plainText : ''),
});

/* ── text ── */
defineFieldType({
  type: 'text',
  validateConfig: (d) => parseDef(z.object({ ...baseDef, type: z.literal('text') }), d),
  normalize: (v) => textValue('text', v),
  toSqlExpr: (propertyId) => sql`(p.properties -> ${propertyId} ->> 'plainText')`,
  filterOperators: [...TEXT_OPS],
  toPlainText: (v) => (v && v.type === 'text' ? v.plainText : ''),
});

/* ── number ── */
defineFieldType({
  type: 'number',
  validateConfig: (d) =>
    parseDef(
      z.object({
        ...baseDef,
        type: z.literal('number'),
        numberFormat: z
          .enum(['number', 'numberWithCommas', 'percent', 'currencyTwd', 'currencyUsd', 'yen', 'euro'])
          .optional(),
        precision: z.number().int().min(0).max(10).nullable().optional(),
      }),
      d,
    ),
  normalize: (v) => {
    if (v === null || v === undefined || v === '') return null;
    const raw = typeof v === 'object' ? (v as { number?: unknown }).number : v;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new AppError('INVALID_FIELD_VALUE', '數值欄位必須是數字');
    return { type: 'number', number: n };
  },
  toSqlExpr: (propertyId) => sql`((p.properties -> ${propertyId} ->> 'number')::numeric)`,
  filterOperators: [...NUMBER_OPS],
  toPlainText: (v) => (v && v.type === 'number' && v.number !== null ? String(v.number) : ''),
});

/* ── select ── */
function optionIds(def: FieldDefinition): Set<string> {
  const opts = (def as { options?: SelectOption[] }).options ?? [];
  return new Set(opts.map((o) => o.id));
}

defineFieldType({
  type: 'select',
  validateConfig: (d) =>
    parseDef(
      z.object({ ...baseDef, type: z.literal('select'), options: z.array(selectOptionSchema).default([]) }),
      d,
    ),
  normalize: (v, def) => {
    if (v === null || v === undefined) return null;
    const id = typeof v === 'object' ? (v as { optionId?: unknown }).optionId : v;
    if (id === null || id === undefined || id === '') return null;
    if (typeof id !== 'string' || !optionIds(def).has(id)) {
      throw new AppError('INVALID_FIELD_VALUE', '選項不存在於欄位定義中', { optionId: id });
    }
    return { type: 'select', optionId: id };
  },
  toSqlExpr: (propertyId) => sql`(p.properties -> ${propertyId} ->> 'optionId')`,
  filterOperators: ['is', 'isNot', 'isAnyOf', 'isEmpty', 'isNotEmpty'],
  toPlainText: (v, def) => {
    if (!v || v.type !== 'select' || !v.optionId) return '';
    const opts = (def as { options?: SelectOption[] }).options ?? [];
    return opts.find((o) => o.id === v.optionId)?.value ?? '';
  },
});

/* ── multiSelect ── */
defineFieldType({
  type: 'multiSelect',
  validateConfig: (d) =>
    parseDef(
      z.object({
        ...baseDef,
        type: z.literal('multiSelect'),
        options: z.array(selectOptionSchema).default([]),
      }),
      d,
    ),
  normalize: (v, def) => {
    if (v === null || v === undefined) return null;
    const raw = Array.isArray(v) ? v : ((v as { optionIds?: unknown }).optionIds ?? []);
    const ids = z.array(z.string()).safeParse(raw);
    if (!ids.success) throw new AppError('INVALID_FIELD_VALUE');
    if (ids.data.length === 0) return null;
    const valid = optionIds(def);
    for (const id of ids.data) {
      if (!valid.has(id)) throw new AppError('INVALID_FIELD_VALUE', '選項不存在於欄位定義中', { optionId: id });
    }
    return { type: 'multiSelect', optionIds: ids.data };
  },
  // 用 ->> 0 當排序鍵（第一個選項），filter 另外走 @> 容器查詢
  toSqlExpr: (propertyId) => sql`(p.properties -> ${propertyId} -> 'optionIds' ->> 0)`,
  filterOperators: ['contains', 'doesNotContain', 'isEmpty', 'isNotEmpty'],
  toPlainText: (v, def) => {
    if (!v || v.type !== 'multiSelect') return '';
    const opts = (def as { options?: SelectOption[] }).options ?? [];
    return v.optionIds.map((id) => opts.find((o) => o.id === id)?.value ?? '').join(', ');
  },
});

/* ── date ── */
defineFieldType({
  type: 'date',
  validateConfig: (d) =>
    parseDef(
      z.object({
        ...baseDef,
        type: z.literal('date'),
        dateFormat: z.string().max(40).optional(),
        timeFormat: z.string().max(40).optional(),
        includeTimeDefault: z.boolean().optional(),
      }),
      d,
    ),
  normalize: (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'string') {
      return { type: 'date', start: v, end: null, includeTime: v.includes('T') };
    }
    const parsed = z
      .object({
        start: z.string().min(1),
        end: z.string().nullable().optional(),
        includeTime: z.boolean().optional(),
        timeZone: z.string().nullable().optional(),
      })
      .safeParse(v);
    if (!parsed.success) throw new AppError('INVALID_FIELD_VALUE', '日期欄位格式不正確');
    return {
      type: 'date',
      start: parsed.data.start,
      end: parsed.data.end ?? null,
      includeTime: parsed.data.includeTime ?? parsed.data.start.includes('T'),
      timeZone: parsed.data.timeZone ?? null,
    };
  },
  toSqlExpr: (propertyId) => sql`(p.properties -> ${propertyId} ->> 'start')`,
  filterOperators: [...DATE_OPS],
  toPlainText: (v) => (v && v.type === 'date' ? v.start : ''),
});

/* ── checkbox ── */
defineFieldType({
  type: 'checkbox',
  validateConfig: (d) => parseDef(z.object({ ...baseDef, type: z.literal('checkbox') }), d),
  normalize: (v) => {
    if (v === null || v === undefined) return null;
    const raw = typeof v === 'object' ? (v as { checkbox?: unknown }).checkbox : v;
    const checked = raw === true || raw === 'true' || raw === 1;
    // checkbox 的 false 也要存，否則 filter is=false 會跟「從未設定」混淆
    return { type: 'checkbox', checkbox: checked };
  },
  toSqlExpr: (propertyId) =>
    sql`coalesce((p.properties -> ${propertyId} ->> 'checkbox')::boolean, false)`,
  filterOperators: ['is'],
  toPlainText: (v) => (v && v.type === 'checkbox' && v.checkbox ? '是' : '否'),
});

/* ── url ── */
defineFieldType({
  type: 'url',
  validateConfig: (d) => parseDef(z.object({ ...baseDef, type: z.literal('url') }), d),
  normalize: (v) => {
    if (v === null || v === undefined || v === '') return null;
    const raw = typeof v === 'object' ? (v as { url?: unknown }).url : v;
    if (raw === null || raw === undefined || raw === '') return null;
    const url = z.string().max(2000).safeParse(raw);
    if (!url.success) throw new AppError('INVALID_FIELD_VALUE');
    return { type: 'url', url: url.data };
  },
  toSqlExpr: (propertyId) => sql`(p.properties -> ${propertyId} ->> 'url')`,
  filterOperators: [...TEXT_OPS],
  toPlainText: (v) => (v && v.type === 'url' ? (v.url ?? '') : ''),
});

/* ── person ── */
defineFieldType({
  type: 'person',
  validateConfig: (d) =>
    parseDef(
      z.object({ ...baseDef, type: z.literal('person'), allowMultiple: z.boolean().optional() }),
      d,
    ),
  normalize: (v) => {
    if (v === null || v === undefined) return null;
    const raw = Array.isArray(v) ? v : ((v as { userIds?: unknown }).userIds ?? []);
    const ids = z.array(z.string().uuid()).safeParse(raw);
    if (!ids.success) throw new AppError('INVALID_FIELD_VALUE', '負責人欄位必須是使用者 id 陣列');
    if (ids.data.length === 0) return null;
    return { type: 'person', userIds: ids.data };
  },
  toSqlExpr: (propertyId) => sql`(p.properties -> ${propertyId} -> 'userIds' ->> 0)`,
  filterOperators: ['contains', 'doesNotContain', 'isEmpty', 'isNotEmpty'],
  toPlainText: (v) => (v && v.type === 'person' ? v.userIds.join(',') : ''),
});
