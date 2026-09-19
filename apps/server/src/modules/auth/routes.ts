import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { clientInfo, requireUser } from '../../plugins/auth.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.js';
import { listAuthProviders } from './providers/registry.js';
import * as service from './service.js';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from './tokens.js';

const openSchema = z.object({
  email: z.string().max(320).optional(),
  password: z.string().max(PASSWORD_MAX_LENGTH).optional(),
  name: z.string().max(100).optional(),
});

const registerSchema = z.object({
  email: z.string().email('請輸入有效的電子郵件').max(320),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `密碼至少 ${PASSWORD_MIN_LENGTH} 個字元`)
    .max(PASSWORD_MAX_LENGTH),
  name: z.string().max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email('請輸入有效的電子郵件').max(320),
  password: z.string().min(1, '請輸入密碼').max(PASSWORD_MAX_LENGTH),
});

/** 所有寫入端點加 rate limit（04 §5.5 安全要點） */
const writeRateLimit = {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', writeRateLimit, async (req, reply) => {
    const input = registerSchema.parse(req.body);
    const bundle = await service.register(input, clientInfo(req));
    void reply.setCookie(REFRESH_COOKIE_NAME, bundle.refreshToken, refreshCookieOptions());
    return reply.status(201).send({
      data: {
        accessToken: bundle.accessToken,
        expiresIn: bundle.expiresIn,
        user: bundle.user,
        workspaces: bundle.workspaces,
      },
    });
  });

  app.post('/login', writeRateLimit, async (req, reply) => {
    const input = loginSchema.parse(req.body);
    const bundle = await service.login(input, clientInfo(req));
    void reply.setCookie(REFRESH_COOKIE_NAME, bundle.refreshToken, refreshCookieOptions());
    return reply.send({
      data: {
        accessToken: bundle.accessToken,
        expiresIn: bundle.expiresIn,
        user: bundle.user,
        workspaces: bundle.workspaces,
      },
    });
  });

  // 開放登入：不輸入或隨便輸入都能進（FEATURE_OPEN_LOGIN）
  app.post('/open', writeRateLimit, async (req, reply) => {
    if (!env.FEATURE_OPEN_LOGIN) throw new AppError('NOT_FOUND');
    const input = openSchema.parse(req.body ?? {});
    const bundle = await service.openLogin(input, clientInfo(req));
    void reply.setCookie(REFRESH_COOKIE_NAME, bundle.refreshToken, refreshCookieOptions());
    return reply.send({
      data: {
        accessToken: bundle.accessToken,
        expiresIn: bundle.expiresIn,
        user: bundle.user,
        workspaces: bundle.workspaces,
        mode: bundle.mode,
        ...(bundle.note ? { note: bundle.note } : {}),
      },
    });
  });

  app.post('/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE_NAME];
    if (!token) throw new AppError('REFRESH_TOKEN_MISSING');
    try {
      const bundle = await service.refresh(token, clientInfo(req));
      void reply.setCookie(REFRESH_COOKIE_NAME, bundle.refreshToken, refreshCookieOptions());
      return reply.send({
        data: {
          accessToken: bundle.accessToken,
          expiresIn: bundle.expiresIn,
          user: bundle.user,
          workspaces: bundle.workspaces,
        },
      });
    } catch (err) {
      // 失敗一律清掉 cookie，避免前端拿著壞 token 不斷重試
      void reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
      throw err;
    }
  });

  app.post('/logout', async (req, reply) => {
    await service.logout(req.cookies[REFRESH_COOKIE_NAME]);
    void reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
    return reply.send({ data: { ok: true } });
  });

  app.get('/me', { preHandler: app.requireAuth }, async (req, reply) => {
    const user = requireUser(req);
    return reply.send({ data: await service.me(user.id) });
  });

  /** 登入頁用：目前啟用了哪些外部登入方式（Google / LINE 插槽） */
  app.get('/providers', async (_req, reply) => {
    return reply.send({ data: { providers: listAuthProviders(), openLogin: env.FEATURE_OPEN_LOGIN } });
  });
}
