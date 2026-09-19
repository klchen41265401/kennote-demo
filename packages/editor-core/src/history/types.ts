import type { Operation } from '../transaction/operation.js';
import type { TransactionKind } from '../transaction/transaction.js';
import type { EditorSelection } from '../selection/types.js';
import type { OtDelta } from '../ot/types.js';

/**
 * 協作 undo（04 §8 M6-5）用的 delta 表示。
 *
 * 為什麼不直接存 `block.update{content}`：那是「把整段內容換成當時的舊值」，
 * undo 時會把別人後來打的字一起蓋掉。改存 delta 之後，
 * 收到遠端 delta 時可以對 stack 裡的每一筆做 transform，
 * undo 就只會撤銷「自己那幾個字」。
 */
export interface HistoryDelta {
  blockId: string;
  /** 正向（redo 用） */
  forward: OtDelta;
  /** 反向（undo 用） */
  inverse: OtDelta;
}

export interface HistoryEntry {
  /** 正向操作 */
  ops: Operation[];
  /** 反向操作（undo 時 apply 這個） */
  inverseOps: Operation[];
  /** 操作前的 selection（undo 後還原到這裡） */
  selectionBefore: EditorSelection;
  /** 操作後的 selection（redo 後還原到這裡） */
  selectionAfter: EditorSelection;
  /** coalescing 判斷用 */
  timestamp: number;
  kind: TransactionKind;
  /** 只影響哪些 block（跨 block 不合併） */
  blockIds: string[];
  /**
   * OT 模式才有：可 transform 的 delta 表示。
   * 沒有這個欄位時 undo 退回 M2 的保守做法（整段內容還原 + 收到遠端 ops 就丟紀錄）。
   */
  deltas?: HistoryDelta[];
}
