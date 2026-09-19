/**
 * UTF-16 code unit ↔ Unicode code point 的雙向轉換。
 *
 * 資料模型內部一律用 code point 計數；DOM 的 Range.startOffset 等 API 用的是
 * UTF-16 code unit。emoji 與罕用漢字（例如 U+20BB7）是 surrogate pair，兩者會差 1。
 */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** 字串的 code point 長度（surrogate pair 只算 1）。 */
export function codePointLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (isHighSurrogate(text.charCodeAt(i)) && i + 1 < text.length && isLowSurrogate(text.charCodeAt(i + 1))) {
      i++;
    }
    n++;
  }
  return n;
}

/** UTF-16 offset → code point offset。offset 落在 surrogate pair 中間時進位到該字元之後。 */
export function utf16ToCodePoint(text: string, utf16Offset: number): number {
  const clamped = Math.max(0, Math.min(utf16Offset, text.length));
  let cp = 0;
  let i = 0;
  while (i < clamped) {
    if (isHighSurrogate(text.charCodeAt(i)) && i + 1 < text.length && isLowSurrogate(text.charCodeAt(i + 1))) {
      i++;
    }
    i++;
    cp++;
  }
  return cp;
}

/** code point offset → UTF-16 offset。 */
export function codePointToUtf16(text: string, cpOffset: number): number {
  if (cpOffset <= 0) return 0;
  let cp = 0;
  let i = 0;
  while (i < text.length) {
    if (cp === cpOffset) return i;
    if (isHighSurrogate(text.charCodeAt(i)) && i + 1 < text.length && isLowSurrogate(text.charCodeAt(i + 1))) {
      i++;
    }
    i++;
    cp++;
  }
  return text.length;
}

/** 以 code point 為單位切片。 */
export function sliceByCodePoint(text: string, from: number, to?: number): string {
  const end = to === undefined ? codePointLength(text) : to;
  const a = codePointToUtf16(text, Math.max(0, from));
  const b = codePointToUtf16(text, Math.max(0, end));
  return b <= a ? '' : text.slice(a, b);
}

/** 取得第 n 個 code point（字串形式），超出範圍回傳空字串。 */
export function codePointAt(text: string, index: number): string {
  return sliceByCodePoint(text, index, index + 1);
}
