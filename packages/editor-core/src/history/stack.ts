/**
 * HistoryStack：自建的 command stack。
 *
 * 不做快照式 undo（大文件會吃爆記憶體），改記錄每個 transaction 的 inverse ops。
 * 協作情境（M6 前的保守做法）：收到會影響 undo stack 中 block 的遠端 ops 時，
 * 丟掉受影響的那一筆與更早的紀錄。undo 能力變差，但絕不會弄壞別人的內容。
 */
import type { Operation } from '../transaction/operation.js';
import type { Transaction } from '../transaction/transaction.js';
import { transformCursor } from '../ot/delta.js';
import { transform } from '../ot/transform.js';
import type { OtDelta } from '../ot/types.js';
import type { EditorSelection } from '../selection/types.js';
import { canCoalesce, COALESCE_WINDOW_MS, mergeEntry } from './coalesce.js';
import type { HistoryDelta, HistoryEntry } from './types.js';

export type { HistoryDelta } from './types.js';

export interface HistoryOptions {
  max?: number;
  coalesceMs?: number;
  /** 可注入假時鐘，讓 coalescing 能用假時間測試。 */
  now?(): number;
}

export class HistoryStack {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private pendingBreak = false;
  private readonly max: number;
  private readonly coalesceMs: number;
  private readonly now: () => number;

  constructor(options: HistoryOptions = {}) {
    this.max = options.max ?? 200;
    this.coalesceMs = options.coalesceMs ?? COALESCE_WINDOW_MS;
    this.now = options.now ?? (() => Date.now());
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /**
   * 把一個 transaction 記進 stack（source 為 history/remote 的不該呼叫這裡）。
   * `deltas` 只在 OT 模式下由 Editor 傳進來，用於協作 undo。
   */
  record(tx: Transaction, deltas?: HistoryDelta[]): void {
    if (tx.ops.length === 0) return;
    const entry: HistoryEntry = {
      ops: tx.ops.slice(),
      inverseOps: tx.inverseOps.slice(),
      selectionBefore: tx.selectionBefore,
      selectionAfter: tx.selectionAfter,
      timestamp: tx.timestamp ?? this.now(),
      kind: tx.kind,
      blockIds: tx.blockIds.slice(),
      ...(deltas && deltas.length > 0 ? { deltas } : {}),
    };
    this.redoStack.length = 0; // 新操作清空 redo
    const top = this.undoStack[this.undoStack.length - 1];
    if (!this.pendingBreak && !tx.breakHistory && top && canCoalesce(top, entry, this.coalesceMs)) {
      mergeEntry(top, entry);
    } else {
      this.undoStack.push(entry);
      if (this.undoStack.length > this.max) this.undoStack.shift();
    }
    this.pendingBreak = false;
  }

  /** 強制斷點：點擊移動游標、blur、貼上、套格式、結構變更、收到遠端 ops。 */
  breakpoint(): void {
    this.pendingBreak = true;
  }

  /** 取出一筆要 undo 的紀錄（呼叫端負責套用 inverseOps 與還原 selectionBefore）。 */
  popUndo(): HistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    this.pendingBreak = true;
    return entry;
  }

  /** 取出一筆要 redo 的紀錄。 */
  popRedo(): HistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    this.pendingBreak = true;
    return entry;
  }

  /** 收到遠端 ops：丟掉受影響的紀錄與更早的（M1-M5 的保守做法）。 */
  onRemoteOps(ops: Operation[]): void {
    const touched = new Set(ops.map((o) => o.blockId));
    const idx = this.undoStack.findIndex((e) => e.blockIds.some((id) => touched.has(id)));
    if (idx >= 0) this.undoStack.splice(0, idx + 1);
    const ridx = this.redoStack.findIndex((e) => e.blockIds.some((id) => touched.has(id)));
    if (ridx >= 0) this.redoStack.splice(0, ridx + 1);
    this.pendingBreak = true;
  }

  /**
   * 收到遠端 **delta**（OT 通道）：把 stack 裡同一個 block 的 forward / inverse delta
   * 對它做 transform，undo 就不會蓋掉對方後來打的字（04 §8 M6-5）。
   *
   * 沒有 delta 表示的紀錄（結構操作、非 OT 模式）仍然沿用保守做法：丟掉。
   *
   * **已知限制**：對 stack 最上面那一筆是精確的；更深的紀錄其座標系比遠端 delta 更舊，
   * 這裡的 transform 是近似值（完整解需要整條 history 的 transform 矩陣）。
   * 實務上 undo 一定從最上面開始，所以影響很小。詳見 docs/adr/0006-ot.md。
   */
  onRemoteDelta(blockId: string, delta: OtDelta): void {
    if (delta.ops.length === 0) return;
    this.undoStack = rebaseStack(this.undoStack, blockId, delta);
    this.redoStack = rebaseStack(this.redoStack, blockId, delta);
    this.pendingBreak = true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingBreak = false;
  }
}

/** 把一整條 stack 對遠端 delta 做 rebase；無法 transform 的紀錄（與更早的）整批丟掉。 */
function rebaseStack(stack: HistoryEntry[], blockId: string, delta: OtDelta): HistoryEntry[] {
  let cutoff = -1;
  const out = stack.map((entry, index) => {
    if (!entry.blockIds.includes(blockId)) return entry;
    const deltas = entry.deltas;
    const target = deltas?.find((d) => d.blockId === blockId);
    if (!deltas || !target) {
      cutoff = index; // 這一筆（與更早的）無法 transform
      return entry;
    }
    const nextDeltas = deltas.map((d) =>
      d.blockId === blockId
        ? {
            blockId,
            forward: transform(d.forward, delta, false),
            inverse: transform(d.inverse, delta, false),
          }
        : d,
    );
    return {
      ...entry,
      deltas: nextDeltas,
      selectionBefore: shiftSelection(entry.selectionBefore, blockId, delta),
      selectionAfter: shiftSelection(entry.selectionAfter, blockId, delta),
    };
  });
  return cutoff >= 0 ? out.slice(cutoff + 1) : out;
}

function shiftSelection(sel: EditorSelection, blockId: string, delta: OtDelta): EditorSelection {
  if (sel.type !== 'text') return sel;
  if (sel.anchor.blockId !== blockId && sel.focus.blockId !== blockId) return sel;
  const shift = (p: { blockId: string; offset: number }): { blockId: string; offset: number } =>
    p.blockId === blockId ? { blockId, offset: transformCursor(p.offset, delta, false) } : p;
  return { type: 'text', anchor: shift(sel.anchor), focus: shift(sel.focus) };
}
