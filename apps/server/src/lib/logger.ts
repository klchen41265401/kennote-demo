import { pino, type LoggerOptions } from 'pino';
import { env, isProd } from '../env.js';

/**
 * pino 設定。Fastify 收 options（而不是 instance），
 * 這樣 FastifyInstance 的泛型才不會被特化成某個具體 Logger 型別
 * （否則每個 route 模組的 FastifyInstance 參數都會對不起來）。
 */
export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
    ],
    censor: '[已遮蔽]',
  },
};

/** 給 service 層、migration、seed 用的獨立 logger（不經過 request 上下文） */
export const logger = pino(loggerOptions);

export type Logger = typeof logger;
