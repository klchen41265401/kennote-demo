import type { AuthUser } from '@kennote/shared-types';
import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import type { SessionRecord } from './token-state.js';

export interface UserRow {
  id: string;
  email: string;
  email_verified_at: Date | null;
  name: string;
  avatar_url: string | null;
  locale: string;
  timezone: string;
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
  };
}

const USER_COLUMNS = sql.raw(
  'id, email::text AS email, email_verified_at, name, avatar_url, locale, timezone, created_at',
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
