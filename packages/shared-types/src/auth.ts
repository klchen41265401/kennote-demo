import type { PublicUser } from './page.js';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

export interface AuthUser extends PublicUser {
  locale: string;
  timezone: string;
  emailVerified: boolean;
  createdAt: string;
  /** 跟著帳號走的外觀偏好（users.preferences，migration 0050）。舊資料是空物件 */
  preferences: UserPreferences;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  role: WorkspaceRole;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: string;
  user: PublicUser;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * access token 回在 body（前端存記憶體，15 分鐘）；
 * refresh token 只存在 HttpOnly cookie，永遠不進 body（04 §5.5）。
 */
export interface AuthSessionResponse {
  accessToken: string;
  /** 秒數 */
  expiresIn: number;
  user: AuthUser;
  workspaces: WorkspaceSummary[];
}

/** 開放登入（FEATURE_OPEN_LOGIN）：登入頁不輸入或隨便輸入都能進 */
export interface OpenLoginRequest {
  email?: string;
  password?: string;
  name?: string;
}

export interface OpenLoginResponse extends AuthSessionResponse {
  /** 'login' 既有帳號密碼正確；'register' 自動建立；'guest' 以訪客身分進入 */
  mode: 'login' | 'register' | 'guest';
  note?: string;
}

export interface MeResponse {
  user: AuthUser;
  workspaces: WorkspaceSummary[];
}

/** JWT payload（04 §5.5） */
export interface AccessTokenClaims {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
}

/** OIDC 擴充點：registry 對外揭露的 provider 資訊 */
export interface AuthProviderInfo {
  id: string;
  displayName: string;
  enabled: boolean;
}

/* ────────────────────────────────────────────────────────────
 * 帳號設定（設定 Dialog 的「我的帳號 / 我的設定」）
 * ──────────────────────────────────────────────────────────── */

/**
 * 訪客帳號的 email 網域。FEATURE_OPEN_LOGIN 隨手發出來的帳號長這樣，
 * 前後端都要能辨認（前端顯示升級提示卡、後端放寬改密碼規則）。
 */
export const GUEST_EMAIL_DOMAIN = '@guest.kennote.local';

export function isGuestEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.toLowerCase().endsWith(GUEST_EMAIL_DOMAIN);
}

export type ThemePreference = 'light' | 'dark' | 'system';
export type StartPagePreference = 'home' | 'last';

/**
 * 跟著帳號走的外觀偏好（users.preferences JSONB，migration 0050）。
 * 每個鍵都是選填：缺鍵 = 用前端預設值，這樣加新偏好不必動資料。
 */
export interface UserPreferences {
  locale?: string;
  theme?: ThemePreference;
  startPage?: StartPagePreference;
}

/** PATCH /api/auth/me —— 只送要改的欄位 */
export interface UpdateProfileRequest {
  name?: string;
  /** 用 POST /api/files/upload 回來的 url；null = 移除頭像 */
  avatarUrl?: string | null;
  /** 淺層合併進現有 preferences，不是整包覆寫 */
  preferences?: UserPreferences;
}
export type UpdateProfileResponse = AuthUser;

/**
 * POST /api/auth/password。
 * 訪客帳號（isGuestEmail）可以不給 currentPassword 直接設定密碼；
 * 正式帳號一定要驗舊密碼，成功後除了目前這台以外的 session 家族全部撤銷。
 */
export interface ChangePasswordRequest {
  currentPassword?: string;
  newPassword: string;
}
export interface ChangePasswordResponse {
  /** 這次一起被踢掉的其他裝置數 */
  revokedSessions: number;
}

/** POST /api/auth/claim —— 把訪客帳號升級成正式帳號（保留所有資料） */
export interface ClaimAccountRequest {
  email: string;
  password: string;
  name?: string;
}
export interface ClaimAccountResponse {
  user: AuthUser;
  revokedSessions: number;
}

/** GET /api/auth/sessions 的一列 = 一次登入（同一個 refresh token 家族 = 同一台裝置） */
export interface SessionInfo {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}
export type ListSessionsResponse = SessionInfo[];

/** POST /api/auth/logout-all —— 含目前這一台，前端收到之後導回登入頁 */
export interface LogoutAllResponse {
  revokedSessions: number;
}

/** DELETE /api/auth/me —— 二次確認用，必須是字串 'DELETE' */
export interface DeleteAccountRequest {
  confirm: string;
}
export interface DeleteAccountResponse {
  /** 交接給其他成員的工作區 id */
  transferredWorkspaces: string[];
  /** 一併軟刪除（沒有其他成員）的工作區 id */
  deletedWorkspaces: string[];
}
