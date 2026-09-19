import type { Operation } from '../transaction/operation.js';
import type { TransactionKind } from '../transaction/transaction.js';
import type { EditorSelection } from '../selection/types.js';

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
}
