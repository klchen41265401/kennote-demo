import type { Page, RichText, TrashedPage } from '@kennote/shared-types';
import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { generateKeyBetween } from '../../lib/fractional.js';

export interface PageRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: RichText;
  icon: string | null;
  cover: string | null;
  sort_key: string;
  children: string[];
  is_database: boolean;
  properties: Record<string, unknown>;
  collection_id: string | null;
  seq: number;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const PAGE_COLUMN_NAMES = [
  'id',
  'workspace_id',
  'parent_id',
  'title',
  'icon',
  'cover',
  'sort_key',
  'children',
  'is_database',
  'properties',
  'collection_id',
  'seq',
  'version',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at',
  'deleted_at',
];

export const PAGE_COLUMNS = sql.raw(PAGE_COLUMN_NAMES.join(', '));

/** 帶資料表別名的欄位清單（JOIN 查詢用） */
export function pageColumns(prefix: string): ReturnType<typeof sql.raw> {
  return sql.raw(PAGE_COLUMN_NAMES.map((c) => `${prefix}.${c}`).join(', '));
}

export function toPage(row: PageRow): Page {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    title: row.title ?? [],
    icon: row.icon,
    cover: row.cover,
    sortKey: row.sort_key,
    children: row.children ?? [],
    isDatabase: row.is_database,
    collectionId: row.collection_id,
    properties: row.properties ?? {},
    seq: Number(row.seq),
    version: Number(row.version),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

/* ── 讀 ───────────────────────────────────────────────── */

export async function findPageById(
  id: string,
  conn: Queryable = db,
  opts: { includeDeleted?: boolean } = {},
): Promise<PageRow | null> {
  const deletedFilter = opts.includeDeleted ? sql.empty : sql` AND deleted_at IS NULL`;
  return conn.queryOne<PageRow>(sql`
    SELECT ${PAGE_COLUMNS} FROM pages WHERE id = ${id}${deletedFilter}
  `);
}

/**
 * 取頁面 **並同時驗證存取權**：非本 workspace 成員一律回 null，
 * 呼叫端轉成 404（不洩漏存在性）。
 */
export async function findPageForUser(
  pageId: string,
  userId: string,
  conn: Queryable = db,
  opts: { includeDeleted?: boolean } = {},
): Promise<PageRow | null> {
  const deletedFilter = opts.includeDeleted ? sql.empty : sql` AND p.deleted_at IS NULL`;
  return conn.queryOne<PageRow>(sql`
    SELECT ${pageColumns('p')}
      FROM pages p
      JOIN workspace_members m
        ON m.workspace_id = p.workspace_id AND m.user_id = ${userId} AND m.deleted_at IS NULL
     WHERE p.id = ${pageId}${deletedFilter}
  `);
}

/** 同一個 parent 底下的兄弟，依 sort_key（C collation）排序 */
export async function listSiblings(
  workspaceId: string,
  parentId: string | null,
  conn: Queryable = db,
): Promise<Array<{ id: string; sort_key: string }>> {
  const parentFilter =
    parentId === null ? sql`parent_id IS NULL` : sql`parent_id = ${parentId}`;
  return conn.query<{ id: string; sort_key: string }>(sql`
    SELECT id, sort_key FROM pages
     WHERE workspace_id = ${workspaceId} AND ${parentFilter}
       AND collection_id IS NULL AND deleted_at IS NULL
     ORDER BY sort_key ASC
  `);
}

/** 算出「插在 afterId 之後」的 sort_key；afterId=null 代表排到最前面 */
export async function computeSortKey(
  workspaceId: string,
  parentId: string | null,
  afterId: string | null | undefined,
  conn: Queryable = db,
): Promise<string> {
  const siblings = await listSiblings(workspaceId, parentId, conn);
  if (afterId === undefined) {
    // 未指定 → 排到最後面
    const last = siblings[siblings.length - 1];
    return generateKeyBetween(last ? last.sort_key : null, null);
  }
  if (afterId === null) {
    const first = siblings[0];
    return generateKeyBetween(null, first ? first.sort_key : null);
  }
  const idx = siblings.findIndex((s) => s.id === afterId);
  if (idx === -1) {
    const last = siblings[siblings.length - 1];
    return generateKeyBetween(last ? last.sort_key : null, null);
  }
  const before = siblings[idx]!.sort_key;
  const after = siblings[idx + 1]?.sort_key ?? null;
  return generateKeyBetween(before, after);
}

/* ── 寫 ───────────────────────────────────────────────── */

export async function insertPage(
  conn: Queryable,
  input: {
    id?: string;
    workspaceId: string;
    parentId: string | null;
    title: RichText;
    icon?: string | null;
    cover?: string | null;
    sortKey: string;
    isDatabase?: boolean;
    collectionId?: string | null;
    properties?: Record<string, unknown>;
    createdBy: string;
  },
): Promise<PageRow> {
  const idFragment = input.id ? sql`${input.id}::uuid` : sql`uuid_generate_v7()`;
  const row = await conn.queryOne<PageRow>(sql`
    INSERT INTO pages (id, workspace_id, parent_id, title, icon, cover, sort_key,
                       is_database, collection_id, properties, created_by, updated_by)
    VALUES (${idFragment}, ${input.workspaceId}, ${input.parentId},
            ${JSON.stringify(input.title)}::jsonb, ${input.icon ?? null}, ${input.cover ?? null},
            ${input.sortKey}, ${input.isDatabase ?? false}, ${input.collectionId ?? null},
            ${JSON.stringify(input.properties ?? {})}::jsonb, ${input.createdBy}, ${input.createdBy})
    RETURNING ${PAGE_COLUMNS}
  `);
  if (!row) throw new Error('建立頁面失敗');
  return row;
}

export async function updatePageMeta(
  conn: Queryable,
  pageId: string,
  patch: { title?: RichText; icon?: string | null; cover?: string | null },
  actorId: string,
): Promise<PageRow | null> {
  const sets = [sql`updated_by = ${actorId}`, sql`version = version + 1`];
  if (patch.title !== undefined) sets.push(sql`title = ${JSON.stringify(patch.title)}::jsonb`);
  if (patch.icon !== undefined) sets.push(sql`icon = ${patch.icon}`);
  if (patch.cover !== undefined) sets.push(sql`cover = ${patch.cover}`);
  return conn.queryOne<PageRow>(sql`
    UPDATE pages SET ${sql.join(sets, ', ')}
     WHERE id = ${pageId} AND deleted_at IS NULL
     RETURNING ${PAGE_COLUMNS}
  `);
}

export async function setPageChildren(
  conn: Queryable,
  pageId: string,
  children: string[],
): Promise<void> {
  await conn.query(sql`
    UPDATE pages SET children = ${children}::uuid[] WHERE id = ${pageId}
  `);
}

/** 取得整棵子樹的 id（含自己）。用於軟刪除、還原、複製 */
export async function collectDescendantIds(
  pageId: string,
  conn: Queryable = db,
  opts: { includeDeleted?: boolean } = {},
): Promise<string[]> {
  const deletedFilter = opts.includeDeleted ? sql.empty : sql` AND c.deleted_at IS NULL`;
  const rows = await conn.query<{ id: string }>(sql`
    WITH RECURSIVE sub AS (
      SELECT id, 0 AS depth FROM pages WHERE id = ${pageId}
      UNION ALL
      SELECT c.id, sub.depth + 1 FROM pages c JOIN sub ON c.parent_id = sub.id
       WHERE sub.depth < 50${deletedFilter}
    )
    SELECT id FROM sub
  `);
  return rows.map((r) => r.id);
}

/** 循環檢測：candidateParentId 是不是 pageId 的子孫（或自己） */
export async function isDescendantOf(
  candidateParentId: string,
  pageId: string,
  conn: Queryable = db,
): Promise<boolean> {
  if (candidateParentId === pageId) return true;
  const row = await conn.queryOne<{ found: boolean }>(sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, 0 AS depth FROM pages WHERE id = ${candidateParentId}
      UNION ALL
      SELECT p.id, p.parent_id, up.depth + 1 FROM pages p JOIN up ON p.id = up.parent_id
       WHERE up.depth < 50
    )
    SELECT EXISTS (SELECT 1 FROM up WHERE id = ${pageId}) AS found
  `);
  return row?.found ?? false;
}

export async function softDeleteSubtree(
  conn: Queryable,
  ids: string[],
  actorId: string,
): Promise<void> {
  await conn.query(sql`
    UPDATE pages SET deleted_at = now(), updated_by = ${actorId}
     WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL
  `);
  await conn.query(sql`
    UPDATE blocks SET deleted_at = now(), updated_by = ${actorId}
     WHERE page_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL
  `);
}

export async function restoreSubtree(
  conn: Queryable,
  ids: string[],
  actorId: string,
): Promise<void> {
  await conn.query(sql`
    UPDATE pages SET deleted_at = NULL, updated_by = ${actorId}
     WHERE id = ANY(${ids}::uuid[])
  `);
  await conn.query(sql`
    UPDATE blocks SET deleted_at = NULL, updated_by = ${actorId}
     WHERE page_id = ANY(${ids}::uuid[])
  `);
}

export async function hardDeleteSubtree(conn: Queryable, ids: string[]): Promise<void> {
  // blocks / 子 pages 都有 ON DELETE CASCADE，但明確刪除比較不依賴 FK 順序
  await conn.query(sql`DELETE FROM blocks WHERE page_id = ANY(${ids}::uuid[])`);
  await conn.query(sql`DELETE FROM pages WHERE id = ANY(${ids}::uuid[])`);
}

export async function movePageRow(
  conn: Queryable,
  pageId: string,
  parentId: string | null,
  sortKey: string,
  actorId: string,
): Promise<PageRow | null> {
  return conn.queryOne<PageRow>(sql`
    UPDATE pages
       SET parent_id = ${parentId}, sort_key = ${sortKey},
           updated_by = ${actorId}, version = version + 1
     WHERE id = ${pageId} AND deleted_at IS NULL
     RETURNING ${PAGE_COLUMNS}
  `);
}

/**
 * 垃圾桶清單。
 *
 * ⭐ **資料庫的列也是 page，刪掉之後要看得到**（功能 QA 第三輪 §1.6 的缺口）。
 * 原本這裡有一條 `AND collection_id IS NULL`，把所有列排除在外 ——
 * 結果是「`POST /api/pages/:id/restore` 還原得回來，但使用者找不到入口」。
 * 列的父層是資料庫頁本身，所以「父層也被刪掉就不重複列出」那條規則仍然成立：
 * 整個資料庫被刪時只會看到資料庫，不會看到它底下的幾千列。
 */
export async function listTrash(workspaceId: string): Promise<TrashedPage[]> {
  const rows = await db.query<{
    id: string;
    workspace_id: string;
    parent_id: string | null;
    title_plain: string | null;
    icon: string | null;
    sort_key: string;
    is_database: boolean;
    collection_id: string | null;
    collection_title: string | null;
    updated_at: Date;
    deleted_at: Date;
  }>(sql`
    SELECT p.id, p.workspace_id, p.parent_id, p.title_plain, p.icon, p.sort_key, p.is_database,
           p.collection_id,
           cp.title_plain AS collection_title,
           p.updated_at, p.deleted_at
      FROM pages p
      LEFT JOIN collections c ON c.id = p.collection_id
      LEFT JOIN pages cp ON cp.id = c.page_id
     WHERE p.workspace_id = ${workspaceId}
       AND p.deleted_at IS NOT NULL
       -- 只列出「刪除動作的根」：父層也被刪掉的子孫不必重複出現
       AND (p.parent_id IS NULL OR p.parent_id NOT IN (
             SELECT id FROM pages WHERE deleted_at IS NOT NULL
           ))
     ORDER BY p.deleted_at DESC
     LIMIT 200
  `);
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    parentId: r.parent_id,
    title: r.title_plain ?? '',
    icon: r.icon,
    sortKey: r.sort_key,
    isDatabase: r.is_database,
    hasChildren: false,
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at.toISOString(),
    collectionId: r.collection_id,
    collectionTitle: r.collection_title,
  }));
}

/** 頁面層級的序列化點：SELECT ... FOR UPDATE（04 §5.4 套用流程 4a） */
export async function lockPageForUpdate(
  conn: Queryable,
  pageId: string,
): Promise<{ id: string; workspace_id: string; seq: number; children: string[] } | null> {
  return conn.queryOne(sql`
    SELECT id, workspace_id, seq, children FROM pages
     WHERE id = ${pageId} AND deleted_at IS NULL
     FOR UPDATE
  `);
}

export async function bumpPageSeq(
  conn: Queryable,
  pageId: string,
  actorId: string,
): Promise<number> {
  const row = await conn.queryOne<{ seq: number }>(sql`
    UPDATE pages SET seq = seq + 1, updated_by = ${actorId}, version = version + 1
     WHERE id = ${pageId}
     RETURNING seq
  `);
  if (!row) throw new Error('更新頁面序號失敗');
  return Number(row.seq);
}
