/**
 * 帳號設定的**純規則**：改密碼要不要驗舊密碼、session 清單怎麼分組、
 * 刪帳號時工作區交接給誰。
 *
 * 跟 token-state.ts 同一個理由抽出來：這些是最容易寫錯、也最該被單元測試釘死的
 * 分支（訪客 vs 正式帳號、只有自己 vs 還有別人），而且完全不需要資料庫。
 */
import type { SessionInfo, UserPreferences, WorkspaceRole } from '@kennote/shared-types';
import { GUEST_EMAIL_DOMAIN } from '@kennote/shared-types';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.js';

/** 訪客帳號 = FEATURE_OPEN_LOGIN 隨手發出來的那種（openLogin() 產生的 email） */
export function isGuestEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.toLowerCase().endsWith(GUEST_EMAIL_DOMAIN);
}

export type PasswordChangePlan =
  | { ok: true; verifyCurrent: boolean }
  | { ok: false; reason: 'CURRENT_REQUIRED' | 'TOO_SHORT' | 'TOO_LONG' | 'SAME_AS_CURRENT' };

/**
 * 改密碼前的規則判斷。
 * 訪客帳號還沒有人知道那串亂數密碼，所以允許不給舊密碼直接設定；
 * 正式帳號一定要驗舊密碼（否則 XSS 拿到 access token 就能鎖死帳號）。
 */
export function planPasswordChange(input: {
  isGuest: boolean;
  currentPassword?: string | undefined;
  newPassword: string;
}): PasswordChangePlan {
  const { isGuest, newPassword } = input;
  const current = input.currentPassword ?? '';
  if (newPassword.length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'TOO_SHORT' };
  if (newPassword.length > PASSWORD_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  if (!isGuest && current.length === 0) return { ok: false, reason: 'CURRENT_REQUIRED' };
  if (current.length > 0 && current === newPassword) return { ok: false, reason: 'SAME_AS_CURRENT' };
  return { ok: true, verifyCurrent: current.length > 0 };
}

/** preferences 是淺層合併：只送 theme 不該把 locale 洗掉；送 undefined 代表沒要改 */
export function mergePreferences(
  base: UserPreferences | null | undefined,
  patch: UserPreferences | undefined,
): UserPreferences {
  const current = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  if (!patch) return { ...current };
  const next: UserPreferences = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

export interface SessionFamilyRow {
  id: string;
  familyId: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * sessions 表一次登入會長出一整串（每次 refresh 輪替都插一列），
 * 但使用者眼中那是**一台裝置**。所以以 family_id 分組：
 *   id         = family_id（DELETE /sessions/:id 用這個）
 *   createdAt  = 這個家族最早那列（＝登入時間）
 *   lastUsedAt = 最新那列（＝最後一次 refresh）
 *   userAgent  = 最新那列有值的（使用者換瀏覽器版本時看到的是新的）
 */
export function summarizeSessions(
  rows: SessionFamilyRow[],
  currentFamilyId: string | null,
): SessionInfo[] {
  const byFamily = new Map<string, SessionFamilyRow[]>();
  for (const row of rows) {
    const list = byFamily.get(row.familyId);
    if (list) list.push(row);
    else byFamily.set(row.familyId, [row]);
  }

  const out: SessionInfo[] = [];
  for (const [familyId, list] of byFamily) {
    const sorted = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const withUa = [...sorted].reverse().find((r) => r.userAgent);
    const withIp = [...sorted].reverse().find((r) => r.ip);
    out.push({
      id: familyId,
      current: currentFamilyId !== null && familyId === currentFamilyId,
      userAgent: withUa?.userAgent ?? null,
      ip: withIp?.ip ?? null,
      createdAt: first.createdAt.toISOString(),
      lastUsedAt: last.createdAt.toISOString(),
      expiresAt: last.expiresAt.toISOString(),
    });
  }
  // 目前這台永遠排第一，其餘照最後使用時間由新到舊
  return out.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return b.lastUsedAt.localeCompare(a.lastUsedAt);
  });
}

export interface WorkspaceMemberCandidate {
  userId: string;
  role: WorkspaceRole;
  joinedAt: Date;
}

const SUCCESSOR_ORDER: WorkspaceRole[] = ['admin', 'member', 'owner', 'guest'];

/**
 * 刪帳號時，owner 的工作區要交接給誰。
 * 優先 admin → member → 另一位 owner → guest；同級取最早加入的（待最久的那位）。
 * 回 null 代表沒有別人了 → 工作區跟著一起軟刪。
 */
export function pickOwnershipSuccessor(
  members: WorkspaceMemberCandidate[],
  leavingUserId: string,
): WorkspaceMemberCandidate | null {
  const candidates = members.filter((m) => m.userId !== leavingUserId);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const ra = SUCCESSOR_ORDER.indexOf(a.role);
    const rb = SUCCESSOR_ORDER.indexOf(b.role);
    if (ra !== rb) return (ra < 0 ? SUCCESSOR_ORDER.length : ra) - (rb < 0 ? SUCCESSOR_ORDER.length : rb);
    return a.joinedAt.getTime() - b.joinedAt.getTime();
  });
  return sorted[0] ?? null;
}

/** 軟刪除後 email 要讓出來，否則同一個信箱再也註冊不回來（uq_users_email 是部分索引） */
export function deletedEmailFor(email: string, userId: string): string {
  const at = email.lastIndexOf('@');
  const local = at > 0 ? email.slice(0, at) : email;
  const domain = at > 0 ? email.slice(at + 1) : 'deleted.kennote.local';
  return `${local}+deleted-${userId.slice(0, 8)}@${domain}`;
}
