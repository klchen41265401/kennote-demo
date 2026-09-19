/**
 * Delta 代數的手寫單元測試（property test 在 transform.prop.test.ts）。
 * 這裡放的是「看得懂的具體例子」，property test 掛掉時先來這裡找哪一格壞了。
 */
import { describe, expect, it } from 'vitest';
import {
  apply,
  baseLength,
  compose,
  composeAll,
  DeltaBuilder,
  deltaFromDiff,
  deltaLength,
  invert,
  isNoop,
  normalizeDelta,
  opLength,
  OpIterator,
  transformCursor,
  transformRange,
} from '../../src/ot/delta.js';
import { transform, transformPair } from '../../src/ot/transform.js';
import type { OtDelta } from '../../src/ot/types.js';
import { fromPlainText, normalize, toPlainText } from '../../src/text/richtext.js';

const text = (s: string) => fromPlainText(s);
const plain = (rt: ReturnType<typeof normalize>) => toPlainText(rt);

describe('opLength / baseLength / deltaLength', () => {
  it('atom 佔 1', () => {
    const d: OtDelta = { ops: [{ insert: '￼', atom: { atom: 'mention', data: { id: '1' } } }] };
    expect(opLength(d.ops[0]!)).toBe(1);
    expect(deltaLength(d)).toBe(1);
    expect(baseLength(d)).toBe(0);
  });

  it('surrogate pair 佔 1（emoji）', () => {
    expect(opLength({ insert: '😀' })).toBe(1);
    expect(deltaLength({ ops: [{ retain: 2 }, { insert: '😀b' }] })).toBe(4);
    expect(baseLength({ ops: [{ retain: 2 }, { delete: 3 }, { insert: 'x' }] })).toBe(5);
  });
});

describe('apply', () => {
  it('retain + insert + delete', () => {
    const out = apply(text('hello'), { ops: [{ retain: 5 }, { insert: ' world' }] });
    expect(plain(out)).toBe('hello world');
  });

  it('delete 中間一段', () => {
    expect(plain(apply(text('abcdef'), { ops: [{ retain: 2 }, { delete: 2 }] }))).toBe('abef');
  });

  it('insert 帶 marks', () => {
    const out = apply(text('ab'), { ops: [{ retain: 1 }, { insert: 'X', marks: [{ t: 'b' }] }] });
    expect(out).toEqual([{ text: 'a' }, { text: 'X', marks: [{ t: 'b' }] }, { text: 'b' }]);
  });

  it('retain 帶 MarkPatch 只改格式', () => {
    const out = apply(text('abc'), { ops: [{ retain: 2, marks: { add: [{ t: 'b' }] } }] });
    expect(out).toEqual([{ text: 'ab', marks: [{ t: 'b' }] }, { text: 'c' }]);
  });

  it('MarkPatch 的 remove 先套、add 後套；同 slot 覆蓋', () => {
    const base = normalize([{ text: 'ab', marks: [{ t: 'link', href: 'x' }] }]);
    const out = apply(base, { ops: [{ retain: 2, marks: { add: [{ t: 'link', href: 'y' }] } }] });
    expect(out).toEqual([{ text: 'ab', marks: [{ t: 'link', href: 'y' }] }]);
  });

  it('insert atom', () => {
    const out = apply(text('ab'), {
      ops: [{ retain: 1 }, { insert: '￼', atom: { atom: 'mention', data: { id: '7' } } }],
    });
    expect(out).toEqual([{ text: 'a' }, { atom: 'mention', data: { id: '7' } }, { text: 'b' }]);
  });

  it('delete 跨過 atom（atom 佔 1）', () => {
    const base = normalize([{ text: 'a' }, { atom: 'date', data: {} }, { text: 'b' }]);
    expect(plain(apply(base, { ops: [{ retain: 1 }, { delete: 1 }] }))).toBe('ab');
  });

  it('retain 超出長度會 clamp，不會炸', () => {
    expect(plain(apply(text('ab'), { ops: [{ retain: 99 }, { insert: 'c' }] }))).toBe('abc');
  });
});

describe('DeltaBuilder / normalizeDelta', () => {
  it('合併相鄰同類 op', () => {
    const b = new DeltaBuilder();
    b.pushRetain(2).pushRetain(3).push({ insert: 'a' }).push({ insert: 'b' }).pushDelete(1).pushDelete(2);
    expect(b.build()).toEqual({ ops: [{ retain: 5 }, { insert: 'ab' }, { delete: 3 }] });
  });

  it('insert 永遠排在同位置的 delete 前面（canonical form）', () => {
    const b = new DeltaBuilder();
    b.pushRetain(1).pushDelete(2).push({ insert: 'x' });
    expect(b.build()).toEqual({ ops: [{ retain: 1 }, { insert: 'x' }, { delete: 2 }] });
  });

  it('去掉結尾多餘的 retain，但保留帶格式的 retain', () => {
    expect(normalizeDelta({ ops: [{ insert: 'a' }, { retain: 3 }] })).toEqual({ ops: [{ insert: 'a' }] });
    expect(normalizeDelta({ ops: [{ retain: 3, marks: { add: [{ t: 'b' }] } }] })).toEqual({
      ops: [{ retain: 3, marks: { add: [{ t: 'b' }] } }],
    });
  });

  it('atom insert 不會跟文字 insert 合併', () => {
    const d = normalizeDelta({
      ops: [{ insert: 'a' }, { insert: '￼', atom: { atom: 'date', data: {} } }, { insert: 'b' }],
    });
    expect(d.ops).toHaveLength(3);
  });

  it('isNoop', () => {
    expect(isNoop({ ops: [] })).toBe(true);
    expect(isNoop({ ops: [{ retain: 5 }] })).toBe(true);
    expect(isNoop({ ops: [{ retain: 5 }, { insert: 'a' }] })).toBe(false);
  });
});

describe('OpIterator', () => {
  it('依 code point 切 insert', () => {
    const it = new OpIterator([{ insert: 'a😀b' }]);
    expect(it.peekLength()).toBe(3);
    expect(it.next(1)).toEqual({ insert: 'a' });
    expect(it.next(1)).toEqual({ insert: '😀' });
    expect(it.next()).toEqual({ insert: 'b' });
    expect(it.hasNext()).toBe(false);
  });

  it('走完之後回傳虛擬 retain', () => {
    const it = new OpIterator([]);
    expect(it.peekLength()).toBe(Infinity);
    expect(it.next(3)).toEqual({ retain: 3 });
  });
});

describe('compose', () => {
  it('apply(apply(S,a),b) === apply(S, compose(a,b))', () => {
    const S = text('hello');
    const a: OtDelta = { ops: [{ retain: 5 }, { insert: ' world' }] };
    const b: OtDelta = { ops: [{ retain: 1 }, { delete: 4 }, { insert: 'i' }] };
    expect(apply(apply(S, a), b)).toEqual(apply(S, compose(a, b)));
    expect(plain(apply(S, compose(a, b)))).toBe('hi world');
  });

  it('b 刪掉 a 剛插進去的字 → 兩者抵銷', () => {
    const a: OtDelta = { ops: [{ insert: 'xy' }] };
    const b: OtDelta = { ops: [{ delete: 2 }] };
    expect(normalizeDelta(compose(a, b))).toEqual({ ops: [] });
  });

  it('b 的 MarkPatch 會套到 a 插入的文字上', () => {
    const a: OtDelta = { ops: [{ insert: 'ab' }] };
    const b: OtDelta = { ops: [{ retain: 2, marks: { add: [{ t: 'b' }] } }] };
    expect(compose(a, b)).toEqual({ ops: [{ insert: 'ab', marks: [{ t: 'b' }] }] });
  });

  it('MarkPatch 的合成：後者覆蓋同 slot', () => {
    const a: OtDelta = { ops: [{ retain: 2, marks: { add: [{ t: 'link', href: 'x' }] } }] };
    const b: OtDelta = { ops: [{ retain: 2, marks: { add: [{ t: 'link', href: 'y' }] } }] };
    const S = text('ab');
    expect(apply(S, compose(a, b))).toEqual(apply(apply(S, a), b));
  });

  it('composeAll', () => {
    const S = text('abc');
    const ds: OtDelta[] = [
      { ops: [{ insert: 'x' }] },
      { ops: [{ retain: 2 }, { delete: 1 }] },
      { ops: [{ retain: 1 }, { insert: 'Y' }] },
    ];
    let step = S;
    for (const d of ds) step = apply(step, d);
    expect(apply(S, composeAll(ds))).toEqual(step);
  });
});

describe('invert', () => {
  it('insert 的反向是 delete', () => {
    const S = text('ab');
    const d: OtDelta = { ops: [{ retain: 1 }, { insert: 'XY' }] };
    expect(apply(apply(S, d), invert(d, S))).toEqual(normalize(S));
  });

  it('delete 的反向會把內容（含 atom 與格式）插回來', () => {
    const S = normalize([{ text: 'a', marks: [{ t: 'b' }] }, { atom: 'mention', data: { id: '9' } }, { text: 'c' }]);
    const d: OtDelta = { ops: [{ delete: 2 }] };
    expect(apply(apply(S, d), invert(d, S))).toEqual(S);
  });

  it('MarkPatch 的反向會逐節點還原原本的格式', () => {
    const S = normalize([{ text: 'a', marks: [{ t: 'b' }] }, { text: 'bc' }]);
    const d: OtDelta = { ops: [{ retain: 3, marks: { add: [{ t: 'b' }] } }] };
    const applied = apply(S, d);
    expect(applied).toEqual([{ text: 'abc', marks: [{ t: 'b' }] }]);
    expect(apply(applied, invert(d, S))).toEqual(S);
  });
});

describe('deltaFromDiff', () => {
  it('打字', () => {
    const before = text('hello');
    const after = text('hello world');
    expect(normalizeDelta(deltaFromDiff(before, after))).toEqual({
      ops: [{ retain: 5 }, { insert: ' world' }],
    });
  });

  it('刪字', () => {
    expect(normalizeDelta(deltaFromDiff(text('abcdef'), text('abef')))).toEqual({
      ops: [{ retain: 2 }, { delete: 2 }],
    });
  });

  it('round-trip：apply(before, deltaFromDiff(before, after)) === after', () => {
    const before = normalize([{ text: 'ab', marks: [{ t: 'b' }] }, { text: 'cd' }]);
    const after = normalize([{ text: 'a', marks: [{ t: 'b' }] }, { atom: 'date', data: { iso: 'x' } }, { text: 'd' }]);
    expect(apply(before, deltaFromDiff(before, after))).toEqual(after);
  });

  it('沒有差異 → 空 delta', () => {
    expect(deltaFromDiff(text('abc'), text('abc'))).toEqual({ ops: [] });
  });
});

describe('transform（手寫關鍵格）', () => {
  it('同位置 insert：priority 決定誰在前，且兩邊收斂', () => {
    const S = text('');
    const a: OtDelta = { ops: [{ insert: 'A' }] };
    const b: OtDelta = { ops: [{ insert: 'B' }] };
    const [a2, b2] = transformPair(a, b);
    expect(plain(apply(apply(S, a), b2))).toBe('BA');
    expect(plain(apply(apply(S, b), a2))).toBe('BA');
  });

  it('兩邊刪同一段 → 不會刪兩次', () => {
    const S = text('abcdef');
    const a: OtDelta = { ops: [{ retain: 1 }, { delete: 3 }] };
    const b: OtDelta = { ops: [{ retain: 2 }, { delete: 3 }] };
    const [a2, b2] = transformPair(a, b);
    expect(plain(apply(apply(S, a), b2))).toBe('af');
    expect(plain(apply(apply(S, b), a2))).toBe('af');
  });

  it('insert 在 delete 範圍內 → insert 存活', () => {
    const S = text('abcdef');
    const a: OtDelta = { ops: [{ retain: 3 }, { insert: 'X' }] };
    const b: OtDelta = { ops: [{ retain: 1 }, { delete: 4 }] };
    const [a2, b2] = transformPair(a, b);
    expect(plain(apply(apply(S, a), b2))).toBe('aXf');
    expect(plain(apply(apply(S, b), a2))).toBe('aXf');
  });

  it('mark 衝突：priority 低的那一邊讓位', () => {
    const S = text('abc');
    const a: OtDelta = { ops: [{ retain: 3, marks: { add: [{ t: 'link', href: 'x' }] } }] };
    const b: OtDelta = { ops: [{ retain: 3, marks: { add: [{ t: 'link', href: 'y' }] } }] };
    const [a2, b2] = transformPair(a, b);
    const left = apply(apply(S, a), b2);
    const right = apply(apply(S, b), a2);
    expect(left).toEqual(right);
    expect(left).toEqual([{ text: 'abc', marks: [{ t: 'link', href: 'y' }] }]);
  });

  it('transform 對空 delta 是恆等', () => {
    const a: OtDelta = { ops: [{ retain: 1 }, { insert: 'z' }] };
    expect(normalizeDelta(transform(a, { ops: [] }, false))).toEqual(normalizeDelta(a));
  });

  it('兩人同時編輯同一段文字，兩人的字都保留（M6 驗收標準）', () => {
    const S = text('kennote');
    const a: OtDelta = { ops: [{ retain: 7 }, { insert: ' 很好用' }] }; // A 在句尾加字
    const b: OtDelta = { ops: [{ insert: '我覺得 ' }] }; // B 在句首加字
    const [a2, b2] = transformPair(a, b);
    const left = plain(apply(apply(S, a), b2));
    const right = plain(apply(apply(S, b), a2));
    expect(left).toBe(right);
    expect(left).toBe('我覺得 kennote 很好用');
  });
});

describe('transformCursor', () => {
  it('別人在游標前面插字 → 游標跟著往後', () => {
    expect(transformCursor(5, { ops: [{ insert: 'abc' }] })).toBe(8);
  });

  it('別人正好在游標位置插字 → 游標留在原地', () => {
    expect(transformCursor(3, { ops: [{ retain: 3 }, { insert: 'XY' }] }, false)).toBe(3);
  });

  it('自己打的字 → 游標跑到後面', () => {
    expect(transformCursor(3, { ops: [{ retain: 3 }, { insert: 'XY' }] }, true)).toBe(5);
  });

  it('刪除範圍內的游標會被收到起點', () => {
    const d: OtDelta = { ops: [{ retain: 2 }, { delete: 3 }] };
    expect(transformCursor(1, d)).toBe(1);
    expect(transformCursor(3, d)).toBe(2);
    expect(transformCursor(5, d)).toBe(2);
    expect(transformCursor(6, d)).toBe(3);
  });

  it('transformRange', () => {
    expect(transformRange([1, 4], { ops: [{ insert: 'ab' }] })).toEqual([3, 6]);
  });
});
