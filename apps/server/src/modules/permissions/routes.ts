/**
 * 權限 / 分享 / 成員 API。
 * 路徑橫跨 /api/pages、/api/workspaces、/api/public，因此註冊絕對路徑（app.ts 不加 prefix）。
 *
 * `/api/public/:token` 是**唯一不需要登入**的端點，所以拆成另一個 plugin，
 * 不掛 requireAuth hook（04 §5.6：預設全部要認證，例外必須顯眼）。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../env.js';
import { requireUser } from '../../plugins/auth.js';
import { getPublicSnapshot } from './public-snapshot.js';
import * as service from './service.js';

const pageParams = z.object({ id: z.string().uuid() });
const writeLimit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

const setPermissionSchema = z.object({
  subjectType: z.enum(['user', 'workspace']),
  subjectId: z.string().uuid().nullable().optional(),
  permission: z.enum(['none', 'read', 'comment', 'edit', 'full']),
});

const shareSchema = z.object({
  enabled: z.boolean(),
  password: z.string().min(4).max(200).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const inviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(['admin', 'member', 'guest']).optional(),
});

export async function permissionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /* ── 頁面權限（SharePopover 的成員清單） ─────────────── */

  app.get('/api/pages/:id/permissions', async (req, reply) => {
    const user = requireUser(req);
    const { id } = pageParams.parse(req.params);
    return reply.send({ data: await service.getPageAccess(id, user.id) });
  });

  // 用 POST 而不是 PUT：前端 api-client 只有 get/post/patch/delete（04 §5.3）
  app.post('/api/pages/:id/permissions', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = pageParams.parse(req.params);
    const input = setPermissionSchema.parse(req.body);
    return reply.send({ data: await service.setPagePermission(id, user.id, input) });
  });

  /* ── 公開分享連結 ─────────────────────────────────── */

  app.post('/api/pages/:id/share', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = pageParams.parse(req.params);
    const input = shareSchema.parse(req.body);
    return reply.send({ data: await service.setPageShare(id, user.id, input) });
  });

  /* ── 工作區成員 ───────────────────────────────────── */

  app.post('/api/workspaces/:id/invites', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = pageParams.parse(req.params);
    const input = inviteSchema.parse(req.body);
    return reply.status(201).send({ data: await service.inviteMember(id, user.id, input) });
  });

  app.patch('/api/workspaces/:id/members/:userId', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id, userId } = z
      .object({ id: z.string().uuid(), userId: z.string().uuid() })
      .parse(req.params);
    const { role } = z
      .object({ role: z.enum(['owner', 'admin', 'member', 'guest']) })
      .parse(req.body);
    return reply.send({ data: await service.changeMemberRole(id, user.id, userId, role) });
  });

  app.delete('/api/workspaces/:id/members/:userId', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id, userId } = z
      .object({ id: z.string().uuid(), userId: z.string().uuid() })
      .parse(req.params);
    return reply.send({ data: await service.removeMember(id, user.id, userId) });
  });
}

/** 匿名可讀：GET /api/public/:token（FEATURE_PUBLIC_SHARE 關閉時一律 404） */
export async function publicShareRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/public/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = z.object({ token: z.string().min(8).max(200) }).parse(req.params);
      const { password } = z.object({ password: z.string().optional() }).parse(req.query);
      const headerPassword = req.headers['x-share-password'];
      const access = await service.resolvePublicAccess(
        token,
        password ?? (typeof headerPassword === 'string' ? headerPassword : null),
      );
      const snapshot = await getPublicSnapshot(access.pageId);
      return reply.send({
        data: { permission: access.permission, snapshot, featurePublicShare: env.FEATURE_PUBLIC_SHARE },
      });
    },
  );
}
