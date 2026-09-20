/**
 * 工作區 / 頁面 / transaction / 版本歷史 / 垃圾桶 / 最愛 / 最近造訪。
 *
 * ⚠️ 字面路徑（`/api/pages/favorites`）必須**排在** `/api/pages/:id` 前面，
 * router 是「先註冊先比對」。
 */
import type {
  HistoryListResponse,
  Page,
  PageTreeNode,
  RichText,
  Transaction,
  TrashedPage,
} from '@kennote/shared-types';
import { HISTORY_BUCKET_MS, HISTORY_BUCKET_TX } from '@kennote/shared-types';
import { commit, db } from '../store';
import {
  applyTransaction,
  buildSnapshot,
  collectDescendants,
  createPage,
  currentUserId,
  duplicatePage,
  getPage,
  isDatabaseRow,
  livePages,
  movePage,
  permanentDeletePage,
  rebuildSnapshotAt,
  restorePage,
  softDeletePage,
  toTreeNode,
  transactionsSince,
} from '../core';
import type { DemoHandler } from '../router';
import { DemoApiError, bySortKey, jsonOk, noContent, nowIso, plain, uuid } from '../util';

function requireWorkspaceId(req: { query: URLSearchParams }): string {
  const id = req.query.get('workspaceId');
  if (id) return id;
  const first = Object.values(db().workspaces).find((w) => !w.deletedAt);
  if (!first) throw new DemoApiError(404, 'WORKSPACE_NOT_FOUND', '找不到工作區');
  return first.id;
}

function treeNodeOf(pageId: string): PageTreeNode | null {
  const page = db().pages[pageId];
  if (!page || page.deletedAt) return null;
  return toTreeNode(page);
}

export const workspaceRoutes: Array<[string, DemoHandler]> = [
  ['GET /api/workspaces', () => jsonOk(Object.values(db().workspaces).filter((w) => !w.deletedAt))],
  [
    'POST /api/workspaces',
    async (req) => {
      const body = (await req.json<{ name?: string }>()) ?? {};
      const id = uuid();
      db().workspaces[id] = {
        id,
        name: body.name ?? '未命名工作區',
        slug: `ws-${id.slice(0, 6)}`,
        icon: null,
        role: 'owner',
        createdAt: nowIso(),
        deletedAt: null,
      };
      commit();
      return jsonOk(db().workspaces[id]);
    },
  ],
  [
    'GET /api/workspaces/:id/tree',
    (req) =>
      jsonOk(
        livePages(req.params.id!)
          .filter((p) => !isDatabaseRow(p))
          .sort(bySortKey)
          .map(toTreeNode),
      ),
  ],
  [
    'PATCH /api/workspaces/:id',
    async (req) => {
      const ws = db().workspaces[req.params.id!];
      if (!ws) throw new DemoApiError(404, 'WORKSPACE_NOT_FOUND', '找不到工作區');
      const patch = (await req.json<{ name?: string; icon?: string | null; slug?: string }>()) ?? {};
      if (patch.name !== undefined) ws.name = patch.name;
      if (patch.icon !== undefined) ws.icon = patch.icon;
      if (patch.slug !== undefined) ws.slug = patch.slug;
      commit();
      return jsonOk(ws);
    },
  ],
  [
    'DELETE /api/workspaces/:id',
    (req) => {
      const ws = db().workspaces[req.params.id!];
      if (ws) ws.deletedAt = nowIso();
      commit();
      return noContent();
    },
  ],
  [
    'GET /api/workspaces/:id/members',
    (req) => {
      const userId = currentUserId();
      const user = db().users[userId]!;
      return jsonOk([
        {
          workspaceId: req.params.id!,
          userId,
          role: 'owner',
          joinedAt: user.createdAt,
          user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl },
        },
      ]);
    },
  ],
  [
    'POST /api/workspaces/:id/invites',
    () => {
      throw new DemoApiError(501, 'NOT_IMPLEMENTED', 'Demo 模式沒有其他成員可以邀請');
    },
  ],
  ['PATCH /api/workspaces/:id/members/:userId', () => noContent()],
  ['DELETE /api/workspaces/:id/members/:userId', () => noContent()],
];

export const pageRoutes: Array<[string, DemoHandler]> = [
  /* ── 字面路徑先註冊 ─────────────────────────────── */
  [
    'GET /api/pages/favorites',
    (req) => {
      const wsId = requireWorkspaceId(req);
      return jsonOk(
        db()
          .favorites.filter((f) => db().pages[f.pageId]?.workspaceId === wsId)
          .map((f) => treeNodeOf(f.pageId))
          .filter((n): n is PageTreeNode => n !== null),
      );
    },
  ],
  ['GET /api/pages/shared-with-me', () => jsonOk([])],
  ['GET /api/pages/recent', (req) => jsonOk(recentNodes(requireWorkspaceId(req)))],
  ['GET /api/recent', (req) => jsonOk(recentNodes(requireWorkspaceId(req)))],

  /* ── CRUD ────────────────────────────────────────── */
  [
    'POST /api/pages',
    async (req) => {
      const body = (await req.json<{
        workspaceId?: string;
        parentId?: string | null;
        title?: RichText | string;
        icon?: string | null;
      }>()) ?? {};
      const workspaceId = body.workspaceId ?? requireWorkspaceId(req);
      const title: RichText =
        typeof body.title === 'string' ? [{ text: body.title }] : (body.title ?? []);
      return jsonOk(
        createPage({
          workspaceId,
          parentId: body.parentId ?? null,
          title,
          icon: body.icon ?? null,
        }),
      );
    },
  ],
  ['GET /api/pages/:id', (req) => jsonOk(getPage(req.params.id!))],
  ['GET /api/pages/:id/snapshot', (req) => jsonOk(buildSnapshot(req.params.id!))],
  [
    'PATCH /api/pages/:id',
    async (req) => {
      const page = getPage(req.params.id!);
      const patch = (await req.json<Partial<Page> & { title?: RichText }>()) ?? {};
      const target = page as unknown as Record<string, unknown>;
      for (const key of ['title', 'icon', 'cover', 'properties'] as const) {
        if (patch[key] !== undefined) target[key] = patch[key];
      }
      page.updatedAt = nowIso();
      page.updatedBy = currentUserId();
      page.version += 1;
      // collection 的名稱跟著載體頁標題走
      if (patch.title !== undefined && page.collectionId) {
        const collection = db().collections[page.collectionId];
        if (collection) collection.name = patch.title;
      }
      commit();
      return jsonOk(page);
    },
  ],
  [
    'DELETE /api/pages/:id',
    (req) => {
      getPage(req.params.id!);
      softDeletePage(req.params.id!);
      return noContent();
    },
  ],
  [
    'POST /api/pages/:id/restore',
    (req) => {
      restorePage(req.params.id!);
      return jsonOk(getPage(req.params.id!));
    },
  ],
  [
    'DELETE /api/pages/:id/permanent',
    (req) => {
      permanentDeletePage(req.params.id!);
      return noContent();
    },
  ],
  [
    'POST /api/pages/:id/move',
    async (req) => {
      const body = (await req.json<{ parentId?: string | null; afterId?: string | null }>()) ?? {};
      return jsonOk(movePage(req.params.id!, body.parentId ?? null, body.afterId));
    },
  ],
  [
    'POST /api/pages/:id/duplicate',
    (req) => jsonOk({ page: duplicatePage(req.params.id!) }),
  ],
  [
    'POST /api/pages/:id/blocks/move-to',
    async (req) => {
      const body = (await req.json<{ blockIds?: string[]; targetPageId?: string; afterId?: string | null }>()) ?? {};
      const sourceId = req.params.id!;
      const targetId = body.targetPageId;
      if (!targetId) throw new DemoApiError(400, 'BAD_REQUEST', '缺少 targetPageId');
      getPage(targetId);
      const ids = body.blockIds ?? [];
      const state = db();
      // 1. 從來源頁刪掉（走 applyTransaction，歷史才有紀錄）
      applyTransaction(sourceId, {
        txId: uuid(),
        pageId: sourceId,
        originSessionId: 'demo-server',
        ops: ids.map((blockId) => ({ type: 'block.delete' as const, blockId })),
      });
      // 2. 在目標頁重建（含子孫）
      const inserts: Transaction['ops'] = [];
      let after: string | null = body.afterId ?? null;
      const walk = (blockId: string, parentId: string | null, afterId: string | null): string | null => {
        const block = state.blocks[blockId];
        if (!block) return afterId;
        const newId = uuid();
        inserts.push({
          type: 'block.insert',
          blockId: newId,
          parentId,
          afterId,
          blockType: block.type,
          props: block.props as Record<string, unknown>,
          content: block.content,
        });
        let childAfter: string | null = null;
        for (const child of block.children ?? []) childAfter = walk(child, newId, childAfter);
        return newId;
      };
      for (const id of ids) after = walk(id, null, after);
      if (inserts.length > 0) {
        applyTransaction(targetId, {
          txId: uuid(),
          pageId: targetId,
          originSessionId: 'demo-server',
          ops: inserts,
        });
      }
      return jsonOk({ movedCount: ids.length, targetPageId: targetId });
    },
  ],

  /* ── transactions ────────────────────────────────── */
  [
    'POST /api/pages/:id/transactions',
    async (req) => {
      const body = await req.json<Transaction>();
      if (!body) throw new DemoApiError(400, 'BAD_REQUEST', '缺少 transaction');
      return jsonOk(applyTransaction(req.params.id!, { ...body, pageId: req.params.id! }));
    },
  ],
  [
    'GET /api/pages/:id/transactions',
    (req) => jsonOk(transactionsSince(req.params.id!, Number(req.query.get('since') ?? 0))),
  ],

  /* ── 版本歷史 ────────────────────────────────────── */
  [
    'GET /api/pages/:id/history',
    (req) => {
      const pageId = req.params.id!;
      const page = getPage(pageId);
      const txs = db()
        .pageTransactions.filter((t) => t.pageId === pageId)
        .sort((a, b) => a.seq - b.seq);
      const versions: HistoryListResponse['versions'] = [];
      let bucket: { seq: number; txCount: number; at: string; actorIds: string[]; startMs: number } | null = null;
      for (const tx of txs) {
        const ms = Date.parse(tx.createdAt);
        if (
          !bucket ||
          bucket.txCount >= HISTORY_BUCKET_TX ||
          ms - bucket.startMs > HISTORY_BUCKET_MS
        ) {
          if (bucket) versions.push({ seq: bucket.seq, txCount: bucket.txCount, at: bucket.at, actorIds: bucket.actorIds });
          bucket = { seq: tx.seq, txCount: 0, at: tx.createdAt, actorIds: [], startMs: ms };
        }
        bucket.seq = tx.seq;
        bucket.at = tx.createdAt;
        bucket.txCount += 1;
        if (!bucket.actorIds.includes(tx.actorId)) bucket.actorIds.push(tx.actorId);
      }
      if (bucket) versions.push({ seq: bucket.seq, txCount: bucket.txCount, at: bucket.at, actorIds: bucket.actorIds });
      versions.reverse();
      return jsonOk({ pageId, currentSeq: page.seq, versions } satisfies HistoryListResponse);
    },
  ],
  [
    'GET /api/pages/:id/history/:seq',
    (req) => {
      const pageId = req.params.id!;
      const seq = Number(req.params.seq);
      const tx = db().pageTransactions.find((t) => t.pageId === pageId && t.seq === seq);
      return jsonOk({
        pageId,
        seq,
        at: tx?.createdAt ?? null,
        snapshot: rebuildSnapshotAt(pageId, seq),
      });
    },
  ],
  [
    'POST /api/pages/:id/history/:seq/restore',
    (req) => {
      const pageId = req.params.id!;
      const seq = Number(req.params.seq);
      const target = rebuildSnapshotAt(pageId, seq);
      const current = buildSnapshot(pageId);
      const ops: Transaction['ops'] = [];
      // 1. 現在有、歷史沒有的 block → 刪
      for (const id of Object.keys(current.recordMap.block)) {
        if (!target.recordMap.block[id]) ops.push({ type: 'block.delete', blockId: id });
      }
      // 2. 歷史有的 block → 插入或覆蓋
      const emit = (blockId: string, parentId: string | null, afterId: string | null): void => {
        const entry = target.recordMap.block[blockId];
        if (!entry) return;
        const b = entry.value;
        if (current.recordMap.block[blockId]) {
          ops.push({
            type: 'block.update',
            blockId,
            patch: { blockType: b.type, props: b.props as Record<string, unknown>, content: b.content },
          });
          ops.push({ type: 'block.move', blockId, parentId, afterId });
        } else {
          ops.push({
            type: 'block.insert',
            blockId,
            parentId,
            afterId,
            blockType: b.type,
            props: b.props as Record<string, unknown>,
            content: b.content,
          });
        }
        let prev: string | null = null;
        for (const child of b.children ?? []) {
          emit(child, blockId, prev);
          prev = child;
        }
      };
      let prevRoot: string | null = null;
      for (const id of target.rootBlockIds) {
        emit(id, null, prevRoot);
        prevRoot = id;
      }
      const restoredTitle = target.recordMap.page[pageId]?.value.title;
      if (restoredTitle) ops.push({ type: 'page.update', patch: { title: restoredTitle } });

      const result = applyTransaction(pageId, {
        txId: uuid(),
        pageId,
        originSessionId: 'demo-restore',
        ops: ops.length > 0 ? ops : [{ type: 'page.update', patch: {} }],
      });
      return jsonOk({ pageId, restoredFromSeq: seq, newSeq: result.seq, opCount: ops.length });
    },
  ],

  /* ── 最愛 / 造訪 ─────────────────────────────────── */
  [
    'POST /api/pages/:id/favorite',
    (req) => {
      const pageId = req.params.id!;
      getPage(pageId);
      const userId = currentUserId();
      if (!db().favorites.some((f) => f.pageId === pageId && f.userId === userId)) {
        db().favorites.push({ pageId, userId, at: nowIso() });
      }
      commit();
      return jsonOk({ pageId, favorite: true });
    },
  ],
  [
    'DELETE /api/pages/:id/favorite',
    (req) => {
      const pageId = req.params.id!;
      db().favorites = db().favorites.filter((f) => f.pageId !== pageId);
      commit();
      return noContent();
    },
  ],
  [
    'POST /api/pages/:id/visit',
    (req) => {
      const pageId = req.params.id!;
      const state = db();
      if (state.pages[pageId] && !state.pages[pageId]!.deletedAt) {
        state.visits = state.visits.filter((v) => v.pageId !== pageId);
        state.visits.push({ pageId, userId: currentUserId(), at: nowIso() });
        if (state.visits.length > 100) state.visits = state.visits.slice(-100);
        commit();
      }
      return noContent();
    },
  ],
];

function recentNodes(workspaceId: string): PageTreeNode[] {
  const visits = [...db().visits].sort((a, b) => (a.at < b.at ? 1 : -1));
  const out: PageTreeNode[] = [];
  for (const v of visits) {
    const page = db().pages[v.pageId];
    if (!page || page.deletedAt || page.workspaceId !== workspaceId) continue;
    out.push(toTreeNode(page));
    if (out.length >= 10) break;
  }
  return out;
}

export const trashRoutes: Array<[string, DemoHandler]> = [
  [
    'GET /api/trash',
    (req) => {
      const workspaceId = requireWorkspaceId(req);
      const state = db();
      const deleted = Object.values(state.pages).filter(
        (p) => p.deletedAt && p.workspaceId === workspaceId,
      );
      // 只列「最上層」被刪的頁（子孫跟著走，不要列兩次）
      const deletedIds = new Set(deleted.map((p) => p.id));
      const roots = deleted.filter((p) => !p.parentId || !deletedIds.has(p.parentId));
      return jsonOk(
        roots.map((p): TrashedPage => {
          const parent = p.parentId ? state.pages[p.parentId] : null;
          const collectionId = parent?.collectionId ?? null;
          return {
            ...toTreeNode(p),
            deletedAt: p.deletedAt!,
            collectionId,
            collectionTitle: collectionId ? plain(state.collections[collectionId]?.name) : null,
          };
        }),
      );
    },
  ],
  [
    'DELETE /api/trash',
    (req) => {
      const workspaceId = requireWorkspaceId(req);
      const ids = Object.values(db().pages)
        .filter((p) => p.deletedAt && p.workspaceId === workspaceId)
        .map((p) => p.id);
      for (const id of ids) if (db().pages[id]) permanentDeletePage(id);
      return jsonOk({ deleted: ids.length, skipped: 0 });
    },
  ],
];

export { collectDescendants, requireWorkspaceId };
