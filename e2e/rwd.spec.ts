/**
 * RWD 與側邊欄收合的驗證（外加截圖）。
 *
 * ```bash
 * cd e2e
 * BASE_URL=http://127.0.0.1:5199 npx playwright test rwd.spec.ts
 * ```
 *
 * 輸出：reference/shots/kennote/rwd-<寬度>-<狀態>.png
 * 三種寬度：1440×900（桌機）/ 1024×768（平板）/ 390×844（手機）。
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const EMAIL = process.env['E2E_EMAIL'] ?? 'e2e@kennote.local';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'e2e-password-2026';
const SHOT_DIR = resolve(process.cwd(), process.env['SHOT_DIR'] ?? '../reference/shots/kennote');

mkdirSync(SHOT_DIR, { recursive: true });

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

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(450);
  await page.screenshot({ path: resolve(SHOT_DIR, `${name}.png`) });
}

/** 側邊欄目前的實際寬度（收合時是 0，抽屜模式時是 fixed 抽屜的寬度） */
async function sidebarWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="側邊欄"]');
    if (!nav) return 0;
    return Math.round(nav.getBoundingClientRect().width);
  });
}

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

test.describe('RWD 與側邊欄收合', () => {
  test('1440×900 桌機：收合 / 展開 / hover 浮出 / 寬度拖曳', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    // 展開狀態：側邊欄 270px
    expect(await sidebarWidth(page)).toBeGreaterThan(200);
    await shot(page, 'rwd-1440-expanded');

    // 點側邊欄右上角的收合鈕
    await page.getByRole('button', { name: '收合側邊欄' }).first().click();
    await page.waitForTimeout(600);
    expect(await sidebarWidth(page), '收合後側邊欄應該不再佔位').toBe(0);
    await shot(page, 'rwd-1440-collapsed');

    // 收合後：滑到左緣 → 浮出抽屜
    await page.mouse.move(600, 400);
    await page.mouse.move(120, 400);
    await page.mouse.move(3, 400);
    await page.waitForTimeout(800);
    expect(await sidebarWidth(page), 'hover 左緣應該浮出抽屜').toBeGreaterThan(200);
    await shot(page, 'rwd-1440-peek');
    await page.mouse.move(900, 400);
    await page.waitForTimeout(500);

    // 頂欄的展開鈕
    await page.getByRole('button', { name: '開啟側邊欄' }).first().click();
    await page.waitForTimeout(600);
    expect(await sidebarWidth(page)).toBeGreaterThan(200);

    // Ctrl+\ 收合再展開
    await page.keyboard.press('Control+\\');
    await page.waitForTimeout(500);
    expect(await sidebarWidth(page)).toBe(0);
    await page.keyboard.press('Control+\\');
    await page.waitForTimeout(500);
    expect(await sidebarWidth(page)).toBeGreaterThan(200);

    // 寬度拖曳（Resizable 的把手是 role="separator"），並驗證 200–420 的夾制
    const handle = page.locator('[role="separator"]').first();
    await handle.focus();
    for (let i = 0; i < 20; i += 1) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    const wide = await sidebarWidth(page);
    expect(wide, '上限 420').toBeLessThanOrEqual(421);
    expect(wide).toBeGreaterThan(270);
    await shot(page, 'rwd-1440-resized');

    for (let i = 0; i < 40; i += 1) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(400);
    expect(await sidebarWidth(page), '下限 200').toBeGreaterThanOrEqual(199);

    // 收合狀態要存進 localStorage
    await page.keyboard.press('Control+\\');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => localStorage.getItem('kennote:sidebar-collapsed'))).toBe('1');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    expect(await sidebarWidth(page), '重新整理後仍維持收合').toBe(0);
    await page.keyboard.press('Control+\\');
    await page.waitForTimeout(400);

    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('1024×768 平板：側邊欄改成覆蓋抽屜 + 遮罩', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await signIn(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    // 預設不佔位
    expect(await sidebarWidth(page), '平板預設不顯示側邊欄').toBe(0);
    await shot(page, 'rwd-1024-closed');

    await page.getByRole('button', { name: '開啟側邊欄' }).first().click();
    await page.waitForTimeout(600);
    expect(await sidebarWidth(page), '抽屜打開').toBeGreaterThan(200);
    await shot(page, 'rwd-1024-drawer');

    // 點遮罩關閉
    await page.mouse.click(800, 400);
    await page.waitForTimeout(600);
    expect(await sidebarWidth(page)).toBe(0);

    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('390×844 手機：topbar 40px、內容 padding 16、抽屜、無水平捲動', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    await shot(page, 'rwd-390-home');

    const topbarHeight = await page.evaluate(() => {
      const el = document.querySelector('header[role="banner"]');
      return el ? Math.round(el.getBoundingClientRect().height) : -1;
    });
    expect(topbarHeight, '手機 topbar 40px').toBe(40);

    expect(await sidebarWidth(page)).toBe(0);
    await page.getByRole('button', { name: '開啟側邊欄' }).first().click();
    await page.waitForTimeout(600);
    const drawer = await sidebarWidth(page);
    expect(drawer, '抽屜幾乎全寬').toBeGreaterThan(280);
    await shot(page, 'rwd-390-drawer');

    // 點抽屜裡的第一頁 → 抽屜自己收起來
    const firstRow = page.locator('[role="treeitem"]').first();
    if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
      await page.waitForTimeout(1500);
      expect(await sidebarWidth(page), '選頁之後抽屜要關起來').toBe(0);
      await page.waitForSelector('.kn-editor-host', { timeout: 20_000 });
      await shot(page, 'rwd-390-page');

      const pad = await page.evaluate(() => {
        const el = document.querySelector('.kn-editor-host');
        return el ? getComputedStyle(el).paddingLeft : '';
      });
      expect(pad, '手機內容欄左右 16px').toBe('16px');
    }

    expect(await hasHorizontalScroll(page), '手機不能有水平捲動').toBe(false);
  });
});
