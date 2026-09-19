import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../env.js';
import { db } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { AppError } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { requireUser } from '../../plugins/auth.js';
import { getMemberRole } from '../workspaces/repo.js';
import { requirePagePermission, resolvePagePermission } from '../permissions/service.js';
import { findFileInUserWorkspace, insertFile, rebindFilePage } from './repo.js';
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

      /*
       * 第九輪：附件從這一刻起記住「它屬於哪一頁」（migration 0070）。
       * 前端在編輯器 / 封面上傳時帶 `pageId`；頭像不帶（不屬於任何頁面）。
       * 帶了就要有那一頁的 `edit` —— 把附件塞進別人的頁面本身就是寫入。
       */
      const pageId =
        z
          .string()
          .uuid()
          .optional()
          .parse((part.fields.pageId as { value?: string } | undefined)?.value) ?? null;
      if (pageId) await requirePagePermission(user.id, pageId, 'edit');

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
        pageId,
      });

      return reply.status(201).send({
        data: {
          id: row.id,
          workspaceId: row.workspace_id,
          originalName: row.original_name,
          contentType: row.content_type,
          size: Number(row.size),
          pageId: row.page_id,
          url: `/api/files/${row.id}`,
          createdAt: row.created_at.toISOString(),
        },
      });
    },
  );

  /**
   * ⭐ 第九輪 §6-5：**附件的 `page_id` 不會跟著 block 搬家。**
   *
   * `block.move` 只能在同一頁裡搬（`apply-transaction` 的 op 沒有 pageId 欄位），
   * 所以「把圖片搬到另一頁」實際上是**剪下 → 貼上**：
   * 原頁 `block.delete`、新頁 `block.insert`，中間那個 `props.fileId` 原封不動。
   * 結果是新頁看得到圖、權限卻還鎖在舊頁：
   *   · 舊頁比新頁嚴 → 新頁的協作者看到破圖（**症狀是壞的**）
   *   · 舊頁比新頁鬆 → 只有新頁 read 的人拿得到舊頁的附件（**安全是壞的**）
   * 兩個方向都錯，所以這件事不能「刻意不做」。
   *
   * 為什麼是一支獨立端點、不是在 `apply-transaction` 裡掃 props：
   *   `apply-transaction` 是熱路徑（每一次打字），而跨頁貼上是**罕見事件**。
   *   把成本放在罕見事件上，不要放在熱路徑上。
   *
   * 權限：**兩頁都要 `edit`**。
   *   · 新頁要 edit —— 這是一次寫入（與 `upload` 帶 pageId 同一條紅線）
   *   · 舊頁也要 edit —— 否則只要對任何一頁有 edit，
   *     就能把別人私密頁裡的附件「改綁」到自己的頁面上，一次繞過 0070 的全部檢查。
   *     **放寬權限的操作要對「放寬之前」的那一邊也有權限。**
   *
   * 回 404（`FILE_NOT_FOUND`）而不是 403，理由同 `GET /:id`。
   */
  app.post(
    '/:id/rebind',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { pageId } = z.object({ pageId: z.string().uuid() }).parse(req.body);

      const file = await findFileInUserWorkspace(id, user.id);
      if (!file) throw new AppError('FILE_NOT_FOUND');

      if (file.page_id) {
        // 舊頁看不見 → 連「這個附件存在」都不承認
        const before = await resolvePagePermission(user.id, file.page_id);
        if (before === 'none') throw new AppError('FILE_NOT_FOUND');
        await requirePagePermission(user.id, file.page_id, 'edit');
      }
      await requirePagePermission(user.id, pageId, 'edit');

      // 附件不能跨工作區搬（儲存路徑 buildStorageKey 帶 workspaceId）
      const target = await db.queryOne<{ workspace_id: string }>(
        sql`SELECT workspace_id FROM pages WHERE id = ${pageId} AND deleted_at IS NULL`,
      );
      if (!target || target.workspace_id !== file.workspace_id) {
        throw new AppError('FILE_NOT_FOUND');
      }

      const row = await rebindFilePage(id, file.page_id, pageId);
      // 0 列 = 有人同時搬過它，讓呼叫端重試而不是靜默成功
      if (!row) throw new AppError('CONFLICT', '這個附件剛剛被其他人搬動了，請重試');

      return reply.send({
        data: { id: row.id, pageId: row.page_id },
      });
    },
  );

  app.get('/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    /*
     * ⭐ 第八輪 §4-1 的已知缺口，第九輪補上。
     *
     * 先用「工作區成員」把範圍收斂（不是成員 → 404，不洩漏存在性），
     * 再看 `page_id`：
     *   有值 → 依**那一頁的權限**（`resolvePagePermission(read)`），
     *          同工作區的 guest 從此拿不到私密頁面裡的附件；
     *   NULL → 0070 之前上傳的舊資料、頭像、匯入暫存檔 → 維持成員限定（退路）。
     *
     * 沒權限一律回 `FILE_NOT_FOUND`（404）而不是 403：
     * 403 等於承認「這個 fileId 存在」。
     */
    const file = await findFileInUserWorkspace(id, user.id);
    if (!file) throw new AppError('FILE_NOT_FOUND');
    if (file.page_id) {
      const permission = await resolvePagePermission(user.id, file.page_id);
      if (permission === 'none') throw new AppError('FILE_NOT_FOUND');
    }

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
