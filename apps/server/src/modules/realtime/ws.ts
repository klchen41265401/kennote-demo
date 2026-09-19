/**
 * WebSocket 端點（04 §6.1/§6.3）。原生 WebSocket + `ws`（透過 @fastify/websocket），
 * **協定之上的一切全部自研**：訊息格式、room、presence、補傳。
 *
 * 這一層只做三件事：
 *   1. 握手認證（query 的 token，或第一則 `auth` 訊息）+ 心跳
 *   2. 把訊息翻譯成 service 呼叫（applyTransaction / permissions / room-manager）
 *   3. 把結果翻譯回 ServerMessage
 *
 * **service 層完全不認識 WS**（04 §7.3 鐵則 1）：`tx` 走的是與
 * `POST /api/pages/:id/transactions` 完全相同的 applyTransaction()。
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ClientMessage, ServerMessage, TransactionResult } from '@kennote/shared-types';
import {
  WS_DEAD_CONNECTION_MS,
  WS_MAX_CATCHUP,
  WS_SERVER_HEARTBEAT_MS,
} from '@kennote/shared-types';
import { db } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { env } from '../../env.js';
import { isAppError } from '../../lib/errors.js';
import { isSessionActive } from '../auth/service.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { applyTransaction, listTransactionsSince } from '../blocks/apply-transaction.js';
import { resolvePagePermission } from '../permissions/service.js';
import { touchSubscription } from '../notifications/service.js';
import type { RealtimeConnection } from './room-manager.js';
import { getRoomManager } from './room-manager.js';

const AUTH_TIMEOUT_MS = 10_000;

interface UserRow {
  id: string;
  name: string;
  avatar_url: string | null;
}

async function loadUser(userId: string): Promise<UserRow | null> {
  return db.queryOne<UserRow>(sql`
    SELECT id, name, avatar_url FROM users WHERE id = ${userId} AND deleted_at IS NULL
  `);
}

async function getPageSeq(pageId: string): Promise<number | null> {
  const row = await db.queryOne<{ seq: number }>(sql`
    SELECT seq FROM pages WHERE id = ${pageId} AND deleted_at IS NULL
  `);
  return row ? Number(row.seq) : null;
}

export async function websocketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket, req: FastifyRequest) => {
    const rooms = getRoomManager();
    const query = (req.query ?? {}) as { token?: string; sessionId?: string };

    let conn: RealtimeConnection | null = null;
    let authTimer: ReturnType<typeof setTimeout> | null = null;
    /** 握手就帶 token 時，認證是非同步的；這段期間先到的訊息要排隊而不是被拒絕 */
    let authPending = Boolean(query.token);
    const earlyMessages: ClientMessage[] = [];

    const send = (msg: ServerMessage): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };

    const fail = (code: string, close = true): void => {
      authPending = false;
      earlyMessages.length = 0;
      send({ t: 'authError', code });
      if (close) socket.close(4401, 'unauthorized');
    };

    /** 認證成功 → 建立 Connection、掛上 user channel（通知推播） */
    const authenticate = async (token: string, sessionId: string): Promise<void> => {
      const claims = verifyAccessToken(token);
      if (!claims) return fail('UNAUTHORIZED');
      if (!(await isSessionActive(claims.sid))) return fail('SESSION_EXPIRED');
      const user = await loadUser(claims.sub);
      if (!user) return fail('UNAUTHORIZED');

      if (authTimer) {
        clearTimeout(authTimer);
        authTimer = null;
      }

      conn = {
        sessionId,
        userId: user.id,
        name: user.name,
        avatarUrl: user.avatar_url,
        subscribedPages: new Set<string>(),
        lastSeenAt: Date.now(),
        send,
        close: (code, reason) => socket.close(code ?? 1000, reason ?? ''),
      };
      await rooms.attachUser(conn);
      authPending = false;
      send({ t: 'authOk', userId: user.id, sessionId });

      // 補跑認證完成前就送到的訊息（順序不變）
      for (const queued of earlyMessages.splice(0)) await dispatch(queued);
    };

    /* ── subscribe：權限 → 入房 → synced / catchUp ─────── */

    const handleSubscribe = async (pageId: string, sinceSeq?: number): Promise<void> => {
      if (!conn) return;
      const permission = await resolvePagePermission(conn.userId, pageId);
      if (permission === 'none') {
        send({ t: 'error', code: 'PAGE_NOT_FOUND', message: '頁面不存在或沒有權限', pageId });
        return;
      }
      const seq = await getPageSeq(pageId);
      if (seq === null) {
        send({ t: 'error', code: 'PAGE_NOT_FOUND', message: '頁面不存在或已被刪除', pageId });
        return;
      }

      await rooms.subscribe(conn, pageId);
      send({ t: 'synced', pageId, seq, permission });

      if (sinceSeq === undefined || sinceSeq >= seq) return;
      // 落後太多就不補傳，叫 client 重抓 snapshot（04 §6.5）
      if (seq - sinceSeq > WS_MAX_CATCHUP) {
        send({ t: 'resync', pageId, reason: 'too_far_behind' });
        return;
      }
      const results = await listTransactionsSince(pageId, sinceSeq, WS_MAX_CATCHUP);
      send({ t: 'catchUp', pageId, results, toSeq: seq });
    };

    /* ── tx：與 HTTP 完全相同的 applyTransaction ────────── */

    const handleTx = async (tx: unknown): Promise<void> => {
      if (!conn) return;
      const envelope = tx as { txId?: string; pageId?: string };
      const txId = typeof envelope?.txId === 'string' ? envelope.txId : '';
      const pageId = typeof envelope?.pageId === 'string' ? envelope.pageId : '';
      if (!txId || !pageId) {
        send({ t: 'txRejected', txId, code: 'BAD_REQUEST', message: 'tx 缺少 txId 或 pageId' });
        return;
      }
      try {
        // 廣播由 setBroadcaster 掛勾負責（commit 之後），這裡只回覆提交者
        const result: TransactionResult = await applyTransaction(
          { pageId, userId: conn.userId },
          tx,
        );
        send({ t: 'txApplied', result });
        void touchSubscription(conn.userId, pageId).catch(() => {});
      } catch (err) {
        if (isAppError(err)) {
          send({ t: 'txRejected', txId, code: err.code, message: err.message });
        } else {
          req.log.error({ err }, 'WS transaction 失敗');
          send({ t: 'txRejected', txId, code: 'INTERNAL_ERROR', message: '伺服器處理失敗' });
        }
      }
    };

    /* ── 訊息分派 ──────────────────────────────────────── */

    const dispatch = async (msg: ClientMessage): Promise<void> => {
      {
        try {
          switch (msg.t) {
            case 'auth':
              if (conn) return;
              await authenticate(msg.token, msg.sessionId || randomUUID());
              return;
            case 'ping':
              send({ t: 'pong' });
              return;
            case 'subscribe':
              if (!conn) return fail('UNAUTHORIZED');
              await handleSubscribe(msg.pageId, msg.sinceSeq);
              return;
            case 'unsubscribe':
              if (!conn) return fail('UNAUTHORIZED');
              await rooms.unsubscribe(conn, msg.pageId);
              return;
            case 'tx':
              if (!conn) return fail('UNAUTHORIZED');
              await handleTx(msg.tx);
              return;
            case 'presence':
              if (!conn) return fail('UNAUTHORIZED');
              await rooms.updatePresence(conn, msg.pageId, msg.blockId, msg.selection);
              return;
            default:
              send({ t: 'error', code: 'UNKNOWN_MESSAGE', message: '不認識的訊息型別' });
          }
        } catch (err) {
          if (isAppError(err)) {
            send({ t: 'error', code: err.code, message: err.message });
          } else {
            req.log.error({ err }, 'WS 訊息處理失敗');
            send({ t: 'error', code: 'INTERNAL_ERROR', message: '伺服器處理失敗' });
          }
        }
      }
    };

    let dispatchChain: Promise<void> = Promise.resolve();
    socket.on('message', (raw: Buffer | string) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send({ t: 'error', code: 'BAD_MESSAGE', message: '訊息不是合法的 JSON' });
        return;
      }
      if (conn) conn.lastSeenAt = Date.now();
      // 認證還在跑（握手帶 token）→ 先排隊，authOk 之後照順序補跑
      if (!conn && authPending && msg.t !== 'auth' && msg.t !== 'ping') {
        if (earlyMessages.length < 50) earlyMessages.push(msg);
        return;
      }
      // 同一條連線的訊息必須「依到達順序」處理：client 先送 block.insert 再送 text.delta，
      // 若並行處理，delta 可能搶先進入交易而 BLOCK_NOT_FOUND。逐頁的 FOR UPDATE 只保證原子性，不保證順序。
      dispatchChain = dispatchChain.then(() => dispatch(msg)).catch(() => undefined);
    });

    /* ── 心跳：每 30s 檢查 lastSeenAt，超過 60s 清除死連線 ── */

    socket.on('pong', () => {
      if (conn) conn.lastSeenAt = Date.now();
    });

    const heartbeat = setInterval(() => {
      if (conn && Date.now() - conn.lastSeenAt > WS_DEAD_CONNECTION_MS) {
        socket.terminate();
        return;
      }
      try {
        socket.ping();
      } catch {
        /* 連線已關閉 */
      }
    }, WS_SERVER_HEARTBEAT_MS);
    heartbeat.unref?.();

    socket.on('close', () => {
      clearInterval(heartbeat);
      if (authTimer) clearTimeout(authTimer);
      if (conn) void rooms.removeConnection(conn);
      conn = null;
    });

    socket.on('error', () => {
      /* close 事件會接著來，統一在那裡清理 */
    });

    // 握手就帶 token 的情況（前端 sync-client 走這條，少一個 round trip）
    if (query.token) {
      void authenticate(query.token, query.sessionId || randomUUID());
    } else {
      authTimer = setTimeout(() => {
        if (!conn) fail('AUTH_TIMEOUT');
      }, AUTH_TIMEOUT_MS);
      authTimer.unref?.();
    }

    req.log.debug({ realtime: env.FEATURE_REALTIME }, 'WS 連線建立');
  });
}
