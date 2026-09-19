/**
 * users 模組的 DAO：個人資料（名稱 / 頭像 / preferences）與刪除帳號。
 *
 * 為什麼不塞進 auth/repo.ts：auth 管的是「你是誰、憑證還有效嗎」，
 * 這裡管的是「你的個人資料長什麼樣」。使用者列的讀取（findUserById / toAuthUser）
 * 仍然只有 auth/repo 一份，避免兩邊各自對映欄位。
 */
import type { UserPreferences, WorkspaceRole } from '@kennote/shared-types';
import { db, type Queryable } from '../../db/client.js';
import { sql, type Sql } from '../../db/sql.js';
import type { WorkspaceMemberCandidate } from '../auth/account-rules.js';

export interface ProfilePatch {
  name?: string;
  avatarUrl?: string | null;
  /** 已經在 service 層合併過的**完整** preferences 物件 */
  preferences?: UserPreferences;
}

/** 回 false 代表使用者不存在（或已被軟刪除） */
export async function updateUserProfile(
  conn: Queryable,
  userId: string,
  patch: ProfilePatch,
): Promise<boolean> {
  const sets: Sql[] = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.avatarUrl !== undefined) sets.push(sql`avatar_url = ${patch.avatarUrl}`);
  if (patch.preferences !== undefined) {
    sets.push(sql`preferences = ${JSON.stringify(patch.preferences)}::jsonb`);
  }
  if (sets.length === 0) return true;
  const rows = await conn.query<{ id: string }>(sql`
    UPDATE users SET ${sql.join(sets, ', ')}
     WHERE id = ${userId} AND deleted_at IS NULL
     RETURNING id
  `);
  return rows.length > 0;
}

export async function readPreferences(
  userId: string,
  conn: Queryable = db,
): Promise<UserPreferences | null> {
  const row = await conn.queryOne<{ preferences: UserPreferences | null }>(sql`
    SELECT preferences FROM users WHERE id = ${userId} AND deleted_at IS NULL
  `);
  return row?.preferences ?? null;
}

/* ── 刪除帳號 ──────────────────────────────────────────── */

export interface OwnedWorkspace {
  workspaceId: string;
  name: string;
  members: WorkspaceMemberCandidate[];
}

/**
 * 這個人以 owner 身分持有的工作區，連同**還活著的成員**一起撈出來。
 * 交接對象的挑選是純函式（account-rules.pickOwnershipSuccessor），
 * 所以這裡只負責把資料備齊，不做決策。
 */
export async function listOwnedWorkspaces(
  userId: string,
  conn: Queryable = db,
): Promise<OwnedWorkspace[]> {
  const rows = await conn.query<{
    workspace_id: string;
    name: string;
    member_id: string;
    role: WorkspaceRole;
    joined_at: Date;
  }>(sql`
    SELECT w.id AS workspace_id, w.name,
           m.user_id AS member_id, m.role, m.joined_at
      FROM workspaces w
      JOIN workspace_members owner_m
        ON owner_m.workspace_id = w.id
       AND owner_m.user_id = ${userId}
       AND owner_m.role = 'owner'
       AND owner_m.deleted_at IS NULL
      JOIN workspace_members m ON m.workspace_id = w.id AND m.deleted_at IS NULL
      JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
     WHERE w.deleted_at IS NULL
     ORDER BY w.created_at ASC, m.joined_at ASC
  `);

  const map = new Map<string, OwnedWorkspace>();
  for (const r of rows) {
    let entry = map.get(r.workspace_id);
    if (!entry) {
      entry = { workspaceId: r.workspace_id, name: r.name, members: [] };
      map.set(r.workspace_id, entry);
    }
    entry.members.push({ userId: r.member_id, role: r.role, joinedAt: r.joined_at });
  }
  return [...map.values()];
}

export async function transferWorkspaceOwnership(
  conn: Queryable,
  input: { workspaceId: string; fromUserId: string; toUserId: string },
): Promise<void> {
  await conn.query(sql`
    UPDATE workspaces SET owner_id = ${input.toUserId} WHERE id = ${input.workspaceId}
  `);
  await conn.query(sql`
    UPDATE workspace_members SET role = 'owner'
     WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.toUserId}
  `);
  // 離開的人降回 member，之後的軟刪除成員那一步會再把他標掉
  await conn.query(sql`
    UPDATE workspace_members SET role = 'member'
     WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.fromUserId}
  `);
}

export async function softDeleteWorkspace(conn: Queryable, workspaceId: string): Promise<void> {
  await conn.query(sql`
    UPDATE workspaces SET deleted_at = now() WHERE id = ${workspaceId} AND deleted_at IS NULL
  `);
}

/** 退出所有工作區（軟刪除成員列），刪帳號時一併做 */
export async function leaveAllWorkspaces(conn: Queryable, userId: string): Promise<void> {
  await conn.query(sql`
    UPDATE workspace_members SET deleted_at = now()
     WHERE user_id = ${userId} AND deleted_at IS NULL
  `);
}

/**
 * 軟刪除使用者本人。
 * email 要改掉：uq_users_email 是 `WHERE deleted_at IS NULL` 的部分索引，
 * 不改雖然也不會撞，但同一個信箱重新註冊後，舊的 local identity
 * （provider+external_id 是**無條件** UNIQUE）會擋住新帳號，所以兩邊都要讓位。
 */
export async function softDeleteUser(
  conn: Queryable,
  input: { userId: string; deletedEmail: string },
): Promise<boolean> {
  await conn.query(sql`
    UPDATE user_identities
       SET external_id = ${input.deletedEmail}, password_hash = NULL
     WHERE user_id = ${input.userId} AND provider = 'local'
  `);
  const rows = await conn.query<{ id: string }>(sql`
    UPDATE users
       SET deleted_at = now(), email = ${input.deletedEmail}::citext
     WHERE id = ${input.userId} AND deleted_at IS NULL
     RETURNING id
  `);
  return rows.length > 0;
}
