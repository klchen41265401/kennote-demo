import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // 純邏輯測試不需要資料庫，但有些模組會 import env.ts（啟動即驗證），
    // 所以這裡給一組合法的假值。真正需要 DB 的測試看 DATABASE_URL_TEST 決定要不要 skip。
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://kennote:kennote@localhost:5432/kennote_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
      LOG_LEVEL: 'error',
    },
  },
});
