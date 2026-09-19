/**
 * AuthProvider registry（04 §5.5 的 OIDC 擴充點）。
 * 「之後要接 Google 登入」= 只加一個檔案 + 在 registry 註冊一行，
 * 不動 users 表、不改既有登入流程。
 */

export interface ExternalProfile {
  providerId: string;
  externalId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

export interface AuthProvider {
  /** 對應 /api/auth/oidc/:id */
  readonly id: string;
  readonly displayName: string;
  readonly enabled: boolean;
  getAuthorizationUrl(state: string, codeChallenge: string): string;
  exchangeCode(code: string, codeVerifier: string): Promise<ExternalProfile>;
}

/** local provider 不走 OIDC 流程，另外定義 */
export interface LocalAuthProvider {
  readonly id: 'local';
  readonly displayName: string;
  readonly enabled: true;
}
