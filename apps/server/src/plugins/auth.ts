/**
 * 認證 plugin：把 access token 解析成 request.user。
 * route 只要掛 { preHandler: app.requireAuth } 就有保護。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import { isSessionActive } from '../modules/auth/service.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') return null;
  return token;
}

export function registerAuthPlugin(app: FastifyInstance): void {
  app.decorateRequest('user', null);

  app.decorate('requireAuth', async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = extractToken(req);
    if (!token) throw new AppError('UNAUTHORIZED');
    const claims = verifyAccessToken(token);
    if (!claims) throw new AppError('SESSION_EXPIRED');
    // 登出之後舊的 access token 必須立刻失效 → 每次都確認 session 沒被撤銷
    if (!(await isSessionActive(claims.sid))) throw new AppError('SESSION_EXPIRED');
    req.user = { id: claims.sub, sessionId: claims.sid };
  });
}

/** route handler 內取得已驗證的使用者（type narrowing 用） */
export function requireUser(req: FastifyRequest): AuthenticatedUser {
  if (!req.user) throw new AppError('UNAUTHORIZED');
  return req.user;
}

export function clientInfo(req: FastifyRequest): { userAgent: string | null; ip: string | null } {
  return {
    userAgent: req.headers['user-agent'] ?? null,
    ip: req.ip ?? null,
  };
}
