/**
 * applyOps(doc, ops) → newDoc。純函式、原子性。
 *
 * 原子性：整批先套在一份 clone 上，任一個 op 失敗就整批丟掉（throw），呼叫端拿到的
 * 永遠是「全部成功」或「原本的 doc」，不會出現套到一半的狀態。
 */
import type { Block, EditorDoc, RichText } from '../model/types.js';
import { childrenOf, cloneDoc, createBlock, descendantIds, isDescendant } from '../model/document.js';
import { normalize, slice as sliceContent, length as contentLength } from '../text/richtext.js';
import type { Operation, TextDelta } from './operation.js';

export class OperationError extends Error {
  readonly op: Operation;
  constructor(message: string, op: Operation) {
    super(`[editor-core] ${message}`);
    this.name = 'OperationError';
    this.op = op;
  }
}

/**
 * 套用一批 operation，回傳新的 doc。
 * 不修改傳入的 doc（呼叫端可安全保留舊參考做 undo / diff）。
 */
export function applyOps(doc: EditorDoc, ops: Operation[]): EditorDoc {
  if (ops.length === 0) return doc;
  const next = cloneDoc(doc);
  for (const op of ops) applyOne(next, op);
  return next;
}

/** 就地套用單一 op（內部用，呼叫端必須傳 clone）。 */
function applyOne(doc: EditorDoc, op: Operation): void {
  switch (op.type) {
    case 'block.insert': {
      if (doc.blocks[op.blockId]) throw new OperationError(`block already exists: ${op.blockId}`, op);
      if (op.parentId !== null && !doc.blocks[op.parentId]) {
        throw new OperationError(`parent not found: ${op.parentId}`, op);
      }
      const block = createBlock({
        id: op.blockId,
        parentId: op.parentId,
        type: op.blockType,
        props: { ...op.props },
        content: normalize(op.content),
      });
      doc.blocks[op.blockId] = block;
      insertIntoParent(doc, op.blockId, op.parentId, op.afterId, op);
      return;
    }

    case 'block.update': {
      const block = doc.blocks[op.blockId];
      if (!block) throw new OperationError(`block not found: ${op.blockId}`, op);
      if (op.baseVersion !== undefined && op.baseVersion !== block.version) {
        throw new OperationError(
          `version conflict on ${op.blockId}: base=${op.baseVersion} current=${block.version}`,
          op,
        );
      }
      const updated: Block = { ...block, version: block.version + 1 };
      if (op.patch.blockType !== undefined) updated.type = op.patch.blockType;
      if (op.patch.props !== undefined) updated.props = { ...op.patch.props };
      if (op.patch.content !== undefined) updated.content = normalize(op.patch.content);
      doc.blocks[op.blockId] = updated;
      return;
    }

    case 'block.move': {
      const block = doc.blocks[op.blockId];
      if (!block) throw new OperationError(`block not found: ${op.blockId}`, op);
      if (op.parentId !== null) {
        if (!doc.blocks[op.parentId]) throw new OperationError(`parent not found: ${op.parentId}`, op);
        if (op.parentId === op.blockId) throw new OperationError(`cannot move block into itself`, op);
        if (isDescendant(doc, op.blockId, op.parentId)) {
          throw new OperationError(`cannot move block into its own descendant`, op);
        }
      }
      if (op.afterId !== null && !doc.blocks[op.afterId]) {
        throw new OperationError(`afterId not found: ${op.afterId}`, op);
      }
      removeFromParent(doc, op.blockId);
      doc.blocks[op.blockId] = { ...block, parentId: op.parentId };
      insertIntoParent(doc, op.blockId, op.parentId, op.afterId, op);
      return;
    }

    case 'block.delete': {
      const block = doc.blocks[op.blockId];
      if (!block) throw new OperationError(`block not found: ${op.blockId}`, op);
      const doomed = [op.blockId, ...descendantIds(doc, op.blockId)];
      removeFromParent(doc, op.blockId);
      for (const id of doomed) delete doc.blocks[id];
      return;
    }

    case 'text.delta': {
      const block = doc.blocks[op.blockId];
      if (!block) throw new OperationError(`block not found: ${op.blockId}`, op);
      doc.blocks[op.blockId] = {
        ...block,
        content: applyTextDelta(block.content, op.delta),
        version: block.version + 1,
      };
      return;
    }

    default: {
      const never: never = op;
      throw new OperationError(`unknown operation: ${JSON.stringify(never)}`, op as Operation);
    }
  }
}

function insertIntoParent(
  doc: EditorDoc,
  blockId: string,
  parentId: string | null,
  afterId: string | null,
  op: Operation,
): void {
  const siblings = parentId === null ? doc.rootIds : doc.blocks[parentId]!.children;
  const list = siblings.slice();
  let index: number;
  if (afterId === null) {
    index = 0;
  } else {
    const i = list.indexOf(afterId);
    if (i < 0) throw new OperationError(`afterId ${afterId} is not a sibling under ${String(parentId)}`, op);
    index = i + 1;
  }
  list.splice(index, 0, blockId);
  if (parentId === null) doc.rootIds = list;
  else doc.blocks[parentId] = { ...doc.blocks[parentId]!, children: list };
}

function removeFromParent(doc: EditorDoc, blockId: string): void {
  const block = doc.blocks[blockId];
  if (!block) return;
  const parentId = block.parentId;
  const list = childrenOf(doc, parentId).filter((id) => id !== blockId);
  if (parentId === null) doc.rootIds = list;
  else if (doc.blocks[parentId]) doc.blocks[parentId] = { ...doc.blocks[parentId]!, children: list };
}

/** 套用 TextDelta（M6 OT 用；現在只有 applyRemote 的轉接會走到）。 */
export function applyTextDelta(content: RichText, delta: TextDelta): RichText {
  const out: RichText = [];
  let pos = 0;
  const total = contentLength(content);
  for (const op of delta.ops) {
    if ('retain' in op) {
      out.push(...sliceContent(content, pos, Math.min(pos + op.retain, total)));
      pos += op.retain;
    } else if ('insert' in op) {
      out.push(op.marks ? { text: op.insert, marks: op.marks } : { text: op.insert });
    } else {
      pos += op.delete;
    }
  }
  if (pos < total) out.push(...sliceContent(content, pos, total));
  return normalize(out);
}
