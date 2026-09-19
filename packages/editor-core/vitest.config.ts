import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    environmentMatchGlobs: [
      ['**/test/dom/**', 'jsdom'],
      ['**/test/integration/**', 'jsdom'],
    ],
    testTimeout: 30_000,
  },
});
