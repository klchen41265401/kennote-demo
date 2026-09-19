/** 字串家族：title / text / url / email / phone。差別只在驗證與顯示行為。 */
import type { FieldValue } from '@kennote/shared-types';
import { richTextToPlainText } from '@kennote/shared-types';
import { z } from 'zod';
import { sql } from '../../../db/sql.js';
import {
  COUNT_AGGS,
  TEXT_OPS,
  baseDef,
  invalidValue,
  parseDef,
  richTextLike,
  unwrap,
} from './common.js';
import { compareNullable, compareText, defineFieldType, propText } from './types.js';

/** title / text 的值一律是 rich text + 冗餘的 plainText（03 §6.4，給搜尋萃取用） */
function toRichTextValue(type: 'title' | 'text', value: unknown): FieldValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return value === '' ? null : { type, richText: [{ text: value }], plainText: value };
  }
  const parsed = z
    .object({ richText: richTextLike.optional(), plainText: z.string().optional() })
    .passthrough()
    .safeParse(value);
  if (!parsed.success) throw invalidValue();
  const richText = (parsed.data.richText ?? []) as never;
  const plainText = parsed.data.plainText ?? richTextToPlainText(richText);
  if (plainText === '' && (parsed.data.richText ?? []).length === 0) return null;
  return { type, richText, plainText };
}

function plainOf(v: FieldValue | undefined): string {
  if (!v) return '';
  if (v.type === 'title' || v.type === 'text') return v.plainText;
  if (v.type === 'url') return v.url ?? '';
  if (v.type === 'email') return v.email ?? '';
  if (v.type === 'phone') return v.phone ?? '';
  return '';
}

/* ── title（每個 collection 有且僅有一個，key 固定為 'title'） ── */
defineFieldType({
  type: 'title',
  label: '標題',
  kind: 'text',
  computed: false,
  groupable: false,
  sortable: true,
  sqlCapable: true,
  validateConfig: (d) => parseDef(z.object({ ...baseDef, type: z.literal('title') }), d),
  defaultValue: () => null,
  normalize: (v) => toRichTextValue('title', v),
  // title 的真值在 pages.title（generated column title_plain），不在 properties
  toSqlExpr: () => sql`p.title_plain`,
  filterOperators: TEXT_OPS,
  aggregations: COUNT_AGGS,
  compare: (a, b) => compareNullable(plainOf(a) || null, plainOf(b) || null, compareText),
  groupKeys: (v) => [plainOf(v) || null],
  groupLabel: (key) => ({ label: key ?? '未命名' }),
  toPlainText: (v) => plainOf(v),
  fromPlainText: (text) => toRichTextValue('title', text),
  coerceFrom: (value, _from) => toRichTextValue('title', plainOf(value)),
});

/* ── text ── */
defineFieldType({
  type: 'text',
  label: '文字',
  kind: 'text',
  computed: false,
  groupable: true,
  sortable: true,
  sqlCapable: true,
  validateConfig: (d) => parseDef(z.object({ ...baseDef, type: z.literal('text') }), d),
  defaultValue: () => null,
  normalize: (v) => toRichTextValue('text', v),
  toSqlExpr: (propertyId) => propText(propertyId, 'plainText'),
  filterOperators: TEXT_OPS,
  aggregations: COUNT_AGGS,
  compare: (a, b) => compareNullable(plainOf(a) || null, plainOf(b) || null, compareText),
  groupKeys: (v) => [plainOf(v) || null],
  groupLabel: (key) => ({ label: key ?? '空白' }),
  toPlainText: (v) => plainOf(v),
  fromPlainText: (text) => toRichTextValue('text', text),
});

/* ── url / email / phone：本質是帶驗證與點擊行為的 text（01 §5.2 M4.2.9） ── */
interface SimpleStringSpec {
  type: 'url' | 'email' | 'phone';
  label: string;
  key: 'url' | 'email' | 'phone';
  maxLength: number;
  /** 回 null 代表通過；回字串代表錯誤訊息 */
  validate?: (value: string) => string | null;
}

const SIMPLE_STRINGS: SimpleStringSpec[] = [
  { type: 'url', label: '網址', key: 'url', maxLength: 2000 },
  {
    type: 'email',
    label: '電子郵件',
    key: 'email',
    maxLength: 320,
    // 刻意用寬鬆規則：真正的 RFC 5322 正規表示式會擋掉合法信箱，比放行假信箱更糟
    validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : '電子郵件格式不正確'),
  },
  {
    type: 'phone',
    label: '電話',
    key: 'phone',
    maxLength: 40,
    validate: (v) => (/^[+0-9()\-.\s#*]{3,40}$/.test(v) ? null : '電話格式不正確'),
  },
];

for (const spec of SIMPLE_STRINGS) {
  defineFieldType({
    type: spec.type,
    label: spec.label,
    kind: 'text',
    computed: false,
    groupable: true,
    sortable: true,
    sqlCapable: true,
    validateConfig: (d) => parseDef(z.object({ ...baseDef, type: z.literal(spec.type) }), d),
    defaultValue: () => null,
    normalize: (v) => {
      if (v === null || v === undefined || v === '') return null;
      const raw = unwrap(v, spec.key);
      if (raw === null || raw === undefined || raw === '') return null;
      if (typeof raw !== 'string' || raw.length > spec.maxLength) {
        throw invalidValue(`${spec.label}長度超過上限`);
      }
      const problem = spec.validate?.(raw.trim());
      if (problem) throw invalidValue(problem);
      return { type: spec.type, [spec.key]: raw.trim() } as FieldValue;
    },
    toSqlExpr: (propertyId) => propText(propertyId, spec.key),
    filterOperators: TEXT_OPS,
    aggregations: COUNT_AGGS,
    compare: (a, b) => compareNullable(plainOf(a) || null, plainOf(b) || null, compareText),
    groupKeys: (v) => [plainOf(v) || null],
    groupLabel: (key) => ({ label: key ?? '空白' }),
    toPlainText: (v) => plainOf(v),
    fromPlainText: (text) => {
      const trimmed = text.trim();
      if (trimmed === '') return null;
      if (spec.validate?.(trimmed)) return null; // 匯入時格式不對就當空值，不整批失敗
      return { type: spec.type, [spec.key]: trimmed } as FieldValue;
    },
  });
}
