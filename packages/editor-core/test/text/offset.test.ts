import { describe, expect, it } from 'vitest';
import {
  codePointAt,
  codePointLength,
  codePointToUtf16,
  sliceByCodePoint,
  utf16ToCodePoint,
} from '../../src/text/offset.js';

const EMOJI = '😀'; // U+1F600，surrogate pair
const RARE = '𠮷'; // U+20BB7，surrogate pair

describe('codePointLength', () => {
  it('ASCII 與 CJK', () => {
    expect(codePointLength('')).toBe(0);
    expect(codePointLength('abc')).toBe(3);
    expect(codePointLength('中文字')).toBe(3);
  });

  it('surrogate pair 只算 1', () => {
    expect(EMOJI.length).toBe(2);
    expect(codePointLength(EMOJI)).toBe(1);
    expect(codePointLength(RARE)).toBe(1);
    expect(codePointLength(`a${EMOJI}b${RARE}`)).toBe(4);
  });

  it('與 [...str].length 一致', () => {
    for (const s of ['', 'abc', '中文', EMOJI, `${EMOJI}${RARE}`, '👨‍👩‍👧‍👦', 'a\nb']) {
      expect(codePointLength(s)).toBe([...s].length);
    }
  });
});

describe('utf16 ↔ code point', () => {
  it('純 ASCII 兩者相同', () => {
    expect(utf16ToCodePoint('hello', 3)).toBe(3);
    expect(codePointToUtf16('hello', 3)).toBe(3);
  });

  it('surrogate pair 會差 1', () => {
    const s = `a${EMOJI}b`; // utf16: a(0) emoji(1,2) b(3)
    expect(codePointToUtf16(s, 0)).toBe(0);
    expect(codePointToUtf16(s, 1)).toBe(1);
    expect(codePointToUtf16(s, 2)).toBe(3);
    expect(codePointToUtf16(s, 3)).toBe(4);
    expect(utf16ToCodePoint(s, 0)).toBe(0);
    expect(utf16ToCodePoint(s, 1)).toBe(1);
    expect(utf16ToCodePoint(s, 3)).toBe(2);
    expect(utf16ToCodePoint(s, 4)).toBe(3);
  });

  it('落在 surrogate pair 中間 → 進位到該字元之後', () => {
    const s = `a${EMOJI}b`;
    expect(utf16ToCodePoint(s, 2)).toBe(2);
  });

  it('超出範圍會 clamp', () => {
    expect(utf16ToCodePoint('abc', 99)).toBe(3);
    expect(codePointToUtf16('abc', 99)).toBe(3);
    expect(utf16ToCodePoint('abc', -5)).toBe(0);
    expect(codePointToUtf16('abc', -5)).toBe(0);
  });

  it('round trip', () => {
    const s = `${EMOJI}中${RARE}a`;
    for (let i = 0; i <= codePointLength(s); i++) {
      expect(utf16ToCodePoint(s, codePointToUtf16(s, i))).toBe(i);
    }
  });
});

describe('sliceByCodePoint / codePointAt', () => {
  it('以 code point 切片', () => {
    const s = `a${EMOJI}b`;
    expect(sliceByCodePoint(s, 0, 1)).toBe('a');
    expect(sliceByCodePoint(s, 1, 2)).toBe(EMOJI);
    expect(sliceByCodePoint(s, 2, 3)).toBe('b');
    expect(sliceByCodePoint(s, 1)).toBe(`${EMOJI}b`);
    expect(sliceByCodePoint(s, 2, 1)).toBe('');
  });

  it('codePointAt', () => {
    expect(codePointAt(`a${EMOJI}`, 1)).toBe(EMOJI);
    expect(codePointAt('abc', 9)).toBe('');
  });
});
