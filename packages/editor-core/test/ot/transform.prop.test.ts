/**
 * OT 的 property-based test（04 §6.6.5、§9.3、§8 M6 驗收標準）。
 *
 * > OT 極易寫錯，而且錯誤是「偶爾才出現、難以重現」的那種。
 * > 單元測試不夠，必須用 property-based testing。
 *
 * **每一條性質都跑 20,000 次**（規格明文要求）。
 * 比較前一律 normalize —— 同一份語義內容必須先化成唯一表示，否則會誤判。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  apply,
  baseLength,
  compose,
  deltaFromDiff,
  invert,
  transformCursor,
} from '../../src/ot/delta.js';
import { transform } from '../../src/ot/transform.js';
import { length as rtLength, normalize } from '../../src/text/richtext.js';
import { arbRichText, arbSteps, buildDelta, show } from './arbitraries.js';

/** 規格要求的次數。CI 想跑快一點可以用 OT_PROP_RUNS 覆寫，預設一定是 20000。 */
const NUM_RUNS = Number(process.env.OT_PROP_RUNS ?? 20_000);
const TIMEOUT = 600_000;

const fcOptions = { numRuns: NUM_RUNS, verbose: false } as const;

describe(`OT property-based test（各 ${NUM_RUNS.toLocaleString('en-US')} 次）`, () => {
  it(
    'TP1：兩邊 transform 之後收斂到相同結果',
    () => {
      fc.assert(
        fc.property(arbRichText(), arbSteps(), arbSteps(), (doc, stepsA, stepsB) => {
          const a = buildDelta(doc, stepsA);
          const b = buildDelta(doc, stepsB);
          const aPrime = transform(a, b, false); // b 先，a 讓位
          const bPrime = transform(b, a, true); // b 先，b 優先
          const left = apply(apply(doc, a), bPrime);
          const right = apply(apply(doc, b), aPrime);
          expect(show(left)).toEqual(show(right));
        }),
        fcOptions,
      );
    },
    TIMEOUT,
  );

  it(
    'compose：apply(apply(S, a), b) === apply(S, compose(a, b))',
    () => {
      fc.assert(
        fc.property(arbRichText(), arbSteps(), arbSteps(), (doc, stepsA, stepsB) => {
          const a = buildDelta(doc, stepsA);
          const mid = apply(doc, a);
          const b = buildDelta(mid, stepsB);
          expect(show(apply(doc, compose(a, b)))).toEqual(show(apply(mid, b)));
        }),
        fcOptions,
      );
    },
    TIMEOUT,
  );

  it(
    'compose 結合律：compose(compose(a, b), c) === compose(a, compose(b, c))',
    () => {
      fc.assert(
        fc.property(
          arbRichText(),
          arbSteps(3),
          arbSteps(3),
          arbSteps(3),
          (doc, stepsA, stepsB, stepsC) => {
            const a = buildDelta(doc, stepsA);
            const after1 = apply(doc, a);
            const b = buildDelta(after1, stepsB);
            const after2 = apply(after1, b);
            const c = buildDelta(after2, stepsC);
            const left = apply(doc, compose(compose(a, b), c));
            const right = apply(doc, compose(a, compose(b, c)));
            expect(show(left)).toEqual(show(right));
            expect(show(left)).toEqual(show(apply(after2, c)));
          },
        ),
        fcOptions,
      );
    },
    TIMEOUT,
  );

  it(
    'invert 可還原：apply(apply(S, d), invert(d, S)) === S',
    () => {
      fc.assert(
        fc.property(arbRichText(), arbSteps(), (doc, steps) => {
          const d = buildDelta(doc, steps);
          expect(show(apply(apply(doc, d), invert(d, doc)))).toEqual(show(doc));
        }),
        fcOptions,
      );
    },
    TIMEOUT,
  );

  it(
    'deltaFromDiff round-trip：apply(before, deltaFromDiff(before, after)) === after',
    () => {
      fc.assert(
        fc.property(arbRichText(), arbRichText(), (before, after) => {
          expect(show(apply(before, deltaFromDiff(before, after)))).toEqual(show(after));
        }),
        fcOptions,
      );
    },
    TIMEOUT,
  );

  it(
    'cursor transform 單調性 + 值域正確',
    () => {
      fc.assert(
        fc.property(
          arbRichText(),
          arbSteps(),
          fc.nat({ max: 20 }),
          fc.nat({ max: 20 }),
          fc.boolean(),
          (doc, steps, x, y, isOwn) => {
            const d = buildDelta(doc, steps);
            const total = rtLength(normalize(doc));
            const [lo, hi] = [x % (total + 1), y % (total + 1)].sort((m, n) => m - n) as [number, number];
            const a = transformCursor(lo, d, isOwn);
            const b = transformCursor(hi, d, isOwn);
            // 單調不減
            expect(a).toBeLessThanOrEqual(b);
            // 結果一定落在新文件的範圍內
            const nextLen = rtLength(apply(doc, d));
            expect(a).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThanOrEqual(nextLen);
          },
        ),
        fcOptions,
      );
    },
    TIMEOUT,
  );

  it(
    'transform 出來的 delta 對新文件是合法的（retain + delete <= 新長度）',
    () => {
      fc.assert(
        fc.property(arbRichText(), arbSteps(), arbSteps(), (doc, stepsA, stepsB) => {
          const a = buildDelta(doc, stepsA);
          const b = buildDelta(doc, stepsB);
          const afterB = apply(doc, b);
          const aPrime = transform(a, b, false);
          // a' 的基底長度不能超過「b 已經套用之後」的文件長度，否則就是 transform 算錯了
          expect(baseLength(aPrime)).toBeLessThanOrEqual(rtLength(afterB));
          // 且 transform 對空 delta 必須是恆等
          expect(show(apply(doc, transform(a, { ops: [] }, false)))).toEqual(show(apply(doc, a)));
        }),
        fcOptions,
      );
    },
    TIMEOUT,
  );
});
