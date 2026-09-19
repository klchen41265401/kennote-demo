/**
 * 內建函式表。新增一個函式 = 在這裡加一筆（型別檢查與求值都吃同一筆定義）。
 */
import { FormulaError, type FormulaType, type FormulaValue } from './ast.js';

export interface FormulaFunctionDef {
  name: string;
  /** 每個參數的期望型別；不足的部分由 restParam 補（可變參數） */
  params: FormulaType[];
  restParam?: FormulaType;
  minArgs: number;
  maxArgs: number;
  /** 回傳型別。給函式的話可依實參型別推導（if 需要） */
  returns: FormulaType | ((argTypes: FormulaType[]) => FormulaType);
  impl: (args: FormulaValue[]) => FormulaValue;
  /** 給 UI 的說明 */
  signature: string;
  description: string;
}

/* ── 型別轉換（所有函式共用，避免每個 impl 各寫一份） ───── */

export function toNumberValue(v: FormulaValue): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  const trimmed = v.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function toStringValue(v: FormulaValue): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return formatDateValue(v, 'YYYY-MM-DD');
  return String(v);
}

export function toBooleanValue(v: FormulaValue): boolean {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v instanceof Date) return true;
  return v !== '';
}

export function toDateValue(v: FormulaValue): Date | null {
  if (v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return null;
    // 純日期（YYYY-MM-DD）一律當作 UTC 零時，避免時區讓 dateBetween 差一天
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed + 'T00:00:00Z' : trimmed;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function isEmptyValue(v: FormulaValue): boolean {
  if (v === null) return true;
  if (typeof v === 'string') return v === '';
  if (typeof v === 'number') return Number.isNaN(v);
  return false;
}

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, '0');
}

/** 支援 YYYY / YY / MM / M / DD / D / HH / H / mm / ss。以 UTC 呈現（存的就是 UTC） */
export function formatDateValue(d: Date, pattern: string): string {
  const map: Record<string, string> = {
    YYYY: String(d.getUTCFullYear()),
    YY: pad(d.getUTCFullYear() % 100),
    MM: pad(d.getUTCMonth() + 1),
    M: String(d.getUTCMonth() + 1),
    DD: pad(d.getUTCDate()),
    D: String(d.getUTCDate()),
    HH: pad(d.getUTCHours()),
    H: String(d.getUTCHours()),
    mm: pad(d.getUTCMinutes()),
    ss: pad(d.getUTCSeconds()),
  };
  return pattern.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|ss/g, (m) => map[m] ?? m);
}

const MS: Record<string, number> = {
  millisecond: 1,
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

function normalizeUnit(raw: FormulaValue): string {
  const u = toStringValue(raw).toLowerCase().replace(/s$/, '');
  return u === '' ? 'day' : u;
}

export function dateAddValue(d: Date, amount: number, unit: string): Date {
  const out = new Date(d.getTime());
  if (unit === 'month') {
    out.setUTCMonth(out.getUTCMonth() + amount);
    return out;
  }
  if (unit === 'year') {
    out.setUTCFullYear(out.getUTCFullYear() + amount);
    return out;
  }
  const ms = MS[unit];
  if (ms === undefined) throw new FormulaError('RUNTIME', '不認得的時間單位「' + unit + '」');
  return new Date(out.getTime() + amount * ms);
}

export function dateBetweenValue(a: Date, b: Date, unit: string): number {
  if (unit === 'month') {
    return (a.getUTCFullYear() - b.getUTCFullYear()) * 12 + (a.getUTCMonth() - b.getUTCMonth());
  }
  if (unit === 'year') return a.getUTCFullYear() - b.getUTCFullYear();
  const ms = MS[unit];
  if (ms === undefined) throw new FormulaError('RUNTIME', '不認得的時間單位「' + unit + '」');
  const raw = (a.getTime() - b.getTime()) / ms;
  return raw < 0 ? Math.ceil(raw) : Math.floor(raw);
}

function entry(d: FormulaFunctionDef): [string, FormulaFunctionDef] {
  return [d.name.toLowerCase(), d];
}

function requireNumber(v: FormulaValue, fn: string): number {
  const n = toNumberValue(v);
  if (n === null) throw new FormulaError('RUNTIME', fn + '() 需要數字，但收到空值或無法轉換的內容');
  return n;
}

function requireDate(v: FormulaValue, fn: string): Date {
  const d = toDateValue(v);
  if (d === null) throw new FormulaError('RUNTIME', fn + '() 需要日期，但收到空值或無法轉換的內容');
  return d;
}

export const FORMULA_FUNCTIONS = new Map<string, FormulaFunctionDef>([
  entry({
    name: 'if',
    params: ['boolean', 'any', 'any'],
    minArgs: 3,
    maxArgs: 3,
    returns: (t) => (t[1] === t[2] ? (t[1] ?? 'any') : 'any'),
    impl: (a) => (toBooleanValue(a[0] ?? null) ? (a[1] ?? null) : (a[2] ?? null)),
    signature: 'if(條件, 成立時, 不成立時)',
    description: '條件判斷',
  }),
  entry({
    name: 'concat',
    params: [],
    restParam: 'any',
    minArgs: 0,
    maxArgs: 64,
    returns: 'string',
    impl: (a) => a.map(toStringValue).join(''),
    signature: 'concat(值, …)',
    description: '串接文字',
  }),
  entry({
    name: 'join',
    params: ['string'],
    restParam: 'any',
    minArgs: 1,
    maxArgs: 64,
    returns: 'string',
    impl: (a) => a.slice(1).map(toStringValue).join(toStringValue(a[0] ?? null)),
    signature: 'join(分隔符, 值, …)',
    description: '用分隔符串接文字',
  }),
  entry({
    name: 'length',
    params: ['any'],
    minArgs: 1,
    maxArgs: 1,
    returns: 'number',
    impl: (a) => [...toStringValue(a[0] ?? null)].length,
    signature: 'length(文字)',
    description: '文字長度（以字元計，emoji 算一個）',
  }),
  entry({
    name: 'format',
    params: ['any'],
    minArgs: 1,
    maxArgs: 1,
    returns: 'string',
    impl: (a) => toStringValue(a[0] ?? null),
    signature: 'format(值)',
    description: '任何值轉成文字',
  }),
  entry({
    name: 'toNumber',
    params: ['any'],
    minArgs: 1,
    maxArgs: 1,
    returns: 'number',
    impl: (a) => toNumberValue(a[0] ?? null),
    signature: 'toNumber(值)',
    description: '轉成數字，轉不動回空值',
  }),
  entry({
    name: 'round',
    params: ['number', 'number'],
    minArgs: 1,
    maxArgs: 2,
    returns: 'number',
    impl: (a) => {
      const n = toNumberValue(a[0] ?? null);
      if (n === null) return null;
      const digits = a.length > 1 ? Math.trunc(toNumberValue(a[1] ?? null) ?? 0) : 0;
      const factor = 10 ** Math.max(0, Math.min(10, digits));
      return Math.round(n * factor) / factor;
    },
    signature: 'round(數字, 小數位數?)',
    description: '四捨五入',
  }),
  entry({
    name: 'abs',
    params: ['number'],
    minArgs: 1,
    maxArgs: 1,
    returns: 'number',
    impl: (a) => {
      const n = toNumberValue(a[0] ?? null);
      return n === null ? null : Math.abs(n);
    },
    signature: 'abs(數字)',
    description: '絕對值',
  }),
  entry({
    name: 'now',
    params: [],
    minArgs: 0,
    maxArgs: 0,
    returns: 'date',
    // 真正的 now 由求值器注入（見 evaluate.ts），這裡只是備援
    impl: () => new Date(),
    signature: 'now()',
    description: '目前時間',
  }),
  entry({
    name: 'dateAdd',
    params: ['date', 'number', 'string'],
    minArgs: 2,
    maxArgs: 3,
    returns: 'date',
    impl: (a) =>
      dateAddValue(
        requireDate(a[0] ?? null, 'dateAdd'),
        requireNumber(a[1] ?? null, 'dateAdd'),
        normalizeUnit(a[2] ?? null),
      ),
    signature: 'dateAdd(日期, 數量, 單位)',
    description: '日期加減。單位：day/week/month/year/hour/minute/second',
  }),
  entry({
    name: 'dateBetween',
    params: ['date', 'date', 'string'],
    minArgs: 2,
    maxArgs: 3,
    returns: 'number',
    impl: (a) =>
      dateBetweenValue(
        requireDate(a[0] ?? null, 'dateBetween'),
        requireDate(a[1] ?? null, 'dateBetween'),
        normalizeUnit(a[2] ?? null),
      ),
    signature: 'dateBetween(日期A, 日期B, 單位)',
    description: '兩個日期相差多少（A − B）',
  }),
  entry({
    name: 'formatDate',
    params: ['date', 'string'],
    minArgs: 1,
    maxArgs: 2,
    returns: 'string',
    impl: (a) => {
      const d = toDateValue(a[0] ?? null);
      if (d === null) return '';
      const pattern = a.length > 1 ? toStringValue(a[1] ?? null) : 'YYYY-MM-DD';
      return formatDateValue(d, pattern || 'YYYY-MM-DD');
    },
    signature: 'formatDate(日期, 格式?)',
    description: '格式化日期，如 formatDate(now(), "YYYY/MM/DD")',
  }),
  entry({
    name: 'empty',
    params: ['any'],
    minArgs: 1,
    maxArgs: 1,
    returns: 'boolean',
    impl: (a) => isEmptyValue(a[0] ?? null),
    signature: 'empty(值)',
    description: '是否為空',
  }),
  entry({
    name: 'contains',
    params: ['any', 'any'],
    minArgs: 2,
    maxArgs: 2,
    returns: 'boolean',
    impl: (a) => toStringValue(a[0] ?? null).includes(toStringValue(a[1] ?? null)),
    signature: 'contains(文字, 子字串)',
    description: '是否包含',
  }),
  entry({
    name: 'replace',
    params: ['any', 'string', 'string'],
    minArgs: 3,
    maxArgs: 3,
    returns: 'string',
    impl: (a) =>
      toStringValue(a[0] ?? null)
        .split(toStringValue(a[1] ?? null))
        .join(toStringValue(a[2] ?? null)),
    signature: 'replace(文字, 找什麼, 換成什麼)',
    description: '全部取代（純字串比對，不是正規表示式）',
  }),
  entry({
    name: 'slice',
    params: ['any', 'number', 'number'],
    minArgs: 2,
    maxArgs: 3,
    returns: 'string',
    impl: (a) => {
      const chars = [...toStringValue(a[0] ?? null)];
      const start = Math.trunc(toNumberValue(a[1] ?? null) ?? 0);
      const end =
        a.length > 2 ? Math.trunc(toNumberValue(a[2] ?? null) ?? chars.length) : chars.length;
      return chars.slice(start, end).join('');
    },
    signature: 'slice(文字, 起, 迄?)',
    description: '取子字串（以字元計）',
  }),
  entry({
    name: 'not',
    params: ['boolean'],
    minArgs: 1,
    maxArgs: 1,
    returns: 'boolean',
    impl: (a) => !toBooleanValue(a[0] ?? null),
    signature: 'not(布林)',
    description: '邏輯反相',
  }),
]);

export function getFormulaFunction(name: string): FormulaFunctionDef | undefined {
  return FORMULA_FUNCTIONS.get(name.toLowerCase());
}

export function listFormulaFunctions(): FormulaFunctionDef[] {
  return [...FORMULA_FUNCTIONS.values()];
}
