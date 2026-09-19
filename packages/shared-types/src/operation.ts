import type { BlockType } from './block.js';
import type { RichText } from './richtext.js';

/** M6 OT 階段才會真正使用的文字層 delta（Quill Delta 風格） */
export type TextDeltaOp =
  | { retain: number }
  | { insert: string; marks?: unknown[] }
  | { delete: number };

export interface TextDelta {
  ops: TextDeltaOp[];
}

/**
 * 所有對 block 的變更都必須表示成 Operation，並經由單一的 applyTransaction() 套用。
 * 04 §5.4 / 00-README §5 風險二的「架構前置要求」。
 */
export type Operation =
  | {
      type: 'block.insert';
      blockId: string;
      parentId: string | null;
      afterId: string | null;
      blockType: BlockType;
      props: Record<string, unknown>;
      content: RichText;
    }
  | {
      type: 'block.update';
      blockId: string;
      patch: {
        blockType?: BlockType;
        props?: Record<string, unknown>;
        content?: RichText;
      };
      baseVersion?: number;
    }
  | { type: 'block.move'; blockId: string; parentId: string | null; afterId: string | null }
  | { type: 'block.delete'; blockId: string }
  | {
      type: 'page.update';
      patch: { title?: RichText; icon?: string | null; cover?: string | null };
    }
  /** M6 OT 階段新增：文字層級的細粒度操作 */
  | { type: 'text.delta'; blockId: string; delta: TextDelta; baseRev: number };

export type OperationType = Operation['type'];

export const OPERATION_TYPES: readonly OperationType[] = [
  'block.insert',
  'block.update',
  'block.move',
  'block.delete',
  'page.update',
  'text.delta',
];

/** 一批原子套用的 operation */
export interface Transaction {
  /** client 產生的 UUID，用於冪等：重送同一 txId 不會重複套用 */
  txId: string;
  pageId: string;
  /** client session id，廣播時用來排除自己 */
  originSessionId: string;
  /** 1..200 */
  ops: Operation[];
}

export const MAX_OPS_PER_TRANSACTION = 200;

export interface TransactionResult {
  txId: string;
  pageId: string;
  /** 頁面層級單調遞增序號，client 用來偵測漏收 */
  seq: number;
  /** 伺服器最終套用的 ops（可能經 transform 調整） */
  ops: Operation[];
  appliedAt: string;
  actorId: string;
  /** baseVersion 不符時標記，供前端提示 */
  conflicts?: string[];
}
