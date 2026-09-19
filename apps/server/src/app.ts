import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pingDatabase } from './db/client.js';
import { env } from './env.js';
import { loggerOptions } from './lib/logger.js';
import { authRoutes } from './modules/auth/routes.js';
import { initAuthProviders } from './modules/auth/providers/registry.js';
import { databaseRoutes } from './modules/databases/routes.js';
import { fileRoutes } from './modules/files/routes.js';
import { commentRoutes } from './modules/comments/routes.js';
import { historyRoutes } from './modules/history/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { pageRoutes } from './modules/pages/routes.js';
import { permissionRoutes, publicShareRoutes } from './modules/permissions/routes.js';
import { initRealtime } from './modules/realtime/index.js';
import { emptyTrash, listTrash } from './modules/pages/service.js';
import { websocketRoutes } from './modules/realtime/ws.js';
import { searchRoutes } from './modules/search/routes.js';
import { recentRoutes } from './modules/recent/routes.js';
import { exportRoutes } from './modules/export/routes.js';
import { importRoutes } from './modules/import/routes.js';
import { gcRoutes } from './modules/gc/routes.js';
import { startGcScheduler } from './modules/gc/service.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';
import { registerAuthPlugin, requireUser } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { healthDetails, registerMetrics, setWsStatsProvider } from './plugins/metrics.js';

// block / field type registry 必須在啟動時就 import，註冊才會發生
import './modules/blocks/block-types/index.js';
import './modules/databases/field-types/index.js';

const VERSION = '0.1.0';
const startedAt = Date.now();

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
  });

  registerErrorHandler(app);
  // M6 可觀測性：請求計數 / 延遲直方圖 / GET /api/metrics（04 §8 M6 第 12 項）
  registerMetrics(app);

  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : true,
    credentials: true,
  });
  await app.register(cookie, { secret: env.JWT_SECRET });
  await app.register(rateLimit, {
    global: false,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  });
  await app.register(multipart, {
    limits: { fileSize: env.STORAGE_MAX_FILE_SIZE, files: 1 },
  });
  await app.register(websocket);

  registerAuthPlugin(app);
  initAuthProviders();
  // M5：接上 WS 廣播、留言/通知推播與權限守門員（掛勾都在 realtime/index.ts）
  const rooms = initRealtime();
  setWsStatsProvider(() => rooms.stats());
  // M6：垃圾桶 GC 排程（每日；手動觸發走 POST /api/admin/gc）
  startGcScheduler();

  app.get('/api/health', async () => {
    const db = await pingDatabase();
    const { migrations } = await healthDetails();
    return {
      data: {
        status: db && migrations.pending === 0 ? 'ok' : 'degraded',
        db,
        version: VERSION,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        migrations,
        // 前端據此決定要不要走 OT delta 通道（docs/adr/0006-ot.md「開啟 FEATURE_OT 的步驟」）。
        // 前後端必須一致：伺服器關著而前端開著，text.delta 會被回 NOT_IMPLEMENTED。
        features: {
          realtime: env.FEATURE_REALTIME,
          ot: env.FEATURE_OT,
          publicShare: env.FEATURE_PUBLIC_SHARE,
        },
      },
    };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(workspaceRoutes, { prefix: '/api/workspaces' });
  await app.register(pageRoutes, { prefix: '/api/pages' });
  await app.register(databaseRoutes, { prefix: '/api/databases' });
  await app.register(fileRoutes, { prefix: '/api/files' });
  await app.register(searchRoutes, { prefix: '/api/search' });
  await app.register(recentRoutes);
  await app.register(exportRoutes);
  await app.register(importRoutes);
  await app.register(gcRoutes);
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(commentRoutes);
  await app.register(permissionRoutes);
  await app.register(publicShareRoutes);
  await app.register(historyRoutes);

  await app.register(async (instance) => {
    instance.addHook('preHandler', instance.requireAuth);
    instance.get('/api/trash', async (req, reply) => {
      const user = requireUser(req);
      const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(req.query);
      return reply.send({ data: await listTrash(workspaceId, user.id) });
    });

    /** 批次「清空垃圾桶」（第六輪補）。刪不掉的（別人的頁面）會被跳過，不是整批失敗 */
    instance.delete(
      '/api/trash',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const user = requireUser(req);
        const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(req.query);
        return reply.send({ data: await emptyTrash(workspaceId, user.id) });
      },
    );
  });

  await app.register(websocketRoutes);

  return app;
}
