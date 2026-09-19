import type { PublicUser } from './page.js';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

export interface AuthUser extends PublicUser {
  locale: string;
  timezone: string;
  emailVerified: boolean;
  createdAt: string;
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
