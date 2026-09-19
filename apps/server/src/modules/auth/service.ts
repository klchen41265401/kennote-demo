/**
 * 認證商業邏輯。不碰 req/reply —— cookie 的設定/清除由 routes 負責。
 */
import type { AuthUser, SessionInfo, WorkspaceSummary } from '@kennote/shared-types';
import { db, withTransaction } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { createPage } from '../pages/service.js';
import { createWorkspace, listWorkspacesForUser } from '../workspaces/repo.js';
import {
  isGuestEmail,
  planPasswordChange,
  summarizeSessions,
} from './account-rules.js';
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from './password.js';
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

/* ────────────────────────────────────────────────────────────
 * 帳號設定（設定 Dialog 的「我的帳號」）
 * ──────────────────────────────────────────────────────────── */

function planFailure(reason: Exclude<ReturnType<typeof planPasswordChange>, { ok: true }>['reason']): AppError {
  switch (reason) {
    case 'CURRENT_REQUIRED':
      return new AppError('VALIDATION_FAILED', '請輸入目前的密碼');
    case 'TOO_SHORT':
      return new AppError('VALIDATION_FAILED', `密碼至少 ${PASSWORD_MIN_LENGTH} 個字元`);
    case 'TOO_LONG':
      return new AppError('VALIDATION_FAILED', '密碼過長');
    case 'SAME_AS_CURRENT':
      return new AppError('VALIDATION_FAILED', '新密碼不能和目前的密碼相同');
  }
}

/** 目前這條 access token 對應的 session 家族（改密碼時要留下來的那一台） */
async function currentFamilyId(sessionId: string): Promise<string | null> {
  const session = await repo.findSessionById(sessionId);
  return session?.familyId ?? null;
}

/**
 * 改密碼。成功之後**除了目前這一台以外**的 session 家族全部撤銷（04 §5.5）：
 * 密碼被偷過的情境下，改密碼必須真的把別人踢掉，否則等於沒改。
 *
 * 訪客帳號（以及只有 OIDC、身上沒有本地密碼的帳號）不需要舊密碼 ——
 * 那串密碼從來沒有人看過，要求輸入只會讓人永遠設不了密碼。
 */
export async function changePassword(
  userId: string,
  sessionId: string,
  input: { currentPassword?: string | undefined; newPassword: string },
): Promise<{ revokedSessions: number }> {
  const user = await repo.findUserById(userId);
  if (!user) throw new AppError('UNAUTHORIZED');
  const identity = await repo.findLocalIdentityByUserId(userId);
  const canSkipCurrent = isGuestEmail(user.email) || identity?.password_hash == null;

  const plan = planPasswordChange({
    isGuest: canSkipCurrent,
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
  });
  if (!plan.ok) throw planFailure(plan.reason);

  if (plan.verifyCurrent && identity?.password_hash != null) {
    const ok = await verifyPassword(identity.password_hash, input.currentPassword ?? '');
    if (!ok) throw new AppError('INVALID_CREDENTIALS', '目前的密碼不正確');
  }

  const passwordHash = await hashPassword(input.newPassword);
  const keepFamily = await currentFamilyId(sessionId);

  const revokedSessions = await withTransaction(async (tx) => {
    const updated = await repo.updateLocalPasswordHash(tx, userId, passwordHash);
    if (!updated) {
      // 沒有 local identity（純 OIDC 帳號）→ 補一筆，讓他之後也能用 email + 密碼登入
      await repo.createLocalIdentity(tx, { userId, email: user.email, passwordHash });
    }
    return repo.revokeUserSessions(tx, userId, 'password_changed', keepFamily);
  });

  logger.info({ userId, revokedSessions }, '使用者變更密碼，其他裝置已登出');
  return { revokedSessions };
}

/**
 * 訪客帳號升級成正式帳號：設定 email + 密碼，資料（工作區、頁面）原封不動留著。
 * 一樣會踢掉其他裝置 —— 升級前那些 session 拿的是「誰都能進」的訪客身分。
 */
export async function claimAccount(
  userId: string,
  sessionId: string,
  input: { email: string; password: string; name?: string | undefined },
): Promise<{ user: AuthUser; revokedSessions: number }> {
  const user = await repo.findUserById(userId);
  if (!user) throw new AppError('UNAUTHORIZED');
  if (!isGuestEmail(user.email)) {
    throw new AppError('CONFLICT', '這個帳號已經是正式帳號了');
  }

  const plan = planPasswordChange({ isGuest: true, newPassword: input.password });
  if (!plan.ok) throw planFailure(plan.reason);

  const email = input.email.trim().toLowerCase();
  if (isGuestEmail(email)) throw new AppError('VALIDATION_FAILED', '請使用真實的電子郵件');
  if (await repo.findUserByEmail(email)) throw new AppError('EMAIL_TAKEN');
  const takenIdentity = await repo.findLocalIdentity(email);
  if (takenIdentity && takenIdentity.user_id !== userId) throw new AppError('EMAIL_TAKEN');

  const passwordHash = await hashPassword(input.password);
  const keepFamily = await currentFamilyId(sessionId);
  const name = input.name?.trim();

  const result = await withTransaction(async (tx) => {
    const row = await repo.claimGuestAccount(tx, {
      userId,
      email,
      passwordHash,
      ...(name ? { name } : {}),
    });
    const revoked = await repo.revokeUserSessions(tx, userId, 'account_claimed', keepFamily);
    return { row, revoked };
  });

  logger.info({ userId }, '訪客帳號已升級為正式帳號');
  // 名稱可能剛剛才改，重讀一次拿最新的列
  const fresh = (await repo.findUserById(userId)) ?? result.row;
  return { user: repo.toAuthUser(fresh), revokedSessions: result.revoked };
}

/** 登出所有裝置（含目前這一台）。前端收到之後自己導回登入頁 */
export async function logoutAll(userId: string): Promise<{ revokedSessions: number }> {
  const revokedSessions = await repo.revokeUserSessions(db, userId, 'logout_all');
  logger.info({ userId, revokedSessions }, '使用者登出了所有裝置');
  return { revokedSessions };
}

/** 裝置清單。一個 refresh token 家族 = 一次登入 = 使用者眼中的一台裝置 */
export async function listSessions(userId: string, sessionId: string): Promise<SessionInfo[]> {
  const [rows, family] = await Promise.all([
    repo.listActiveSessionRows(userId),
    currentFamilyId(sessionId),
  ]);
  return summarizeSessions(rows, family);
}

/** 撤銷單一裝置。:id 收 family_id（清單回的 id），也接受某一列 session 的 id */
export async function revokeSessionFamily(
  userId: string,
  id: string,
): Promise<{ revokedSessions: number }> {
  const familyId = await repo.resolveSessionFamily(userId, id);
  if (!familyId) throw new AppError('NOT_FOUND', '找不到這個工作階段');
  const revokedSessions = await repo.revokeFamily(db, familyId, 'revoked_by_user');
  return { revokedSessions };
}
