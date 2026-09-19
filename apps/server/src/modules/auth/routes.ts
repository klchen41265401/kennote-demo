import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { clientInfo, requireUser } from '../../plugins/auth.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.js';
import { listAuthProviders } from './providers/registry.js';
import * as service from './service.js';
import * as users from '../users/service.js';
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

/** 個人資料／偏好是「邊改邊存」，門檻放寬一點，但仍然有上限 */
const profileRateLimit = {
  config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
};

const preferencesSchema = z.object({
  locale: z.string().max(16).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  startPage: z.enum(['home', 'last']).optional(),
});

const profileSchema = z
  .object({
    name: z.string().min(1, '顯示名稱不能是空的').max(100).optional(),
    avatarUrl: z.string().max(2048).nullable().optional(),
    preferences: preferencesSchema.optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: '沒有要更新的欄位' });

const passwordSchema = z.object({
  currentPassword: z.string().max(PASSWORD_MAX_LENGTH).optional(),
  newPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `密碼至少 ${PASSWORD_MIN_LENGTH} 個字元`)
    .max(PASSWORD_MAX_LENGTH),
});

const claimSchema = z.object({
  email: z.string().email('請輸入有效的電子郵件').max(320),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `密碼至少 ${PASSWORD_MIN_LENGTH} 個字元`)
    .max(PASSWORD_MAX_LENGTH),
  name: z.string().max(100).optional(),
});

/**
 * 二次確認。前端的 api-client 在 DELETE 不帶 body，
 * 所以 query string 與 body 都收（?confirm=DELETE 或 { confirm: 'DELETE' }）。
 */
const deleteAccountSchema = z.object({ confirm: z.string().max(20).optional() });

const sessionParams = z.object({ id: z.string().uuid() });

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

  /* ── 帳號設定（設定 Dialog 的「我的帳號 / 我的設定」） ──── */

  /** 名稱、頭像、偏好（語言 / 主題 / 起始頁面）。只送要改的欄位 */
  app.patch('/me', { preHandler: app.requireAuth, ...profileRateLimit }, async (req, reply) => {
    const user = requireUser(req);
    const input = profileSchema.parse(req.body ?? {});
    return reply.send({ data: await users.updateProfile(user.id, input) });
  });

  /**
   * 刪除帳號（軟刪除 + 撤銷所有 session）。
   * 二次確認的字串由前端輸入，後端再驗一次 —— 不讓誤打的 DELETE 請求生效。
   */
  app.delete('/me', { preHandler: app.requireAuth, ...writeRateLimit }, async (req, reply) => {
    const user = requireUser(req);
    const fromQuery = deleteAccountSchema.parse(req.query ?? {});
    const fromBody = deleteAccountSchema.parse(req.body ?? {});
    const confirm = fromBody.confirm ?? fromQuery.confirm;
    if (confirm !== 'DELETE') throw new AppError('VALIDATION_FAILED', '請輸入 DELETE 以確認刪除');
    const result = await users.deleteAccount(user.id);
    void reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
    return reply.send({ data: result });
  });

  /** 改密碼：撤銷除了目前這一台以外的所有 session 家族 */
  app.post('/password', { preHandler: app.requireAuth, ...writeRateLimit }, async (req, reply) => {
    const user = requireUser(req);
    const input = passwordSchema.parse(req.body ?? {});
    return reply.send({
      data: await service.changePassword(user.id, user.sessionId, input),
    });
  });

  /** 訪客帳號升級成正式帳號（保留所有資料） */
  app.post('/claim', { preHandler: app.requireAuth, ...writeRateLimit }, async (req, reply) => {
    const user = requireUser(req);
    const input = claimSchema.parse(req.body ?? {});
    return reply.send({ data: await service.claimAccount(user.id, user.sessionId, input) });
  });

  /** 登出所有裝置（含目前這一台）→ 前端隨後導回登入頁 */
  app.post('/logout-all', { preHandler: app.requireAuth, ...writeRateLimit }, async (req, reply) => {
    const user = requireUser(req);
    const result = await service.logoutAll(user.id);
    void reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
    return reply.send({ data: result });
  });

  app.get('/sessions', { preHandler: app.requireAuth }, async (req, reply) => {
    const user = requireUser(req);
    return reply.send({ data: await service.listSessions(user.id, user.sessionId) });
  });

  app.delete('/sessions/:id', { preHandler: app.requireAuth, ...writeRateLimit }, async (req, reply) => {
    const user = requireUser(req);
    const { id } = sessionParams.parse(req.params);
    return reply.send({ data: await service.revokeSessionFamily(user.id, id) });
  });

  /** 登入頁用：目前啟用了哪些外部登入方式（Google / LINE 插槽） */
  app.get('/providers', async (_req, reply) => {
    return reply.send({ data: { providers: listAuthProviders(), openLogin: env.FEATURE_OPEN_LOGIN } });
  });
}
