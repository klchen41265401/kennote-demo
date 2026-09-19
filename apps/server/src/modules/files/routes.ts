import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../env.js';
import { db } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { requireUser } from '../../plugins/auth.js';
import { getMemberRole } from '../workspaces/repo.js';
import { findFileForUser, insertFile } from './repo.js';
import { buildStorageKey, createStorage, detectFileType } from './storage/index.js';

/** 使用者上傳的 HTML / SVG 一律強制下載，避免儲存型 XSS（04 §5.6） */
const FORCE_DOWNLOAD = new Set(['text/html', 'image/svg+xml', 'application/xhtml+xml']);

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post(
    '/upload',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const part = await req.file({ limits: { fileSize: env.STORAGE_MAX_FILE_SIZE } });
      if (!part) throw new AppError('BAD_REQUEST', '請求中沒有檔案');

      const workspaceId = z
        .string()
        .uuid('缺少 workspaceId 欄位')
        .parse((part.fields.workspaceId as { value?: string } | undefined)?.value);
      if (!(await getMemberRole(workspaceId, user.id))) throw new AppError('FORBIDDEN');

      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new AppError('FILE_TOO_LARGE');
        }
        throw err;
      }
      if (buffer.length === 0) throw new AppError('BAD_REQUEST', '檔案是空的');
      if (buffer.length > env.STORAGE_MAX_FILE_SIZE) throw new AppError('FILE_TOO_LARGE');

      // 以 magic number 決定真實型別，client 宣稱的 mimetype 只當參考
      const detected = detectFileType(buffer);
      if (!detected) throw new AppError('UNSUPPORTED_FILE_TYPE');

      const fileId = uuidv7();
      const storage = createStorage();
      const key = buildStorageKey(workspaceId, fileId, detected.ext);
      await storage.put(key, buffer, detected.mime);

      const row = await insertFile(db, {
        id: fileId,
        workspaceId,
        storageKey: key,
        storageDriver: storage.driver,
        originalName: part.filename?.slice(0, 500) ?? `${fileId}.${detected.ext}`,
        contentType: detected.mime,
        size: buffer.length,
        uploadedBy: user.id,
      });

      return reply.status(201).send({
        data: {
          id: row.id,
          workspaceId: row.workspace_id,
          originalName: row.original_name,
          contentType: row.content_type,
          size: Number(row.size),
          url: `/api/files/${row.id}`,
          createdAt: row.created_at.toISOString(),
        },
      });
    },
  );

  app.get('/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const file = await findFileForUser(id, user.id);
    if (!file) throw new AppError('FILE_NOT_FOUND');

    const storage = createStorage();
    const stream = await storage.get(file.storage_key);
    const disposition = FORCE_DOWNLOAD.has(file.content_type) ? 'attachment' : 'inline';

    void reply
      .header('Content-Type', file.content_type)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header(
        'Content-Disposition',
        `${disposition}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
      );
    return reply.send(stream);
  });
}
