/**
 * RichText 的最小差異計算。
 *
 * 主要用途：IME compositionend 之後，從 DOM 讀回真實內容，與組字前的快照比對，
 * 產生「最小的一次文字替換」，用來算新游標位置（不吞字、游標不跳）。
 */
import type { RichText } from '../model/types.js';
import { codePointLength, sliceByCodePoint } from './offset.js';
import { length, normalize, slice, toPlainText } from './richtext.js';

export interface TextChange {
  /** 變更起點（code point offset） */
  from: number;
  /** 變更終點（在 before 座標系） */
  to: number;
  /** 插入的文字 */
  insert: string;
}

/** 計算兩段純文字的最小替換（共同前綴 + 共同後綴）。 */
export function diffText(before: string, after: string): TextChange | null {
  if (before === after) return null;
  const beforeLen = codePointLength(before);
  const afterLen = codePointLength(after);
  let prefix = 0;
  const maxPrefix = Math.min(beforeLen, afterLen);
  while (
    prefix < maxPrefix &&
    sliceByCodePoint(before, prefix, prefix + 1) === sliceByCodePoint(after, prefix, prefix + 1)
  ) {
    prefix++;
  }
  let suffix = 0;
  const maxSuffix = Math.min(beforeLen - prefix, afterLen - prefix);
  while (
    suffix < maxSuffix &&
    sliceByCodePoint(before, beforeLen - suffix - 1, beforeLen - suffix) ===
      sliceByCodePoint(after, afterLen - suffix - 1, afterLen - suffix)
  ) {
    suffix++;
  }
  return {
    from: prefix,
    to: beforeLen - suffix,
    insert: sliceByCodePoint(after, prefix, afterLen - suffix),
  };
}

export interface RichTextDiff {
  /** 變更範圍（before 座標） */
  from: number;
  to: number;
  /** 替換成的內容 */
  insert: RichText;
  /** 套用之後，游標應該在的位置（after 座標） */
  caretAfter: number;
}

/**
 * 計算兩段 RichText 的最小差異。
 * 以純文字層級求共同前後綴，再從 after 取出該範圍的 RichText（保留格式）。
 */
export function diffRichText(before: RichText, after: RichText): RichTextDiff | null {
  const a = normalize(before);
  const b = normalize(after);
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  const beforeLen = length(a);
  const afterLen = length(b);
  let prefix = 0;
  const maxPrefix = Math.min(beforeLen, afterLen);
  while (prefix < maxPrefix && sameUnit(a, b, prefix, prefix)) prefix++;
  let suffix = 0;
  const maxSuffix = Math.min(beforeLen - prefix, afterLen - prefix);
  while (suffix < maxSuffix && sameUnit(a, b, beforeLen - suffix - 1, afterLen - suffix - 1)) suffix++;
  const from = prefix;
  const to = beforeLen - suffix;
  const insert = slice(b, prefix, afterLen - suffix);
  return { from, to, insert, caretAfter: prefix + length(insert) };
}

function sameUnit(a: RichText, b: RichText, ai: number, bi: number): boolean {
  const ua = slice(a, ai, ai + 1);
  const ub = slice(b, bi, bi + 1);
  return JSON.stringify(ua) === JSON.stringify(ub);
}

/** 只比較純文字，忽略格式（MutationObserver 對帳的快速路徑）。 */
export function plainTextEquals(a: RichText, b: RichText): boolean {
  return toPlainText(a) === toPlainText(b);
}
