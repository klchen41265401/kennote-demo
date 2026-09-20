/**
 * Demo 後端的「service 層」：頁面 / block / transaction 的核心語意。
 *
 * ⭐ 與伺服器一樣，**所有 block 變更只有這一條路徑**（`applyTransaction`），
 * REST `POST /api/pages/:id/transactions` 與假 WS 的 `tx` 訊息都走這裡。
 * op 語意逐條對照 `apps/server/src/modules/blocks/apply-transaction.ts`。
 */
import type {
  AuthUser,
  Block,
  Operation,
  Page,
  PageSnapshot,
  PageTreeNode,
  PublicUser,
  RichText,
  Transaction,
  TransactionResult,
} from '@kennote/shared-types';
import { commit, db, type DemoBlock, type DemoTransaction } from './store';
import {
  DemoApiError,
  bySortKey,
  lastSortKey,
  nowIso,
  plain,
  removeChild,
  sortKeyBetween,
  spliceChildren,
  uuid,
} from './util';

/* ── 讀取 ────────────────────────────────────────────────── */

export function currentUserId(): string {
  const id = db().sessionUserId;
  if (!id) throw new DemoApiError(401, 'UNAUTHORIZED', '尚未登入');
  return id;
}

export function currentUser(): AuthUser {
  const user = db().users[currentUserId()];
  if (!user) throw new DemoApiError(401, 'UNAUTHORIZED', '尚未登入');
  return user;
}

export function publicUser(userId: string | null): PublicUser | null {
  if (!userId) return null;
  const u = db().users[userId];
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl };
}

export function getPage(pageId: string, options: { includeDeleted?: boolean } = {}): Page {
  const page = db().pages[pageId];
  if (!page || (!options.includeDeleted && page.deletedAt)) {
    throw new DemoApiError(404, 'PAGE_NOT_FOUND', '頁面不存在或已被刪除');
  }
  return page;
}

export function livePages(workspaceId?: string): Page[] {
  return Object.values(db().pages).filter(
    (p) => !p.deletedAt && (!workspaceId || p.workspaceId === workspaceId),
  );
}

export function childrenOf(pageId: string | null, workspaceId: string): Page[] {
  return livePages(workspaceId)
    .filter((p) => p.parentId === pageId)
    .sort(bySortKey);
}

/** 頁面樹節點。database 的「列」不進樹（它們是 collection 的 row） */
export function toTreeNode(page: Page): PageTreeNode {
  const hasChildren = livePages(page.workspaceId).some(
    (p) => p.parentId === page.id && !isDatabaseRow(p),
  );
  return {
    id: page.id,
    workspaceId: page.workspaceId,
    parentId: page.parentId,
    title: plain(page.title) || '未命名',
    icon: page.icon,
    sortKey: page.sortKey,
    isDatabase: page.isDatabase,
    hasChildren,
    updatedAt: page.updatedAt,
  };
}

/** 是不是某個 collection 的列（列的 parentId 指向 database 的載體頁） */
export function isDatabaseRow(page: Page): boolean {
  const parent = page.parentId ? db().pages[page.parentId] : null;
  return Boolean(parent?.isDatabase) && !page.isDatabase;
}

export function collectDescendants(pageId: string): string[] {
  const out: string[] = [];
  const stack = [pageId];
  const all = Object.values(db().pages);
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const p of all) {
      if (p.parentId === id && !out.includes(p.id)) {
        out.push(p.id);
        stack.push(p.id);
      }
    }
  }
  return out;
}

/* ── 建立 ────────────────────────────────────────────────── */

export interface CreatePageInput {
  workspaceId: string;
  parentId?: string | null;
  title?: RichText;
  icon?: string | null;
  cover?: string | null;
  isDatabase?: boolean;
  /** 建立時自動插入一個空 paragraph（與伺服器一致） */
  seedParagraph?: boolean;
  afterId?: string | null;
}

export function createPage(input: CreatePageInput): Page {
  const state = db();
  const userId = state.sessionUserId;
  const parentId = input.parentId ?? null;
  const siblings = livePages(input.workspaceId)
    .filter((p) => p.parentId === parentId)
    .map((p) => p.sortKey);
  const at = nowIso();
  const page: Page = {
    id: uuid(),
    workspaceId: input.workspaceId,
    parentId,
    title: input.title ?? [],
    icon: input.icon ?? null,
    cover: input.cover ?? null,
    sortKey: lastSortKey(siblings),
    children: [],
    isDatabase: input.isDatabase ?? false,
    collectionId: null,
    properties: {},
    seq: 0,
    version: 1,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    createdBy: userId,
    updatedBy: userId,
  };
  state.pages[page.id] = page;
  if (input.seedParagraph !== false && !page.isDatabase) {
    applyTransaction(page.id, {
      txId: uuid(),
      pageId: page.id,
      originSessionId: 'demo-server',
      ops: [
        {
          type: 'block.insert',
          blockId: uuid(),
          parentId: null,
          afterId: null,
          blockType: 'paragraph',
          props: {},
          content: [],
        },
      ],
    });
  }
  commit();
  return page;
}

export function movePage(pageId: string, parentId: string | null, afterId?: string | null): Page {
  const page = getPage(pageId);
  if (parentId) {
    if (parentId === pageId || collectDescendants(pageId).includes(parentId)) {
      throw new DemoApiError(409, 'PAGE_CYCLE', '不能把頁面搬到自己的子頁面底下');
    }
    getPage(parentId);
  }
  page.parentId = parentId;
  const siblings = livePages(page.workspaceId)
    .filter((p) => p.parentId === parentId && p.id !== pageId)
    .sort(bySortKey);
  if (afterId === undefined) {
    page.sortKey = lastSortKey(siblings.map((p) => p.sortKey));
  } else if (afterId === null) {
    page.sortKey = sortKeyBetween(null, siblings[0]?.sortKey ?? null);
  } else {
    const idx = siblings.findIndex((p) => p.id === afterId);
    page.sortKey = sortKeyBetween(
      siblings[idx]?.sortKey ?? null,
      siblings[idx + 1]?.sortKey ?? null,
    );
  }
  page.updatedAt = nowIso();
  commit();
  return page;
}

export function softDeletePage(pageId: string): void {
  const at = nowIso();
  const ids = [pageId, ...collectDescendants(pageId)];
  for (const id of ids) {
    const p = db().pages[id];
    if (p && !p.deletedAt) {
      p.deletedAt = at;
      p.updatedAt = at;
    }
  }
  commit();
}

export function restorePage(pageId: string): void {
  const ids = [pageId, ...collectDescendants(pageId)];
  for (const id of ids) {
    const p = db().pages[id];
    if (p) {
      p.deletedAt = null;
      p.updatedAt = nowIso();
    }
  }
  commit();
}

export function permanentDeletePage(pageId: string): void {
  const state = db();
  const ids = [pageId, ...collectDescendants(pageId)];
  for (const id of ids) {
    const page = state.pages[id];
    delete state.pages[id];
    for (const [blockId, block] of Object.entries(state.blocks)) {
      if (block.pageId === id) delete state.blocks[blockId];
    }
    state.pageTransactions = state.pageTransactions.filter((t) => t.pageId !== id);
    state.favorites = state.favorites.filter((f) => f.pageId !== id);
    state.visits = state.visits.filter((v) => v.pageId !== id);
    if (page?.collectionId) {
      delete state.collections[page.collectionId];
      for (const [viewId, view] of Object.entries(state.views)) {
        if (view.collectionId === page.collectionId) delete state.views[viewId];
      }
    }
  }
  commit();
}

/** 深拷貝一頁（含 blocks 與子頁），內部頁面連結指向新複本 */
export function duplicatePage(pageId: string): Page {
  getPage(pageId); // 不存在就丟 404
  const idMap = new Map<string, string>();
  const order = [pageId, ...collectDescendants(pageId)];
  for (const id of order) idMap.set(id, uuid());

  const state = db();
  let root: Page | null = null;
  for (const id of order) {
    const original = state.pages[id];
    if (!original || original.deletedAt) continue;
    const newId = idMap.get(id)!;
    const copy: Page = {
      ...JSON.parse(JSON.stringify(original)),
      id: newId,
      parentId: id === pageId ? original.parentId : (idMap.get(original.parentId ?? '') ?? original.parentId),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      seq: 0,
    };
    if (id === pageId) {
      copy.title = [...(original.title ?? []), { text: ' (複本)' }] as RichText;
      const siblings = livePages(original.workspaceId).filter((p) => p.parentId === original.parentId);
      copy.sortKey = lastSortKey(siblings.map((p) => p.sortKey));
      root = copy;
    }
    const blockIdMap = new Map<string, string>();
    const blocks = Object.values(state.blocks).filter((b) => b.pageId === id && !b.deletedAt);
    for (const b of blocks) blockIdMap.set(b.id, uuid());
    copy.children = (original.children ?? []).map((c) => blockIdMap.get(c) ?? c);
    state.pages[newId] = copy;
    for (const b of blocks) {
      const nb: DemoBlock = JSON.parse(JSON.stringify(b));
      nb.id = blockIdMap.get(b.id)!;
      nb.pageId = newId;
      nb.parentId = b.parentId ? (blockIdMap.get(b.parentId) ?? null) : null;
      nb.children = (b.children ?? []).map((c) => blockIdMap.get(c) ?? c);
      // 子頁 block 指向新複本
      const props = nb.props as { pageId?: string };
      if (typeof props.pageId === 'string' && idMap.has(props.pageId)) {
        props.pageId = idMap.get(props.pageId)!;
      }
      state.blocks[nb.id] = nb;
    }
  }
  commit();
  if (!root) throw new DemoApiError(500, 'INTERNAL_ERROR', '複製失敗');
  return root;
}

/* ── snapshot ────────────────────────────────────────────── */

export function buildSnapshot(pageId: string): PageSnapshot {
  const page = getPage(pageId);
  const blocks = Object.values(db().blocks).filter((b) => b.pageId === pageId && !b.deletedAt);
  const blockMap: PageSnapshot['recordMap']['block'] = {};
  const userIds = new Set<string>();
  for (const b of blocks) {
    const { deletedAt: _deletedAt, workspaceId: _ws, ...rest } = b;
    blockMap[b.id] = { value: rest as Block, role: 'owner' };
    if (b.createdBy) userIds.add(b.createdBy);
    if (b.updatedBy) userIds.add(b.updatedBy);
  }
  if (page.createdBy) userIds.add(page.createdBy);
  const users: PageSnapshot['recordMap']['user'] = {};
  for (const id of userIds) {
    const u = publicUser(id);
    if (u) users[id] = { value: u, role: 'reader' };
  }
  return {
    pageId,
    seq: page.seq,
    rootBlockIds: page.children ?? [],
    recordMap: {
      page: { [page.id]: { value: page, role: 'owner' } },
      block: blockMap,
      user: users,
    },
  };
}

/* ── applyTransaction ────────────────────────────────────── */

function readChildren(pageId: string, parentId: string | null): string[] {
  if (parentId === null) return db().pages[pageId]?.children ?? [];
  const parent = db().blocks[parentId];
  if (!parent || parent.deletedAt) {
    throw new DemoApiError(404, 'BLOCK_NOT_FOUND', '找不到父區塊', { parentId });
  }
  return parent.children ?? [];
}

function writeChildren(pageId: string, parentId: string | null, children: string[]): void {
  if (parentId === null) {
    const page = db().pages[pageId];
    if (page) page.children = children;
    return;
  }
  const parent = db().blocks[parentId];
  if (parent) parent.children = children;
}

function blockDescendants(blockId: string): string[] {
  const out: string[] = [];
  const stack = [blockId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    out.push(id);
    const b = db().blocks[id];
    for (const child of b?.children ?? []) stack.push(child);
  }
  return out;
}

function isBlockDescendantOf(candidateId: string, ancestorId: string): boolean {
  let cursor: string | null = candidateId;
  const guard = new Set<string>();
  while (cursor) {
    if (guard.has(cursor)) return false;
    guard.add(cursor);
    if (cursor === ancestorId) return true;
    cursor = db().blocks[cursor]?.parentId ?? null;
  }
  return false;
}

function applyOne(
  pageId: string,
  userId: string,
  op: Operation,
  conflicts: string[],
  emitted: Operation[],
  history: Operation[],
): void {
  const state = db();
  const at = nowIso();
  if (op.type !== 'text.delta' && op.type !== 'block.update') {
    emitted.push(op);
    history.push(op);
  }
  switch (op.type) {
    case 'block.insert': {
      if (op.parentId !== null) {
        const parent = state.blocks[op.parentId];
        if (!parent || parent.pageId !== pageId || parent.deletedAt) {
          throw new DemoApiError(404, 'BLOCK_NOT_FOUND', '找不到父區塊', { parentId: op.parentId });
        }
      }
      if (state.blocks[op.blockId]) return; // 冪等
      const page = state.pages[pageId]!;
      state.blocks[op.blockId] = {
        id: op.blockId,
        pageId,
        workspaceId: page.workspaceId,
        parentId: op.parentId,
        type: op.blockType,
        props: (op.props ?? {}) as DemoBlock['props'],
        content: op.content ?? [],
        children: [],
        version: 1,
        createdAt: at,
        updatedAt: at,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
      };
      writeChildren(
        pageId,
        op.parentId,
        spliceChildren(readChildren(pageId, op.parentId), op.blockId, op.afterId),
      );
      return;
    }

    case 'block.update': {
      const block = state.blocks[op.blockId];
      if (!block || block.pageId !== pageId || block.deletedAt) {
        throw new DemoApiError(404, 'BLOCK_NOT_FOUND', '找不到區塊', { blockId: op.blockId });
      }
      if (op.baseVersion !== undefined && op.baseVersion !== block.version) {
        conflicts.push(op.blockId);
      }
      if (op.patch.blockType !== undefined) block.type = op.patch.blockType;
      if (op.patch.props !== undefined) {
        block.props = { ...block.props, ...op.patch.props } as DemoBlock['props'];
      }
      if (op.patch.content !== undefined) block.content = op.patch.content;
      block.version += 1;
      block.updatedAt = at;
      block.updatedBy = userId;
      emitted.push(op);
      history.push(op);
      return;
    }

    case 'block.move': {
      const block = state.blocks[op.blockId];
      if (!block || block.pageId !== pageId || block.deletedAt) {
        throw new DemoApiError(404, 'BLOCK_NOT_FOUND', '找不到區塊', { blockId: op.blockId });
      }
      if (op.parentId !== null) {
        const parent = state.blocks[op.parentId];
        if (!parent || parent.pageId !== pageId || parent.deletedAt) {
          throw new DemoApiError(404, 'BLOCK_NOT_FOUND', '找不到父區塊', { parentId: op.parentId });
        }
        if (isBlockDescendantOf(op.parentId, op.blockId)) {
          throw new DemoApiError(400, 'INVALID_OPERATION', '無法把區塊搬移到自己的子區塊底下');
        }
      }
      writeChildren(pageId, block.parentId, removeChild(readChildren(pageId, block.parentId), op.blockId));
      block.parentId = op.parentId;
      block.updatedAt = at;
      block.updatedBy = userId;
      writeChildren(
        pageId,
        op.parentId,
        spliceChildren(readChildren(pageId, op.parentId), op.blockId, op.afterId),
      );
      return;
    }

    case 'block.delete': {
      const block = state.blocks[op.blockId];
      if (!block || block.pageId !== pageId || block.deletedAt) return; // 冪等
      for (const id of blockDescendants(op.blockId)) {
        const b = state.blocks[id];
        if (b) {
          b.deletedAt = at;
          b.updatedAt = at;
        }
      }
      writeChildren(pageId, block.parentId, removeChild(readChildren(pageId, block.parentId), op.blockId));
      return;
    }

    case 'page.update': {
      const page = state.pages[pageId]!;
      if (op.patch.title !== undefined) page.title = op.patch.title;
      if (op.patch.icon !== undefined) page.icon = op.patch.icon;
      if (op.patch.cover !== undefined) page.cover = op.patch.cover;
      page.updatedAt = at;
      page.updatedBy = userId;
      page.version += 1;
      return;
    }

    case 'text.delta': {
      // Demo 後端一律回報 features.ot = false，前端不會送 text.delta。
      throw new DemoApiError(501, 'NOT_IMPLEMENTED', 'Demo 模式不支援 OT（/api/health 已回報 ot=false）');
    }
  }
}

export type DemoBroadcast = (result: TransactionResult, originSessionId: string) => void;
let broadcast: DemoBroadcast = () => {};
export function setDemoBroadcaster(fn: DemoBroadcast): void {
  broadcast = fn;
}

export function applyTransaction(pageId: string, input: Transaction): TransactionResult {
  const state = db();
  const userId = state.sessionUserId ?? 'demo-user';
  const page = state.pages[pageId];
  if (!page || page.deletedAt) throw new DemoApiError(404, 'PAGE_NOT_FOUND', '頁面不存在或已被刪除');

  // 冪等：同一個 txId 重送直接回上次結果
  const existing = state.pageTransactions.find((t) => t.txId === input.txId);
  if (existing) return existing.result;

  if (!Array.isArray(input.ops) || input.ops.length === 0) {
    throw new DemoApiError(400, 'INVALID_OPERATION', 'transaction 至少要有一個 operation');
  }
  if (input.ops.length > 200) {
    throw new DemoApiError(413, 'TRANSACTION_TOO_LARGE', 'transaction 超過 200 個 operation');
  }

  const conflicts: string[] = [];
  const emitted: Operation[] = [];
  const history: Operation[] = [];
  for (const op of input.ops) applyOne(pageId, userId, op, conflicts, emitted, history);

  page.seq += 1;
  page.updatedAt = nowIso();
  page.updatedBy = userId;

  const result: TransactionResult = {
    txId: input.txId,
    pageId,
    seq: page.seq,
    ops: emitted,
    appliedAt: nowIso(),
    actorId: userId,
    ...(conflicts.length > 0 ? { conflicts } : {}),
  };
  const record: DemoTransaction = {
    txId: input.txId,
    pageId,
    seq: page.seq,
    ops: history,
    result,
    actorId: userId,
    originSessionId: input.originSessionId,
    createdAt: result.appliedAt,
  };
  state.pageTransactions.push(record);
  commit();
  broadcast(result, input.originSessionId);
  return result;
}

export function transactionsSince(pageId: string, since: number, limit = 200): TransactionResult[] {
  return db()
    .pageTransactions.filter((t) => t.pageId === pageId && t.seq > since)
    .sort((a, b) => a.seq - b.seq)
    .slice(0, limit)
    .map((t) => t.result);
}

/**
 * 版本歷史：從 operation log 重播到某個 seq。
 * 與伺服器一樣，**不另存快照**。
 */
export function rebuildSnapshotAt(pageId: string, seq: number): PageSnapshot {
  const page = getPage(pageId);
  const txs = db()
    .pageTransactions.filter((t) => t.pageId === pageId && t.seq <= seq)
    .sort((a, b) => a.seq - b.seq);

  const blocks: Record<string, Block> = {};
  let rootChildren: string[] = [];
  const meta = { title: page.title, icon: page.icon, cover: page.cover };

  const children = (parentId: string | null): string[] =>
    parentId === null ? rootChildren : (blocks[parentId]?.children ?? []);
  const setChildren = (parentId: string | null, next: string[]): void => {
    if (parentId === null) rootChildren = next;
    else if (blocks[parentId]) blocks[parentId]!.children = next;
  };

  for (const tx of txs) {
    for (const op of tx.ops) {
      switch (op.type) {
        case 'block.insert':
          blocks[op.blockId] = {
            id: op.blockId,
            pageId,
            parentId: op.parentId,
            type: op.blockType,
            props: (op.props ?? {}) as Block['props'],
            content: op.content ?? [],
            children: [],
            version: 1,
            createdAt: tx.createdAt,
            updatedAt: tx.createdAt,
            createdBy: tx.actorId,
            updatedBy: tx.actorId,
          };
          setChildren(op.parentId, spliceChildren(children(op.parentId), op.blockId, op.afterId));
          break;
        case 'block.update': {
          const b = blocks[op.blockId];
          if (!b) break;
          if (op.patch.blockType !== undefined) b.type = op.patch.blockType;
          if (op.patch.props !== undefined) b.props = { ...b.props, ...op.patch.props } as Block['props'];
          if (op.patch.content !== undefined) b.content = op.patch.content;
          b.version += 1;
          b.updatedAt = tx.createdAt;
          break;
        }
        case 'block.move': {
          const b = blocks[op.blockId];
          if (!b) break;
          setChildren(b.parentId, removeChild(children(b.parentId), op.blockId));
          b.parentId = op.parentId;
          setChildren(op.parentId, spliceChildren(children(op.parentId), op.blockId, op.afterId));
          break;
        }
        case 'block.delete': {
          const b = blocks[op.blockId];
          if (!b) break;
          const stack = [op.blockId];
          while (stack.length > 0) {
            const id = stack.pop()!;
            for (const c of blocks[id]?.children ?? []) stack.push(c);
            delete blocks[id];
          }
          setChildren(b.parentId, removeChild(children(b.parentId), op.blockId));
          break;
        }
        case 'page.update':
          if (op.patch.title !== undefined) meta.title = op.patch.title;
          if (op.patch.icon !== undefined) meta.icon = op.patch.icon;
          if (op.patch.cover !== undefined) meta.cover = op.patch.cover;
          break;
        default:
          break;
      }
    }
  }

  const blockMap: PageSnapshot['recordMap']['block'] = {};
  for (const [id, value] of Object.entries(blocks)) blockMap[id] = { value, role: 'owner' };
  const snapshotPage: Page = { ...page, ...meta, children: rootChildren, seq };
  const users: PageSnapshot['recordMap']['user'] = {};
  const me = publicUser(db().sessionUserId);
  if (me) users[me.id] = { value: me, role: 'reader' };

  return {
    pageId,
    seq,
    rootBlockIds: rootChildren,
    recordMap: { page: { [pageId]: { value: snapshotPage, role: 'owner' } }, block: blockMap, user: users },
  };
}
