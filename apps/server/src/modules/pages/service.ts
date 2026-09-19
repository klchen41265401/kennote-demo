/**
 * 頁面商業邏輯。**這一層不認識 HTTP**（04 §7.3 鐵則 1）——
 * 同一份邏輯之後要同時被 REST route 與 WS handler 呼叫。
 */
import type {
  CreatePageRequest,
  Page,
  PageSnapshot,
  PublicUser,
  RichText,
  TrashedPage,
} from '@kennote/shared-types';
import { db, withTransaction } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { AppError, pageNotFound, workspaceNotFound } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { applyTransaction } from '../blocks/apply-transaction.js';
import { listBlocksByPage, toBlock } from '../blocks/repo.js';
import { requirePagePermission } from '../permissions/service.js';
import { getMemberRole } from '../workspaces/repo.js';
import * as repo from './repo.js';

async function assertMember(workspaceId: string, userId: string, conn = db): Promise<void> {
  const role = await getMemberRole(workspaceId, userId, conn);
  if (!role) throw workspaceNotFound();
}

/**
 * 建立頁面。
 * **頁面建立時自動建立一個空 paragraph block** —— 而且是走 applyTransaction()，
 * 不是直接 INSERT，這樣「所有 block 變更必經單一抽象層」這條紀律才是真的。
 */
export async function createPage(input: CreatePageRequest, userId: string): Promise<Page> {
  return withTransaction(async (tx) => {
    await assertMember(input.workspaceId, userId, tx);

    const parentId = input.parentId ?? null;
    if (parentId) {
      const parent = await repo.findPageForUser(parentId, userId, tx);
      if (!parent || parent.workspace_id !== input.workspaceId) throw pageNotFound();
    }

    const sortKey = await repo.computeSortKey(
      input.workspaceId,
      parentId,
      input.afterId === undefined ? undefined : input.afterId,
      tx,
    );

    const row = await repo.insertPage(tx, {
      workspaceId: input.workspaceId,
      parentId,
      title: input.title ?? [],
      icon: input.icon ?? null,
      sortKey,
      isDatabase: input.isDatabase ?? false,
      createdBy: userId,
    });

    if (!input.isDatabase) {
      await applyTransaction(
        { pageId: row.id, userId },
        {
          txId: uuidv7(),
          pageId: row.id,
          originSessionId: 'server:page-create',
          ops: [
            {
              type: 'block.insert',
              blockId: uuidv7(),
              parentId: null,
              afterId: null,
              blockType: 'paragraph',
              props: {},
              content: [],
            },
          ],
        },
        tx,
      );
    }

    const fresh = await repo.findPageById(row.id, tx);
    return repo.toPage(fresh ?? row);
  });
}

export async function getPage(pageId: string, userId: string): Promise<Page> {
  const row = await repo.findPageForUser(pageId, userId);
  if (!row) throw pageNotFound();
  return repo.toPage(row);
}

/**
 * GET /api/pages/:id/snapshot —— 初次載入。
 * 回 03 §9.1 的 record_map 形狀（扁平 normalized map + sync seq），
 * 讓 HTTP 載入與 WebSocket 訂閱之間沒有空窗。
 */
export async function getSnapshot(pageId: string, userId: string): Promise<PageSnapshot> {
  const pageRow = await repo.findPageForUser(pageId, userId);
  if (!pageRow) throw pageNotFound();

  const page = repo.toPage(pageRow);
  const blockRows = await listBlocksByPage(pageId);
  const blocks = blockRows.map(toBlock);

  const userIds = new Set<string>();
  for (const id of [page.createdBy, page.updatedBy]) if (id) userIds.add(id);
  for (const b of blocks) {
    if (b.createdBy) userIds.add(b.createdBy);
    if (b.updatedBy) userIds.add(b.updatedBy);
  }

  const users =
    userIds.size === 0
      ? []
      : await db.query<{ id: string; name: string; email: string; avatar_url: string | null }>(sql`
          SELECT id, name, email::text AS email, avatar_url
            FROM users WHERE id = ANY(${[...userIds]}::uuid[])
        `);

  const role = 'editor' as const;
  const snapshot: PageSnapshot = {
    pageId,
    seq: page.seq,
    rootBlockIds: page.children,
    recordMap: {
      page: { [page.id]: { value: page, role } },
      block: Object.fromEntries(blocks.map((b) => [b.id, { value: b, role }])),
      user: Object.fromEntries(
        users.map((u): [string, { value: PublicUser; role: typeof role }] => [
          u.id,
          {
            value: { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatar_url },
            role,
          },
        ]),
      ),
    },
  };
  return snapshot;
}

export async function patchPage(
  pageId: string,
  userId: string,
  patch: { title?: RichText; icon?: string | null; cover?: string | null },
): Promise<Page> {
  const row = await repo.findPageForUser(pageId, userId);
  if (!row) throw pageNotFound();
  /*
   * 第五輪 BUG-27：`findPageForUser` 只回答「看不看得見」，不看權限等級 ——
   * 所以只有 comment / read 權限的人（例如被分享進來的 guest）可以改標題、
   * 換 icon、換封面。block 的寫入早就有 permission guard 了
   * （permissions/service.ts 的 registerPermissionGuard），頁面 meta 漏掉了。
   */
  await requirePagePermission(userId, pageId, 'edit');
  const updated = await repo.updatePageMeta(db, pageId, patch, userId);
  if (!updated) throw pageNotFound();
  return repo.toPage(updated);
}

/** 軟刪除：子孫一併進垃圾桶 */
export async function deletePage(pageId: string, userId: string): Promise<{ deleted: string[] }> {
  return withTransaction(async (tx) => {
    const row = await repo.findPageForUser(pageId, userId, tx);
    if (!row) throw pageNotFound();
    // BUG-27：只有 comment / read 權限的人不能把整棵子樹丟進垃圾桶
    await requirePagePermission(userId, pageId, 'edit', tx);
    const ids = await repo.collectDescendantIds(pageId, tx);
    await repo.softDeleteSubtree(tx, ids, userId);
    return { deleted: ids };
  });
}

/** 還原：子孫一併還原 */
export async function restorePage(pageId: string, userId: string): Promise<Page> {
  return withTransaction(async (tx) => {
    const row = await repo.findPageForUser(pageId, userId, tx, { includeDeleted: true });
    if (!row) throw pageNotFound();
    if (row.deleted_at === null) throw new AppError('PAGE_ALREADY_DELETED', '這個頁面不在垃圾桶裡');
    const ids = await repo.collectDescendantIds(pageId, tx, { includeDeleted: true });
    await repo.restoreSubtree(tx, ids, userId);
    // 父頁面若還在垃圾桶，還原後改掛到頂層，避免變成看不見的孤兒
    if (row.parent_id) {
      const parent = await repo.findPageById(row.parent_id, tx);
      if (!parent) {
        const sortKey = await repo.computeSortKey(row.workspace_id, null, undefined, tx);
        await repo.movePageRow(tx, pageId, null, sortKey, userId);
      }
    }
    const fresh = await repo.findPageById(pageId, tx);
    return repo.toPage(fresh!);
  });
}

export async function permanentlyDeletePage(pageId: string, userId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const row = await repo.findPageForUser(pageId, userId, tx, { includeDeleted: true });
    if (!row) throw pageNotFound();
    const ids = await repo.collectDescendantIds(pageId, tx, { includeDeleted: true });
    await repo.hardDeleteSubtree(tx, ids);
  });
}

/** 搬移。含循環檢測：不可拖進自己的子孫（M3 驗收標準） */
export async function movePage(
  pageId: string,
  userId: string,
  input: { parentId: string | null; afterId?: string | null },
): Promise<Page> {
  return withTransaction(async (tx) => {
    const row = await repo.findPageForUser(pageId, userId, tx);
    if (!row) throw pageNotFound();
    // BUG-27：搬頁面也算編輯
    await requirePagePermission(userId, pageId, 'edit', tx);

    if (input.parentId !== null) {
      const parent = await repo.findPageForUser(input.parentId, userId, tx);
      if (!parent || parent.workspace_id !== row.workspace_id) throw pageNotFound();
      if (await repo.isDescendantOf(input.parentId, pageId, tx)) {
        throw new AppError('PAGE_CYCLE');
      }
    }

    const sortKey = await repo.computeSortKey(
      row.workspace_id,
      input.parentId,
      input.afterId === undefined ? undefined : input.afterId,
      tx,
    );
    const moved = await repo.movePageRow(tx, pageId, input.parentId, sortKey, userId);
    if (!moved) throw pageNotFound();
    return repo.toPage(moved);
  });
}

/**
 * 深拷貝。內部連結（page block 的 props.pageId、inline atom 的 pageLink）
 * 會被改寫成指向新複本，而非原件（M3 驗收標準）。
 * 做法：先建立完整的 舊id → 新id 對照表，再對序列化後的 JSON 做整批取代。
 */
export async function duplicatePage(
  pageId: string,
  userId: string,
): Promise<{ page: Page; idMap: Record<string, string> }> {
  return withTransaction(async (tx) => {
    const root = await repo.findPageForUser(pageId, userId, tx);
    if (!root) throw pageNotFound();

    const pageIds = await repo.collectDescendantIds(pageId, tx);
    const pages = await tx.query<repo.PageRow>(sql`
      SELECT ${repo.PAGE_COLUMNS} FROM pages
       WHERE id = ANY(${pageIds}::uuid[]) AND deleted_at IS NULL
       ORDER BY sort_key ASC
    `);
    const blocks = await tx.query<{
      id: string;
      page_id: string;
      parent_id: string | null;
      type: string;
      props: Record<string, unknown>;
      content: unknown;
      children: string[];
    }>(sql`
      SELECT id, page_id, parent_id, type, props, content, children FROM blocks
       WHERE page_id = ANY(${pageIds}::uuid[]) AND deleted_at IS NULL
       ORDER BY created_at ASC
    `);

    const idMap: Record<string, string> = {};
    for (const p of pages) idMap[p.id] = uuidv7();
    for (const b of blocks) idMap[b.id] = uuidv7();

    const remap = <T>(value: T): T => {
      let json = JSON.stringify(value);
      for (const [oldId, newId] of Object.entries(idMap)) {
        json = json.split(oldId).join(newId);
      }
      return JSON.parse(json) as T;
    };

    const newRootSortKey = await repo.computeSortKey(
      root.workspace_id,
      root.parent_id,
      root.id,
      tx,
    );

    for (const p of orderParentsFirst(pages)) {
      const isRoot = p.id === pageId;
      await tx.query(sql`
        INSERT INTO pages (id, workspace_id, parent_id, title, icon, cover, sort_key,
                           children, is_database, properties, created_by, updated_by)
        VALUES (${idMap[p.id]}, ${p.workspace_id},
                ${isRoot ? p.parent_id : (idMap[p.parent_id ?? ''] ?? p.parent_id)},
                ${JSON.stringify(isRoot ? appendCopySuffix(p.title) : p.title)}::jsonb,
                ${p.icon}, ${p.cover},
                ${isRoot ? newRootSortKey : p.sort_key},
                ${remap(p.children)}::uuid[], ${p.is_database},
                ${JSON.stringify(remap(p.properties))}::jsonb, ${userId}, ${userId})
      `);
    }

    for (const b of orderParentsFirst(blocks)) {
      await tx.query(sql`
        INSERT INTO blocks (id, workspace_id, page_id, parent_id, type, props, content,
                            children, created_by, updated_by)
        VALUES (${idMap[b.id]}, ${root.workspace_id}, ${idMap[b.page_id]},
                ${b.parent_id ? idMap[b.parent_id] : null}, ${b.type},
                ${JSON.stringify(remap(b.props))}::jsonb,
                ${JSON.stringify(remap(b.content))}::jsonb,
                ${remap(b.children)}::uuid[], ${userId}, ${userId})
      `);
    }

    const fresh = await repo.findPageById(idMap[pageId]!, tx);
    return { page: repo.toPage(fresh!), idMap };
  });
}

/**
 * `pages.parent_id` 與 `blocks.parent_id` 都有指向自己那張表的外鍵，
 * 所以**插入時父一定要先於子**。原本的查詢是用 `sort_key` / `created_at` 排序，
 * 兩者都不保證這件事（子頁的 sort_key 字典序常常排在父頁前面），
 * 一旦排到子在前，INSERT 就撞外鍵，整個 `duplicatePage` 交易回滾 → 500。
 * 這裡先把列重排成「父先於子」的前序。
 */
export function orderParentsFirst<T extends { id: string; parent_id: string | null }>(rows: T[]): T[] {
  const ids = new Set(rows.map((r) => r.id));
  const byParent = new Map<string | null, T[]>();
  for (const r of rows) {
    const key = r.parent_id !== null && ids.has(r.parent_id) ? r.parent_id : null;
    const list = byParent.get(key);
    if (list) list.push(r);
    else byParent.set(key, [r]);
  }
  const out: T[] = [];
  const walk = (key: string | null): void => {
    for (const r of byParent.get(key) ?? []) {
      out.push(r);
      walk(r.id);
    }
  };
  walk(null);
  if (out.length < rows.length) {
    // 資料異常（例如成環）時不要默默掉資料，把剩下的接在後面
    const seen = new Set(out.map((r) => r.id));
    for (const r of rows) if (!seen.has(r.id)) out.push(r);
  }
  return out;
}

function appendCopySuffix(title: RichText): RichText {
  const copy = Array.isArray(title) ? [...title] : [];
  copy.push({ text: '（複本）' });
  return copy;
}

export async function listTrash(workspaceId: string, userId: string): Promise<TrashedPage[]> {
  await assertMember(workspaceId, userId);
  return repo.listTrash(workspaceId);
}
