/**
 * Grapheme cluster（使用者感知的「一個字」）處理。
 *
 * 家庭 emoji 是 1 個 grapheme 但 7 個 code point；按一次 Backspace 必須整組消失。
 * 用原生 Intl.Segmenter（Node 18+ 與所有現代瀏覽器都有），不引入任何套件。
 * 環境缺 Intl.Segmenter 時退回保守的 combining-mark 實作。
 *
 * 注意：本模組所有 offset 都是 code point 單位（與資料模型一致）。
 */
import { codePointLength, codePointToUtf16, utf16ToCodePoint } from './offset.js';

interface SegmentData {
  index: number;
  segment: string;
}
interface SegmenterLike {
  segment(input: string): Iterable<SegmentData>;
}

let segmenter: SegmenterLike | null | undefined;

function getSegmenter(): SegmenterLike | null {
  if (segmenter !== undefined) return segmenter;
  const IntlAny = Intl as unknown as {
    Segmenter?: new (locale?: string, opts?: { granularity: string }) => SegmenterLike;
  };
  segmenter = IntlAny.Segmenter ? new IntlAny.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  return segmenter;
}

function isCombiningAt(text: string, cpIndex: number): boolean {
  const cp = text.codePointAt(codePointToUtf16(text, cpIndex));
  if (cp === undefined) return false;
  if (cp === 0x200d || cp === 0xfe0f || cp === 0xfe0e) return true;
  if (cp >= 0x1f3fb && cp <= 0x1f3ff) return true;
  if (cp >= 0x0300 && cp <= 0x036f) return true;
  if (cp >= 0x1ab0 && cp <= 0x1aff) return true;
  if (cp >= 0x20d0 && cp <= 0x20ff) return true;
  if (cpIndex > 0) {
    const prev = text.codePointAt(codePointToUtf16(text, cpIndex - 1));
    if (prev === 0x200d) return true;
  }
  return false;
}

/** 以 code point offset 列出所有 grapheme 邊界（含 0 與總長度）。 */
export function graphemeBoundaries(text: string): number[] {
  const total = codePointLength(text);
  if (total === 0) return [0];
  const seg = getSegmenter();
  const bounds: number[] = [0];
  if (seg) {
    for (const item of seg.segment(text)) {
      if (item.index === 0) continue;
      bounds.push(utf16ToCodePoint(text, item.index));
    }
  } else {
    let i = 0;
    while (i < total) {
      i++;
      while (i < total && isCombiningAt(text, i)) i++;
      if (i < total) bounds.push(i);
    }
  }
  bounds.push(total);
  return bounds;
}

/** 從 code point offset 往右移一個 grapheme。已在結尾則回傳總長度。 */
export function nextGrapheme(text: string, offset: number): number {
  const total = codePointLength(text);
  if (offset >= total) return total;
  for (const b of graphemeBoundaries(text)) {
    if (b > offset) return b;
  }
  return total;
}

/** 從 code point offset 往左移一個 grapheme。已在開頭則回傳 0。 */
export function prevGrapheme(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let prev = 0;
  for (const b of graphemeBoundaries(text)) {
    if (b >= offset) break;
    prev = b;
  }
  return prev;
}

/** 切成 grapheme 陣列。 */
export function splitGraphemes(text: string): string[] {
  const seg = getSegmenter();
  if (seg) {
    const out: string[] = [];
    for (const item of seg.segment(text)) out.push(item.segment);
    return out;
  }
  const bounds = graphemeBoundaries(text);
  const out: string[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    out.push(text.slice(codePointToUtf16(text, bounds[i]!), codePointToUtf16(text, bounds[i + 1]!)));
  }
  return out;
}

const WORD_SEPARATOR = /[\s　.,;:!?'"()[\]{}<>/\|@#$%^&*+=~`、。，；：！？“”‘’]/;
const CJK = /[⺀-鿿豈-﫿＀-￯]/;

/**
 * 往左找詞界（Ctrl/Opt+Backspace 用）。
 * 英文以空白與標點分隔；CJK 因為沒有空白，退化為「一個字」以避免一次刪掉整段。
 */
export function prevWordBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let i = offset;
  // 先吃掉緊鄰游標的空白
  while (i > 0 && /\s/.test(charAt(text, i - 1))) i--;
  if (i === 0) return 0;
  const ch = charAt(text, i - 1);
  if (CJK.test(ch)) return prevGrapheme(text, i);
  if (WORD_SEPARATOR.test(ch)) {
    while (i > 0 && WORD_SEPARATOR.test(charAt(text, i - 1)) && !/\s/.test(charAt(text, i - 1))) i--;
    return i;
  }
  while (i > 0) {
    const c = charAt(text, i - 1);
    if (WORD_SEPARATOR.test(c) || CJK.test(c)) break;
    i--;
  }
  return i;
}

/** 往右找詞界（Ctrl/Opt+Delete 用）。 */
export function nextWordBoundary(text: string, offset: number): number {
  const total = codePointLength(text);
  if (offset >= total) return total;
  let i = offset;
  while (i < total && /\s/.test(charAt(text, i))) i++;
  if (i === total) return total;
  const ch = charAt(text, i);
  if (CJK.test(ch)) return nextGrapheme(text, i);
  if (WORD_SEPARATOR.test(ch)) {
    while (i < total && WORD_SEPARATOR.test(charAt(text, i)) && !/\s/.test(charAt(text, i))) i++;
    return i;
  }
  while (i < total) {
    const c = charAt(text, i);
    if (WORD_SEPARATOR.test(c) || CJK.test(c)) break;
    i++;
  }
  return i;
}

function charAt(text: string, cpIndex: number): string {
  const a = codePointToUtf16(text, cpIndex);
  const b = codePointToUtf16(text, cpIndex + 1);
  return text.slice(a, b);
}
