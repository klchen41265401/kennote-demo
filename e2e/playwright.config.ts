import { defineConfig } from '@playwright/test';

/**
 * 截圖比對用的設定。
 * 量測基準刻意與 reference/notion-capture 完全一致：**1440 × 900 @1x**，
 * 否則截圖無法並排比對。
 */
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://100.74.148.92:8090',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
  },
  // 刻意不 spread devices['Desktop Chrome'] —— 它會把 viewport 蓋成 1280×720，
  // 那就跟 reference/notion-capture 的 1440×900 對不起來了。
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
