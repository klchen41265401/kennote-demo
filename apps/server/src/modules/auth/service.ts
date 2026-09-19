/**
 * 認證商業邏輯。不碰 req/reply —— cookie 的設定/清除由 routes 負責。
 */
import type { AuthUser, WorkspaceSummary } from '@kennote/shared-types';
import { db, withTransaction } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { createPage } from '../pages/service.js';
import { createWorkspace, listWorkspacesForUser } from '../workspaces/repo.js';
import { hashPassword, verifyPassword } from './password.js';
import * as repo from './repo.js';
import { classifyRefresh, decisionErrorCode, shouldRevokeFamily } from './token-state.js';
import {
  ACCESS_TTL_SECONDS,
  generateRefreshToken,
  hashRefreshToken,
  refreshExpiresAt,
  signAccessToken,
} from './tokens.js';

export interface SessionBundle {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
  workspaces: WorkspaceSummary[];
}

export interface ClientInfo {
  userAgent: string | null;
  ip: string | null;
}

function slugify(seed: string): string {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${base || 'ws'}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 註冊：建立 user + local identity + 預設工作區 + 第一個頁面 */
export async function register(
  input: { email: string; password: string; name?: string },
  client: ClientInfo,
): Promise<SessionBundle> {
  const email = input.email.trim().toLowerCase();
  const existing = await repo.findUserByEmail(email);
  if (existing) throw new AppError('EMAIL_TAKEN');

  const passwordHash = await hashPassword(input.password);
  const name = input.name?.trim() || email.split('@')[0] || 'Kennote 使用者';

  const { user, workspace } = await withTransaction(async (tx) => {
    const created = await repo.createUserWithLocalIdentity(tx, { email, name, passwordHash });
    const ws = await createWorkspace(tx, {
      name: `${name} 的工作區`,
      slug: slugify(name),
      ownerId: created.id,
    });
    return { user: created, workspace: ws };
  });

  // 第一個頁面走正規的 createPage（因此也會自動得到一個空 paragraph block）
  await createPage(
    { workspaceId: workspace.id, title: [{ text: '歡迎使用 kennote' }], icon: '👋' },
    user.id,
  ).catch((err) => {
    logger.warn({ err }, '建立歡迎頁面失敗（不影響註冊）');
  });

  return issueSession(user.id, client);
}

export async function login(
  input: { email: string; password: string },
  client: ClientInfo,
): Promise<SessionBundle> {
  const email = input.email.trim().toLowerCase();
  const identity = await repo.findLocalIdentity(email);
  // 帳號不存在時也跑一次雜湊比對，讓回應時間不會洩漏帳號是否存在
  const hash = identity?.password_hash ?? '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ok = await verifyPassword(hash, input.password);
  if (!identity || !ok) throw new AppError('INVALID_CREDENTIALS');

  await repo.touchLastSeen(identity.user_id);
  return issueSession(identity.user_id, client);
}

/**
 * 開放登入（FEATURE_OPEN_LOGIN）：
 *  - 沒給 email → 建立一個訪客帳號並登入
 *  - email 不存在 → 直接用給的資料註冊（密碼太短就補到最低長度）
 *  - email 存在且密碼正確 → 一般登入
 *  - email 存在但密碼錯 → 不洩漏帳號、也不放行既有帳號：改以訪客身分進入
 */
export async function openLogin(
  input: { email?: string; password?: string; name?: string },
  client: ClientInfo,
): Promise<SessionBundle & { mode: 'login' | 'register' | 'guest'; note?: string }> {
  const email = input.email?.trim().toLowerCase() ?? '';
  const password = input.password ?? '';
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const guest = async (note?: string) => {
    const id = Math.random().toString(36).slice(2, 10);
    const bundle = await register(
      { email: `guest-${id}@guest.kennote.local`, password: `guest-${id}-${Date.now()}`, name: input.name?.trim() || '訪客' },
      client,
    );
    return { ...bundle, mode: 'guest' as const, ...(note ? { note } : {}) };
  };

  if (!looksLikeEmail) return guest(email ? '輸入的不是電子郵件，已以訪客身分進入' : undefined);

  const identity = await repo.findLocalIdentity(email);
  if (!identity) {
    const safePassword = password.length >= 8 ? password : `${password}${'kennote!'.repeat(2)}`.slice(0, 32);
    const bundle = await register({ email, password: safePassword, name: input.name }, client);
    return { ...bundle, mode: 'register' as const, note: '已自動建立帳號' };
  }
  const ok = password.length > 0 && identity.password_hash != null && (await verifyPassword(identity.password_hash, password));
  if (ok) {
    await repo.touchLastSeen(identity.user_id);
    const bundle = await issueSession(identity.user_id, client);
    return { ...bundle, mode: 'login' as const };
  }
  return guest('密碼不符，已以訪客身分進入');
}

/** 發一組新的 access + refresh（全新登入 → 新的 session 家族） */
async function issueSession(
  userId: string,
  client: ClientInfo,
  family?: { familyId: string; parentId: string },
): Promise<SessionBundle> {
  const refreshToken = generateRefreshToken();
  const session = await repo.createSession(db, {
    userId,
    familyId: family?.familyId ?? null,
    tokenHash: hashRefreshToken(refreshToken),
    parentId: family?.parentId ?? null,
    expiresAt: refreshExpiresAt(),
    userAgent: client.userAgent,
    ip: client.ip,
  });

  const userRow = await repo.findUserById(userId);
  if (!userRow) throw new AppError('UNAUTHORIZED');

  return {
    accessToken: signAccessToken(userId, session.id),
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
    user: repo.toAuthUser(userRow),
    workspaces: await listWorkspacesForUser(userId),
  };
}

/**
 * Refresh with rotation + 重用偵測。
 * 舊 token 被用第二次 → 整個 session 家族撤銷（04 §5.5）。
 */
export async function refresh(refreshToken: string, client: ClientInfo): Promise<SessionBundle> {
  const tokenHash = hashRefreshToken(refreshToken);
  const session = await repo.findSessionByTokenHash(tokenHash);
  const decision = classifyRefresh(session);

  if (decision !== 'VALID') {
    if (session && shouldRevokeFamily(decision)) {
      const revoked = await repo.revokeFamily(db, session.familyId, 'refresh_token_reuse');
      logger.warn(
        { userId: session.userId, familyId: session.familyId, revoked },
        '偵測到 refresh token 重用，已撤銷整個 session 家族',
      );
    }
    if (decision === 'INVALID') throw new AppError('SESSION_EXPIRED');
    throw new AppError(decisionErrorCode(decision));
  }

  const current = session!;
  await repo.markRotated(db, current.id);
  return issueSession(current.userId, client, {
    familyId: current.familyId,
    parentId: current.id,
  });
}

/** 登出：撤銷這一條 session（不動同家族的其他裝置） */
export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  const session = await repo.findSessionByTokenHash(hashRefreshToken(refreshToken));
  if (!session) return;
  await repo.revokeSession(db, session.id, 'logout');
}

export async function me(userId: string): Promise<{ user: AuthUser; workspaces: WorkspaceSummary[] }> {
  const row = await repo.findUserById(userId);
  if (!row) throw new AppError('UNAUTHORIZED');
  return { user: repo.toAuthUser(row), workspaces: await listWorkspacesForUser(userId) };
}

/** access token 驗證後，確認 session 仍然有效（登出後舊 access token 立刻失效） */
export async function isSessionActive(sessionId: string): Promise<boolean> {
  const session = await repo.findSessionById(sessionId);
  if (!session) return false;
  return session.revokedAt === null;
}
