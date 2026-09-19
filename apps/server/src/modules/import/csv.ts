/**
 * CSV 解析 + 欄位型別推斷（純邏輯，不碰資料庫，所以沒有 DB 也測得動）。
 *
 * 01 §10 M9.1.2「匯入 CSV 成資料庫」與 M9.1.4「Notion 匯出的 Markdown+CSV」
 * 共用同一支：Notion 的 database 匯出就是一張 CSV。
 *
 * 推斷順序是刻意的：從「最嚴格」排到「最寬鬆」，第一個全部值都通過的型別就是答案。
 *   checkbox → number → date → url → email → multiSelect → select → text
 * 猜錯的成本很低（使用者在 UI 改欄位型別，M4 的 retype 會做值遷移），
 * 但猜太寬（全部變 text）使用者就得手動改每一欄，所以寧可積極一點。
 */
import type { CollectionSchema, FieldDefinition, FieldType, SelectColor } from '@kennote/shared-types';

/* ── 解析（RFC 4180 + Excel 的實務慣例） ─────────────── */

export function parseCsv(input: string): string[][] {
  // BOM
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 去掉尾端的空白列
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c.trim() === '')) rows.pop();
  return rows;
}

/* ── 型別推斷 ─────────────────────────────────────────── */

const TRUE_WORDS = new Set(['yes', 'true', '1', '是', '✓', 'v', 'checked', 'y']);
const FALSE_WORDS = new Set(['no', 'false', '0', '否', '✗', 'x', 'unchecked', 'n']);

const NUMBER_RE = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?$/;
const URL_RE = /^https?:\/\/\S+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** ISO、`2026/01/31`、`2026-01-31 09:00`、Notion 的 `January 31, 2026 9:00 AM` */
const DATE_RES = [
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  /^\d{4}\/\d{1,2}\/\d{1,2}([ ]\d{1,2}:\d{2}([ ]?[AP]M)?)?$/i,
  /^[A-Z][a-z]+ \d{1,2}, \d{4}([ ]\d{1,2}:\d{2}[ ]?[AP]M)?$/,
];

function nonEmpty(values: string[]): string[] {
  return values.map((v) => v.trim()).filter((v) => v !== '');
}

export function inferFieldType(values: string[]): FieldType {
  const filled = nonEmpty(values);
  if (filled.length === 0) return 'text';

  const all = (test: (v: string) => boolean): boolean => filled.every(test);

  if (all((v) => TRUE_WORDS.has(v.toLowerCase()) || FALSE_WORDS.has(v.toLowerCase()))) {
    return 'checkbox';
  }
  if (all((v) => NUMBER_RE.test(v))) return 'number';
  if (all((v) => DATE_RES.some((re) => re.test(v)))) return 'date';
  if (all((v) => URL_RE.test(v))) return 'url';
  if (all((v) => EMAIL_RE.test(v))) return 'email';

  // multiSelect：欄位值以逗號分隔且「不同標籤數」遠小於列數
  const commaish = filled.filter((v) => v.includes(','));
  if (commaish.length >= Math.max(1, filled.length * 0.3)) {
    const labels = new Set<string>();
    for (const v of filled) for (const part of splitMulti(v)) labels.add(part);
    if (labels.size > 0 && labels.size <= 60 && [...labels].every((l) => l.length <= 40)) {
      return 'multiSelect';
    }
  }

  // select：字串短，而且「有重複」或「樣本太少還看不出來」。
  // 樣本少時寧可猜 select（使用者在 UI 一鍵改型別就好，M4 的 retype 會做值遷移），
  // 也不要全部掉進 text —— 那才是使用者要一欄一欄手動改的慘劇。
  const distinct = new Set(filled);
  if (
    distinct.size <= 50 &&
    [...distinct].every((v) => v.length <= 40) &&
    (distinct.size <= Math.ceil(filled.length * 0.8) || filled.length <= 8)
  ) {
    return 'select';
  }

  return 'text';
}

export function splitMulti(value: string): string[] {
  return value
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

const OPTION_COLORS: SelectColor[] = [
  'default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
];

/** 標籤 → 穩定的 optionId（同一份 CSV 兩次匯入會得到同樣的 id） */
export function optionIdFor(label: string, index: number): string {
  const ascii = label.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase();
  return `o${index}${ascii}`.slice(0, 16);
}

function buildOptions(values: string[], multi: boolean): Array<{ id: string; value: string; color: SelectColor }> {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const value of nonEmpty(values)) {
    for (const label of multi ? splitMulti(value) : [value]) {
      if (seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
      if (labels.length >= 200) break;
    }
  }
  return labels.map((value, i) => ({
    id: optionIdFor(value, i),
    value,
    color: OPTION_COLORS[i % OPTION_COLORS.length]!,
  }));
}

export interface CsvSchemaPlan {
  schema: CollectionSchema;
  /** CSV 欄索引 → propertyId */
  columns: Array<{ index: number; propertyId: string; name: string; type: FieldType }>;
  warnings: string[];
}

const RESERVED = new Set(['title']);

function propertyIdFor(name: string, index: number, used: Set<string>): string {
  const ascii = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
  let candidate = (ascii.length > 0 ? ascii : `c${index}`).slice(0, 14);
  if (RESERVED.has(candidate.toLowerCase()) || used.has(candidate)) candidate = `${candidate}${index}`;
  candidate = candidate.slice(0, 16);
  while (used.has(candidate)) candidate = `${candidate}x`.slice(0, 16);
  used.add(candidate);
  return candidate;
}

/**
 * 由 CSV 的表頭 + 資料列推出 collection schema。
 * 第一欄一律是 title（Notion 匯出的第一欄就是 Name）。
 */
export function planCsvSchema(rows: string[][]): CsvSchemaPlan {
  const warnings: string[] = [];
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const schema: CollectionSchema = {};
  const columns: CsvSchemaPlan['columns'] = [];
  const used = new Set<string>(['title']);

  if (header.length === 0) {
    warnings.push('CSV 沒有表頭，無法建立資料庫');
    return { schema: { title: { name: '名稱', type: 'title' } }, columns: [], warnings };
  }

  header.forEach((rawName, index) => {
    const name = rawName.trim() || `欄位 ${index + 1}`;
    const values = body.map((row) => row[index] ?? '');

    if (index === 0) {
      schema.title = { name, type: 'title' };
      columns.push({ index, propertyId: 'title', name, type: 'title' });
      return;
    }

    const type = inferFieldType(values);
    const propertyId = propertyIdFor(name, index, used);
    let def: FieldDefinition;
    if (type === 'select' || type === 'multiSelect') {
      def = { name, type, options: buildOptions(values, type === 'multiSelect') } as FieldDefinition;
    } else {
      def = { name, type } as FieldDefinition;
    }
    schema[propertyId] = def;
    columns.push({ index, propertyId, name, type });
  });

  return { schema, columns, warnings };
}

/** Notion 的 checkbox 欄位匯出成 Yes/No；這裡統一成 true/false 字串給 fromPlainText 吃 */
export function normalizeCellForImport(type: FieldType, raw: string): string {
  const value = raw.trim();
  if (type !== 'checkbox') return value;
  const lower = value.toLowerCase();
  if (TRUE_WORDS.has(lower)) return 'true';
  if (FALSE_WORDS.has(lower)) return 'false';
  return '';
}
