/**
 * LINE Login 插槽。狀態同 google.ts：介面完成、流程未接。
 */
import { env } from '../../../env.js';
import { AppError } from '../../../lib/errors.js';
import type { AuthProvider, ExternalProfile } from './types.js';

export class LineProvider implements AuthProvider {
  readonly id = 'line';
  readonly displayName = 'LINE';
  readonly enabled = Boolean(env.LINE_CHANNEL_ID && env.LINE_CHANNEL_SECRET);

  getAuthorizationUrl(state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.LINE_CHANNEL_ID ?? '',
      redirect_uri: `${env.PUBLIC_BASE_URL}/api/auth/oidc/line/callback`,
      state,
      scope: 'profile openid email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
  }

  async exchangeCode(_code: string, _codeVerifier: string): Promise<ExternalProfile> {
    throw new AppError('NOT_IMPLEMENTED', 'LINE 登入尚未接上（插槽已預留）');
  }
}
