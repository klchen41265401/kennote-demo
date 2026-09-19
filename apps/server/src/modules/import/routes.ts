/**
 * 匯入 API（multipart）。
 *
 * 大檔案：@fastify/multipart 已經把上傳串流化並以 `STORAGE_MAX_FILE_SIZE` 封頂；
 * zip 的內容則是**逐項**解壓縮（見 export/zip.ts 的 ZipArchive.read），
 * 所以記憶體峰值 = 壓縮檔本身 + 最大單一檔案，而不是「全部解開」。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { requireUser } from '../../plugins/auth.js';
import { importFile } from './service.js';

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post(
    '/api/import',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const part = await req.file({ limits: { fileSize: env.STORAGE_MAX_FILE_SIZE } });
      if (!part) throw new AppError('BAD_REQUEST', '請求中沒有檔案');

      const fields = part.fields as Record<string, { value?: string } | undefined>;
      const { workspaceId, parentId } = z
        .object({
          workspaceId: z.string().uuid('缺少 workspaceId 欄位'),
          parentId: z.string().uuid().nullable().optional(),
        })
        .parse({
          workspaceId: fields.workspaceId?.value,
          parentId: fields.parentId?.value || undefined,
        });

      let data: Buffer;
      try {
        data = await part.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new AppError('FILE_TOO_LARGE');
        }
        throw err;
      }
      if (data.length === 0) throw new AppError('BAD_REQUEST', '檔案是空的');

      const result = await importFile(
        {
          workspaceId,
          parentId: parentId ?? null,
          filename: part.filename ?? 'import',
          data,
        },
        user.id,
      );
      return reply.status(201).send({ data: result });
    },
  );
}
