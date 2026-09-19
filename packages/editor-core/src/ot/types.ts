/**
 * OT（Operational Transformation）的型別骨架。
 *
 * M2-A 不實作 transform：這一層在 M6 才會啟用。
 * 現在先把型別與函式簽章定下來，讓 editor-core 的其他部分
 * （history 的 rebase、applyRemote 的 selection 修正）有明確的接點可以對齊。
 */
import type { Operation, TextDelta, TextDeltaOp } from '../transaction/operation.js';

export type { Operation, TextDelta, TextDeltaOp };

export type TransformSide = 'left' | 'right';

/**
 * transform(a, b, side)：把 a 變成「在 b 已經套用之後」仍然表達相同意圖的 a'。
 * M6 實作，並用 fast-check 驗證 §6.6.5 的三條性質（TP1/TP2/收斂性）。
 */
export function transform(_a: Operation[], _b: Operation[], _side: TransformSide): Operation[] {
  throw new Error('[editor-core] OT transform 尚未實作（M6）');
}

/** delta 的長度（retain + insert）。 */
export function deltaLength(delta: TextDelta): number {
  let n = 0;
  for (const op of delta.ops) {
    if ('retain' in op) n += op.retain;
    else if ('insert' in op) n += [...op.insert].length;
  }
  return n;
}

/** 把 delta 正規化（合併相鄰的同類 op、去掉結尾多餘的 retain）。 */
export function normalizeDelta(delta: TextDelta): TextDelta {
  const ops: TextDeltaOp[] = [];
  for (const op of delta.ops) {
    const prev = ops[ops.length - 1];
    if (prev && 'retain' in prev && 'retain' in op) {
      ops[ops.length - 1] = { retain: prev.retain + op.retain };
      continue;
    }
    if (prev && 'delete' in prev && 'delete' in op) {
      ops[ops.length - 1] = { delete: prev.delete + op.delete };
      continue;
    }
    if (prev && 'insert' in prev && 'insert' in op && JSON.stringify(prev.marks) === JSON.stringify(op.marks)) {
      const merged: TextDeltaOp = op.marks ? { insert: prev.insert + op.insert, marks: op.marks } : { insert: prev.insert + op.insert };
      ops[ops.length - 1] = merged;
      continue;
    }
    ops.push(op);
  }
  while (ops.length > 0) {
    const last = ops[ops.length - 1]!;
    if ('retain' in last) ops.pop();
    else break;
  }
  return { ops };
}
