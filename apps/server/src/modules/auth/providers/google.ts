/**
 * Google OIDC 插槽。
 * 介面完成、流程未接 —— 啟用方式：在 .env 填 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET，
 * 然後把 getAuthorizationUrl / exchangeCode 的 TODO 補完（約 60 行）。
 * 這個檔案存在的意義是：證明 registry 的形狀真的容得下一個外部 provider。
 */
import { env } from '../../../env.js';
import { AppError } from '../../../lib/errors.js';
import type { AuthProvider, ExternalProfile } from './types.js';

export class GoogleProvider implements AuthProvider {
  readonly id = 'google';
  readonly displayName = 'Google';
  readonly enabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  getAuthorizationUrl(state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      redirect_uri: `${env.PUBLIC_BASE_URL}/api/auth/oidc/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(_code: string, _codeVerifier: string): Promise<ExternalProfile> {
    throw new AppError('NOT_IMPLEMENTED', 'Google 登入尚未接上（插槽已預留）');
  }
}
