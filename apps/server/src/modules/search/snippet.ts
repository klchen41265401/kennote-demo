/**
 * 搜尋結果片段 + 高亮。
 *
 * 為什麼不是只靠 `ts_headline`：
 *   ts_headline 用的是**同一個 parser**，而 'simple' parser 不會斷中文，
 *   所以文件裡的 token 是「資料庫設計規格文件」整串，而查詢是 bigram '資料'，
 *   兩者不相等 → 中文內容 ts_headline 回來的片段**一個 <mark> 都沒有**。
 *
 * 做法：SQL 仍然呼叫 ts_headline（英數內容它做得很好，而且在資料庫端就切好片段），
 *      回到應用層後若片段裡沒有任何 <mark>，就用這裡的 buildSnippet() 自己切自己標。
 *      兩條路都走同一套 token（segment.ts），所以高亮位置與相關性排序是一致的。
 *
 * 安全：輸出是「已逸出的 HTML」，只有我們自己放進去的 <mark>/</mark> 是標籤。
 */

const DEFAULT_WINDOW = 160;
const CONTEXT_BEFORE = 24;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Range {
  start: number;
  end: number;
}

/** 找出所有 token 在文字中的位置（不分大小寫），合併重疊區間 */
export function matchRanges(text: string, tokens: string[], limitPerToken = 40): Range[] {
  if (tokens.length === 0 || text.length === 0) return [];
  const hay = text.toLowerCase();
  const raw: Range[] = [];
  for (const token of tokens) {
    if (!token) continue;
    let from = 0;
    let found = 0;
    for (;;) {
      const at = hay.indexOf(token, from);
      if (at === -1 || found >= limitPerToken) break;
      raw.push({ start: at, end: at + token.length });
      from = at + 1; // bigram 會重疊，步進 1 才不會漏
      found++;
    }
  }
  if (raw.length === 0) return [];
  raw.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Range[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/** 挑出命中最密集的視窗起點 */
function bestWindowStart(ranges: Range[], windowSize: number, textLength: number): number {
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < ranges.length; i++) {
    const start = Math.max(0, ranges[i]!.start - CONTEXT_BEFORE);
    const end = start + windowSize;
    let count = 0;
    for (let j = i; j < ranges.length && ranges[j]!.start < end; j++) count++;
    if (count > bestCount) {
      bestCount = count;
      best = start;
    }
  }
  return Math.min(best, Math.max(0, textLength - windowSize));
}

export interface SnippetOptions {
  maxLength?: number;
  /** 一個 <mark> 都沒有時要不要回前 maxLength 字（true）還是空字串（false） */
  fallbackToHead?: boolean;
}

/**
 * 依 token 在 text 中挑一段上下文並包上 `<mark>`。
 * 回傳值是**已逸出的 HTML**。
 */
export function buildSnippet(
  text: string,
  tokens: string[],
  options: SnippetOptions = {},
): string {
  const maxLength = options.maxLength ?? DEFAULT_WINDOW;
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length === 0) return '';

  const ranges = matchRanges(clean, tokens);
  if (ranges.length === 0) {
    if (options.fallbackToHead === false) return '';
    return escapeHtml(clean.slice(0, maxLength)) + (clean.length > maxLength ? '…' : '');
  }

  const start = bestWindowStart(ranges, maxLength, clean.length);
  const end = Math.min(clean.length, start + maxLength);

  let out = start > 0 ? '…' : '';
  let cursor = start;
  for (const range of ranges) {
    if (range.end <= start) continue;
    if (range.start >= end) break;
    const from = Math.max(range.start, start);
    const to = Math.min(range.end, end);
    if (from > cursor) out += escapeHtml(clean.slice(cursor, from));
    out += `<mark>${escapeHtml(clean.slice(from, to))}</mark>`;
    cursor = to;
  }
  if (cursor < end) out += escapeHtml(clean.slice(cursor, end));
  if (end < clean.length) out += '…';
  return out;
}

/** ts_headline 的產出有沒有真的標到東西 */
export function hasHighlight(headline: string | null | undefined): boolean {
  return typeof headline === 'string' && headline.includes('<mark>');
}

/**
 * ts_headline 的輸出只逸出了 `<`/`>`？—— 沒有。PostgreSQL 會原樣輸出文件內容，
 * 所以若要直接用它，必須先把非 <mark> 的部分逸出。
 * 做法：先把我們指定的 StartSel/StopSel 換成不可能出現在內容裡的哨兵，
 * 逸出整串，再把哨兵換回標籤。
 */
const START_SENTINEL = '\u0001KNMARK\u0001';
const STOP_SENTINEL = '\u0002KNMARK\u0002';

export const TS_HEADLINE_OPTIONS =
  `StartSel=${START_SENTINEL},StopSel=${STOP_SENTINEL},` +
  'MaxWords=28,MinWords=8,ShortWord=2,MaxFragments=1,FragmentDelimiter= … ';

export function sanitizeHeadline(headline: string): string {
  return escapeHtml(headline)
    .split(START_SENTINEL)
    .join('<mark>')
    .split(STOP_SENTINEL)
    .join('</mark>');
}

export function headlineHasSentinel(headline: string | null | undefined): boolean {
  return typeof headline === 'string' && headline.includes(START_SENTINEL);
}
