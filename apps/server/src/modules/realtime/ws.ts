/**
 * WebSocket 端點骨架（04 §6）。
 *
 * M1 只做三件事：把 /ws 掛起來、收 ping 回 pong、把未實作的訊息明確回錯。
 * M5 接手的人請在這裡實作 room-manager.ts / connection.ts / broadcast.ts，
 * 並用 setBroadcaster() 把 applyTransaction 的結果廣播出去 ——
 * **service 層不需要任何改動**，因為它本來就不認識 HTTP / WS（04 §7.3 鐵則 1）。
 *
 * 協定型別已經定好：packages/shared-types/src/ws.ts 的 ClientMessage / ServerMessage。
 */
import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage } from '@kennote/shared-types';
import { env } from '../../env.js';
import { verifyAccessToken } from '../auth/tokens.js';

export async function websocketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket, req) => {
    let userId: string | null = null;

    const send = (msg: ServerMessage) => socket.send(JSON.stringify(msg));

    socket.on('message', (raw: Buffer | string) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send({ t: 'authError', code: 'BAD_MESSAGE' });
        return;
      }

      switch (msg.t) {
        case 'auth': {
          const claims = verifyAccessToken(msg.token);
          if (!claims) {
            send({ t: 'authError', code: 'UNAUTHORIZED' });
            socket.close(4401, 'unauthorized');
            return;
          }
          userId = claims.sub;
          send({ t: 'authOk', userId });
          return;
        }
        case 'ping':
          send({ t: 'pong' });
          return;
        case 'subscribe':
        case 'unsubscribe':
        case 'tx':
        case 'presence':
          if (!userId) {
            send({ t: 'authError', code: 'UNAUTHORIZED' });
            return;
          }
          // M5 才實作：目前一律要求前端降級走 HTTP（04 §5.3 的 HTTP 降級路徑）
          send({
            t: 'resync',
            pageId: 'pageId' in msg ? msg.pageId : '',
            reason: 'realtime_not_implemented',
          });
          return;
        default:
          send({ t: 'authError', code: 'UNKNOWN_MESSAGE' });
      }
    });

    req.log.debug({ realtime: env.FEATURE_REALTIME }, 'WS 連線建立');
  });
}
