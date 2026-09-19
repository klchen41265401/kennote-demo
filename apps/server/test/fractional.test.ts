import { describe, expect, it } from 'vitest';
import {
  FIRST_SORT_KEY,
  InvalidSortKeyError,
  generateKeyBetween,
  generateNKeysBetween,
} from '../src/lib/fractional.js';

describe('fractional index', () => {
  it('兩端皆空時回傳中間值', () => {
    expect(generateKeyBetween(null, null)).toBe(FIRST_SORT_KEY);
  });

  it('產生的 key 一定嚴格落在兩者之間', () => {
    const cases: Array<[string | null, string | null]> = [
      [null, null],
      ['V', null],
      [null, 'V'],
      ['V', 'W'],
      ['V', 'VV'],
      ['a', 'ab'],
      ['0F', '0V'],
      ['z', null],
      [null, '1'],
      ['zz', null],
    ];
    for (const [before, after] of cases) {
      const key = generateKeyBetween(before, after);
      if (before !== null) expect(key > before, `${key} > ${before}`).toBe(true);
      if (after !== null) expect(key < after, `${key} < ${after}`).toBe(true);
      expect(key.endsWith('0')).toBe(false);
    }
  });

  it('反覆在同一個縫隙插入 200 次仍然保持有序（不會退化）', () => {
    let a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const inserted: string[] = [];
    let left = a;
    for (let i = 0; i < 200; i++) {
      const key = generateKeyBetween(left, b);
      expect(key > left).toBe(true);
      expect(key < b).toBe(true);
      inserted.push(key);
      left = key;
    }
    expect([...inserted].sort()).toEqual(inserted);
    a = inserted[inserted.length - 1]!;
    expect(a < b).toBe(true);
  });

  it('一直往前插入也保持有序', () => {
    let right = generateKeyBetween(null, null);
    for (let i = 0; i < 100; i++) {
      const key = generateKeyBetween(null, right);
      expect(key < right).toBe(true);
      right = key;
    }
  });

  it('一直往後附加也保持有序', () => {
    let left = generateKeyBetween(null, null);
    for (let i = 0; i < 100; i++) {
      const key = generateKeyBetween(left, null);
      expect(key > left).toBe(true);
      left = key;
    }
  });

  it('generateNKeysBetween 回傳嚴格遞增的 n 個 key', () => {
    const keys = generateNKeysBetween('V', 'W', 10);
    expect(keys).toHaveLength(10);
    expect([...keys].sort()).toEqual(keys);
    for (const k of keys) {
      expect(k > 'V').toBe(true);
      expect(k < 'W').toBe(true);
    }
  });

  it('before >= after 時拒絕', () => {
    expect(() => generateKeyBetween('W', 'V')).toThrow(InvalidSortKeyError);
    expect(() => generateKeyBetween('V', 'V')).toThrow(InvalidSortKeyError);
  });

  it('拒絕不合法的 key（含以 0 結尾的 key）', () => {
    expect(() => generateKeyBetween('V-', null)).toThrow(InvalidSortKeyError);
    expect(() => generateKeyBetween('V0', null)).toThrow(InvalidSortKeyError);
    expect(() => generateKeyBetween('', null)).toThrow(InvalidSortKeyError);
  });
});
