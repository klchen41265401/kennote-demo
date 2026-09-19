import { describe, expect, it } from 'vitest';
import type { Mark, RichText } from '../../src/model/types.js';
import {
  clearMarks,
  deleteRange,
  inheritMarksAt,
  insertNodes,
  insertText,
  length,
  marksAt,
  normalize,
  slice,
  toOffsetText,
  toPlainText,
  toggleMark,
} from '../../src/text/richtext.js';

const B: Mark = { t: 'b' };
const I: Mark = { t: 'i' };
const LINK: Mark = { t: 'link', href: 'https://x.com' };

const HELLO: RichText = [{ text: 'Hello ' }, { text: 'world', marks: [B] }, { text: '!' }];
const MENTION = { atom: 'mention' as const, data: { id: 'u1', text: 'Ken' } };

describe('normalize', () => {
  it('移除空 span', () => {
    expect(normalize([{ text: '' }, { text: 'a' }, { text: '' }])).toEqual([{ text: 'a' }]);
  });

  it('合併相鄰同格式 span（打 100 個字不會變成 100 個 span）', () => {
    const many: RichText = Array.from({ length: 100 }, (_, i) => ({ text: String(i % 10) }));
    expect(normalize(many)).toHaveLength(1);
  });

  it('不同格式不合併', () => {
    expect(normalize([{ text: 'a' }, { text: 'b', marks: [B] }])).toHaveLength(2);
  });

  it('marks 去重與排序，讓 JSON 可直接比較', () => {
    const a = normalize([{ text: 'x', marks: [I, B, B] }]);
    const b = normalize([{ text: 'x', marks: [B, I] }]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('空 marks 陣列會被移除（唯一正規表示）', () => {
    expect(normalize([{ text: 'x', marks: [] }])).toEqual([{ text: 'x' }]);
  });

  it('冪等', () => {
    const once = normalize(HELLO);
    expect(normalize(once)).toEqual(once);
  });

  it('atom 不會被合併掉', () => {
    const rt: RichText = [{ text: 'a' }, MENTION, { text: 'b' }];
    expect(normalize(rt)).toHaveLength(3);
  });

  it('null / undefined 安全', () => {
    expect(normalize(null)).toEqual([]);
    expect(normalize(undefined)).toEqual([]);
  });
});

describe('length', () => {
  it('以 code point 計算，atom 算 1', () => {
    expect(length(HELLO)).toBe(12);
    expect(length([MENTION])).toBe(1);
    expect(length([{ text: '😀' }])).toBe(1);
    expect(length([])).toBe(0);
  });
});

describe('slice', () => {
  it('切出子片段並保留格式', () => {
    expect(slice(HELLO, 6, 11)).toEqual([{ text: 'world', marks: [B] }]);
    expect(slice(HELLO, 0, 6)).toEqual([{ text: 'Hello ' }]);
  });

  it('跨越 span 邊界', () => {
    expect(slice(HELLO, 4, 8)).toEqual([{ text: 'o ' }, { text: 'wo', marks: [B] }]);
  });

  it('空範圍與越界會 clamp', () => {
    expect(slice(HELLO, 5, 5)).toEqual([]);
    expect(slice(HELLO, 8, 3)).toEqual([]);
    expect(slice(HELLO, -5, 999)).toEqual(normalize(HELLO));
  });

  it('atom 不可分割：只有整個落在範圍內才收', () => {
    const rt: RichText = [{ text: 'ab' }, MENTION, { text: 'cd' }];
    expect(slice(rt, 2, 3)).toEqual([MENTION]);
    expect(slice(rt, 0, 2)).toEqual([{ text: 'ab' }]);
    expect(slice(rt, 3, 5)).toEqual([{ text: 'cd' }]);
  });

  it('三段拼接回原文', () => {
    const joined = normalize([...slice(HELLO, 0, 3), ...slice(HELLO, 3, 9), ...slice(HELLO, 9, 12)]);
    expect(joined).toEqual(normalize(HELLO));
  });
});

describe('insertText', () => {
  it('在中間插入並繼承 offset-1 的格式', () => {
    const next = insertText(HELLO, 8, 'XX');
    expect(next).toEqual([{ text: 'Hello ' }, { text: 'woXXrld', marks: [B] }, { text: '!' }]);
  });

  it('offset 0 不繼承任何格式', () => {
    const next = insertText(HELLO, 0, 'A');
    expect(next[0]).toEqual({ text: 'AHello ' });
  });

  it('可明確指定 marks', () => {
    const next = insertText([{ text: 'ab' }], 1, 'X', [I]);
    expect(next).toEqual([{ text: 'a' }, { text: 'X', marks: [I] }, { text: 'b' }]);
  });

  it('插入空字串是 no-op（但仍會 normalize）', () => {
    expect(insertText(HELLO, 3, '')).toEqual(normalize(HELLO));
  });

  it('結果永遠是 normalize 過的', () => {
    const next = insertText([{ text: 'ab' }], 1, 'X');
    expect(next).toHaveLength(1);
  });

  it('越界的 offset 會 clamp 到結尾', () => {
    expect(toPlainText(insertText([{ text: 'ab' }], 99, 'c'))).toBe('abc');
  });
});

describe('insertNodes', () => {
  it('插入 atom', () => {
    const next = insertNodes([{ text: 'ab' }], 1, [MENTION]);
    expect(next).toEqual([{ text: 'a' }, MENTION, { text: 'b' }]);
    expect(length(next)).toBe(3);
  });
});

describe('deleteRange', () => {
  it('刪除中間（刪完之後左右會合併成一個 span）', () => {
    expect(deleteRange(HELLO, 5, 11)).toEqual([{ text: 'Hello!' }]);
  });

  it('刪除後相鄰同格式 span 會合併', () => {
    const rt: RichText = [{ text: 'ab' }, { text: 'XY', marks: [B] }, { text: 'cd' }];
    expect(deleteRange(rt, 2, 4)).toEqual([{ text: 'abcd' }]);
  });

  it('空範圍是 no-op；順序顛倒會自動修正', () => {
    expect(deleteRange(HELLO, 3, 3)).toEqual(normalize(HELLO));
    expect(deleteRange(HELLO, 11, 5)).toEqual(deleteRange(HELLO, 5, 11));
  });

  it('insert 後 delete 同範圍可還原', () => {
    const inserted = insertText(HELLO, 4, 'ABC');
    expect(deleteRange(inserted, 4, 7)).toEqual(normalize(HELLO));
  });
});

describe('toggleMark', () => {
  it('整段沒有 → 套上', () => {
    expect(toggleMark([{ text: 'abc' }], 0, 3, B)).toEqual([{ text: 'abc', marks: [B] }]);
  });

  it('整段都有 → 移除（toggle 語義）', () => {
    const on = toggleMark([{ text: 'abc' }], 0, 3, B);
    expect(toggleMark(on, 0, 3, B)).toEqual([{ text: 'abc' }]);
  });

  it('部分有 → 整段套上（不是各自 toggle）', () => {
    const rt: RichText = [{ text: 'ab', marks: [B] }, { text: 'cd' }];
    expect(toggleMark(rt, 0, 4, B)).toEqual([{ text: 'abcd', marks: [B] }]);
  });

  it('跨越既有粗體選取後套斜體，span 數最小化', () => {
    const rt: RichText = [{ text: 'aa' }, { text: 'bb', marks: [B] }, { text: 'cc' }];
    const next = toggleMark(rt, 0, 6, I);
    // 預期：斜體(aa) + 粗斜(bb) + 斜體(cc) = 3 個 span，不會碎片化成 6 個
    expect(next).toHaveLength(3);
    expect(next).toEqual([
      { text: 'aa', marks: [I] },
      { text: 'bb', marks: [B, I] },
      { text: 'cc', marks: [I] },
    ]);
    // 再套一次斜體 → 全部移除，並合併回 3 段中的 2 段格式
    const off = toggleMark(next, 0, 6, I);
    expect(off).toEqual([{ text: 'aa' }, { text: 'bb', marks: [B] }, { text: 'cc' }]);
  });

  it('兩次 toggle 回到原狀', () => {
    const once = toggleMark(HELLO, 2, 9, I);
    expect(toggleMark(once, 2, 9, I)).toEqual(normalize(HELLO));
  });

  it('空範圍是 no-op', () => {
    expect(toggleMark(HELLO, 4, 4, B)).toEqual(normalize(HELLO));
  });

  it('link 是同一個 slot：套新的會換掉舊的', () => {
    const withLink = toggleMark([{ text: 'abc' }], 0, 3, LINK);
    const replaced = toggleMark(withLink, 0, 3, { t: 'link', href: 'https://y.com' });
    expect(replaced).toEqual([{ text: 'abc', marks: [{ t: 'link', href: 'https://y.com' }] }]);
  });

  it('atom 也能套 mark', () => {
    const next = toggleMark([MENTION], 0, 1, B);
    expect(next[0]!.marks).toEqual([B]);
  });
});

describe('marksAt', () => {
  it('回傳範圍內共同擁有的 marks', () => {
    expect(marksAt(HELLO, 6, 11)).toEqual([B]);
    expect(marksAt(HELLO, 0, 12)).toEqual([]);
  });

  it('collapsed 時回傳「接著打字會繼承的格式」', () => {
    expect(marksAt(HELLO, 8, 8)).toEqual([B]);
    expect(marksAt(HELLO, 0, 0)).toEqual([]);
  });

  it('inheritMarksAt 與 marksAt 的 collapsed 行為一致', () => {
    expect(inheritMarksAt(HELLO, 8) ?? []).toEqual(marksAt(HELLO, 8, 8));
  });
});

describe('toPlainText / toOffsetText', () => {
  it('toPlainText 給人看', () => {
    expect(toPlainText(HELLO)).toBe('Hello world!');
    expect(toPlainText([{ text: 'hi ' }, MENTION])).toBe('hi @Ken');
  });

  it('toOffsetText 的長度與 model offset 完全對齊', () => {
    const rt: RichText = [{ text: 'ab' }, MENTION, { text: 'cd' }];
    expect(toOffsetText(rt)).toHaveLength(5);
    expect([...toOffsetText(rt)].length).toBe(length(rt));
  });
});

describe('clearMarks', () => {
  it('清掉範圍內所有格式', () => {
    expect(clearMarks(HELLO, 0, 12)).toEqual([{ text: 'Hello world!' }]);
  });
});
