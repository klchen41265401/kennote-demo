/**
 * Tx.*：把「使用者意圖」翻譯成 Operation[] 的便利建構器。
 *
 * 全部是純函式（不碰 DOM、不碰 registry 實例），所以每一條編輯行為都能在 Node 裡單測。
 * 需要 block 型別知識的地方一律透過 BuilderContext 注入，避免 transaction 層依賴 plugins 層。
 */
import type { Block, BlockType, EditorDoc, Mark, RichText } from '../model/types.js';
import { childrenOf, createId, descendantIds, flattenDoc, nextSiblingId, prevSiblingId } from '../model/document.js';
import { deleteRange, insertNodes, insertText, length, slice, toggleMark as toggleMarkRt } from '../text/richtext.js';
import type { EditorSelection } from '../selection/types.js';
import { blockSelection, textSelection } from '../selection/types.js';
import type { Operation } from './operation.js';

export interface BuildResult {
  ops: Operation[];
  selectionAfter: EditorSelection;
}

export interface BuilderContext {
  /** 此型別是否有可編輯的行內內容（divider / image 等沒有）。 */
  hasInlineContent(type: BlockType): boolean;
  /** 此型別可否有子 block。 */
  canHaveChildren(type: BlockType): boolean;
  /** Enter 分割時，後半段要變成什麼型別（heading 分割後通常變 paragraph）。 */
  splitType(type: BlockType): BlockType;
  /** Enter 在空 block 時要「跳出」成什麼型別（空清單項 → paragraph）。 */
  exitType(type: BlockType): BlockType | null;
  /** 產生新的 block id。 */
  newId(): string;
}

const TEXT_TYPES = new Set<BlockType>([
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bulletedList',
  'numberedList',
  'todo',
  'toggle',
  'quote',
  'callout',
  'code',
]);

const CONTINUING_TYPES = new Set<BlockType>(['bulletedList', 'numberedList', 'todo']);

/** 預設 context：在沒有 registry 的情況下（例如單元測試）也能用。 */
export const defaultBuilderContext: BuilderContext = {
  hasInlineContent: (type) => TEXT_TYPES.has(type),
  canHaveChildren: (type) =>
    type !== 'divider' && type !== 'image' && type !== 'file' && type !== 'bookmark' && type !== 'code',
  splitType: (type) => (CONTINUING_TYPES.has(type) || type === 'quote' || type === 'callout' ? type : 'paragraph'),
  exitType: (type) => (CONTINUING_TYPES.has(type) || type === 'quote' || type === 'callout' ? 'paragraph' : null),
  newId: createId,
};

function block(doc: EditorDoc, id: string): Block {
  const b = doc.blocks[id];
  if (!b) throw new Error(`[editor-core] block not found: ${id}`);
  return b;
}

function updateContent(b: Block, content: RichText): Operation {
  return { type: 'block.update', blockId: b.id, patch: { content } };
}

// ─────────────────────────────────────────────────────────────
// 文字層級
// ─────────────────────────────────────────────────────────────

/** 取代 [from,to) 為一段文字（插入、覆寫選取都走這裡）。 */
export function insertTextOps(
  doc: EditorDoc,
  blockId: string,
  from: number,
  to: number,
  text: string,
  marks?: Mark[],
): BuildResult {
  const b = block(doc, blockId);
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const afterDelete = end > start ? deleteRange(b.content, start, end) : b.content;
  const next = insertText(afterDelete, start, text, marks);
  const caret = start + [...text].length;
  return { ops: [updateContent(b, next)], selectionAfter: textSelection(blockId, caret) };
}

/** 插入任意 inline 內容（atom、貼上的片段）。 */
export function insertInlineOps(
  doc: EditorDoc,
  blockId: string,
  from: number,
  to: number,
  nodes: RichText,
): BuildResult {
  const b = block(doc, blockId);
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const afterDelete = end > start ? deleteRange(b.content, start, end) : b.content;
  const next = insertNodes(afterDelete, start, nodes);
  return { ops: [updateContent(b, next)], selectionAfter: textSelection(blockId, start + length(nodes)) };
}

export function deleteRangeOps(doc: EditorDoc, blockId: string, from: number, to: number): BuildResult {
  const b = block(doc, blockId);
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (start === end) return { ops: [], selectionAfter: textSelection(blockId, start) };
  return {
    ops: [updateContent(b, deleteRange(b.content, start, end))],
    selectionAfter: textSelection(blockId, start),
  };
}

export function toggleMarkOps(doc: EditorDoc, blockId: string, from: number, to: number, mark: Mark): BuildResult {
  const b = block(doc, blockId);
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return {
    ops: [updateContent(b, toggleMarkRt(b.content, start, end, mark))],
    // 套完格式維持原選取，使用者才能連按 Cmd+B Cmd+I
    selectionAfter: textSelection(blockId, from, to),
  };
}

// ─────────────────────────────────────────────────────────────
// Block 層級
// ─────────────────────────────────────────────────────────────

export function setBlockTypeOps(
  doc: EditorDoc,
  blockIds: string[],
  type: BlockType,
  props?: Record<string, unknown>,
  selectionAfter?: EditorSelection,
): BuildResult {
  const ops: Operation[] = [];
  for (const id of blockIds) {
    const b = doc.blocks[id];
    if (!b) continue;
    const patch: { blockType: BlockType; props?: Record<string, unknown> } = { blockType: type };
    if (props !== undefined) patch.props = props;
    ops.push({ type: 'block.update', blockId: id, patch });
  }
  const first = blockIds[0];
  return {
    ops,
    selectionAfter: selectionAfter ?? (first ? textSelection(first, 0) : { type: 'none' }),
  };
}

export interface InsertBlockOptions {
  id?: string;
  type?: BlockType;
  props?: Record<string, unknown>;
  content?: RichText;
  /** 放在 afterId 之後（同層）還是變成 afterId 的第一個子層。 */
  asChild?: boolean;
}

export function insertBlockAfterOps(doc: EditorDoc, afterId: string | null, options: InsertBlockOptions = {}): BuildResult {
  const id = options.id ?? createId();
  let parentId: string | null = null;
  let after: string | null = null;
  if (afterId !== null) {
    const anchor = block(doc, afterId);
    if (options.asChild) {
      parentId = afterId;
      after = null;
    } else {
      parentId = anchor.parentId;
      after = afterId;
    }
  } else {
    parentId = null;
    after = doc.rootIds.length > 0 ? doc.rootIds[doc.rootIds.length - 1]! : null;
  }
  const op: Operation = {
    type: 'block.insert',
    blockId: id,
    parentId,
    afterId: after,
    blockType: options.type ?? 'paragraph',
    props: options.props ?? {},
    content: options.content ?? [],
  };
  return { ops: [op], selectionAfter: textSelection(id, 0) };
}

/**
 * Enter：在 offset 分割 block。
 * 有子 block 的情況下，新 block 會成為第一個子層（對齊 Notion 行為），否則是下一個兄弟。
 */
export function splitBlockOps(
  doc: EditorDoc,
  blockId: string,
  offset: number,
  ctx: BuilderContext = defaultBuilderContext,
): BuildResult {
  const b = block(doc, blockId);
  const total = length(b.content);
  const at = Math.max(0, Math.min(offset, total));
  const head = slice(b.content, 0, at);
  const tail = slice(b.content, at, total);
  const newId = ctx.newId();
  const newType = ctx.splitType(b.type);
  const asChild = b.children.length > 0 && ctx.canHaveChildren(b.type);

  const ops: Operation[] = [];
  if (at < total || head.length !== b.content.length) ops.push(updateContent(b, head));
  const props: Record<string, unknown> = newType === b.type ? inheritProps(b) : {};
  ops.push({
    type: 'block.insert',
    blockId: newId,
    parentId: asChild ? b.id : b.parentId,
    afterId: asChild ? null : b.id,
    blockType: newType,
    props,
    content: tail,
  });
  return { ops, selectionAfter: textSelection(newId, 0) };
}

function inheritProps(b: Block): Record<string, unknown> {
  if (b.type === 'todo') return { checked: false };
  if (b.type === 'code') return { ...b.props };
  return { ...b.props };
}

/** 空的清單項按 Enter：跳出清單（轉回 paragraph，並且若有縮排先 outdent）。 */
export function exitBlockOps(
  doc: EditorDoc,
  blockId: string,
  ctx: BuilderContext = defaultBuilderContext,
): BuildResult | null {
  const b = block(doc, blockId);
  if (b.parentId !== null) return outdentOps(doc, blockId);
  const target = ctx.exitType(b.type);
  if (!target) return null;
  return {
    ops: [{ type: 'block.update', blockId, patch: { blockType: target, props: {} } }],
    selectionAfter: textSelection(blockId, 0),
  };
}

/**
 * 行首 Backspace：與前一個有行內內容的 block 合併，游標停在接縫處。
 * 回傳 null 代表沒有可合併的對象（例如文件第一個 block）。
 */
export function mergeBackwardOps(
  doc: EditorDoc,
  blockId: string,
  ctx: BuilderContext = defaultBuilderContext,
): BuildResult | null {
  const b = block(doc, blockId);
  const order = flattenDoc(doc);
  const idx = order.indexOf(blockId);
  let targetId: string | null = null;
  for (let i = idx - 1; i >= 0; i--) {
    const candidate = order[i]!;
    // 不能跟自己的祖先合併（會造成樹結構錯亂）
    if (descendantIds(doc, candidate).includes(blockId)) continue;
    if (ctx.hasInlineContent(doc.blocks[candidate]!.type)) {
      targetId = candidate;
      break;
    }
    // 遇到 divider / image 之類的非文字 block：直接刪掉它（Notion 行為）
    return {
      ops: [{ type: 'block.delete', blockId: candidate }],
      selectionAfter: textSelection(blockId, 0),
    };
  }
  if (!targetId) return null;
  const target = block(doc, targetId);
  const seam = length(target.content);
  const merged = [...target.content, ...b.content];

  const ops: Operation[] = [updateContent(target, merged)];
  // 被合併掉的 block 若有子層，接到 target 底下（避免整批子樹被連帶刪除）
  let afterId: string | null = target.children.length > 0 ? target.children[target.children.length - 1]! : null;
  for (const childId of b.children) {
    ops.push({ type: 'block.move', blockId: childId, parentId: targetId, afterId });
    afterId = childId;
  }
  ops.push({ type: 'block.delete', blockId });
  return { ops, selectionAfter: textSelection(targetId, seam) };
}

/** 行尾 Delete：把後一個 block 併進來。 */
export function mergeForwardOps(
  doc: EditorDoc,
  blockId: string,
  ctx: BuilderContext = defaultBuilderContext,
): BuildResult | null {
  const order = flattenDoc(doc);
  const idx = order.indexOf(blockId);
  for (let i = idx + 1; i < order.length; i++) {
    const candidate = order[i]!;
    if (!ctx.hasInlineContent(doc.blocks[candidate]!.type)) {
      return {
        ops: [{ type: 'block.delete', blockId: candidate }],
        selectionAfter: textSelection(blockId, length(block(doc, blockId).content)),
      };
    }
    return mergeBackwardOps(doc, candidate, ctx);
  }
  return null;
}

export function deleteBlocksOps(doc: EditorDoc, blockIds: string[]): BuildResult {
  const order = flattenDoc(doc);
  const set = new Set(blockIds);
  // 只刪最上層的（子孫會連帶消失），並依 document order 反序刪除以保持 afterId 穩定
  const tops = blockIds.filter((id) => {
    let p = doc.blocks[id]?.parentId ?? null;
    while (p !== null) {
      if (set.has(p)) return false;
      p = doc.blocks[p]?.parentId ?? null;
    }
    return true;
  });
  const ops: Operation[] = tops
    .slice()
    .sort((a, c) => order.indexOf(c) - order.indexOf(a))
    .map((id) => ({ type: 'block.delete', blockId: id }));

  // 刪完之後游標要落在哪裡：第一個被刪 block 的前一個，沒有的話用後一個
  const firstIdx = Math.min(...tops.map((id) => order.indexOf(id)).filter((i) => i >= 0));
  const lastIdx = Math.max(...tops.map((id) => order.indexOf(id)).filter((i) => i >= 0));
  let anchor: string | null = null;
  for (let i = firstIdx - 1; i >= 0; i--) {
    if (!set.has(order[i]!)) {
      anchor = order[i]!;
      break;
    }
  }
  if (!anchor) {
    for (let i = lastIdx + 1; i < order.length; i++) {
      if (!set.has(order[i]!)) {
        anchor = order[i]!;
        break;
      }
    }
  }
  const selectionAfter: EditorSelection = anchor
    ? textSelection(anchor, length(doc.blocks[anchor]!.content))
    : { type: 'none' };
  return { ops, selectionAfter };
}

export function moveBlockOps(
  doc: EditorDoc,
  blockId: string,
  parentId: string | null,
  afterId: string | null,
): BuildResult {
  return {
    ops: [{ type: 'block.move', blockId, parentId, afterId }],
    selectionAfter: textSelection(blockId, 0),
  };
}

/** Tab：變成前一個同層兄弟的最後一個子層。 */
export function indentOps(doc: EditorDoc, blockId: string, selectionAfter?: EditorSelection): BuildResult | null {
  const prev = prevSiblingId(doc, blockId);
  if (!prev) return null;
  const parent = block(doc, prev);
  const after = parent.children.length > 0 ? parent.children[parent.children.length - 1]! : null;
  return {
    ops: [{ type: 'block.move', blockId, parentId: prev, afterId: after }],
    selectionAfter: selectionAfter ?? textSelection(blockId, 0),
  };
}

/** Shift+Tab：升一層，插在原 parent 之後。 */
export function outdentOps(doc: EditorDoc, blockId: string, selectionAfter?: EditorSelection): BuildResult | null {
  const b = block(doc, blockId);
  if (b.parentId === null) return null;
  const parent = block(doc, b.parentId);
  const ops: Operation[] = [{ type: 'block.move', blockId, parentId: parent.parentId, afterId: parent.id }];
  // 原本排在自己後面的兄弟，要跟著縮到自己底下（維持清單的視覺結構）
  const siblings = childrenOf(doc, b.parentId);
  const myIndex = siblings.indexOf(blockId);
  let after: string | null = b.children.length > 0 ? b.children[b.children.length - 1]! : null;
  for (let i = myIndex + 1; i < siblings.length; i++) {
    const sid = siblings[i]!;
    ops.push({ type: 'block.move', blockId: sid, parentId: blockId, afterId: after });
    after = sid;
  }
  return { ops, selectionAfter: selectionAfter ?? textSelection(blockId, 0) };
}

/** 貼上 / 插入一整個 fragment。 */
export function insertFragmentOps(
  doc: EditorDoc,
  blockId: string,
  from: number,
  to: number,
  fragment: { rootIds: string[]; blocks: Record<string, Block> },
  ctx: BuilderContext = defaultBuilderContext,
): BuildResult {
  const target = block(doc, blockId);
  const roots = fragment.rootIds.map((id) => fragment.blocks[id]).filter((b): b is Block => !!b);
  if (roots.length === 0) return { ops: [], selectionAfter: textSelection(blockId, from) };

  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const head = slice(target.content, 0, start);
  const tail = slice(target.content, end, length(target.content));

  const first = roots[0]!;
  const ops: Operation[] = [];
  const targetIsEmpty = length(target.content) === 0 && target.children.length === 0;

  // 單一段落片段且目標 block 有內容 → 就地插入文字，不新增 block
  if (roots.length === 1 && first.children.length === 0 && first.type === 'paragraph' && !targetIsEmpty) {
    const merged = [...head, ...first.content, ...tail];
    return {
      ops: [updateContent(target, merged)],
      selectionAfter: textSelection(blockId, start + length(first.content)),
    };
  }

  /**
   * 第一段要不要併進目前的 block？
   *  - 目前 block 是空的 → 併入，並直接採用片段的型別（貼上標題就變標題）
   *  - 第一段是普通段落 → 併入（貼上多段文字時，第一段接在游標處）
   *  - 第一段有自己的型別（標題／清單／程式碼…）而目前 block 有內容
   *    → 不併入，整段變成新的 block 插在後面，否則會把型別資訊吃掉
   */
  const mergeFirst = targetIsEmpty || first.type === 'paragraph' || first.type === target.type;
  const firstMerged = targetIsEmpty ? first.content.slice() : mergeFirst ? [...head, ...first.content] : head;
  const patch: { content: RichText; blockType?: BlockType; props?: Record<string, unknown> } = { content: firstMerged };
  if (targetIsEmpty) {
    patch.blockType = first.type;
    patch.props = { ...first.props };
  }
  ops.push({ type: 'block.update', blockId, patch });

  let lastId = blockId;
  const lastParent: string | null = target.parentId;
  let caretBlock = blockId;
  let caretOffset = length(firstMerged);

  const emitSubtree = (src: Block, parentId: string | null, afterId: string | null): string => {
    const newId = ctx.newId();
    ops.push({
      type: 'block.insert',
      blockId: newId,
      parentId,
      afterId,
      blockType: src.type,
      props: { ...src.props },
      content: src.content.slice(),
    });
    let childAfter: string | null = null;
    for (const childId of src.children) {
      const child = fragment.blocks[childId];
      if (!child) continue;
      childAfter = emitSubtree(child, newId, childAfter);
    }
    return newId;
  };

  // 第一段的子層（只有第一段被併進來時才掛在目前 block 底下）
  if (mergeFirst) {
    let childAfter: string | null = target.children.length > 0 ? target.children[target.children.length - 1]! : null;
    for (const childId of first.children) {
      const child = fragment.blocks[childId];
      if (!child) continue;
      childAfter = emitSubtree(child, blockId, childAfter);
    }
  }

  const restRoots = mergeFirst ? roots.slice(1) : roots;
  let lastRootContent: RichText = firstMerged;
  for (const root of restRoots) {
    const newId = emitSubtree(root, lastParent, lastId);
    lastId = newId;
    caretBlock = newId;
    caretOffset = length(root.content);
    lastRootContent = root.content;
  }

  // 原本游標之後的殘留文字接在最後一個新 block 後面
  if (tail.length > 0) {
    if (lastId !== blockId) {
      ops.push({ type: 'block.update', blockId: lastId, patch: { content: [...lastRootContent, ...tail] } });
    } else {
      ops.push({ type: 'block.update', blockId, patch: { content: [...firstMerged, ...tail] } });
    }
  }

  return { ops, selectionAfter: textSelection(caretBlock, caretOffset) };
}

/** block selection 模式下，把選取往上/下擴展一個 block。 */
export function extendBlockSelection(doc: EditorDoc, sel: EditorSelection, dir: -1 | 1): EditorSelection {
  if (sel.type !== 'block') return sel;
  const order = flattenDoc(doc);
  const i = order.indexOf(sel.focusId);
  if (i < 0) return sel;
  const nextIndex = i + dir;
  if (nextIndex < 0 || nextIndex >= order.length) return sel;
  const nextFocus = order[nextIndex]!;
  const anchorIdx = order.indexOf(sel.anchorId);
  const [a, b] = anchorIdx <= nextIndex ? [anchorIdx, nextIndex] : [nextIndex, anchorIdx];
  return blockSelection(order.slice(a, b + 1), sel.anchorId, nextFocus);
}

export const Tx = {
  insertText: insertTextOps,
  insertInline: insertInlineOps,
  deleteRange: deleteRangeOps,
  toggleMark: toggleMarkOps,
  setBlockType: setBlockTypeOps,
  insertBlockAfter: insertBlockAfterOps,
  splitBlock: splitBlockOps,
  exitBlock: exitBlockOps,
  mergeBackward: mergeBackwardOps,
  mergeForward: mergeForwardOps,
  deleteBlocks: deleteBlocksOps,
  moveBlock: moveBlockOps,
  indent: indentOps,
  outdent: outdentOps,
  insertFragment: insertFragmentOps,
};

export { nextSiblingId };
