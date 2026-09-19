/**
 * invertOps(doc, ops)：產生「能把 doc 還原回套用前狀態」的反向 operation 序列。
 *
 * 關鍵細節：
 *  1. 每個 op 的反向必須在「套用該 op 之前」的狀態上計算，所以要逐步推進中間狀態。
 *  2. 回傳的序列是反序的（最後一個 op 的反向排最前面），可以直接 applyOps 一次跑完。
 *  3. block.delete 的反向要把整棵子樹（含所有子孫）依序重建。
 */
import type { EditorDoc } from '../model/types.js';
import { prevSiblingId } from '../model/document.js';
import { applyOps } from './apply.js';
import type { Operation } from './operation.js';

export function invertOps(doc: EditorDoc, ops: Operation[]): Operation[] {
  const perOp: Operation[][] = [];
  let cur = doc;
  for (const op of ops) {
    perOp.push(invertOne(cur, op));
    cur = applyOps(cur, [op]);
  }
  const out: Operation[] = [];
  for (let i = perOp.length - 1; i >= 0; i--) out.push(...perOp[i]!);
  return out;
}

/** 單一 op 的反向（stateBefore 必須是「還沒套用這個 op」的狀態）。 */
export function invertOne(stateBefore: EditorDoc, op: Operation): Operation[] {
  switch (op.type) {
    case 'block.insert':
      return [{ type: 'block.delete', blockId: op.blockId }];

    case 'block.delete': {
      const root = stateBefore.blocks[op.blockId];
      if (!root) return [];
      const out: Operation[] = [];
      const emit = (id: string) => {
        const b = stateBefore.blocks[id];
        if (!b) return;
        out.push({
          type: 'block.insert',
          blockId: b.id,
          parentId: b.parentId,
          afterId: prevSiblingId(stateBefore, b.id),
          blockType: b.type,
          props: { ...b.props },
          content: b.content.slice(),
        });
        for (const child of b.children) emit(child);
      };
      emit(op.blockId);
      return out;
    }

    case 'block.move': {
      const b = stateBefore.blocks[op.blockId];
      if (!b) return [];
      return [
        {
          type: 'block.move',
          blockId: b.id,
          parentId: b.parentId,
          afterId: prevSiblingId(stateBefore, b.id),
        },
      ];
    }

    case 'block.update': {
      const b = stateBefore.blocks[op.blockId];
      if (!b) return [];
      const patch: { blockType?: typeof b.type; props?: Record<string, unknown>; content?: typeof b.content } = {};
      if (op.patch.blockType !== undefined) patch.blockType = b.type;
      if (op.patch.props !== undefined) patch.props = { ...b.props };
      if (op.patch.content !== undefined) patch.content = b.content.slice();
      return [{ type: 'block.update', blockId: op.blockId, patch }];
    }

    case 'text.delta': {
      const b = stateBefore.blocks[op.blockId];
      if (!b) return [];
      return [{ type: 'block.update', blockId: op.blockId, patch: { content: b.content.slice() } }];
    }

    default:
      return [];
  }
}
