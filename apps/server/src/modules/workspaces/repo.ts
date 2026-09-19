import type { PageTreeNode, WorkspaceMember, WorkspaceRole, WorkspaceSummary } from '@kennote/shared-types';
import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';

interface WorkspaceSummaryRow {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  role: WorkspaceRole;
}

export async function listWorkspacesForUser(userId: string): Promise<WorkspaceSummary[]> {
  const rows = await db.query<WorkspaceSummaryRow>(sql`
    SELECT w.id, w.name, w.slug, w.icon, m.role
      FROM workspaces w
      JOIN workspace_members m ON m.workspace_id = w.id
     WHERE m.user_id = ${userId}
       AND m.deleted_at IS NULL
       AND w.deleted_at IS NULL
     ORDER BY w.created_at ASC
  `);
  return rows;
}

/**
 * 成員檢查。回 null 代表「不是成員」——呼叫端一律轉成 404，
 * 不回 403，以免洩漏工作區/頁面的存在性（00-README 第一週驗收標準）。
 */
export async function getMemberRole(
  workspaceId: string,
  userId: string,
  conn: Queryable = db,
): Promise<WorkspaceRole | null> {
  const row = await conn.queryOne<{ role: WorkspaceRole }>(sql`
    SELECT role FROM workspace_members
     WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND deleted_at IS NULL
  `);
  return row?.role ?? null;
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const rows = await db.query<{
    workspace_id: string;
    user_id: string;
    role: WorkspaceRole;
    joined_at: Date;
    name: string;
    email: string;
    avatar_url: string | null;
  }>(sql`
    SELECT m.workspace_id, m.user_id, m.role, m.joined_at,
           u.name, u.email::text AS email, u.avatar_url
      FROM workspace_members m
      JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ${workspaceId} AND m.deleted_at IS NULL AND u.deleted_at IS NULL
     ORDER BY m.joined_at ASC
  `);
  return rows.map((r) => ({
    workspaceId: r.workspace_id,
    userId: r.user_id,
    role: r.role,
    joinedAt: r.joined_at.toISOString(),
    user: { id: r.user_id, name: r.name, email: r.email, avatarUrl: r.avatar_url },
  }));
}

interface TreeRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title_plain: string | null;
  icon: string | null;
  sort_key: string;
  is_database: boolean;
  has_children: boolean;
  updated_at: Date;
}

/**
 * 整棵頁面樹（遞迴 CTE，03 §7.2）。
 * 回**扁平陣列 + parentId + sortKey**，由前端組樹 —— 這樣同一份資料也能直接餵搜尋、
 * 麵包屑與「最近開啟」，不必為每種用途各寫一個查詢。
 *
 * 注意：database 的「列」也是 pages 的一列，但不該出現在側邊欄，
 * 所以用 collection_id IS NULL 過濾掉。
 */
export async function getWorkspaceTree(workspaceId: string): Promise<PageTreeNode[]> {
  const rows = await db.query<TreeRow>(sql`
    WITH RECURSIVE tree AS (
      SELECT p.id, p.workspace_id, p.parent_id, p.title_plain, p.icon, p.sort_key,
             p.is_database, p.updated_at, 0 AS depth
        FROM pages p
       WHERE p.workspace_id = ${workspaceId}
         AND p.parent_id IS NULL
         AND p.collection_id IS NULL
         AND p.deleted_at IS NULL
      UNION ALL
      SELECT c.id, c.workspace_id, c.parent_id, c.title_plain, c.icon, c.sort_key,
             c.is_database, c.updated_at, tree.depth + 1
        FROM pages c
        JOIN tree ON c.parent_id = tree.id
       WHERE c.deleted_at IS NULL
         AND c.collection_id IS NULL
         AND tree.depth < 50
    )
    SELECT tree.*,
           EXISTS (
             SELECT 1 FROM pages ch
              WHERE ch.parent_id = tree.id AND ch.deleted_at IS NULL AND ch.collection_id IS NULL
           ) AS has_children
      FROM tree
     ORDER BY depth ASC, sort_key ASC
  `);

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    parentId: r.parent_id,
    title: r.title_plain ?? '',
    icon: r.icon,
    sortKey: r.sort_key,
    isDatabase: r.is_database,
    hasChildren: r.has_children,
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function createWorkspace(
  conn: Queryable,
  input: { name: string; slug: string; ownerId: string },
): Promise<WorkspaceSummary> {
  const row = await conn.queryOne<{ id: string; name: string; slug: string; icon: string | null }>(sql`
    INSERT INTO workspaces (name, slug, owner_id)
    VALUES (${input.name}, ${input.slug}, ${input.ownerId})
    RETURNING id, name, slug, icon
  `);
  if (!row) throw new Error('建立工作區失敗');
  await conn.query(sql`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${row.id}, ${input.ownerId}, 'owner')
  `);
  return { ...row, role: 'owner' };
}
