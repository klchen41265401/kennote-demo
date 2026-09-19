/**
 * 匯出 API。路徑在 /api/pages 底下，但邏輯屬於 export 模組，
 * 所以跟 history / recent 一樣用完整路徑註冊（app.ts 不加 prefix）。
 */
import type { FastifyInstance } from 'fastify';
import { EXPORT_FORMATS } from '@kennote/shared-types';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import { exportPage } from './service.js';

const pageParams = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  format: z.enum(EXPORT_FORMATS),
  includeSubpages: z.boolean().optional(),
  includeAttachments: z.boolean().optional(),
});

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post(
    '/api/pages/:id/export',
    // 匯出會掃整棵子樹 + 讀附件，比一般查詢重得多
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = pageParams.parse(req.params);
      const body = bodySchema.parse(req.body ?? {});
      const output = await exportPage(id, user.id, body);

      return reply
        .header('Content-Type', output.contentType)
        .header('X-Content-Type-Options', 'nosniff')
        .header(
          'Content-Disposition',
          `attachment; filename="${asciiFallback(output.filename)}"; filename*=UTF-8''${encodeURIComponent(output.filename)}`,
        )
        .send(output.body);
    },
  );
}

/** 舊瀏覽器只看得懂 ASCII 的 filename= */
function asciiFallback(name: string): string {
  const cleaned = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return cleaned.replace(/^_+$/, 'export') || 'export';
}
