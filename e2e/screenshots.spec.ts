/**
 * kennote 截圖腳本 —— 產出與 `reference/notion-capture/` **同名**的畫面，
 * 方便把兩邊並排比對（左 Notion 原版、右 kennote）。
 *
 * ```bash
 * cd e2e
 * npm i -D @playwright/test && npx playwright install chromium
 * # 打遠端正式站（預設）
 * npx playwright test screenshots.spec.ts
 * # 打本機 dev server（vite proxy 到遠端 API）
 * BASE_URL=http://localhost:5173 npx playwright test screenshots.spec.ts
 * ```
 *
 * 環境變數：
 *   BASE_URL       預設 http://100.74.148.92:8090
 *   E2E_EMAIL      預設 e2e@kennote.local（不存在就自動註冊）
 *   E2E_PASSWORD   預設 e2e-password-2026
 *   SHOT_DIR       預設 ../reference/shots/kennote
 *
 * 輸出檔名對照 reference/notion-capture/INDEX.md 的代號，light / dark 各一份。
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const EMAIL = process.env['E2E_EMAIL'] ?? 'e2e@kennote.local';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'e2e-password-2026';
const SHOT_DIR = resolve(process.cwd(), process.env['SHOT_DIR'] ?? '../reference/shots/kennote');

type Theme = 'light' | 'dark';

mkdirSync(SHOT_DIR, { recursive: true });

async function shot(page: Page, name: string, theme: Theme): Promise<void> {
  await page.waitForTimeout(350); // 讓浮層動畫與字體載入收斂
  await page.screenshot({ path: resolve(SHOT_DIR, `${name}-${theme}.png`) });
}

async function clip(
  page: Page,
  name: string,
  theme: Theme,
  box: { x: number; y: number; width: number; height: number },
): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(SHOT_DIR, `${name}-${theme}.png`), clip: box });
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    localStorage.setItem('kennote:theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(200);
}

/**
 * 登入。依序嘗試：既有 session → 帳密 → 「不輸入，直接進入」（開發用的免帳密入口）→ 註冊。
 * auth 模組由另一位代理維護，入口會變，所以這裡刻意做成「有什麼就用什麼」。
 */
async function signIn(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  if (!page.url().includes('/login')) return;

  const email = page.locator('input[type="email"], input[name="email"]').first();
  const password = page.locator('input[type="password"]').first();
  if (await email.isVisible().catch(() => false)) {
    await email.fill(EMAIL);
    await password.fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(2000);
  }
  if (!page.url().includes('/login')) return;

  const guest = page.getByRole('button', { name: /不輸入|直接進入|訪客/ }).first();
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.waitForTimeout(2500);
  }
  if (!page.url().includes('/login')) return;

  await page.goto('/register', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const inputs = page.locator('input');
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const el = inputs.nth(i);
    const type = await el.getAttribute('type');
    const nameAttr = (await el.getAttribute('name')) ?? '';
    if (type === 'email' || nameAttr === 'email') await el.fill(EMAIL);
    else if (type === 'password') await el.fill(PASSWORD);
    else if (nameAttr === 'name') await el.fill('E2E 測試員');
  }
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2500);
}

/** 記住第一個頁面的網址，行動版沒有側邊欄時直接用 goto */
let firstPageUrl: string | null = null;

/** 側邊欄裡第一個頁面連結；沒有就建一個。 */
async function openFirstPage(page: Page): Promise<void> {
  if (firstPageUrl && page.viewportSize() && page.viewportSize()!.width < 768) {
    await page.goto(firstPageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    return;
  }
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // 側邊欄可能還在抓樹，先等到「有頁面」或「有新增頁面鈕」其中之一出現
  await page
    .locator('[role="treeitem"], button[aria-label="新增頁面"]')
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 })
    .catch(() => undefined);

  const rows = page.locator('[role="treeitem"]');
  if ((await rows.count()) === 0) {
    await page.getByRole('button', { name: '新增頁面', exact: true }).first().click({ timeout: 20_000 });
    await page.waitForTimeout(2200);
  } else {
    await rows.first().click();
    await page.waitForTimeout(1500);
  }
  if (page.url().includes('/page/')) firstPageUrl = page.url();
}

for (const theme of ['light', 'dark'] as Theme[]) {
  test.describe(`kennote 截圖（${theme}）`, () => {
    test(`全部畫面（${theme}）`, async ({ page }) => {
      /* ── m1-login：登入畫面 ── */
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await setTheme(page, theme);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      if (page.url().includes('/login')) await shot(page, 'm1-login', theme);

      await signIn(page);
      await setTheme(page, theme);

      /* ── 01-home：首頁 ── */
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.mouse.move(720, 450); // 頂欄動作是 hover 才顯示
      await page.waitForTimeout(1500);
      await shot(page, '01-home', theme);

      /* ── 03*：側邊欄 ── */
      await clip(page, '03-sidebar', theme, { x: 0, y: 0, width: 270, height: 899 });
      await clip(page, '03b-sidebar-top', theme, { x: 0, y: 0, width: 270, height: 180 });
      await clip(page, '03e-sidebar-bottom', theme, { x: 0, y: 740, width: 270, height: 159 });

      const firstRow = page.locator('[role="treeitem"]').first();
      if (await firstRow.isVisible().catch(() => false)) {
        await firstRow.hover();
        await clip(page, '03d-sidebar-item-hover', theme, { x: 0, y: 40, width: 270, height: 200 });
      }

      // 工作區切換器
      const wsButton = page.getByRole('button', { name: '切換工作區' });
      if (await wsButton.isVisible().catch(() => false)) {
        await wsButton.click();
        await shot(page, '03f-workspace-switcher', theme);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }

      /* ── 02 / 04：頁面與頂欄 ── */
      await openFirstPage(page);
      await page.mouse.move(900, 400);
      await page.waitForTimeout(900);
      await shot(page, '02-page-top', theme);
      await clip(page, '04-topbar', theme, { x: 270, y: 0, width: 1170, height: 44 });
      await clip(page, '04b-topbar-right', theme, { x: 1050, y: 0, width: 390, height: 44 });

      // 捲動之後的內容（各種 block）
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(500);
      await shot(page, '02b-page-mid', theme);
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(500);
      await shot(page, '02c-page-mid2', theme);
      await page.mouse.wheel(0, -1800);
      await page.waitForTimeout(400);

      /* ── 06k：頁面 ⋯ 選單 ── */
      const moreButton = page.getByRole('button', { name: '動作' }).first();
      if (await moreButton.isVisible().catch(() => false)) {
        await moreButton.click();
        await shot(page, '06k-page-more-menu-full', theme);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }

      /* ── 06j：分享 ── */
      const shareButton = page.getByRole('button', { name: /分享/ }).first();
      if (await shareButton.isVisible().catch(() => false)) {
        await shareButton.click();
        await shot(page, '06j-share-dialog-full', theme);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }

      /* ── 06 / 06d：編輯器浮層（slash / bubble）── */
      const firstBlock = page.locator('.kn-editor [contenteditable="true"]').first();
      if (await firstBlock.isVisible().catch(() => false)) {
        await firstBlock.click();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('/');
        await page.waitForTimeout(700);
        await shot(page, '06-slash-menu-full', theme);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);

        await page.keyboard.type('bubble menu 測試文字');
        await page.waitForTimeout(300);
        await page.keyboard.press('Home');
        await page.keyboard.press('Shift+End');
        await page.waitForTimeout(600);
        await shot(page, '06d-bubble-menu-full', theme);
        await page.keyboard.press('ArrowRight');
        // 清掉剛剛打的字，避免污染測試頁
        for (let i = 0; i < 24; i += 1) await page.keyboard.press('Backspace');
        await page.waitForTimeout(400);
      }

      /* ── 06i：Ctrl+K 搜尋 ── */
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(700);
      await shot(page, '06i-quick-find-full', theme);
      await page.keyboard.type('測試');
      await page.waitForTimeout(900);
      await shot(page, '06i2-quick-find-typed', theme);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      /* ── 08：設定 ── */
      await page.keyboard.press('Control+,');
      await page.waitForTimeout(700);
      await shot(page, '08-settings-account', theme);
      const prefNav = page.getByRole('button', { name: '我的設定' });
      if (await prefNav.isVisible().catch(() => false)) {
        await prefNav.click();
        await shot(page, '08b-settings-appearance', theme);
      }
      const wsNav = page.getByRole('button', { name: '一般' }).first();
      if (await wsNav.isVisible().catch(() => false)) {
        await wsNav.click();
        await shot(page, '08c-settings-workspace', theme);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      /* ── 09：垃圾桶 / 收件匣 / 留言 / 版本歷史 ── */
      const trashButton = page.getByRole('button', { name: '垃圾桶' }).first();
      if (await trashButton.isVisible().catch(() => false)) {
        await trashButton.click();
        await shot(page, '09-trash', theme);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }

      await page.goto('/inbox', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      await shot(page, '09b-inbox', theme);

      await openFirstPage(page);
      const commentButton = page.getByRole('button', { name: '留言' }).first();
      if (await commentButton.isVisible().catch(() => false)) {
        await commentButton.click();
        await page.waitForTimeout(700);
        await shot(page, '09c-comments-sidebar', theme);
        const historyTab = page.getByRole('tab', { name: '版本歷史' });
        if (await historyTab.isVisible().catch(() => false)) {
          await historyTab.click();
          await page.waitForTimeout(700);
          await shot(page, '09d-version-history', theme);
        }
        await page.getByRole('button', { name: '關閉面板' }).first().click();
        await page.waitForTimeout(300);
      }

      /* ── 03g：側邊欄收合 ── */
      await page.keyboard.press('Control+\\');
      await page.waitForTimeout(600);
      await shot(page, '03g-sidebar-collapsed', theme);
      await page.keyboard.press('Control+\\');
      await page.waitForTimeout(600);

      /* ── 07：資料庫（有的話）── */
      const dbRow = page.locator('[role="treeitem"]').filter({ hasText: /資料庫|database/i }).first();
      if (await dbRow.isVisible().catch(() => false)) {
        await dbRow.click();
        await page.waitForTimeout(1500);
        await shot(page, '07-db-table-full', theme);
        const boardTab = page.getByRole('tab', { name: /看板|board/i }).first();
        if (await boardTab.isVisible().catch(() => false)) {
          await boardTab.click();
          await page.waitForTimeout(1200);
          await shot(page, '07e-db-board-full', theme);
        }
      }

      /* ── 10：行動版 ── */
      await page.setViewportSize({ width: 390, height: 844 });
      await openFirstPage(page);
      await page.waitForTimeout(900);
      await shot(page, '10-mobile-page', theme);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      await shot(page, '10b-mobile-home', theme);
      await page.setViewportSize({ width: 1440, height: 900 });
    });
  });
}
