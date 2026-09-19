/**
 * EditorDoc 的唯讀查詢 helper。全部是純函式，不修改傳入的 doc。
 */
import type { Block, BlockType, EditorDoc, RichText } from './types.js';

export function getBlock(doc: EditorDoc, id: string): Block | undefined {
  return doc.blocks[id];
}

export function mustGetBlock(doc: EditorDoc, id: string): Block {
  const b = doc.blocks[id];
  if (!b) throw new Error(`[editor-core] block not found: ${id}`);
  return b;
}

/** 某個 parent 的 children 陣列（parentId 為 null 時就是 rootIds）。 */
export function childrenOf(doc: EditorDoc, parentId: string | null): string[] {
  if (parentId === null) return doc.rootIds;
  return doc.blocks[parentId]?.children ?? [];
}

export function indexOf(doc: EditorDoc, id: string): number {
  const b = doc.blocks[id];
  if (!b) return -1;
  return childrenOf(doc, b.parentId).indexOf(id);
}

export function prevSiblingId(doc: EditorDoc, id: string): string | null {
  const b = doc.blocks[id];
  if (!b) return null;
  const siblings = childrenOf(doc, b.parentId);
  const i = siblings.indexOf(id);
  return i > 0 ? siblings[i - 1]! : null;
}

export function nextSiblingId(doc: EditorDoc, id: string): string | null {
  const b = doc.blocks[id];
  if (!b) return null;
  const siblings = childrenOf(doc, b.parentId);
  const i = siblings.indexOf(id);
  return i >= 0 && i + 1 < siblings.length ? siblings[i + 1]! : null;
}

/** 所有子孫 id（不含自己），depth-first。 */
export function descendantIds(doc: EditorDoc, id: string): string[] {
  const out: string[] = [];
  const stack = [...(doc.blocks[id]?.children ?? [])];
  while (stack.length > 0) {
    const cur = stack.shift()!;
    out.push(cur);
    const b = doc.blocks[cur];
    if (b) stack.unshift(...b.children);
  }
  return out;
}

export function isDescendant(doc: EditorDoc, ancestorId: string, maybeDescendantId: string): boolean {
  let cur = doc.blocks[maybeDescendantId]?.parentId ?? null;
  const seen = new Set<string>();
  while (cur !== null) {
    if (cur === ancestorId) return true;
    if (seen.has(cur)) return false; // 防呆：資料若已有環，不要無限迴圈
    seen.add(cur);
    cur = doc.blocks[cur]?.parentId ?? null;
  }
  return false;
}

export function ancestorIds(doc: EditorDoc, id: string): string[] {
  const out: string[] = [];
  let cur = doc.blocks[id]?.parentId ?? null;
  const seen = new Set<string>();
  while (cur !== null && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = doc.blocks[cur]?.parentId ?? null;
  }
  return out;
}

/** 整份文件的 document order（深度優先前序）。 */
export function flattenDoc(doc: EditorDoc): string[] {
  const out: string[] = [];
  const visit = (ids: string[]) => {
    for (const id of ids) {
      const b = doc.blocks[id];
      if (!b) continue;
      out.push(id);
      visit(b.children);
    }
  };
  visit(doc.rootIds);
  return out;
}

/** document order 中的前一個 block。 */
export function prevBlockId(doc: EditorDoc, id: string): string | null {
  const order = flattenDoc(doc);
  const i = order.indexOf(id);
  return i > 0 ? order[i - 1]! : null;
}

/** document order 中的後一個 block。 */
export function nextBlockId(doc: EditorDoc, id: string): string | null {
  const order = flattenDoc(doc);
  const i = order.indexOf(id);
  return i >= 0 && i + 1 < order.length ? order[i + 1]! : null;
}

/** 依 document order 取出 a 到 b 之間的所有 block（含兩端），供 block selection 用。 */
export function blockRange(doc: EditorDoc, a: string, b: string): string[] {
  const order = flattenDoc(doc);
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia < 0 || ib < 0) return [];
  const [from, to] = ia <= ib ? [ia, ib] : [ib, ia];
  const raw = order.slice(from, to + 1);
  // 若某個 block 的祖先也在集合內，就不要重複列出（刪除時會連子孫一起刪）
  const set = new Set(raw);
  return raw.filter((id) => {
    let p = doc.blocks[id]?.parentId ?? null;
    while (p !== null) {
      if (set.has(p)) return false;
      p = doc.blocks[p]?.parentId ?? null;
    }
    return true;
  });
}

export interface CreateBlockInput {
  id: string;
  type?: BlockType;
  parentId?: string | null;
  props?: Record<string, unknown>;
  content?: RichText;
  children?: string[];
  version?: number;
}

export function createBlock(input: CreateBlockInput): Block {
  return {
    id: input.id,
    parentId: input.parentId ?? null,
    type: input.type ?? 'paragraph',
    props: input.props ?? {},
    content: input.content ?? [],
    children: input.children ?? [],
    version: input.version ?? 1,
  };
}

/** 深拷貝（結構化複製；zero-dep，所以用 JSON round-trip 以外的手寫版本避免丟型別）。 */
export function cloneDoc(doc: EditorDoc): EditorDoc {
  const blocks: Record<string, Block> = {};
  for (const id of Object.keys(doc.blocks)) {
    const b = doc.blocks[id]!;
    blocks[id] = { ...b, props: { ...b.props }, content: b.content.slice(), children: b.children.slice() };
  }
  return { rootIds: doc.rootIds.slice(), blocks };
}

let idCounter = 0;

/** 產生 block id。zero-dep：優先用 crypto.randomUUID，否則退回時間戳 + 計數器。 */
export function createId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  idCounter += 1;
  return `b_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
