/**
 * Transaction：編輯器的唯一變更單位。
 *
 * 鐵律：任何文件變更都必須包成 Transaction 走 editor.applyTransaction()，
 * 不存在「偷偷改 doc」的路徑。這條紀律換來的是：undo、協作同步、對帳全部只有一個接點。
 */
import type { EditorDoc } from '../model/types.js';
import type { EditorSelection } from '../selection/types.js';
import { invertOps } from './invert.js';
import type { Operation } from './operation.js';

/** 這一批變更屬於哪一類（history coalescing 靠它判斷能不能合併）。 */
export type TransactionKind = 'insertText' | 'deleteText' | 'format' | 'structural';

/** 變更的來源。history / remote 不會再被記進 undo stack，也不會被廣播回同步層。 */
export type TransactionSource = 'user' | 'history' | 'remote' | 'ime' | 'reconcile' | 'paste';

export interface Transaction {
  ops: Operation[];
  /** 反向操作。applyTransaction 前若未給，會自動以當下的 doc 計算。 */
  inverseOps: Operation[];
  selectionBefore: EditorSelection;
  selectionAfter: EditorSelection;
  timestamp: number;
  kind: TransactionKind;
  /** 這批變更碰到的 block（coalescing 與 undo rebase 用）。 */
  blockIds: string[];
  source: TransactionSource;
  /** DOM 已經是對的（IME reconcile / MutationObserver 對帳），不要重繪。 */
  skipRender?: boolean;
  /** 強制切斷 history coalescing。 */
  breakHistory?: boolean;
  /** 自由附加資料（plugin 用）。 */
  meta?: Record<string, unknown>;
}

export interface TransactionInput {
  ops: Operation[];
  selectionBefore: EditorSelection;
  selectionAfter: EditorSelection;
  kind?: TransactionKind;
  source?: TransactionSource;
  skipRender?: boolean;
  breakHistory?: boolean;
  meta?: Record<string, unknown>;
  inverseOps?: Operation[];
  timestamp?: number;
}

function inferKind(ops: Operation[]): TransactionKind {
  if (ops.some((o) => o.type !== 'block.update' && o.type !== 'text.delta')) return 'structural';
  if (ops.some((o) => o.type === 'block.update' && o.patch.blockType !== undefined)) return 'structural';
  return 'insertText';
}

export function createTransaction(doc: EditorDoc, input: TransactionInput): Transaction {
  const blockIds: string[] = [];
  for (const op of input.ops) if (!blockIds.includes(op.blockId)) blockIds.push(op.blockId);
  const tx: Transaction = {
    ops: input.ops,
    inverseOps: input.inverseOps ?? invertOps(doc, input.ops),
    selectionBefore: input.selectionBefore,
    selectionAfter: input.selectionAfter,
    timestamp: input.timestamp ?? Date.now(),
    kind: input.kind ?? inferKind(input.ops),
    blockIds,
    source: input.source ?? 'user',
  };
  if (input.skipRender) tx.skipRender = true;
  if (input.breakHistory) tx.breakHistory = true;
  if (input.meta) tx.meta = input.meta;
  return tx;
}
