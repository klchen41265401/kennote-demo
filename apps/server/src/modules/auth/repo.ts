import type { AuthUser, UserPreferences } from '@kennote/shared-types';
import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import type { SessionFamilyRow } from './account-rules.js';
import type { SessionRecord } from './token-state.js';

export interface UserRow {
  id: string;
  email: string;
  email_verified_at: Date | null;
  name: string;
  avatar_url: string | null;
  locale: string;
  timezone: string;
  preferences: UserPreferences | null;
  created_at: Date;
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    locale: row.locale,
    timezone: row.timezone,
    emailVerified: row.email_verified_at !== null,
    createdAt: row.created_at.toISOString(),
    // 0050 之前建立的列沒有 preferences；一律正規化成物件，前端不必再防一次
    preferences:
      row.preferences && typeof row.preferences === 'object' && !Array.isArray(row.preferences)
        ? row.preferences
        : {},
  };
}

const USER_COLUMNS = sql.raw(
  'id, email::text AS email, email_verified_at, name, avatar_url, locale, timezone, preferences, created_at',
);

export async function findUserById(id: string, conn: Queryable = db): Promise<UserRow | null> {
  return conn.queryOne<UserRow>(sql`
    SELECT ${USER_COLUMNS} FROM users WHERE id = ${id} AND deleted_at IS NULL
  `);
}

export async function findUserByEmail(email: string, conn: Queryable = db): Promise<UserRow | null> {
  return conn.queryOne<UserRow>(sql`
    SELECT ${USER_COLUMNS} FROM users WHERE email = ${email}::citext AND deleted_at IS NULL
  `);
}

export interface LocalIdentityRow {
  id: string;
  user_id: string;
  password_hash: string | null;
}

export async function findLocalIdentity(
  email: string,
  conn: Queryable = db,
): Promise<LocalIdentityRow | null> {
  return conn.queryOne<LocalIdentityRow>(sql`
    SELECT id, user_id, password_hash
      FROM user_identities
     WHERE provider = 'local' AND external_id = ${email.toLowerCase()}
  `);
}

export async function createUserWithLocalIdentity(
  conn: Queryable,
  input: { email: string; name: string; passwordHash: string },
): Promise<UserRow> {
  const user = await conn.queryOne<UserRow>(sql`
    INSERT INTO users (email, name)
    VALUES (${input.email}::citext, ${input.name})
    RETURNING ${USER_COLUMNS}
  `);
  if (!user) throw new Error('建立使用者失敗');
  await conn.query(sql`
    INSERT INTO user_identities (user_id, provider, external_id, password_hash)
    VALUES (${user.id}, 'local', ${input.email.toLowerCase()}, ${input.passwordHash})
  `);
  return user;
}

export async function touchLastSeen(userId: string, conn: Queryable = db): Promise<void> {
  await conn.query(sql`UPDATE users SET last_seen_at = now() WHERE id = ${userId}`);
}

/* ── sessions（refresh token） ─────────────────────────── */

interface SessionRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    familyId: row.family_id,
    expiresAt: row.expires_at,
    rotatedAt: row.rotated_at,
    revokedAt: row.revoked_at,
  };
}

export async function createSession(
  conn: Queryable,
  input: {
    userId: string;
    familyId: string | null;
    tokenHash: string;
    parentId: string | null;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
  },
): Promise<SessionRecord> {
  // family_id 為 null 代表這是一次全新登入 → 用自己的 id 當 family root
  const row = await conn.queryOne<SessionRow>(sql`
    INSERT INTO sessions (user_id, family_id, token_hash, parent_id, expires_at, user_agent, ip)
    VALUES (
      ${input.userId},
      coalesce(${input.familyId}::uuid, uuid_generate_v7()),
      ${input.tokenHash},
      ${input.parentId},
      ${input.expiresAt.toISOString()},
      ${input.userAgent},
      ${input.ip}::inet
    )
    RETURNING id, user_id, family_id, expires_at, rotated_at, revoked_at
  `);
  if (!row) throw new Error('建立 session 失敗');
  // 全新登入時 family_id 是隨機產生的，但慣例上讓它等於第一個 session 的 id
  if (input.familyId === null) {
    await conn.query(sql`UPDATE sessions SET family_id = id WHERE id = ${row.id}`);
    row.family_id = row.id;
  }
  return toSessionRecord(row);
}

export async function findSessionByTokenHash(
  tokenHash: string,
  conn: Queryable = db,
): Promise<SessionRecord | null> {
  const row = await conn.queryOne<SessionRow>(sql`
    SELECT id, user_id, family_id, expires_at, rotated_at, revoked_at
      FROM sessions WHERE token_hash = ${tokenHash}
  `);
  return row ? toSessionRecord(row) : null;
}

export async function findSessionById(
  id: string,
  conn: Queryable = db,
): Promise<SessionRecord | null> {
  const row = await conn.queryOne<SessionRow>(sql`
    SELECT id, user_id, family_id, expires_at, rotated_at, revoked_at
      FROM sessions WHERE id = ${id}
  `);
  return row ? toSessionRecord(row) : null;
}

export async function markRotated(conn: Queryable, sessionId: string): Promise<void> {
  await conn.query(sql`UPDATE sessions SET rotated_at = now() WHERE id = ${sessionId}`);
}

export async function revokeSession(
  conn: Queryable,
  sessionId: string,
  reason: string,
): Promise<void> {
  await conn.query(sql`
    UPDATE sessions SET revoked_at = now(), revoked_reason = ${reason}
     WHERE id = ${sessionId} AND revoked_at IS NULL
  `);
}

/** 重用偵測觸發時：整個 session 家族一次撤銷（04 §5.5） */
export async function revokeFamily(
  conn: Queryable,
  familyId: string,
  reason: string,
): Promise<number> {
  const rows = await conn.query<{ id: string }>(sql`
    UPDATE sessions SET revoked_at = now(), revoked_reason = ${reason}
     WHERE family_id = ${familyId} AND revoked_at IS NULL
     RETURNING id
  `);
  return rows.length;
}

/* ── 帳號設定（改密碼 / 訪客升級 / 裝置清單） ───────────── */

/** 一個使用者目前還有效的 session 列（尚未撤銷、尚未過期） */
export async function listActiveSessionRows(
  userId: string,
  conn: Queryable = db,
): Promise<SessionFamilyRow[]> {
  const rows = await conn.query<{
    id: string;
    family_id: string;
    user_agent: string | null;
    ip: string | null;
    created_at: Date;
    expires_at: Date;
  }>(sql`
    SELECT id, family_id, user_agent, ip::text AS ip, created_at, expires_at
      FROM sessions
     WHERE user_id = ${userId}
       AND revoked_at IS NULL
       AND expires_at > now()
     ORDER BY created_at ASC
  `);
  return rows.map((r) => ({
    id: r.id,
    familyId: r.family_id,
    userAgent: r.user_agent,
    ip: r.ip,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

/**
 * 把 `:id` 解析成 family_id。
 * 前端拿到的清單用 family_id 當 id（一個家族 = 一台裝置），
 * 但也接受某一列 session 的 id，免得呼叫端要先知道我們的分組方式。
 */
export async function resolveSessionFamily(
  userId: string,
  id: string,
  conn: Queryable = db,
): Promise<string | null> {
  const row = await conn.queryOne<{ family_id: string }>(sql`
    SELECT family_id FROM sessions
     WHERE user_id = ${userId} AND (id = ${id}::uuid OR family_id = ${id}::uuid)
     ORDER BY created_at ASC
     LIMIT 1
  `);
  return row?.family_id ?? null;
}

/**
 * 撤銷這個使用者的所有 session。
 * exceptFamilyId 給值時保留那一個家族（改密碼「踢掉其他裝置但留著自己」用）。
 */
export async function revokeUserSessions(
  conn: Queryable,
  userId: string,
  reason: string,
  exceptFamilyId?: string | null,
): Promise<number> {
  const keep = exceptFamilyId
    ? sql`AND family_id <> ${exceptFamilyId}::uuid`
    : sql.empty;
  const rows = await conn.query<{ id: string }>(sql`
    UPDATE sessions SET revoked_at = now(), revoked_reason = ${reason}
     WHERE user_id = ${userId} AND revoked_at IS NULL ${keep}
     RETURNING id
  `);
  return rows.length;
}

/** 改密碼：只動 provider='local' 那一筆身分 */
export async function updateLocalPasswordHash(
  conn: Queryable,
  userId: string,
  passwordHash: string,
): Promise<boolean> {
  const rows = await conn.query<{ id: string }>(sql`
    UPDATE user_identities SET password_hash = ${passwordHash}
     WHERE user_id = ${userId} AND provider = 'local'
     RETURNING id
  `);
  return rows.length > 0;
}

/** 只有 OIDC 身分的帳號第一次設定密碼時，補一筆 local identity */
export async function createLocalIdentity(
  conn: Queryable,
  input: { userId: string; email: string; passwordHash: string },
): Promise<void> {
  await conn.query(sql`
    INSERT INTO user_identities (user_id, provider, external_id, password_hash)
    VALUES (${input.userId}, 'local', ${input.email.toLowerCase()}, ${input.passwordHash})
    ON CONFLICT (provider, external_id)
    DO UPDATE SET password_hash = EXCLUDED.password_hash
  `);
}

export async function findLocalIdentityByUserId(
  userId: string,
  conn: Queryable = db,
): Promise<LocalIdentityRow | null> {
  return conn.queryOne<LocalIdentityRow>(sql`
    SELECT id, user_id, password_hash
      FROM user_identities
     WHERE user_id = ${userId} AND provider = 'local'
  `);
}

/**
 * 訪客升級成正式帳號：users.email 與 local identity 的 external_id 必須同時換，
 * 否則下次用新 email 登入會找不到身分 → 一定要在同一個交易裡。
 */
export async function claimGuestAccount(
  conn: Queryable,
  input: { userId: string; email: string; passwordHash: string; name?: string | undefined },
): Promise<UserRow> {
  const email = input.email.trim().toLowerCase();
  const nameSet = input.name ? sql`, name = ${input.name}` : sql.empty;
  const user = await conn.queryOne<UserRow>(sql`
    UPDATE users
       SET email = ${email}::citext, email_verified_at = NULL ${nameSet}
     WHERE id = ${input.userId} AND deleted_at IS NULL
     RETURNING ${USER_COLUMNS}
  `);
  if (!user) throw new Error('找不到要升級的帳號');
  const updated = await conn.query<{ id: string }>(sql`
    UPDATE user_identities
       SET external_id = ${email}, password_hash = ${input.passwordHash}
     WHERE user_id = ${input.userId} AND provider = 'local'
     RETURNING id
  `);
  // 走 OIDC 進來、身上沒有 local identity 的帳號：補一筆
  if (updated.length === 0) {
    await conn.query(sql`
      INSERT INTO user_identities (user_id, provider, external_id, password_hash)
      VALUES (${input.userId}, 'local', ${email}, ${input.passwordHash})
    `);
  }
  return user;
}
