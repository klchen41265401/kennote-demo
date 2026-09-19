import { buildApp } from './app.js';
import { closePool } from './db/client.js';
import { env } from './env.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '收到關閉訊號，正在優雅關閉');
    try {
      await app.close();
      await closePool();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, '關閉時發生錯誤');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.SERVER_PORT, host: env.SERVER_HOST });
  logger.info(
    { port: env.SERVER_PORT, env: env.NODE_ENV },
    `kennote server 已啟動：http://localhost:${env.SERVER_PORT}/api/health`,
  );
}

main().catch((err) => {
  logger.error({ err }, '伺服器啟動失敗');
  process.exit(1);
});
