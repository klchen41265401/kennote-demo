/**
 * OT 的核心：`transform`（04 §6.6.2）。
 *
 * ────────────────────────────────────────────────────────────
 * TP1（也是我們**唯一**需要的性質）
 *
 *   transform(a, b, false)  →  a'   （b 先、a 後）
 *   transform(b, a, true)   →  b'   （b 先、a 後）
 *
 *   apply(apply(S, a), transform(b, a, true)) === apply(apply(S, b), transform(a, b, false))
 *
 * 因為我們有**中央權威伺服器 + 全序列化**，不需要 TP2（OT 惡名昭彰的難點）。
 *
 * `priority` 的語義：`transform(x, y, priority)` 產生 x'，
 * `priority === true` 代表「x 的 insert 排在 y 的 insert 前面、x 的格式覆蓋 y 的格式」。
 * 呼叫端**必須成對使用**：一邊 true、一邊 false，否則不會收斂。
 *
 * 本專案的固定約定（伺服器與客戶端都照這個寫，才不會兩邊算出不同結果）：
 *   **已經被伺服器套用的那一邊優先**（priority = true），
 *   還在飛行中的本地 delta 讓位（priority = false）。
 * ────────────────────────────────────────────────────────────
 */
import { markSlot } from '../text/marks.js';
import { DeltaBuilder, OpIterator, opLength, patchSlots } from './delta.js';
import { isDelete, isInsert, isRetain, type MarkPatch, type OtDelta } from './types.js';

/**
 * retain vs retain 時的 mark patch 轉換。
 * priority = false（自己讓位）時，把「對方也碰過的 slot」從自己的 patch 拿掉。
 */
export function transformMarkPatch(
  mine: MarkPatch | undefined,
  theirs: MarkPatch | undefined,
  priority: boolean,
): MarkPatch | undefined {
  if (!mine) return undefined;
  if (priority || !theirs) return mine;
  const taken = patchSlots(theirs);
  if (taken.size === 0) return mine;
  const add = (mine.add ?? []).filter((m) => !taken.has(markSlot(m)));
  const remove = (mine.remove ?? []).filter((m) => !taken.has(markSlot(m)));
  if (add.length === 0 && remove.length === 0) return undefined;
  const out: MarkPatch = {};
  if (add.length > 0) out.add = add;
  if (remove.length > 0) out.remove = remove;
  return out;
}

/**
 * 把 a 轉換成「b 已經套用之後」仍然表達相同意圖的 a'。
 *
 * a 與 b 必須基於**同一個**文件版本。
 */
export function transform(a: OtDelta, b: OtDelta, priority: boolean): OtDelta {
  const ia = new OpIterator(a.ops);
  const ib = new OpIterator(b.ops);
  const out = new DeltaBuilder();

  while (ia.hasNext() || ib.hasNext()) {
    // ── insert vs insert：同位置衝突，用 priority 決勝（穩定、確定性）──
    if (ia.peekIsInsert() && (priority || !ib.peekIsInsert())) {
      out.push(ia.next());
      continue;
    }
    // ── 對方插了字：我要先 retain 過去 ──
    if (ib.peekIsInsert()) {
      out.pushRetain(opLength(ib.next()));
      continue;
    }

    const len = Math.min(ia.peekLength(), ib.peekLength());
    const opA = ia.next(len);
    const opB = ib.next(len);

    if (isDelete(opB)) {
      // 對方把這段刪掉了 → 我對這段的 retain / delete 通通失效
      continue;
    }
    if (isDelete(opA)) {
      out.pushDelete(len);
      continue;
    }
    if (isRetain(opA) && isRetain(opB)) {
      out.pushRetain(len, transformMarkPatch(opA.marks, opB.marks, priority));
      continue;
    }
    // 走不到這裡：insert 已在迴圈開頭處理完
    /* c8 ignore next */
    if (isInsert(opA)) out.push(opA);
  }
  return out.build();
}

/**
 * 兩邊一起算（規格 §6.6.2 的 `[a', b']` 形狀）。
 * b 優先（b 是「先發生」的那一邊）。
 */
export function transformPair(a: OtDelta, b: OtDelta): [OtDelta, OtDelta] {
  return [transform(a, b, false), transform(b, a, true)];
}

/**
 * 把 `delta` 依序 transform 過一串「已經被套用」的 delta。
 * 伺服器的 `receiveDelta` 與客戶端的追趕都走這裡。
 */
export function transformAgainstAll(delta: OtDelta, applied: readonly OtDelta[]): OtDelta {
  let d = delta;
  for (const c of applied) d = transform(d, c, false);
  return d;
}
