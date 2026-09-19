import { describe, expect, it } from 'vitest';
import {
  graphemeBoundaries,
  nextGrapheme,
  nextWordBoundary,
  prevGrapheme,
  prevWordBoundary,
  splitGraphemes,
} from '../../src/text/grapheme.js';
import { codePointLength } from '../../src/text/offset.js';

const FAMILY = '👨‍👩‍👧‍👦'; // 1 grapheme / 7 code points
const FLAG = '🇹🇼'; // regional indicator pair
const COMBINED = 'が'; // か + 濁音符（組合字）

describe('grapheme 基本性質', () => {
  it('家庭 emoji 是 1 個 grapheme 但 7 個 code point', () => {
    expect(codePointLength(FAMILY)).toBe(7);
    expect(splitGraphemes(FAMILY)).toHaveLength(1);
  });

  it('boundaries 一定包含 0 與總長度且遞增', () => {
    for (const s of ['', 'abc', FAMILY, FLAG, COMBINED, `a${FAMILY}b`]) {
      const bounds = graphemeBoundaries(s);
      expect(bounds[0]).toBe(0);
      expect(bounds[bounds.length - 1]).toBe(codePointLength(s));
      for (let i = 1; i < bounds.length; i++) expect(bounds[i]!).toBeGreaterThanOrEqual(bounds[i - 1]!);
    }
  });
});

describe('nextGrapheme / prevGrapheme', () => {
  it('一次跨過整個家庭 emoji（Backspace 不會拆出半個表情）', () => {
    const text = `a${FAMILY}b`;
    expect(nextGrapheme(text, 1)).toBe(8); // 跳過 7 個 code point
    expect(prevGrapheme(text, 8)).toBe(1);
  });

  it('單一家庭 emoji 的 Backspace 一次清空', () => {
    expect(prevGrapheme(FAMILY, codePointLength(FAMILY))).toBe(0);
  });

  it('組合字視為一個字', () => {
    const text = `${COMBINED}x`;
    expect(prevGrapheme(text, codePointLength(COMBINED))).toBe(0);
  });

  it('邊界情況', () => {
    expect(nextGrapheme('abc', 3)).toBe(3);
    expect(nextGrapheme('abc', 99)).toBe(3);
    expect(prevGrapheme('abc', 0)).toBe(0);
    expect(prevGrapheme('', 0)).toBe(0);
  });

  it('一般文字一次移動一個字', () => {
    expect(nextGrapheme('中文字', 0)).toBe(1);
    expect(prevGrapheme('中文字', 3)).toBe(2);
  });

  it('從任意位置往前再往後可回到 grapheme 邊界', () => {
    const text = `ab${FAMILY}${FLAG}cd`;
    const bounds = new Set(graphemeBoundaries(text));
    for (let i = 0; i <= codePointLength(text); i++) {
      expect(bounds.has(prevGrapheme(text, i)) || i === 0).toBe(true);
    }
  });
});

describe('詞界（Ctrl+Backspace）', () => {
  it('英文以空白/標點分隔', () => {
    const text = 'hello world foo';
    expect(prevWordBoundary(text, 15)).toBe(12);
    expect(prevWordBoundary(text, 12)).toBe(6);
    expect(nextWordBoundary(text, 0)).toBe(5);
  });

  it('中文退化為一個字（不會一次刪掉整段）', () => {
    const text = '這是一段中文';
    expect(prevWordBoundary(text, 6)).toBe(5);
    expect(nextWordBoundary(text, 0)).toBe(1);
  });

  it('邊界', () => {
    expect(prevWordBoundary('abc', 0)).toBe(0);
    expect(nextWordBoundary('abc', 3)).toBe(3);
    expect(prevWordBoundary('   ', 3)).toBe(0);
  });
});
