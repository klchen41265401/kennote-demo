/**
 * Undo 的合併規則。
 *
 * 連續打字必須合併成一個 undo 單位，否則使用者要按 100 次 Cmd+Z 才能還原一句話。
 * 但合併過頭也很糟（undo 一次吃掉整篇），所以有明確的斷點條件。
 */
import { compose } from '../ot/delta.js';
import type { EditorSelection } from '../selection/types.js';
import type { HistoryDelta, HistoryEntry } from './types.js';

/** 停頓超過這個時間就切斷合併。 */
export const COALESCE_WINDOW_MS = 1000;

/** 兩次操作的位置是否連續（上一次結束的位置 === 這一次開始的位置）。 */
export function isAdjacent(after: EditorSelection, before: EditorSelection): boolean {
  if (after.type !== 'text' || before.type !== 'text') return false;
  if (after.focus.blockId !== before.anchor.blockId) return false;
  // 連續打字：游標剛好接在上次結束處；連續刪除：游標會往回走，允許相等或相差在合理範圍
  return after.focus.offset === before.anchor.offset && before.anchor.offset === before.focus.offset;
}

export function canCoalesce(prev: HistoryEntry, next: HistoryEntry, windowMs = COALESCE_WINDOW_MS): boolean {
  if (next.timestamp - prev.timestamp >= windowMs) return false; // 停頓 → 斷開
  if (prev.kind !== next.kind) return false; // 不同類型不合併
  if (prev.kind === 'structural' || prev.kind === 'format') return false; // 結構/格式永不合併
  if (prev.blockIds.length !== 1 || next.blockIds.length !== 1) return false;
  if (prev.blockIds[0] !== next.blockIds[0]) return false; // 跨 block 不合併
  if (!isAdjacent(prev.selectionAfter, next.selectionBefore)) return false;
  return true;
}

/** 把 next 併進 prev（就地修改 prev）。 */
export function mergeEntry(prev: HistoryEntry, next: HistoryEntry): void {
  prev.ops.push(...next.ops);
  // 反向 ops 接在「前面」，因為 undo 要反序執行
  prev.inverseOps.unshift(...next.inverseOps);
  const deltas = mergeDeltas(prev.deltas, next.deltas);
  if (deltas) prev.deltas = deltas;
  else delete prev.deltas;
  prev.selectionAfter = next.selectionAfter;
  prev.timestamp = next.timestamp;
}

/**
 * 合併兩筆的 delta：forward 前後相接，inverse 反序相接。
 *
 *   forward = compose(prev.forward, next.forward)
 *   inverse = compose(next.inverse, prev.inverse)   ← 注意順序相反
 *
 * 任一邊沒有 delta 表示（含結構操作）就整組放棄，退回保守的 inverseOps。
 */
export function mergeDeltas(
  prev: HistoryDelta[] | undefined,
  next: HistoryDelta[] | undefined,
): HistoryDelta[] | undefined {
  if (!prev || !next) return undefined;
  const out: HistoryDelta[] = prev.map((d) => ({ ...d }));
  for (const item of next) {
    const existing = out.find((d) => d.blockId === item.blockId);
    if (existing) {
      existing.forward = compose(existing.forward, item.forward);
      existing.inverse = compose(item.inverse, existing.inverse);
    } else {
      out.push({ ...item });
    }
  }
  return out;
}
