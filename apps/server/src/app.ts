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
import { listTrash } from './modules/pages/service.js';
import { websocketRoutes } from './modules/realtime/ws.js';
import { searchRoutes } from './modules/search/routes.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';
import { registerAuthPlugin, requireUser } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';

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
  initRealtime();

  app.get('/api/health', async () => {
    const db = await pingDatabase();
    return {
      data: {
        status: db ? 'ok' : 'degraded',
        db,
        version: VERSION,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
      },
    };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(workspaceRoutes, { prefix: '/api/workspaces' });
  await app.register(pageRoutes, { prefix: '/api/pages' });
  await app.register(databaseRoutes, { prefix: '/api/databases' });
  await app.register(fileRoutes, { prefix: '/api/files' });
  await app.register(searchRoutes, { prefix: '/api/search' });
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
  });

  await app.register(websocketRoutes);

  return app;
}
