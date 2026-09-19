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
import {
  canControlTrashedPage,
  requirePagePermission,
  requireTrashedPageControl,
  resolvePagePermission,
} from '../permissions/service.js';
import { buildPermissionIndex, canSee } from '../permissions/bulk.js';
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

/**
 * 第六輪：`findPageForUser()` 只 JOIN `workspace_members`，所以**工作區外的
 * 被授權者**（只有 `page_permissions` 的 user 條目）會拿到 404。
 * 這支補一層 fallback：成員照舊走原路，非成員再問一次
 * `resolvePagePermission()`（它現在認得非成員的直接授權，封頂 `edit`）。
 *
 * 刻意**只**補在「讀某一頁」這條路上 —— tree / search / trash / favorites
 * 全都還是成員限定，所以被授權者只看得到那一頁，看不到工作區的其他東西。
 */
async function findVisiblePage(pageId: string, userId: string) {
  /*
   * ⭐ 第七輪 BUG-35：原本這裡是「先 `findPageForUser()`，**有列就直接回**，
   * 只有非成員才 fallback 去問權限」。`findPageForUser()` 只 JOIN
   * `workspace_members` —— 於是 baseline `none` 的 guest 對工作區裡的**任何**
   * 頁面都拿得到 `GET /api/pages/:id` 與 `GET /snapshot`（整份 recordMap，
   * 含所有 block 內容）。遠端實測：guest 讀得到「CEO 年薪 1234 萬」。
   *
   * 寫入路徑（applyTransaction 的 permission guard）一直是對的，
   * 所以第五 / 六輪的「guest 寫入 403/404」通過並不代表讀取也有守門員。
   *
   * 現在**一律**先問 `resolvePagePermission()`：成員與非成員走同一道檢查，
   * `none` → 404（不洩漏存在性）。已刪除的頁面也會在這裡被擋掉
   * （`resolvePagePermission` 對 `deleted_at !== null` 一律回 none）。
   */
  if ((await resolvePagePermission(userId, pageId)) === 'none') throw pageNotFound();
  const row = (await repo.findPageForUser(pageId, userId)) ?? (await repo.findPageById(pageId));
  if (!row || row.deleted_at !== null) throw pageNotFound();
  return row;
}

export async function getPage(pageId: string, userId: string): Promise<Page> {
  return repo.toPage(await findVisiblePage(pageId, userId));
}

/**
 * GET /api/pages/:id/snapshot —— 初次載入。
 * 回 03 §9.1 的 record_map 形狀（扁平 normalized map + sync seq），
 * 讓 HTTP 載入與 WebSocket 訂閱之間沒有空窗。
 */
export async function getSnapshot(pageId: string, userId: string): Promise<PageSnapshot> {
  const pageRow = await findVisiblePage(pageId, userId);
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
    // BUG-29：`findPageForUser` 只驗「是不是工作區成員」，還原也要看得出是誰的東西
    await requireTrashedPageControl(userId, pageId, tx);
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

/**
 * 永久刪除（hard delete，沒有回頭路）。
 *
 * **BUG-29**：這裡原本只有 `findPageForUser()` —— 那支只 JOIN `workspace_members`，
 * 於是任何工作區成員（**包括 guest**）都刪得掉別人的頁面。實測遠端站台：
 * 一個沒有任何頁面授權的 guest `DELETE /api/pages/:id/permanent` 拿到 **200**。
 *
 * 不能用 `requirePagePermission()`：`resolvePagePermission()` 對已刪除的頁面
 * 一律回 `none`，套下去連擁有者都會 404（第五輪就是因此跳過這條路）。
 * 改用 `requireTrashedPageControl()`（owner / admin / 建立者 / 刪除者）。
 */
export async function permanentlyDeletePage(pageId: string, userId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const row = await repo.findPageForUser(pageId, userId, tx, { includeDeleted: true });
    if (!row) throw pageNotFound();
    if (row.deleted_at === null) {
      throw new AppError('PAGE_ALREADY_DELETED', '這個頁面不在垃圾桶裡，請先刪除再永久刪除');
    }
    await requireTrashedPageControl(userId, pageId, tx);
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
  /*
   * ⭐ 第七輪 BUG-36（第六輪 §5-13 留下來確認的）：原本只有 `findPageForUser()`，
   * 完全沒問權限 —— 遠端實測 guest（baseline none、沒有任何授權）
   * `POST /api/pages/:id/duplicate` 回 **201**，整棵子樹被複製成他自己的頁面
   * （而且他是複本的 `created_by` → 對複本有 full）。等於唯讀被完全繞過。
   *
   * 要 `edit` 而不是 `read`：複製會在**同一個工作區**裡長出新頁面，
   * 那是寫入動作。真的想「讀者也能留一份自己的副本」應該是另一支
   * 「複製到我的工作區」，不是這一支。
   */
  await requirePagePermission(userId, pageId, 'edit');
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

/**
 * 垃圾桶清單。
 *
 * ⭐ 第七輪（第六輪 §5-2）：原本只 `assertMember` —— guest 看得到工作區裡
 * **每一個**已刪頁面的標題。BUG-29 讓他刪不掉了，但還是看得到。
 *
 * 已刪除的頁面對任何人都是 `resolvePagePermission() === 'none'`（開頭就擋掉），
 * 所以這裡問的是兩個問題的聯集：
 *   1. 「如果它還在，你看得見嗎」→ `buildPermissionIndex()`（忽略 deleted_at）
 *   2. 「你有沒有資格處置這份殘骸」→ `canControlTrashedPage()`（建立者 / 刪除者 / 管理員）
 * 第 2 條是必要的：自己建立、自己刪掉、但從來沒有 page_permissions 條目的頁面，
 * 對 guest 來說第 1 條會是 none，少了第 2 條他就再也找不回自己的東西。
 */
export async function listTrash(workspaceId: string, userId: string): Promise<TrashedPage[]> {
  await assertMember(workspaceId, userId);
  const role = await getMemberRole(workspaceId, userId);
  if (!role) throw workspaceNotFound();

  const rows = await repo.listTrash(workspaceId);
  const index = await buildPermissionIndex(workspaceId, userId, role);
  if (index.mode === 'all') return rows;

  const actors = await repo.findPageActors(rows.map((r) => r.id));
  return rows.filter((row) => {
    if (canSee(index, row.id)) return true;
    const actor = actors.get(row.id);
    return actor ? canControlTrashedPage(userId, role, actor) : false;
  });
}

/**
 * 批次「清空垃圾桶」（第六輪補）。
 *
 * 逐頁套用與 `permanentlyDeletePage()` 相同的判斷，**刪不了的就跳過**
 * 而不是整批失敗 —— 不然一個 member 只要垃圾桶裡有一頁別人的東西就永遠清不掉。
 * 回傳 `{ deleted, skipped }`，前端據此提示「N 頁不是你的，已保留」。
 */
export async function emptyTrash(
  workspaceId: string,
  userId: string,
): Promise<{ deleted: number; skipped: number }> {
  await assertMember(workspaceId, userId);
  const role = await getMemberRole(workspaceId, userId);
  if (!role) throw workspaceNotFound();

  const trashed = await repo.listTrash(workspaceId);
  let deleted = 0;
  let skipped = 0;

  for (const page of trashed) {
    // 一頁一個 transaction：中途有一頁出錯不會把已經刪掉的又拖回來
    const done = await withTransaction(async (tx) => {
      const meta = await repo.findPageActorMeta(page.id, tx);
      if (!meta || meta.deleted_at === null) return false;
      if (!canControlTrashedPage(userId, role, meta)) return false;
      const ids = await repo.collectDescendantIds(page.id, tx, { includeDeleted: true });
      await repo.hardDeleteSubtree(tx, ids);
      return true;
    });
    if (done) deleted += 1;
    else skipped += 1;
  }

  return { deleted, skipped };
}
