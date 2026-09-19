/**
 * Token 產生與驗證。
 * - access token：JWT，15 分鐘，回在 response body（前端存記憶體）
 * - refresh token：**不透明**隨機字串，只有 sha256 進資料庫，
 *   原文只存在 HttpOnly + SameSite=Lax cookie 裡（04 §5.5）
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { AccessTokenClaims } from '@kennote/shared-types';
import { env } from '../../env.js';

export const REFRESH_COOKIE_NAME = 'kennote_rt';

export function signAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId }, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    issuer: 'kennote',
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { issuer: 'kennote' });
    if (typeof decoded === 'string') return null;
    const { sub, sid, iat, exp } = decoded as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof sid !== 'string') return null;
    return { sub, sid, iat: Number(iat), exp: Number(exp) };
  } catch {
    return null;
  }
}

/** 256 bit 的不透明 token；base64url 之後是 43 字元 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 固定時間比較，避免用回應時間猜 token */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function refreshCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
  domain?: string;
} {
  const opts = {
    httpOnly: true as const,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: env.JWT_REFRESH_TTL_SECONDS,
  };
  return env.COOKIE_DOMAIN ? { ...opts, domain: env.COOKIE_DOMAIN } : opts;
}

export function refreshExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + env.JWT_REFRESH_TTL_SECONDS * 1000);
}

export const ACCESS_TTL_SECONDS = env.JWT_ACCESS_TTL_SECONDS;
