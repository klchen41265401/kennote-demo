/**
 * 權限資料層。查詢形狀對齊 03 §4.12 的 block_ancestors / effective_page_role，
 * 差別只在本專案的頁面樹是 pages 表（見 docs/adr/0002）。
 */
import type { PageRoleRow, WorkspaceRole } from '@kennote/shared-types';
import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import type { PermissionEntryInput } from './resolve.js';

export interface PageMetaRow {
  id: string;
  workspace_id: string;
  created_by: string | null;
  inherits_permissions: boolean;
  deleted_at: Date | null;
}

/**
 * 垃圾桶專用的 meta。多帶一個 `updated_by` ——
 * `softDeleteSubtree()` 軟刪除時會把它設成操作者，所以這是「誰把它丟進垃圾桶」
 * 的代理欄位（schema 目前沒有 `deleted_by`）。
 */
export interface TrashedPageMetaRow extends PageMetaRow {
  updated_by: string | null;
}

export async function findPageMetaWithActor(
  pageId: string,
  conn: Queryable = db,
): Promise<TrashedPageMetaRow | null> {
  return conn.queryOne<TrashedPageMetaRow>(sql`
    SELECT id, workspace_id, created_by, updated_by, inherits_permissions, deleted_at
      FROM pages WHERE id = ${pageId}
  `);
}

export async function findPageMeta(
  pageId: string,
  conn: Queryable = db,
): Promise<PageMetaRow | null> {
  return conn.queryOne<PageMetaRow>(sql`
    SELECT id, workspace_id, created_by, inherits_permissions, deleted_at
      FROM pages WHERE id = ${pageId}
  `);
}

export async function getWorkspaceRole(
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

/**
 * 沿祖先鏈收集 page_permissions 條目。
 * 遞迴 CTE 在 inherits_permissions = false 的那一層就停止往上（權限中斷點）。
 */
export async function collectInheritedEntries(
  pageId: string,
  conn: Queryable = db,
): Promise<PermissionEntryInput[]> {
  const rows = await conn.query<{
    subject_type: 'user' | 'workspace' | 'public';
    subject_id: string | null;
    role: PageRoleRow;
    depth: number;
  }>(sql`
    WITH RECURSIVE chain AS (
      SELECT p.id, p.parent_id, 0 AS depth, p.inherits_permissions
        FROM pages p WHERE p.id = ${pageId}
      UNION ALL
      SELECT p.id, p.parent_id, c.depth + 1, p.inherits_permissions
        FROM pages p JOIN chain c ON p.id = c.parent_id
       WHERE c.inherits_permissions = true AND c.depth < 64
    )
    SELECT pp.subject_type::text AS subject_type, pp.subject_id,
           pp.role::text AS role, chain.depth
      FROM chain
      JOIN page_permissions pp ON pp.page_id = chain.id
     ORDER BY chain.depth ASC
  `);
  return rows.map((r) => ({
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    role: r.role,
    depth: Number(r.depth),
  }));
}

export interface PageEntryRow {
  id: string;
  page_id: string;
  subject_type: 'user' | 'workspace' | 'public';
  subject_id: string | null;
  role: PageRoleRow;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

/** 這一頁自己的授權條目（分享面板列表用，不含繼承） */
export async function listPageEntries(
  pageId: string,
  conn: Queryable = db,
): Promise<PageEntryRow[]> {
  return conn.query<PageEntryRow>(sql`
    SELECT pp.id, pp.page_id, pp.subject_type::text AS subject_type, pp.subject_id,
           pp.role::text AS role, u.name, u.email::text AS email, u.avatar_url
      FROM page_permissions pp
      LEFT JOIN users u ON u.id = pp.subject_id AND pp.subject_type = 'user'
     WHERE pp.page_id = ${pageId}
     ORDER BY pp.created_at ASC
  `);
}

export async function upsertPageEntry(
  conn: Queryable,
  input: {
    workspaceId: string;
    pageId: string;
    subjectType: 'user' | 'workspace' | 'public';
    subjectId: string | null;
    role: PageRoleRow;
    grantedBy: string;
  },
): Promise<void> {
  // 注意：uq_page_permissions 的 subject_id 可為 NULL，而 UNIQUE 約束裡 NULL 彼此不相等，
  // 所以 public 條目（subject_id IS NULL）不能靠 ON CONFLICT 去重 —— 先刪再插。
  if (input.subjectId === null) {
    await deletePageEntry(conn, input.pageId, input.subjectType, null);
    await conn.query(sql`
      INSERT INTO page_permissions (workspace_id, page_id, subject_type, subject_id, role, granted_by)
      VALUES (${input.workspaceId}, ${input.pageId}, ${input.subjectType}::permission_subject,
              NULL, ${input.role}::page_role, ${input.grantedBy})
    `);
    return;
  }
  await conn.query(sql`
    INSERT INTO page_permissions (workspace_id, page_id, subject_type, subject_id, role, granted_by)
    VALUES (${input.workspaceId}, ${input.pageId}, ${input.subjectType}::permission_subject,
            ${input.subjectId}, ${input.role}::page_role, ${input.grantedBy})
    ON CONFLICT (page_id, subject_type, subject_id)
    DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, updated_at = now()
  `);
}

export async function deletePageEntry(
  conn: Queryable,
  pageId: string,
  subjectType: 'user' | 'workspace' | 'public',
  subjectId: string | null,
): Promise<void> {
  const subjectFilter =
    subjectId === null ? sql`subject_id IS NULL` : sql`subject_id = ${subjectId}`;
  await conn.query(sql`
    DELETE FROM page_permissions
     WHERE page_id = ${pageId} AND subject_type = ${subjectType}::permission_subject
       AND ${subjectFilter}
  `);
}

/* ── 工作區成員 / 邀請 ─────────────────────────────────── */

export interface UserRow {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

export async function findUserByEmail(
  email: string,
  conn: Queryable = db,
): Promise<UserRow | null> {
  return conn.queryOne<UserRow>(sql`
    SELECT id, name, email::text AS email, avatar_url
      FROM users WHERE email = ${email}::citext AND deleted_at IS NULL
  `);
}

export async function listUsersByIds(ids: string[], conn: Queryable = db): Promise<UserRow[]> {
  if (ids.length === 0) return [];
  return conn.query<UserRow>(sql`
    SELECT id, name, email::text AS email, avatar_url
      FROM users WHERE id = ANY(${ids}::uuid[])
  `);
}

export async function addMember(
  conn: Queryable,
  input: { workspaceId: string; userId: string; role: WorkspaceRole; invitedBy: string },
): Promise<void> {
  await conn.query(sql`
    INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
    VALUES (${input.workspaceId}, ${input.userId}, ${input.role}::workspace_role, ${input.invitedBy})
    ON CONFLICT (workspace_id, user_id)
    DO UPDATE SET role = EXCLUDED.role, deleted_at = NULL, updated_at = now()
  `);
}

export async function updateMemberRole(
  conn: Queryable,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<boolean> {
  const row = await conn.queryOne<{ user_id: string }>(sql`
    UPDATE workspace_members SET role = ${role}::workspace_role
     WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND deleted_at IS NULL
     RETURNING user_id
  `);
  return row !== null;
}

export async function removeMember(
  conn: Queryable,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const row = await conn.queryOne<{ user_id: string }>(sql`
    UPDATE workspace_members SET deleted_at = now()
     WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND deleted_at IS NULL
     RETURNING user_id
  `);
  return row !== null;
}

export interface InviteRow {
  id: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  expires_at: Date;
}

export async function createInvite(
  conn: Queryable,
  input: {
    workspaceId: string;
    email: string;
    role: WorkspaceRole;
    token: string;
    invitedBy: string;
  },
): Promise<InviteRow> {
  const row = await conn.queryOne<InviteRow>(sql`
    INSERT INTO workspace_invites (workspace_id, email, role, token, invited_by)
    VALUES (${input.workspaceId}, ${input.email}::citext, ${input.role}::workspace_role,
            ${input.token}, ${input.invitedBy})
    ON CONFLICT (workspace_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL
    DO UPDATE SET role = EXCLUDED.role, token = EXCLUDED.token,
                  expires_at = now() + interval '14 days'
    RETURNING id, email::text AS email, role, token, expires_at
  `);
  if (!row) throw new Error('建立邀請失敗');
  return row;
}

/* ── 公開分享連結 ─────────────────────────────────────── */

export interface PublicLinkRow {
  id: string;
  workspace_id: string;
  page_id: string;
  token: string;
  password_hash: string | null;
  expires_at: Date | null;
  created_at: Date;
  revoked_at: Date | null;
}

const LINK_COLUMNS = sql.raw(
  'id, workspace_id, page_id, token, password_hash, expires_at, created_at, revoked_at',
);

export async function findActiveLinkByPage(
  pageId: string,
  conn: Queryable = db,
): Promise<PublicLinkRow | null> {
  return conn.queryOne<PublicLinkRow>(sql`
    SELECT ${LINK_COLUMNS} FROM public_links
     WHERE page_id = ${pageId} AND revoked_at IS NULL
  `);
}

export async function findActiveLinkByToken(
  token: string,
  conn: Queryable = db,
): Promise<PublicLinkRow | null> {
  return conn.queryOne<PublicLinkRow>(sql`
    SELECT ${LINK_COLUMNS} FROM public_links
     WHERE token = ${token} AND revoked_at IS NULL
  `);
}

export async function upsertPublicLink(
  conn: Queryable,
  input: {
    workspaceId: string;
    pageId: string;
    token: string;
    passwordHash: string | null;
    expiresAt: string | null;
    createdBy: string;
  },
): Promise<PublicLinkRow> {
  const row = await conn.queryOne<PublicLinkRow>(sql`
    INSERT INTO public_links (workspace_id, page_id, token, password_hash, expires_at, created_by)
    VALUES (${input.workspaceId}, ${input.pageId}, ${input.token}, ${input.passwordHash},
            ${input.expiresAt}::timestamptz, ${input.createdBy})
    ON CONFLICT (page_id) WHERE revoked_at IS NULL
    DO UPDATE SET password_hash = EXCLUDED.password_hash,
                  expires_at = EXCLUDED.expires_at,
                  updated_at = now()
    RETURNING ${LINK_COLUMNS}
  `);
  if (!row) throw new Error('建立公開連結失敗');
  return row;
}

export async function revokePublicLink(conn: Queryable, pageId: string): Promise<void> {
  await conn.query(sql`
    UPDATE public_links SET revoked_at = now() WHERE page_id = ${pageId} AND revoked_at IS NULL
  `);
}
