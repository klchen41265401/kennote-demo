/**
 * 宿主層常用的 model 操作。全部回傳 Operation[]（或直接 dispatch），
 * 絕不直接改 doc —— editor.applyTransaction 是唯一入口。
 */
import {
  deleteRange,
  flattenDoc,
  insertNodes,
  length as rtLength,
  slice,
  toOffsetText,
  type Editor,
  type EditorDoc,
  type InlineAtom,
  type Operation,
  type RichText,
} from '@kennote/editor-core';

/** 刪掉 block 中 [from, to) 的文字（slash / mention 的觸發字串） */
export function deleteTextOps(editor: Editor, blockId: string, from: number, to: number): Operation[] {
  const block = editor.getBlock(blockId);
  if (!block) return [];
  return [{ type: 'block.update', blockId, patch: { content: deleteRange(block.content, from, to) } }];
}

/**
 * 把觸發字串（`/query`、`@query`）刪掉，游標回到觸發點。
 * 回傳是否成功。
 */
export function consumeTrigger(editor: Editor, blockId: string, triggerOffset: number, query: string): boolean {
  const block = editor.getBlock(blockId);
  if (!block) return false;
  const to = triggerOffset + 1 + [...query].length;
  const ops = deleteTextOps(editor, blockId, triggerOffset, to);
  if (ops.length === 0) return false;
  return editor.dispatch({
    ops,
    kind: 'structural',
    breakHistory: true,
    selectionAfter: {
      type: 'text',
      anchor: { blockId, offset: triggerOffset },
      focus: { blockId, offset: triggerOffset },
    },
  });
}

/** 在游標處插入一個 inline atom（mention / pageLink / date / equation） */
export function insertAtom(editor: Editor, atom: InlineAtom, trailingSpace = true): boolean {
  const sel = editor.getSelection();
  if (sel.type !== 'text') return false;
  const blockId = sel.focus.blockId;
  const block = editor.getBlock(blockId);
  if (!block) return false;
  const at = Math.min(sel.focus.offset, rtLength(block.content));
  const nodes: RichText = trailingSpace ? [atom, { text: ' ' }] : [atom];
  const content = insertNodes(block.content, at, nodes);
  const after = at + (trailingSpace ? 2 : 1);
  return editor.dispatch({
    ops: [{ type: 'block.update', blockId, patch: { content } }],
    kind: 'structural',
    breakHistory: true,
    selectionAfter: { type: 'text', anchor: { blockId, offset: after }, focus: { blockId, offset: after } },
  });
}

/** 游標前 n 個字（`[[` 偵測用） */
export function textBeforeCaret(editor: Editor, n: number): { blockId: string; offset: number; text: string } | null {
  const sel = editor.getSelection();
  if (sel.type !== 'text') return null;
  const block = editor.getBlock(sel.focus.blockId);
  if (!block) return null;
  const offset = sel.focus.offset;
  const from = Math.max(0, offset - n);
  return { blockId: sel.focus.blockId, offset, text: toOffsetText(slice(block.content, from, offset)) };
}

/** 深拷貝一棵 block 子樹，回傳 insert ops（新 id）。 */
export function duplicateBlockOps(
  doc: EditorDoc,
  blockId: string,
  newId: () => string,
): { ops: Operation[]; newRootId: string | null } {
  const source = doc.blocks[blockId];
  if (!source) return { ops: [], newRootId: null };
  const ops: Operation[] = [];

  const copy = (id: string, parentId: string | null, afterId: string | null): string | null => {
    const block = doc.blocks[id];
    if (!block) return null;
    const nextId = newId();
    ops.push({
      type: 'block.insert',
      blockId: nextId,
      parentId,
      afterId,
      blockType: block.type,
      props: { ...block.props },
      content: block.content,
    });
    let prevChild: string | null = null;
    for (const childId of block.children) {
      prevChild = copy(childId, nextId, prevChild);
    }
    return nextId;
  };

  const newRootId = copy(blockId, source.parentId, blockId);
  return { ops, newRootId };
}

/** 選取範圍（text 或 block）涵蓋哪些 block id */
export function selectedBlockIds(editor: Editor): string[] {
  const sel = editor.getSelection();
  if (sel.type === 'block') return sel.blockIds;
  if (sel.type === 'text') return [sel.focus.blockId];
  return [];
}

/** 目前游標所在的 block（沒有就 null） */
export function currentBlockId(editor: Editor): string | null {
  const sel = editor.getSelection();
  if (sel.type === 'text') return sel.focus.blockId;
  if (sel.type === 'block') return sel.focusId;
  return null;
}

/** 平坦順序中的下一個 / 上一個 block */
export function siblingInOrder(doc: EditorDoc, blockId: string, delta: number): string | null {
  const order = flattenDoc(doc);
  const i = order.indexOf(blockId);
  if (i < 0) return null;
  return order[i + delta] ?? null;
}

/** block.move：把 blockId 移到 targetId 的前 / 後 / 子層 */
export function moveOpFor(
  doc: EditorDoc,
  blockId: string,
  target: { id: string; position: 'before' | 'after' | 'child' },
): { parentId: string | null; afterId: string | null } | null {
  const targetBlock = doc.blocks[target.id];
  if (!targetBlock) return null;
  if (target.position === 'child') {
    const lastChild = targetBlock.children[targetBlock.children.length - 1] ?? null;
    return { parentId: target.id, afterId: lastChild === blockId ? null : lastChild };
  }
  const siblings = targetBlock.parentId ? (doc.blocks[targetBlock.parentId]?.children ?? []) : doc.rootIds;
  const index = siblings.indexOf(target.id);
  if (target.position === 'after') return { parentId: targetBlock.parentId, afterId: target.id };
  const prev = index > 0 ? (siblings[index - 1] ?? null) : null;
  return { parentId: targetBlock.parentId, afterId: prev === blockId ? null : prev };
}

/** blockId 是不是 ancestorId 的子孫（拖曳時擋掉「拖到自己的子孫」） */
export function isDescendantOf(doc: EditorDoc, blockId: string, ancestorId: string): boolean {
  let current = doc.blocks[blockId]?.parentId ?? null;
  while (current) {
    if (current === ancestorId) return true;
    current = doc.blocks[current]?.parentId ?? null;
  }
  return false;
}
