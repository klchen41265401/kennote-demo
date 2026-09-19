/**
 * 自研 fractional index（04 §1.2 明列為必須自研項目）。
 *
 * 用途：pages.sort_key —— 在兩個兄弟之間插入一個新節點時，
 * 只要產生一個「字典序介於兩者之間」的字串，就不必重排其他列。
 *
 * 設計：
 * - 字母表為 ASCII 可印字元的子集，嚴格遞增：'0'-'9' + 'A'-'Z' + 'a'-'z'（62 進位）
 * - 比較一律用位元組字典序（PostgreSQL 的 collation 可能不是 C，
 *   所以索引與查詢都用 `ORDER BY sort_key COLLATE "C"`，見 migration）
 * - 永不產生以字母表第一個字元結尾的 key（否則無法再往前插入）
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const MIN_CHAR = DIGITS[0]!; // '0'
const MAX_CHAR = DIGITS[DIGITS.length - 1]!; // 'z'
const BASE = DIGITS.length;

export class InvalidSortKeyError extends Error {
  constructor(key: string) {
    super(`不合法的 sort key：${JSON.stringify(key)}`);
    this.name = 'InvalidSortKeyError';
  }
}

function digitAt(key: string, index: number): number {
  if (index >= key.length) return -1; // 比任何字元都小（等同「更短的字串排前面」）
  const code = DIGITS.indexOf(key[index]!);
  if (code < 0) throw new InvalidSortKeyError(key);
  return code;
}

function validate(key: string | null, name: string): void {
  if (key === null) return;
  if (key.length === 0) throw new InvalidSortKeyError(`${name} 不可為空字串`);
  for (const ch of key) {
    if (DIGITS.indexOf(ch) < 0) throw new InvalidSortKeyError(key);
  }
  if (key.endsWith(MIN_CHAR)) throw new InvalidSortKeyError(`${key}（不可以 ${MIN_CHAR} 結尾）`);
}

/**
 * 產生一個排序鍵，使得 before < result < after（位元組字典序）。
 * before = null 代表「排到最前面」，after = null 代表「排到最後面」。
 */
export function generateKeyBetween(before: string | null, after: string | null): string {
  validate(before, 'before');
  validate(after, 'after');
  if (before !== null && after !== null && before >= after) {
    throw new InvalidSortKeyError(`before(${before}) 必須小於 after(${after})`);
  }

  // 兩端皆空 → 取中間值，之後往兩邊都還有空間
  if (before === null && after === null) return midDigit();

  if (before === null) {
    // 要產生比 after 小的 key
    const first = digitAt(after!, 0);
    if (first > 0) {
      const mid = Math.floor(first / 2);
      if (mid > 0) return DIGITS[mid]!;
      // first === 1 → mid === 0，不能以 '0' 結尾，往下一層走
      return MIN_CHAR + generateKeyBetween(null, after!.slice(1) || null);
    }
    // after 以 '0' 開頭（理論上不會發生，因為我們從不產生這種 key）
    return MIN_CHAR + generateKeyBetween(null, after!.slice(1) || null);
  }

  if (after === null) {
    // 要產生比 before 大的 key
    const first = digitAt(before, 0);
    if (first < BASE - 1) {
      const mid = first + Math.max(1, Math.floor((BASE - 1 - first) / 2));
      return DIGITS[mid]!;
    }
    // before 以 'z' 開頭 → 保留 'z' 前綴，遞迴處理剩下的部分
    return MAX_CHAR + generateKeyBetween(before.slice(1) || null, null);
  }

  return between(before, after);
}

function midDigit(): string {
  return DIGITS[Math.floor(BASE / 2)]!; // 'V'
}

function between(a: string, b: string): string {
  let prefix = '';
  let i = 0;
  // 走過共同前綴（a < b 已由呼叫端保證，故兩者不會同時耗盡）
  while (true) {
    const da = digitAt(a, i);
    const db = digitAt(b, i);
    if (da === db) {
      prefix += DIGITS[da]!;
      i += 1;
      continue;
    }
    if (da === -1) {
      // a 已用完（a 是 b 的前綴）→ 只要產生一個小於 b 剩餘部分的 key
      return prefix + generateKeyBetween(null, b.slice(i));
    }
    if (db - da > 1) {
      // 這一位還有空間，直接取中間值
      return prefix + DIGITS[da + Math.floor((db - da) / 2)]!;
    }
    // 兩位相鄰：固定 a 的這一位，往下一層找「比 a 的尾巴大」的 key
    return prefix + DIGITS[da]! + generateKeyBetween(a.slice(i + 1) || null, null);
  }
}

/** 一次產生 n 個依序排列的 key（批次匯入用） */
export function generateNKeysBetween(
  before: string | null,
  after: string | null,
  n: number,
): string[] {
  if (n <= 0) return [];
  if (n === 1) return [generateKeyBetween(before, after)];
  const keys: string[] = [];
  let cursor = before;
  for (let i = 0; i < n; i++) {
    const key = generateKeyBetween(cursor, after);
    keys.push(key);
    cursor = key;
  }
  return keys;
}

/** 位元組字典序比較（給測試與記憶體內排序使用） */
export function compareSortKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const FIRST_SORT_KEY = midDigit();
