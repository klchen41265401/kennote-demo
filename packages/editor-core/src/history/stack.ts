/**
 * HistoryStack：自建的 command stack。
 *
 * 不做快照式 undo（大文件會吃爆記憶體），改記錄每個 transaction 的 inverse ops。
 * 協作情境（M6 前的保守做法）：收到會影響 undo stack 中 block 的遠端 ops 時，
 * 丟掉受影響的那一筆與更早的紀錄。undo 能力變差，但絕不會弄壞別人的內容。
 */
import type { Operation } from '../transaction/operation.js';
import type { Transaction } from '../transaction/transaction.js';
import { canCoalesce, COALESCE_WINDOW_MS, mergeEntry } from './coalesce.js';
import type { HistoryEntry } from './types.js';

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

  /** 把一個 transaction 記進 stack（source 為 history/remote 的不該呼叫這裡）。 */
  record(tx: Transaction): void {
    if (tx.ops.length === 0) return;
    const entry: HistoryEntry = {
      ops: tx.ops.slice(),
      inverseOps: tx.inverseOps.slice(),
      selectionBefore: tx.selectionBefore,
      selectionAfter: tx.selectionAfter,
      timestamp: tx.timestamp ?? this.now(),
      kind: tx.kind,
      blockIds: tx.blockIds.slice(),
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

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingBreak = false;
  }
}
