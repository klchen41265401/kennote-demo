/**
 * 各欄位型別共用的零件：運算子清單、zod 片段、值的解析小工具。
 * 放這裡是為了讓每個型別檔案只剩「這個型別特有的東西」。
 */
import type { AggregationFunction, FilterOperator, SelectOption } from '@kennote/shared-types';
import { z } from 'zod';
import { AppError } from '../../../lib/errors.js';
import type { FieldDefinition } from '@kennote/shared-types';

export const TEXT_OPS: FilterOperator[] = [
  'is',
  'isNot',
  'contains',
  'doesNotContain',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
];

export const NUMBER_OPS: FilterOperator[] = [
  'equals',
  'doesNotEqual',
  'greaterThan',
  'lessThan',
  'greaterThanOrEqualTo',
  'lessThanOrEqualTo',
  'isEmpty',
  'isNotEmpty',
];

export const DATE_OPS: FilterOperator[] = [
  'is',
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
  'isWithin',
  'isEmpty',
  'isNotEmpty',
];

export const SELECT_OPS: FilterOperator[] = [
  'is',
  'isNot',
  'isAnyOf',
  'isNoneOf',
  'isEmpty',
  'isNotEmpty',
];

export const CONTAINER_OPS: FilterOperator[] = [
  'contains',
  'doesNotContain',
  'isEmpty',
  'isNotEmpty',
];

export const EMPTY_ONLY_OPS: FilterOperator[] = ['isEmpty', 'isNotEmpty'];

/* ── 聚合（aggregation 列）能用哪些函式 ─────────────────── */

export const COUNT_AGGS: AggregationFunction[] = [
  'none',
  'count',
  'countValues',
  'countUnique',
  'countEmpty',
  'countNotEmpty',
  'percentEmpty',
  'percentNotEmpty',
];

export const NUMBER_AGGS: AggregationFunction[] = [
  ...COUNT_AGGS,
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
];

export const DATE_AGGS: AggregationFunction[] = [...COUNT_AGGS, 'earliestDate', 'latestDate'];

export const BOOLEAN_AGGS: AggregationFunction[] = [
  'none',
  'count',
  'checked',
  'unchecked',
  'percentChecked',
];

/* ── zod 片段 ─────────────────────────────────────────── */

export const selectOptionSchema = z.object({
  id: z.string().min(1).max(40),
  value: z.string().max(200),
  color: z
    .enum(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'])
    .default('default'),
});

export const baseDef = {
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  readonly: z.boolean().optional(),
};

export function parseDef<T extends z.ZodType>(schema: T, input: unknown): FieldDefinition {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('INVALID_FIELD_TYPE', '欄位定義格式不正確', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data as FieldDefinition;
}

export const richTextLike = z.array(z.record(z.unknown()));

/* ── 值的小工具 ───────────────────────────────────────── */

/** 允許使用者傳 `{ url: 'x' }` 或直接 `'x'`（CSV 匯入、API 快捷用法都會用到） */
export function unwrap(value: unknown, key: string): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return (value as Record<string, unknown>)[key];
  }
  return value;
}

export function optionList(def: FieldDefinition): SelectOption[] {
  return (def as { options?: SelectOption[] }).options ?? [];
}

export function optionIdSet(def: FieldDefinition): Set<string> {
  return new Set(optionList(def).map((o) => o.id));
}

export function labelOfOption(def: FieldDefinition, id: string | null | undefined): string {
  if (!id) return '';
  return optionList(def).find((o) => o.id === id)?.value ?? '';
}

export function optionByLabel(def: FieldDefinition, label: string): SelectOption | undefined {
  const needle = label.trim();
  return optionList(def).find((o) => o.value === needle);
}

export function invalidValue(message?: string, details?: Record<string, unknown>): AppError {
  return new AppError('INVALID_FIELD_VALUE', message, details);
}

/** 4~8 碼的短碼（03 §4.6）：只用不易誤認的字元 */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePropertyId(existing: Iterable<string> = []): string {
  const taken = new Set(existing);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let id = '';
    for (let i = 0; i < 6; i += 1) {
      id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    if (!taken.has(id) && id !== 'title') return id;
  }
  throw new Error('無法產生不重複的 propertyId');
}

export function generateOptionId(existing: Iterable<string> = []): string {
  const taken = new Set(existing);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const id = 'opt_' + Math.random().toString(36).slice(2, 8);
    if (!taken.has(id)) return id;
  }
  throw new Error('無法產生不重複的 optionId');
}
