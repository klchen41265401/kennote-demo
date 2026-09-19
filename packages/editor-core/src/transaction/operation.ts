/**
 * Operation 型別（與 shared-types 的協定同源）。
 *
 * 所有對文件的變更，最終都必須表達成這些 operation，
 * 因為它們同時是：undo 的單位、協作同步的封包、後端持久化的紀錄。
 */
import type { BlockType, Mark, RichText } from '../model/types.js';

/** 行內文字的增量（M6 OT 才會實際使用，型別先定下來）。 */
export interface TextDelta {
  ops: TextDeltaOp[];
}

export type TextDeltaOp =
  | { retain: number }
  | { insert: string; marks?: Mark[] }
  | { delete: number };

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
      patch: { blockType?: BlockType; props?: Record<string, unknown>; content?: RichText };
      baseVersion?: number;
    }
  | { type: 'block.move'; blockId: string; parentId: string | null; afterId: string | null }
  | { type: 'block.delete'; blockId: string }
  | { type: 'text.delta'; blockId: string; delta: TextDelta; baseRev: number };

export type OperationType = Operation['type'];

export function opBlockId(op: Operation): string {
  return op.blockId;
}

export function isStructuralOp(op: Operation): boolean {
  return op.type === 'block.insert' || op.type === 'block.delete' || op.type === 'block.move';
}
