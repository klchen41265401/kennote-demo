/**
 * Delta 代數：apply / compose / invert / deltaFromDiff / transformCursor（04 §6.6.1–§6.6.2）。
 *
 * 全部是零副作用純函式，可在 Node 完整測試；`transform` 住在隔壁的 transform.ts。
 *
 * 單位一律是 **code point，atom 佔 1**，與 `text/richtext.ts` 的 offset 完全對齊，
 * 所以 `slice` / `length` 可以直接拿來用，不必另寫一套。
 */
import type { InlineNode, Mark, RichText } from '../model/types.js';
import { isAtom, isSpan } from '../model/types.js';
import { codePointLength, sliceByCodePoint } from '../text/offset.js';
import { addMark, markSlot, normalizeMarks, removeMark } from '../text/marks.js';
import { length as rtLength, nodeLength, normalize, slice } from '../text/richtext.js';
import { diffRichText } from '../text/diff.js';
import {
  ATOM_PLACEHOLDER,
  EMPTY_DELTA,
  isDelete,
  isInsert,
  isRetain,
  type MarkPatch,
  type OtDelta,
  type OtInsertOp,
  type OtTextOp,
} from './types.js';

/* ────────────────────────────────────────────────────────────
 * 基本工具
 * ──────────────────────────────────────────────────────────── */

/** 單一 op 消耗／產生的長度。 */
export function opLength(op: OtTextOp): number {
  if (isRetain(op)) return op.retain;
  if (isDelete(op)) return op.delete;
  return codePointLength(op.insert);
}

/** delta 套用**之前**需要的文件長度（retain + delete）。 */
export function baseLength(delta: OtDelta): number {
  let n = 0;
  for (const op of delta.ops) {
    if (isRetain(op)) n += op.retain;
    else if (isDelete(op)) n += op.delete;
  }
  return n;
}

/** delta 套用**之後**的長度貢獻（retain + insert）。 */
export function deltaLength(delta: OtDelta): number {
  let n = 0;
  for (const op of delta.ops) {
    if (isRetain(op)) n += op.retain;
    else if (isInsert(op)) n += codePointLength(op.insert);
  }
  return n;
}

/** 這個 delta 是不是 no-op（套用後文件完全不變）。 */
export function isNoop(delta: OtDelta): boolean {
  return normalizeDelta(delta).ops.length === 0;
}

function markPatchIsEmpty(patch: MarkPatch | undefined): boolean {
  if (!patch) return true;
  return (patch.add?.length ?? 0) === 0 && (patch.remove?.length ?? 0) === 0;
}

function canonicalPatch(patch: MarkPatch | undefined): MarkPatch | undefined {
  if (markPatchIsEmpty(patch)) return undefined;
  const out: MarkPatch = {};
  const add = normalizeMarks(patch!.add);
  const remove = normalizeMarks(patch!.remove);
  if (add) out.add = add;
  if (remove) out.remove = remove;
  return markPatchIsEmpty(out) ? undefined : out;
}

function patchEquals(a: MarkPatch | undefined, b: MarkPatch | undefined): boolean {
  return JSON.stringify(canonicalPatch(a) ?? null) === JSON.stringify(canonicalPatch(b) ?? null);
}

function marksEqualJson(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  return JSON.stringify(normalizeMarks(a) ?? null) === JSON.stringify(normalizeMarks(b) ?? null);
}

/** patch 觸碰到的 slot 集合（add 與 remove 都算）。 */
export function patchSlots(patch: MarkPatch | undefined): Set<string> {
  const out = new Set<string>();
  if (!patch) return out;
  for (const m of patch.add ?? []) out.add(markSlot(m));
  for (const m of patch.remove ?? []) out.add(markSlot(m));
  return out;
}

/** 把 MarkPatch 套到一組 marks 上（remove 先、add 後）。 */
export function applyMarkPatch(marks: Mark[] | undefined, patch: MarkPatch | undefined): Mark[] | undefined {
  if (!patch) return normalizeMarks(marks);
  let next = normalizeMarks(marks);
  for (const m of patch.remove ?? []) next = removeMark(next, m);
  for (const m of patch.add ?? []) next = addMark(next, m);
  return next;
}

function withMarks(node: InlineNode, marks: Mark[] | undefined): InlineNode {
  const n = normalizeMarks(marks);
  if (isSpan(node)) return n ? { text: node.text, marks: n } : { text: node.text };
  return n ? { atom: node.atom, data: node.data, marks: n } : { atom: node.atom, data: node.data };
}

/** 把一個 inline node 變成對應的 insert op（invert 刪除時用）。 */
export function insertOpFromNode(node: InlineNode): OtInsertOp {
  const marks = normalizeMarks(node.marks);
  if (isAtom(node)) {
    const op: OtInsertOp = { insert: ATOM_PLACEHOLDER, atom: { atom: node.atom, data: node.data } };
    if (marks) op.marks = marks;
    return op;
  }
  const op: OtInsertOp = { insert: node.text };
  if (marks) op.marks = marks;
  return op;
}

/** insert op → 實際插入的 inline 節點。 */
export function nodeFromInsertOp(op: OtInsertOp): InlineNode {
  const marks = normalizeMarks(op.marks);
  if (op.atom) {
    return marks
      ? { atom: op.atom.atom, data: op.atom.data, marks }
      : { atom: op.atom.atom, data: op.atom.data };
  }
  return marks ? { text: op.insert, marks } : { text: op.insert };
}

/* ────────────────────────────────────────────────────────────
 * DeltaBuilder —— 帶正規化的 push（Quill 的規則）
 * ──────────────────────────────────────────────────────────── */

/**
 * push 時就地正規化：
 *  1. 合併相鄰同類同屬性的 op
 *  2. **insert 永遠排在同位置的 delete 前面**（canonical form，
 *     否則 `[delete 1, insert 'a']` 與 `[insert 'a', delete 1]` 會是兩個表示法）
 */
export class DeltaBuilder {
  private readonly ops: OtTextOp[] = [];

  push(op: OtTextOp): this {
    if (opLength(op) <= 0) return this;
    let index = this.ops.length;
    let last = this.ops[index - 1];

    if (last) {
      if (isDelete(op) && isDelete(last)) {
        this.ops[index - 1] = { delete: last.delete + op.delete };
        return this;
      }
      // delete 後面接 insert → 把 insert 插到 delete 前面
      if (isDelete(last) && isInsert(op)) {
        index -= 1;
        last = this.ops[index - 1];
        if (!last) {
          this.ops.unshift(op);
          return this;
        }
      }
      if (last) {
        if (
          isInsert(op) &&
          isInsert(last) &&
          !op.atom &&
          !last.atom &&
          marksEqualJson(op.marks, last.marks)
        ) {
          const merged: OtInsertOp = { insert: last.insert + op.insert };
          const marks = normalizeMarks(op.marks);
          if (marks) merged.marks = marks;
          this.ops[index - 1] = merged;
          return this;
        }
        if (isRetain(op) && isRetain(last) && patchEquals(op.marks, last.marks)) {
          const merged: OtTextOp = { retain: last.retain + op.retain };
          const patch = canonicalPatch(op.marks);
          if (patch) merged.marks = patch;
          this.ops[index - 1] = merged;
          return this;
        }
      }
    }

    if (index === this.ops.length) this.ops.push(op);
    else this.ops.splice(index, 0, op);
    return this;
  }

  pushRetain(n: number, patch?: MarkPatch): this {
    if (n <= 0) return this;
    const canonical = canonicalPatch(patch);
    return this.push(canonical ? { retain: n, marks: canonical } : { retain: n });
  }

  pushDelete(n: number): this {
    return n > 0 ? this.push({ delete: n }) : this;
  }

  /** 去掉結尾「沒有格式變更」的 retain（它們對結果沒有影響）。 */
  build(): OtDelta {
    const ops = this.ops.slice();
    while (ops.length > 0) {
      const last = ops[ops.length - 1]!;
      if (isRetain(last) && !last.marks) ops.pop();
      else break;
    }
    return { ops };
  }
}

/** 把任意 delta 重建成 canonical form。 */
export function normalizeDelta(delta: OtDelta): OtDelta {
  const builder = new DeltaBuilder();
  for (const op of delta.ops) {
    if (isRetain(op)) builder.pushRetain(op.retain, op.marks);
    else if (isDelete(op)) builder.pushDelete(op.delete);
    else if (op.insert.length > 0) {
      const next: OtInsertOp = { insert: op.insert };
      const marks = normalizeMarks(op.marks);
      if (marks) next.marks = marks;
      if (op.atom) next.atom = { atom: op.atom.atom, data: op.atom.data };
      builder.push(next);
    }
  }
  return builder.build();
}

export function deltaEquals(a: OtDelta, b: OtDelta): boolean {
  return JSON.stringify(normalizeDelta(a)) === JSON.stringify(normalizeDelta(b));
}

/* ────────────────────────────────────────────────────────────
 * OpIterator —— transform / compose 的共同骨架
 * ──────────────────────────────────────────────────────────── */

export type OpKind = 'retain' | 'insert' | 'delete' | 'none';

export class OpIterator {
  private index = 0;
  /** 目前這個 op 已經被消耗掉多少（code point） */
  private offset = 0;

  constructor(private readonly ops: readonly OtTextOp[]) {}

  hasNext(): boolean {
    return this.peekLength() < Infinity;
  }

  peek(): OtTextOp | undefined {
    return this.ops[this.index];
  }

  peekKind(): OpKind {
    const op = this.ops[this.index];
    if (!op) return 'none';
    if (isRetain(op)) return 'retain';
    if (isDelete(op)) return 'delete';
    return 'insert';
  }

  peekIsInsert(): boolean {
    return this.peekKind() === 'insert';
  }

  /** 目前 op 還剩多少長度；已經走完時回傳 Infinity（Quill 的慣例）。 */
  peekLength(): number {
    const op = this.ops[this.index];
    if (!op) return Infinity;
    return opLength(op) - this.offset;
  }

  /**
   * 取出最多 `length` 長度的 op。
   * 已經走完時回傳一個「虛擬 retain」，讓呼叫端不必到處寫 if。
   */
  next(length = Infinity): OtTextOp {
    const op = this.ops[this.index];
    if (!op) return { retain: length === Infinity ? Infinity : length };
    const opLen = opLength(op);
    const take = Math.min(length, opLen - this.offset);
    const start = this.offset;
    if (take >= opLen - this.offset) {
      this.index += 1;
      this.offset = 0;
    } else {
      this.offset += take;
    }
    if (isDelete(op)) return { delete: take };
    if (isRetain(op)) return op.marks ? { retain: take, marks: op.marks } : { retain: take };
    // insert：依 code point 切片（atom 的 insert 長度固定是 1，永遠不會被切開）
    const next: OtInsertOp = { insert: sliceByCodePoint(op.insert, start, start + take) };
    if (op.marks) next.marks = op.marks;
    if (op.atom) next.atom = op.atom;
    return next;
  }

  /** 剩下還沒被取走的 op。 */
  rest(): OtTextOp[] {
    if (!this.hasNext()) return [];
    if (this.offset === 0) return this.ops.slice(this.index);
    const partial = this.next();
    return [partial, ...this.ops.slice(this.index)];
  }
}

/* ────────────────────────────────────────────────────────────
 * apply
 * ──────────────────────────────────────────────────────────── */

/** 把 delta 套到 RichText 上。結果一定是 normalize 過的 canonical form。 */
export function apply(rt: RichText, delta: OtDelta): RichText {
  const source = normalize(rt);
  const total = rtLength(source);
  const out: InlineNode[] = [];
  let pos = 0;

  for (const op of delta.ops) {
    if (isInsert(op)) {
      if (op.insert.length > 0) out.push(nodeFromInsertOp(op));
      continue;
    }
    if (isRetain(op)) {
      const end = Math.min(pos + op.retain, total);
      if (end > pos) {
        const seg = slice(source, pos, end);
        if (op.marks) for (const node of seg) out.push(withMarks(node, applyMarkPatch(node.marks, op.marks)));
        else out.push(...seg);
      }
      pos = end;
      continue;
    }
    pos = Math.min(pos + op.delete, total);
  }
  if (pos < total) out.push(...slice(source, pos, total));
  return normalize(out);
}

/* ────────────────────────────────────────────────────────────
 * compose
 * ──────────────────────────────────────────────────────────── */

/** 把兩個 MarkPatch 合成一個（先 a 後 b）。 */
export function composeMarkPatch(
  a: MarkPatch | undefined,
  b: MarkPatch | undefined,
): MarkPatch | undefined {
  if (markPatchIsEmpty(a)) return canonicalPatch(b);
  if (markPatchIsEmpty(b)) return canonicalPatch(a);
  const bSlots = patchSlots(b);
  const remove = [...(a!.remove ?? []), ...(b!.remove ?? [])];
  // a 的 add 若被 b 再次碰到（覆蓋或移除），就不必保留
  const add = [...(a!.add ?? []).filter((m) => !bSlots.has(markSlot(m))), ...(b!.add ?? [])];
  return canonicalPatch({ add, remove });
}

/**
 * 把兩個「前後相接」的 delta 合併成一個：
 *     apply(apply(S, a), b) === apply(S, compose(a, b))
 */
export function compose(a: OtDelta, b: OtDelta): OtDelta {
  const ia = new OpIterator(a.ops);
  const ib = new OpIterator(b.ops);
  const out = new DeltaBuilder();

  while (ia.hasNext() || ib.hasNext()) {
    // b 的 insert 是憑空長出來的，直接照抄
    if (ib.peekIsInsert()) {
      out.push(ib.next());
      continue;
    }
    // a 的 delete 發生在 b 看得到的文件之前，b 無從影響
    if (ia.peekKind() === 'delete') {
      out.push(ia.next());
      continue;
    }
    const len = Math.min(ia.peekLength(), ib.peekLength());
    const opA = ia.next(len);
    const opB = ib.next(len);

    if (isRetain(opB)) {
      if (isRetain(opA)) {
        out.pushRetain(len, composeMarkPatch(opA.marks, opB.marks));
      } else if (isInsert(opA)) {
        const next: OtInsertOp = { insert: opA.insert };
        const marks = applyMarkPatch(opA.marks, opB.marks);
        if (marks) next.marks = marks;
        if (opA.atom) next.atom = opA.atom;
        out.push(next);
      }
      continue;
    }
    if (isDelete(opB)) {
      // a 插進去的字被 b 刪掉 → 兩者互相抵銷，什麼都不用留
      if (isRetain(opA)) out.pushDelete(len);
      continue;
    }
  }
  return out.build();
}

/** compose 多個 delta（左結合）。 */
export function composeAll(deltas: readonly OtDelta[]): OtDelta {
  let acc: OtDelta = EMPTY_DELTA;
  for (const d of deltas) acc = compose(acc, d);
  return normalizeDelta(acc);
}

/* ────────────────────────────────────────────────────────────
 * invert
 * ──────────────────────────────────────────────────────────── */

/** 產生「把 patch 還原回 original marks」的反向 patch。 */
function invertMarkPatch(patch: MarkPatch, original: Mark[] | undefined): MarkPatch | undefined {
  const slots = patchSlots(patch);
  if (slots.size === 0) return undefined;
  const bySlot = new Map<string, Mark>();
  for (const m of normalizeMarks(original) ?? []) bySlot.set(markSlot(m), m);
  const add: Mark[] = [];
  const remove: Mark[] = [];
  for (const slot of slots) {
    const before = bySlot.get(slot);
    if (before) add.push(before);
    else {
      // 原本沒有這個 slot → 反向操作是「移除」，用 patch 裡的 mark 當代表
      const rep =
        (patch.add ?? []).find((m) => markSlot(m) === slot) ??
        (patch.remove ?? []).find((m) => markSlot(m) === slot);
      if (rep) remove.push(rep);
    }
  }
  return canonicalPatch({ add, remove });
}

/**
 * 產生反向 delta：`apply(apply(base, d), invert(d, base)) === normalize(base)`。
 * `base` 必須是 d 套用**之前**的內容。
 */
export function invert(delta: OtDelta, base: RichText): OtDelta {
  const source = normalize(base);
  const total = rtLength(source);
  const out = new DeltaBuilder();
  let pos = 0;

  for (const op of delta.ops) {
    if (isInsert(op)) {
      out.pushDelete(codePointLength(op.insert));
      continue;
    }
    if (isRetain(op)) {
      if (!op.marks) {
        out.pushRetain(op.retain);
        pos += op.retain;
        continue;
      }
      const end = Math.min(pos + op.retain, total);
      // marks 在範圍內可能不一致 → 依 base 的節點邊界逐段還原
      for (const node of slice(source, pos, end)) {
        out.pushRetain(nodeLength(node), invertMarkPatch(op.marks, node.marks));
      }
      if (pos + op.retain > end) out.pushRetain(pos + op.retain - end);
      pos += op.retain;
      continue;
    }
    // delete → 把原本的內容插回去
    const end = Math.min(pos + op.delete, total);
    for (const node of slice(source, pos, end)) out.push(insertOpFromNode(node));
    pos += op.delete;
  }
  return out.build();
}

/* ────────────────────────────────────────────────────────────
 * deltaFromDiff
 * ──────────────────────────────────────────────────────────── */

/**
 * 從「編輯前 / 編輯後」的兩段 RichText 算出最小 delta（用 text/diff.ts 的共同前後綴）。
 *
 * 這是 LWW 的 `block.update{content}` 升級成 OT `text.delta` 的轉接點：
 * 編輯器內部仍然產生整段新內容，這裡把它壓縮成 retain/insert/delete。
 */
export function deltaFromDiff(before: RichText, after: RichText): OtDelta {
  const diff = diffRichText(before, after);
  if (!diff) return EMPTY_DELTA;
  const out = new DeltaBuilder();
  out.pushRetain(diff.from);
  for (const node of diff.insert) out.push(insertOpFromNode(node));
  out.pushDelete(diff.to - diff.from);
  return out.build();
}

/* ────────────────────────────────────────────────────────────
 * 游標 transform
 * ──────────────────────────────────────────────────────────── */

/**
 * 把一個 offset 推到 delta 套用之後的位置。
 *
 * `isOwn = true`：這個 delta 是自己打的字 → 游標要跟著跑到插入內容的**後面**。
 * `isOwn = false`：別人在我游標位置插字 → 我的游標留在原地（不被推走）。
 *
 * 性質：對固定的 delta，`offset` 遞增 ⇒ 回傳值單調不減。
 */
export function transformCursor(offset: number, delta: OtDelta, isOwn = false): number {
  let index = 0;
  let out = Math.max(0, offset);
  const target = Math.max(0, offset);

  for (const op of delta.ops) {
    if (isInsert(op)) {
      if (index < target || (index === target && isOwn)) out += codePointLength(op.insert);
    } else if (isRetain(op)) {
      index += op.retain;
    } else {
      if (target > index) out -= Math.min(op.delete, target - index);
      index += op.delete;
    }
    if (index > target) break;
  }
  return Math.max(0, out);
}

/** 一次 transform 一個 [anchor, focus] 選取範圍。 */
export function transformRange(
  range: [number, number],
  delta: OtDelta,
  isOwn = false,
): [number, number] {
  return [transformCursor(range[0], delta, isOwn), transformCursor(range[1], delta, isOwn)];
}
