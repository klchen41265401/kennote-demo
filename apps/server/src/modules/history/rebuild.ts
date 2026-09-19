/**
 * 版本歷史的**純邏輯**：從 operation log 重播出任意 seq 的文件狀態，
 * 以及「目前狀態 → 目標狀態」的 diff（還原時要送出的 ops）。
 *
 * 刻意不碰資料庫，所以可以完整單元測試（apps/server/test/history-rebuild.test.ts）。
 * 這也是 `page_transactions` 作為系統關鍵資產的直接回報（04 §5.4）：
 * 斷線補傳、版本歷史、undo 的 transform 來源全部共用同一份 log。
 */
import type { BlockType, Operation, RichText } from '@kennote/shared-types';
import { HISTORY_BUCKET_MS, HISTORY_BUCKET_TX, type HistoryVersion } from '@kennote/shared-types';
import { removeChild, spliceChildren } from '../blocks/validate-ops.js';

export interface DocBlock {
  id: string;
  parentId: string | null;
  type: BlockType;
  props: Record<string, unknown>;
  content: RichText;
  children: string[];
}

export interface DocState {
  title: RichText;
  icon: string | null;
  cover: string | null;
  /** 根層 block 順序 */
  children: string[];
  blocks: Map<string, DocBlock>;
}

export function createEmptyDoc(): DocState {
  return { title: [], icon: null, cover: null, children: [], blocks: new Map() };
}

export function cloneDoc(doc: DocState): DocState {
  return {
    title: structuredClone(doc.title),
    icon: doc.icon,
    cover: doc.cover,
    children: [...doc.children],
    blocks: new Map(
      [...doc.blocks].map(([id, b]) => [
        id,
        { ...b, props: structuredClone(b.props), content: structuredClone(b.content), children: [...b.children] },
      ]),
    ),
  };
}

function readChildren(doc: DocState, parentId: string | null): string[] {
  if (parentId === null) return doc.children;
  return doc.blocks.get(parentId)?.children ?? [];
}

function writeChildren(doc: DocState, parentId: string | null, children: string[]): void {
  if (parentId === null) {
    doc.children = children;
    return;
  }
  const parent = doc.blocks.get(parentId);
  if (parent) parent.children = children;
}

function collectSubtree(doc: DocState, blockId: string, out: string[] = []): string[] {
  out.push(blockId);
  for (const child of doc.blocks.get(blockId)?.children ?? []) collectSubtree(doc, child, out);
  return out;
}

/** 套用一個 operation。未知 / M6 的 text.delta 一律忽略（重播必須容錯） */
export function applyOpToDoc(doc: DocState, op: Operation): void {
  switch (op.type) {
    case 'block.insert': {
      if (doc.blocks.has(op.blockId)) return; // 冪等
      doc.blocks.set(op.blockId, {
        id: op.blockId,
        parentId: op.parentId,
        type: op.blockType,
        props: op.props ?? {},
        content: op.content ?? [],
        children: [],
      });
      writeChildren(
        doc,
        op.parentId,
        spliceChildren(readChildren(doc, op.parentId), op.blockId, op.afterId),
      );
      return;
    }
    case 'block.update': {
      const block = doc.blocks.get(op.blockId);
      if (!block) return;
      if (op.patch.blockType !== undefined) block.type = op.patch.blockType;
      if (op.patch.props !== undefined) block.props = op.patch.props;
      if (op.patch.content !== undefined) block.content = op.patch.content;
      return;
    }
    case 'block.move': {
      const block = doc.blocks.get(op.blockId);
      if (!block) return;
      writeChildren(doc, block.parentId, removeChild(readChildren(doc, block.parentId), op.blockId));
      block.parentId = op.parentId;
      writeChildren(
        doc,
        op.parentId,
        spliceChildren(readChildren(doc, op.parentId), op.blockId, op.afterId),
      );
      return;
    }
    case 'block.delete': {
      const block = doc.blocks.get(op.blockId);
      if (!block) return;
      const ids = collectSubtree(doc, op.blockId);
      writeChildren(doc, block.parentId, removeChild(readChildren(doc, block.parentId), op.blockId));
      for (const id of ids) doc.blocks.delete(id);
      return;
    }
    case 'page.update': {
      if (op.patch.title !== undefined) doc.title = op.patch.title;
      if (op.patch.icon !== undefined) doc.icon = op.patch.icon;
      if (op.patch.cover !== undefined) doc.cover = op.patch.cover;
      return;
    }
    default:
      // text.delta（M6）與未知型別：重播時忽略，不讓歷史功能整個壞掉
      return;
  }
}

export function applyOpsToDoc(doc: DocState, ops: Operation[]): DocState {
  for (const op of ops) applyOpToDoc(doc, op);
  return doc;
}

/** 從 transaction log 重建到指定 seq（含）。seq = 0 → 空文件 */
export function rebuildAt(
  transactions: Array<{ seq: number; ops: Operation[] }>,
  targetSeq: number,
): DocState {
  const doc = createEmptyDoc();
  for (const tx of [...transactions].sort((a, b) => a.seq - b.seq)) {
    if (tx.seq > targetSeq) break;
    applyOpsToDoc(doc, tx.ops);
  }
  return doc;
}

/* ── 版本點聚合（HistoryPanel 的清單） ──────────────────── */

export function bucketVersions(
  transactions: Array<{ seq: number; appliedAt: string; actorId: string | null }>,
): HistoryVersion[] {
  const sorted = [...transactions].sort((a, b) => a.seq - b.seq);
  const versions: HistoryVersion[] = [];
  let current: (HistoryVersion & { startedAt: number }) | null = null;

  for (const tx of sorted) {
    const at = Date.parse(tx.appliedAt);
    const startNew =
      current === null ||
      current.txCount >= HISTORY_BUCKET_TX ||
      at - current.startedAt >= HISTORY_BUCKET_MS;

    if (startNew) {
      current = {
        seq: tx.seq,
        txCount: 0,
        at: tx.appliedAt,
        actorIds: [],
        startedAt: Number.isNaN(at) ? 0 : at,
      };
      versions.push(current);
    }
    if (!current) continue;
    current.seq = tx.seq;
    current.at = tx.appliedAt;
    current.txCount += 1;
    if (tx.actorId && !current.actorIds.includes(tx.actorId)) current.actorIds.push(tx.actorId);
  }

  // 最新的版本點排最前面
  return versions
    .map(({ seq, txCount, at, actorIds }) => ({ seq, txCount, at, actorIds }))
    .reverse();
}

/* ── 還原：current → target 的 ops ─────────────────────── */

function afterIdOf(children: string[], blockId: string): string | null {
  const idx = children.indexOf(blockId);
  return idx <= 0 ? null : (children[idx - 1] ?? null);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * 產生「把 current 變成 target」的 operation 陣列。
 * 還原是**再送一筆 transaction**，歷史不被改寫（04 §8 M5-13）。
 *
 * 順序很重要：先刪、再由上而下插入、最後修正排序與內容。
 */
export function diffDocs(current: DocState, target: DocState): Operation[] {
  const ops: Operation[] = [];

  // 1) 刪除目標狀態不存在的 block（父節點被刪時子孫會一起消失，所以跳過已被涵蓋的）
  const deleted = new Set<string>();
  for (const [id, block] of current.blocks) {
    if (target.blocks.has(id)) continue;
    let ancestor = block.parentId;
    let covered = false;
    while (ancestor) {
      if (!target.blocks.has(ancestor)) {
        covered = true;
        break;
      }
      ancestor = current.blocks.get(ancestor)?.parentId ?? null;
    }
    if (covered) continue;
    deleted.add(id);
    ops.push({ type: 'block.delete', blockId: id });
  }

  // 2) 由上而下插入新 block（父節點一定先於子節點）
  const visit = (parentId: string | null): void => {
    const children = parentId === null ? target.children : (target.blocks.get(parentId)?.children ?? []);
    let previous: string | null = null;
    for (const id of children) {
      const block = target.blocks.get(id);
      if (!block) continue;
      if (!current.blocks.has(id) || deleted.has(id)) {
        ops.push({
          type: 'block.insert',
          blockId: id,
          parentId,
          afterId: previous,
          blockType: block.type,
          props: block.props,
          content: block.content,
        });
      }
      previous = id;
      visit(id);
    }
  };
  visit(null);

  // 3) 既有 block：內容與型別
  for (const [id, block] of target.blocks) {
    const before = current.blocks.get(id);
    if (!before || deleted.has(id)) continue;
    const patch: { blockType?: BlockType; props?: Record<string, unknown>; content?: RichText } = {};
    if (before.type !== block.type) patch.blockType = block.type;
    if (!sameJson(before.props, block.props)) patch.props = block.props;
    if (!sameJson(before.content, block.content)) patch.content = block.content;
    if (Object.keys(patch).length > 0) ops.push({ type: 'block.update', blockId: id, patch });
  }

  // 4) 位置（父節點或前一個兄弟不同 → move）
  const targetParents = new Map<string, string | null>();
  const walk = (parentId: string | null): void => {
    const children = parentId === null ? target.children : (target.blocks.get(parentId)?.children ?? []);
    for (const id of children) {
      targetParents.set(id, parentId);
      walk(id);
    }
  };
  walk(null);

  for (const [id, parentId] of targetParents) {
    const before = current.blocks.get(id);
    if (!before || deleted.has(id)) continue; // 剛插入的已經在正確位置
    const targetChildren =
      parentId === null ? target.children : (target.blocks.get(parentId)?.children ?? []);
    const currentChildren =
      before.parentId === null ? current.children : (current.blocks.get(before.parentId)?.children ?? []);
    const targetAfter = afterIdOf(targetChildren, id);
    const currentAfter = afterIdOf(currentChildren, id);
    if (before.parentId !== parentId || targetAfter !== currentAfter) {
      ops.push({ type: 'block.move', blockId: id, parentId, afterId: targetAfter });
    }
  }

  // 5) 頁面 meta
  const pagePatch: { title?: RichText; icon?: string | null; cover?: string | null } = {};
  if (!sameJson(current.title, target.title)) pagePatch.title = target.title;
  if (current.icon !== target.icon) pagePatch.icon = target.icon;
  if (current.cover !== target.cover) pagePatch.cover = target.cover;
  if (Object.keys(pagePatch).length > 0) ops.push({ type: 'page.update', patch: pagePatch });

  return ops;
}
