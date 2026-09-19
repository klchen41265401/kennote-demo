/**
 * 自研中文斷詞 —— 索引端與查詢端的**同一套規則**（03 §7.4 方案 A）。
 *
 * ⚠️ 這個檔案與 migration 0020 的 `kn_segment()` 是同一個演算法的兩個實作。
 *    兩邊漂移 = 索引裡有的詞查不到。test/search-segment.test.ts 的黃金案例
 *    就是拿來釘住這件事的（改規則 → 兩邊一起改 → 重建索引）。
 *
 * 規則（刻意極簡，才寫得出兩份一致的實作）：
 *   1. `[0-9A-Za-z]+` 連續英數 → 小寫後成為一個 token
 *   2. CJK 連續字元 → 長度 1 給該字本身；長度 ≥ 2 給所有相鄰 bigram
 *   3. 其餘字元（空白、標點、emoji…）一律當分隔符
 *
 * 為什麼是 bigram 而不是詞典斷詞：
 *   詞典（jieba / SCWS）要嘛得在 DB 裝擴充（自架不一定能裝），要嘛得維護詞庫。
 *   bigram 的召回率是 100%（任何連續 2 字的查詢一定比得到），精準度靠
 *   ts_rank_cd 的 cover density 補回來 —— 查「資料庫設計」會同時要求
 *   資料/料庫/庫設/設計 四個 token 都命中且相鄰，實際體感很好。
 *   代價：索引大約是原文的 2 倍，單字查詢要靠 pg_trgm fallback。
 */

/** 中日韓統一表意文字 + 擴充 A + 相容表意 + 假名 + 諺文。與 0020 的字元類完全對應 */
const CJK_RANGES: Array<[number, number]> = [
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0x3040, 0x30ff],
  [0xac00, 0xd7af],
];

export function isCjkCodePoint(code: number): boolean {
  for (const [lo, hi] of CJK_RANGES) {
    if (code >= lo && code <= hi) return true;
  }
  return false;
}

function isAlnum(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) || // 0-9
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) // a-z
  );
}

/** 斷詞。回傳 token 陣列（順序與原文一致） */
export function segmentTokens(text: string): string[] {
  const out: string[] = [];
  if (!text) return out;

  let i = 0;
  const n = text.length;
  while (i < n) {
    const code = text.charCodeAt(i);

    if (isAlnum(code)) {
      let j = i + 1;
      while (j < n && isAlnum(text.charCodeAt(j))) j++;
      out.push(text.slice(i, j).toLowerCase());
      i = j;
      continue;
    }

    if (isCjkCodePoint(code)) {
      let j = i + 1;
      while (j < n && isCjkCodePoint(text.charCodeAt(j))) j++;
      const run = text.slice(i, j);
      if (run.length === 1) out.push(run);
      else for (let k = 0; k + 1 < run.length; k++) out.push(run.slice(k, k + 2));
      i = j;
      continue;
    }

    i++;
  }
  return out;
}

/** 斷詞後以空白串接（= kn_segment() 的回傳值，給對齊測試用） */
export function segmentText(text: string): string {
  return segmentTokens(text).join(' ');
}

/** 查詢端額外要知道的事：使用者輸入裡有沒有「單獨的 1 個 CJK 字」 */
export interface ParsedQuery {
  /** 去重後的 token（保留出現順序） */
  tokens: string[];
  /** 給 to_tsquery('simple', $1) 的字串；沒有 token 時為 null */
  tsquery: string | null;
  /**
   * true = 這個查詢不該只信 tsvector（單字 CJK、純標點、或只有一個很短的詞），
   * 呼叫端要一併跑 pg_trgm 的 ILIKE fallback。
   */
  needsTrigramFallback: boolean;
  /** 原始輸入（去頭尾空白） */
  raw: string;
}

/**
 * token → tsquery 字串。
 *
 * 安全性：token 由 segmentTokens 產生，**只可能**是 `[0-9a-z]+` 或 CJK 字元，
 * 不可能含有引號、`&`、`|`、`!`、`:`、`(`、`)`，因此包單引號後拼接不存在注入風險。
 * 即使如此，字串仍然是以參數（$1）送進 `to_tsquery('simple', $1)`，不進 SQL 文字。
 */
export function buildTsQuery(tokens: string[], options: { prefixLast?: boolean } = {}): string | null {
  if (tokens.length === 0) return null;
  const prefixLast = options.prefixLast ?? true;
  const parts = tokens.map((token, idx) => {
    const last = idx === tokens.length - 1;
    // 只有英數詞做前綴比對（type-ahead）；CJK bigram 做前綴沒有意義
    const wantPrefix = prefixLast && last && /^[0-9a-z]+$/.test(token) && token.length >= 2;
    return wantPrefix ? `'${token}':*` : `'${token}'`;
  });
  return parts.join(' & ');
}

const MAX_TOKENS = 32;

export function parseQuery(raw: string, options: { prefixLast?: boolean } = {}): ParsedQuery {
  const trimmed = raw.trim();
  const all = segmentTokens(trimmed);

  // 去重但保留順序（重複 token 對 AND 查詢沒有幫助，只會讓 tsquery 變長）
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const t of all) {
    if (seen.has(t)) continue;
    seen.add(t);
    tokens.push(t);
    if (tokens.length >= MAX_TOKENS) break;
  }

  // 「一個 CJK 字」或「一個 1 字母的英數」斷不出 bigram → tsvector 幫不上忙
  const shortish = trimmed.length > 0 && tokens.length <= 1 && trimmed.replace(/\s+/g, '').length <= 2;

  return {
    tokens,
    tsquery: buildTsQuery(tokens, options),
    needsTrigramFallback: tokens.length === 0 || shortish,
    raw: trimmed,
  };
}
