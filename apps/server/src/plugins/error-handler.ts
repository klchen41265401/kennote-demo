/**
 * 統一錯誤處理（04 §5.3）。
 * 所有錯誤都長 { error: { code, message, details? } }，前端只寫一次處理邏輯。
 */
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, isAppError } from '../lib/errors.js';
import { isProd } from '../env.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `找不到 ${req.method} ${req.url}` },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    if (isAppError(err)) {
      if (err.statusCode >= 500) req.log.error({ err }, err.message);
      else req.log.debug({ code: err.code }, err.message);
      return reply.status(err.statusCode).send(err.toJSON());
    }

    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: '輸入資料驗證失敗',
          details: {
            issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          },
        },
      });
    }

    // @fastify/rate-limit
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply
        .status(429)
        .send({ error: { code: 'RATE_LIMITED', message: '操作過於頻繁，請稍後再試' } });
    }

    // @fastify/multipart 的檔案過大
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply
        .status(413)
        .send({ error: { code: 'FILE_TOO_LARGE', message: '檔案超過大小上限' } });
    }

    // Fastify 內建 schema 驗證 / JSON 解析錯誤
    const raw = err as { statusCode?: number; message?: string; stack?: string };
    const statusCode = raw.statusCode ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: { code: 'BAD_REQUEST', message: raw.message || '請求格式不正確' },
      });
    }

    req.log.error({ err }, '未預期的錯誤');
    const fallback = new AppError('INTERNAL_ERROR');
    return reply.status(500).send({
      error: {
        code: fallback.code,
        message: fallback.message,
        ...(isProd ? {} : { details: { original: raw.message, stack: raw.stack } }),
      },
    });
  });
}
