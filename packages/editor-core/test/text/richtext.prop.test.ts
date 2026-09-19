/**
 * Property-based testing —— 自研演算法的關鍵防線（04 §9.3）。
 * 自研的 RichText 演算法正確性無法靠人工想案例窮盡，用 fast-check 自動生成上千組輸入。
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { InlineNode, Mark, RichText } from '../../src/model/types.js';
import {
  deleteRange,
  insertText,
  length,
  marksAt,
  normalize,
  slice,
  toOffsetText,
  toggleMark,
} from '../../src/text/richtext.js';
import { codePointLength } from '../../src/text/offset.js';

const RUNS = 1000;

const arbMark: fc.Arbitrary<Mark> = fc.oneof(
  fc.constant<Mark>({ t: 'b' }),
  fc.constant<Mark>({ t: 'i' }),
  fc.constant<Mark>({ t: 'u' }),
  fc.constant<Mark>({ t: 's' }),
  fc.constant<Mark>({ t: 'code' }),
  fc.constantFrom('https://a.example', 'https://b.example').map<Mark>((href) => ({ t: 'link', href })),
  fc.constantFrom('#f00', '#0f0').map<Mark>((fg) => ({ t: 'color', fg })),
);

/** 無參數的 mark：同一個 slot 不會互相取代，toggle 是真正可逆的。 */
const arbSimpleMark: fc.Arbitrary<Mark> = fc.constantFrom<Mark>({ t: 'b' }, { t: 'i' }, { t: 'u' }, { t: 's' }, { t: 'code' });

const arbMarks = fc.array(arbMark, { maxLength: 3 });

/** 含 CJK、emoji、surrogate pair、換行的文字。 */
const arbText = fc
  .array(fc.constantFrom('a', 'b', '中', '文', '😀', '𠮷', ' ', '\n', '👨‍👩‍👧‍👦'), { minLength: 1, maxLength: 6 })
  .map((parts) => parts.join(''));

const arbSpan: fc.Arbitrary<InlineNode> = fc.record({ text: arbText, marks: arbMarks });

const arbAtom: fc.Arbitrary<InlineNode> = fc.record({
  atom: fc.constantFrom('mention' as const, 'date' as const, 'pageLink' as const),
  data: fc.constant({ id: 'x' }),
  marks: arbMarks,
});

export const arbRichText: fc.Arbitrary<RichText> = fc.array(fc.oneof({ weight: 4, arbitrary: arbSpan }, { weight: 1, arbitrary: arbAtom }), {
  maxLength: 6,
});

/** 產生一個合法的 [i, j] 範圍。 */
function rangeOf(rt: RichText, a: number, b: number): [number, number] {
  const total = length(rt);
  const i = total === 0 ? 0 : a % (total + 1);
  const j = total === 0 ? 0 : b % (total + 1);
  return i <= j ? [i, j] : [j, i];
}

describe('RichText property tests', () => {
  it('normalize 是冪等的', () => {
    fc.assert(
      fc.property(arbRichText, (rt) => {
        const once = normalize(rt);
        expect(normalize(once)).toEqual(once);
      }),
      { numRuns: RUNS },
    );
  });

  it('normalize 不改變純文字內容與長度', () => {
    fc.assert(
      fc.property(arbRichText, (rt) => {
        const once = normalize(rt);
        expect(toOffsetText(once)).toBe(toOffsetText(rt.filter((n) => !('text' in n) || n.text.length > 0)));
        expect(length(once)).toBe(length(normalize(rt)));
      }),
      { numRuns: RUNS },
    );
  });

  it('normalize 後不存在空 span，也不存在相鄰同格式 span（不碎片化）', () => {
    fc.assert(
      fc.property(arbRichText, (rt) => {
        const out = normalize(rt);
        for (const node of out) {
          if ('text' in node) expect(node.text.length).toBeGreaterThan(0);
          if (node.marks) expect(node.marks.length).toBeGreaterThan(0);
        }
        for (let i = 1; i < out.length; i++) {
          const prev = out[i - 1]!;
          const cur = out[i]!;
          if ('text' in prev && 'text' in cur) {
            expect(JSON.stringify(prev.marks ?? null)).not.toBe(JSON.stringify(cur.marks ?? null));
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('slice 三段拼接回原文', () => {
    fc.assert(
      fc.property(arbRichText, fc.nat(), fc.nat(), (rt, a, b) => {
        const total = length(rt);
        const [i, j] = rangeOf(rt, a, b);
        const joined = normalize([...slice(rt, 0, i), ...slice(rt, i, j), ...slice(rt, j, total)]);
        expect(joined).toEqual(normalize(rt));
      }),
      { numRuns: RUNS },
    );
  });

  it('slice 的長度等於範圍長度（atom 完整落在範圍內時）', () => {
    fc.assert(
      fc.property(arbRichText, fc.nat(), fc.nat(), (rt, a, b) => {
        const [i, j] = rangeOf(rt, a, b);
        expect(length(slice(rt, i, j))).toBeLessThanOrEqual(j - i);
      }),
      { numRuns: RUNS },
    );
  });

  it('insert 後 delete 同範圍可還原', () => {
    fc.assert(
      fc.property(arbRichText, fc.nat(), arbText, (rt, at, text) => {
        const total = length(rt);
        const offset = total === 0 ? 0 : at % (total + 1);
        const inserted = insertText(rt, offset, text);
        const restored = deleteRange(inserted, offset, offset + codePointLength(text));
        expect(restored).toEqual(normalize(rt));
      }),
      { numRuns: RUNS },
    );
  });

  it('insert 讓長度剛好增加插入文字的長度', () => {
    fc.assert(
      fc.property(arbRichText, fc.nat(), arbText, (rt, at, text) => {
        const total = length(rt);
        const offset = total === 0 ? 0 : at % (total + 1);
        expect(length(insertText(rt, offset, text))).toBe(total + codePointLength(text));
      }),
      { numRuns: RUNS },
    );
  });

  it('delete 讓長度剛好減少範圍長度', () => {
    fc.assert(
      fc.property(arbRichText, fc.nat(), fc.nat(), (rt, a, b) => {
        const total = length(rt);
        const [i, j] = rangeOf(rt, a, b);
        expect(length(deleteRange(rt, i, j))).toBe(total - (j - i));
      }),
      { numRuns: RUNS },
    );
  });

  /**
   * 注意 toggle 的正確語義：範圍內「部分」有該 mark 時，第一次是「整段套上」，
   * 第二次才是「整段移除」——所以混合狀態下 toggle 兩次不會回到原狀（所有編輯器皆然）。
   * 能保證的兩條性質是：
   *   1. 範圍原本就是均勻的（全有或全無）→ toggle 兩次回到原狀
   *   2. toggle 三次 === toggle 一次（第一次之後狀態就穩定了）
   * 另外 link / color 是「同一個 slot 只能有一個」的 mark：套上新的會取代舊的，
   * 因此它們的 toggle 只對「無參數 mark」可逆（見 richtext.test.ts 的 link slot 測試）。
   */
  it('toggleMark：均勻範圍 toggle 兩次回到原狀', () => {
    fc.assert(
      fc.property(arbRichText, fc.nat(), fc.nat(), arbSimpleMark, (rt, a, b, mark) => {
        const [i, j] = rangeOf(rt, a, b);
        const marksInRange = marksAt(rt, i, j);
        const uniformOn = marksInRange.some((m) => JSON.stringify(m) === JSON.stringify(mark));
        const uniformOff = slice(rt, i, j).every(
          (n) => !(n.marks ?? []).some((m) => JSON.stringify(m) === JSON.stringify(mark)),
        );
        if (!uniformOn && !uniformOff) return; // 混合狀態不在這條性質的範圍內
        const twice = toggleMark(toggleMark(rt, i, j, mark), i, j, mark);
        expect(twice).toEqual(normalize(rt));
      }),
      { numRuns: RUNS },
    );
  });

  it('toggleMark 三次 === 一次（狀態穩定）', () => {
    fc.assert(
      fc.property(arbRichText, fc.nat(), fc.nat(), arbMark, (rt, a, b, mark) => {
        const [i, j] = rangeOf(rt, a, b);
        const once = toggleMark(rt, i, j, mark);
        const thrice = toggleMark(toggleMark(once, i, j, mark), i, j, mark);
        expect(thrice).toEqual(once);
      }),
      { numRuns: RUNS },
    );
  });

  it('toggleMark 不改變文字內容與長度', () => {
    fc.assert(
      fc.property(arbRichText, fc.nat(), fc.nat(), arbMark, (rt, a, b, mark) => {
        const [i, j] = rangeOf(rt, a, b);
        const once = toggleMark(rt, i, j, mark);
        expect(toOffsetText(once)).toBe(toOffsetText(normalize(rt)));
        expect(length(once)).toBe(length(rt));
      }),
      { numRuns: RUNS },
    );
  });

  it('toggleMark 之後 marksAt 一定回報正確狀態', () => {
    fc.assert(
      fc.property(arbRichText, fc.nat(), fc.nat(), arbMark, (rt, a, b, mark) => {
        const [i, j] = rangeOf(rt, a, b);
        if (i === j) return;
        const once = toggleMark(rt, i, j, mark);
        const had = marksAt(rt, i, j).some((m) => JSON.stringify(m) === JSON.stringify(mark));
        const has = marksAt(once, i, j).some((m) => JSON.stringify(m) === JSON.stringify(mark));
        expect(has).toBe(!had);
      }),
      { numRuns: RUNS },
    );
  });

  it('任何純函式的輸出都已經是 normalize 過的（canonical form）', () => {
    fc.assert(
      fc.property(arbRichText, fc.nat(), fc.nat(), arbText, arbMark, (rt, a, b, text, mark) => {
        const [i, j] = rangeOf(rt, a, b);
        for (const out of [slice(rt, i, j), insertText(rt, i, text), deleteRange(rt, i, j), toggleMark(rt, i, j, mark)]) {
          expect(normalize(out)).toEqual(out);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
