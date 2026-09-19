/**
 * OT property-based test 的資料產生器（04 §6.6.5、§9.3）。
 *
 * 原則：**小而密**。字母表只有 4 個字、mark 只有 5 種、文件長度 0–12，
 * 這樣 2 萬次隨機測試才會真的撞到邊界（同位置 insert、刪到同一段、mark 打架），
 * 而不是每次都產生一堆互不相干的操作。
 */
import fc from 'fast-check';
import type { InlineAtom, InlineNode, Mark, RichText } from '../../src/model/types.js';
import { length as rtLength, normalize } from '../../src/text/richtext.js';
import type { MarkPatch, OtDelta, OtTextOp } from '../../src/ot/types.js';

export const ALPHABET = ['a', 'b', 'c', 'ü'] as const;

export const MARKS: Mark[] = [
  { t: 'b' },
  { t: 'i' },
  { t: 'code' },
  { t: 'link', href: 'x' },
  { t: 'link', href: 'y' },
  { t: 'color', fg: 'red' },
];

export function arbMark(): fc.Arbitrary<Mark> {
  return fc.constantFrom(...MARKS);
}

export function arbMarks(): fc.Arbitrary<Mark[] | undefined> {
  return fc.oneof(
    { weight: 3, arbitrary: fc.constant(undefined) },
    { weight: 2, arbitrary: fc.uniqueArray(arbMark(), { maxLength: 2 }) },
  );
}

export function arbText(): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...ALPHABET), { minLength: 1, maxLength: 4 })
    .map((cs) => cs.join(''));
}

export function arbAtom(): fc.Arbitrary<InlineAtom> {
  return fc
    .tuple(fc.constantFrom('mention' as const, 'date' as const), fc.constantFrom('1', '2'))
    .map(([atom, id]) => ({ atom, data: { id } }));
}

export function arbNode(): fc.Arbitrary<InlineNode> {
  return fc.oneof(
    {
      weight: 5,
      arbitrary: fc
        .tuple(arbText(), arbMarks())
        .map(([text, marks]) => (marks && marks.length > 0 ? { text, marks } : { text })),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(arbAtom(), arbMarks())
        .map(([atom, marks]) =>
          marks && marks.length > 0 ? { ...atom, marks } : atom,
        ) as fc.Arbitrary<InlineNode>,
    },
  );
}

export function arbRichText(): fc.Arbitrary<RichText> {
  return fc.array(arbNode(), { maxLength: 4 }).map((nodes) => normalize(nodes));
}

export function arbMarkPatch(): fc.Arbitrary<MarkPatch> {
  return fc
    .tuple(
      fc.uniqueArray(arbMark(), { maxLength: 2 }),
      fc.uniqueArray(arbMark(), { maxLength: 1 }),
    )
    .map(([add, remove]) => {
      const patch: MarkPatch = {};
      if (add.length > 0) patch.add = add;
      if (remove.length > 0) patch.remove = remove;
      return patch;
    })
    .filter((p) => (p.add?.length ?? 0) + (p.remove?.length ?? 0) > 0);
}

/** delta 產生器的「指令」：真正的長度在 buildDelta 裡依文件長度 clamp。 */
export type DeltaStep =
  | { k: 'retain'; n: number }
  | { k: 'retainMark'; n: number; patch: MarkPatch }
  | { k: 'delete'; n: number }
  | { k: 'insert'; text: string; marks: Mark[] | undefined }
  | { k: 'insertAtom'; atom: InlineAtom; marks: Mark[] | undefined };

export function arbStep(): fc.Arbitrary<DeltaStep> {
  return fc.oneof(
    { weight: 4, arbitrary: fc.integer({ min: 1, max: 5 }).map((n) => ({ k: 'retain' as const, n })) },
    {
      weight: 2,
      arbitrary: fc
        .tuple(fc.integer({ min: 1, max: 5 }), arbMarkPatch())
        .map(([n, patch]) => ({ k: 'retainMark' as const, n, patch })),
    },
    { weight: 3, arbitrary: fc.integer({ min: 1, max: 4 }).map((n) => ({ k: 'delete' as const, n })) },
    {
      weight: 4,
      arbitrary: fc
        .tuple(arbText(), arbMarks())
        .map(([text, marks]) => ({ k: 'insert' as const, text, marks })),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(arbAtom(), arbMarks())
        .map(([atom, marks]) => ({ k: 'insertAtom' as const, atom, marks })),
    },
  );
}

export function arbSteps(maxLength = 5): fc.Arbitrary<DeltaStep[]> {
  return fc.array(arbStep(), { maxLength });
}

/**
 * 把「指令」變成一個**對 `rt` 合法**的 delta（retain + delete 總和不超過文件長度）。
 * 刻意不經過 DeltaBuilder，讓 transform / compose 也會收到非正規化的輸入。
 */
export function buildDelta(rt: RichText, steps: readonly DeltaStep[]): OtDelta {
  const total = rtLength(rt);
  const ops: OtTextOp[] = [];
  let pos = 0;
  for (const step of steps) {
    switch (step.k) {
      case 'insert':
        if (step.text.length > 0) {
          ops.push(step.marks && step.marks.length > 0 ? { insert: step.text, marks: step.marks } : { insert: step.text });
        }
        break;
      case 'insertAtom':
        ops.push(
          step.marks && step.marks.length > 0
            ? { insert: '￼', atom: step.atom, marks: step.marks }
            : { insert: '￼', atom: step.atom },
        );
        break;
      case 'retain': {
        const n = Math.min(step.n, total - pos);
        if (n > 0) {
          ops.push({ retain: n });
          pos += n;
        }
        break;
      }
      case 'retainMark': {
        const n = Math.min(step.n, total - pos);
        if (n > 0) {
          ops.push({ retain: n, marks: step.patch });
          pos += n;
        }
        break;
      }
      case 'delete': {
        const n = Math.min(step.n, total - pos);
        if (n > 0) {
          ops.push({ delete: n });
          pos += n;
        }
        break;
      }
    }
  }
  return { ops };
}

/** 比較兩段 RichText 是否語義相等（一定先 normalize，§6.6.5 的 ⭐ 提醒）。 */
export function sameRichText(a: RichText, b: RichText): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export function show(rt: RichText): string {
  return JSON.stringify(normalize(rt));
}

/** 簡單、可重現的 PRNG（模糊測試模擬器用，不依賴 Math.random）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
