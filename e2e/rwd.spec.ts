/**
 * RWD 驗證（gap-review §D：D-1 ~ D-12）＋ 四檔寬度 × light/dark 截圖。
 *
 * ```bash
 * cd e2e
 * BASE_URL=http://127.0.0.1:5322 npx playwright test rwd.spec.ts
 * ```
 *
 * 輸出：reference/shots/kennote/rwd-<寬度>-<狀態>.png
 *
 * 斷點（`apps/web/src/stores/ui.ts` 的 `currentBreakpoint()`）：
 *
 * | 寬度 | 側邊欄 | 右側面板 | 內容欄 gutter | 底部工具列 |
 * |---|---|---|---|---|
 * | 390  | 覆蓋抽屜 + 遮罩 | 覆蓋抽屜（幾乎滿版） | 16 | 有 |
 * | 768  | **佔位欄**（預設未釘住，`Ctrl+\` 釘住） | 覆蓋抽屜 | 48 | 無 |
 * | 1024 | 同上 | 覆蓋抽屜 | 48 | 無 |
 * | 1280 | 佔位欄、預設展開 | **佔位欄**（推擠內容） | 96 | 無 |
 *
 * ⚠️ D-1 之前「768–1279 跟手機一樣是覆蓋抽屜」，舊斷言已隨斷點一起改掉。
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

/** 側邊欄是「佔位欄」還是「覆蓋抽屜」：佔位欄不是 fixed，而且主欄會被推窄 */
async function sidebarIsDocked(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="側邊欄"]');
    if (!nav) return false;
    for (let el: Element | null = nav; el; el = el.parentElement) {
      if (getComputedStyle(el).position === 'fixed') return false;
    }
    return nav.getBoundingClientRect().width > 0;
  });
}

/** 右側面板是不是覆蓋式抽屜（fixed）；佔位欄回傳 false */
async function rightPanelMode(page: Page): Promise<'none' | 'drawer' | 'docked'> {
  return page.evaluate(() => {
    const panel = document.querySelector('aside[aria-label="側邊面板"]');
    if (!panel) return 'none';
    for (let el: Element | null = panel; el; el = el.parentElement) {
      if (getComputedStyle(el).position === 'fixed') return 'drawer';
    }
    return 'docked';
  });
}

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

async function topbarHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('header[role="banner"]');
    return el ? Math.round(el.getBoundingClientRect().height) : -1;
  });
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset['theme'] = t;
    document.documentElement.classList.toggle('kn-dark', t === 'dark');
    try {
      localStorage.setItem('kennote:theme', t);
    } catch {
      /* 無痕 */
    }
  }, theme);
  await page.waitForTimeout(250);
}

/**
 * 開啟第一個頁面（找不到就留在首頁）。
 * ⚠️ 768 以上未釘住、390 未開抽屜時，頁面樹根本不在畫面上 —— 要先把側邊欄叫出來，
 * 不然 `openFirstPage()` 會一路回傳 false，讓後面的斷言「空過」。
 */
async function openFirstPage(page: Page): Promise<boolean> {
  const firstRow = page.locator('[role="treeitem"]').first();
  if (!(await firstRow.isVisible().catch(() => false))) {
    const toggle = page.getByRole('button', { name: '開啟側邊欄' }).first();
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(700);
    }
  }
  if (!(await firstRow.isVisible().catch(() => false))) return false;
  await firstRow.click();
  await page.waitForTimeout(1400);
  return page.locator('.kn-editor-host').first().isVisible().catch(() => false);
}

test.describe('RWD 與側邊欄收合', () => {
  test('1280×900 桌機：收合 / 展開 / hover 浮出 / 寬度拖曳 / 右側面板佔位', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    // 展開狀態：側邊欄 270px 且**佔位**
    expect(await sidebarWidth(page)).toBeGreaterThan(200);
    expect(await sidebarIsDocked(page), '桌機側邊欄是佔位欄').toBe(true);
    expect(await topbarHeight(page), '桌機 topbar 44').toBe(44);
    await shot(page, 'rwd-1280-expanded');

    // 點側邊欄右上角的收合鈕
    await page.getByRole('button', { name: '收合側邊欄' }).first().click();
    await page.waitForTimeout(600);
    expect(await sidebarWidth(page), '收合後側邊欄應該不再佔位').toBe(0);
    await shot(page, 'rwd-1280-collapsed');

    // 收合後：滑到左緣 → 浮出抽屜
    await page.mouse.move(600, 400);
    await page.mouse.move(120, 400);
    await page.mouse.move(3, 400);
    await page.waitForTimeout(800);
    expect(await sidebarWidth(page), 'hover 左緣應該浮出抽屜').toBeGreaterThan(200);
    await shot(page, 'rwd-1280-peek');
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
    await shot(page, 'rwd-1280-resized');

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

  test('D-1 768×1024 平板直式：側邊欄是佔位欄（可釘住）、右側面板是覆蓋抽屜', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await signIn(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    // 預設沒釘住 → 不佔位
    expect(await sidebarWidth(page), '平板預設不釘住側邊欄').toBe(0);
    expect(await topbarHeight(page), '平板 topbar 44').toBe(44);
    await shot(page, 'rwd-768-closed');

    // D-10：Ctrl+\ / 頂欄漢堡把側邊欄「釘住」成佔位欄（不是覆蓋抽屜）
    await page.getByRole('button', { name: '開啟側邊欄' }).first().click();
    await page.waitForTimeout(600);
    expect(await sidebarIsDocked(page), '平板釘住後是佔位欄，不是覆蓋抽屜').toBe(true);
    const docked = await sidebarWidth(page);
    expect(docked, '768–1023 的佔位側邊欄 240').toBeLessThanOrEqual(240);
    expect(docked).toBeGreaterThan(200);
    await shot(page, 'rwd-768-docked');
    expect(
      await page.evaluate(() => localStorage.getItem('kennote:sidebar-pinned-tablet')),
      '釘住狀態要持久化',
    ).toBe('1');

    // 再按一次 → 取消釘住
    await page.keyboard.press('Control+\\');
    await page.waitForTimeout(500);
    expect(await sidebarWidth(page)).toBe(0);

    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('D-1 / D-9 1024×768 平板橫式：內容欄不貼邊、右側面板覆蓋抽屜', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await signIn(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await shot(page, 'rwd-1024-closed');

    expect(await sidebarWidth(page)).toBe(0);
    await page.getByRole('button', { name: '開啟側邊欄' }).first().click();
    await page.waitForTimeout(600);
    expect(await sidebarIsDocked(page), '1024 的側邊欄是佔位欄').toBe(true);
    await shot(page, 'rwd-1024-docked');

    // D-9：內容欄不能貼邊。1024 的空白是「主欄寬 - 724 的置中留白」，
    // 768–1023 才需要靠 padding 撐（那一條在下一個 test 驗）。
    if (await openFirstPage(page)) {
      const gutter = await page.evaluate(() => {
        const host = document.querySelector('.kn-editor-host');
        const main = host?.closest('[class*="content"], [class*="main"]') ?? document.body;
        if (!host) return -1;
        const h = host.getBoundingClientRect();
        const m = main.getBoundingClientRect();
        return Math.round(h.left - m.left + parseFloat(getComputedStyle(host).paddingLeft));
      });
      expect(gutter, '1024 的內容欄左右留白至少 48').toBeGreaterThanOrEqual(48);
      expect(await topbarHeight(page), '1024 topbar 44').toBe(44);
      await shot(page, 'rwd-1024-page');
    }

    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('D-9 768 的內容欄留白 48', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await signIn(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    if (await openFirstPage(page)) {
      const pad = await page.evaluate(() => {
        const el = document.querySelector('.kn-editor-host');
        return el ? getComputedStyle(el).paddingLeft : '';
      });
      expect(pad, '768–1023 內容欄左右 48px').toBe('48px');
      await shot(page, 'rwd-768-page');
    }
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('390×844 手機：topbar 40px、內容 padding 16、抽屜、底部工具列、無水平捲動', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    await shot(page, 'rwd-390-home');

    expect(await topbarHeight(page), '手機 topbar 40px').toBe(40);

    // D-4：非編輯頁的底部固定工具列＝首頁 / 搜尋 / 收件匣
    const bar = page.locator('nav[aria-label="底部工具列"]');
    await expect(bar, 'D-4 手機要有固定底部工具列').toBeVisible();
    const barBox = await bar.boundingBox();
    expect(barBox, '底部工具列貼齊視窗底緣').not.toBeNull();
    expect(Math.round((barBox?.y ?? 0) + (barBox?.height ?? 0))).toBeGreaterThanOrEqual(840);
    for (const name of ['首頁', '搜尋', '收件匣']) {
      await expect(bar.getByRole('button', { name })).toBeVisible();
    }

    expect(await sidebarWidth(page)).toBe(0);
    await page.getByRole('button', { name: '開啟側邊欄' }).first().click();
    await page.waitForTimeout(600);
    const drawer = await sidebarWidth(page);
    expect(drawer, '抽屜幾乎全寬').toBeGreaterThan(280);
    expect(await sidebarIsDocked(page), '手機側邊欄是覆蓋抽屜').toBe(false);
    await shot(page, 'rwd-390-drawer');

    // 點抽屜裡的第一頁 → 抽屜自己收起來
    if (await openFirstPage(page)) {
      expect(await sidebarWidth(page), '選頁之後抽屜要關起來').toBe(0);
      await page.waitForSelector('.kn-editor-host', { timeout: 20_000 });
      await shot(page, 'rwd-390-page');

      const pad = await page.evaluate(() => {
        const el = document.querySelector('.kn-editor-host');
        return el ? getComputedStyle(el).paddingLeft : '';
      });
      expect(pad, '手機內容欄左右 16px').toBe('16px');

      // D-4：編輯頁的底部工具列換成「插入 / 指令 / 留言 / 更多」
      for (const name of ['插入區塊', '指令選單', '留言', '更多']) {
        await expect(bar.getByRole('button', { name })).toBeVisible();
      }

      // 右側面板在手機是覆蓋抽屜（不是佔位欄，也不是不掛載 —— gap-review A-1）
      await bar.getByRole('button', { name: '留言' }).click();
      await page.waitForTimeout(500);
      expect(await rightPanelMode(page), '手機右側面板＝覆蓋抽屜').toBe('drawer');
      await shot(page, 'rwd-390-rightdrawer');
      await page.keyboard.press('Escape');
    }

    expect(await hasHorizontalScroll(page), '手機不能有水平捲動').toBe(false);
  });

  test('D-6 觸控裝置的命中區 ≥ 44px', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await signIn(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);

    const small = await page.evaluate(() => {
      const bad: string[] = [];
      const header = document.querySelector('header[role="banner"]');
      const bar = document.querySelector('nav[aria-label="底部工具列"]');
      for (const root of [header, bar]) {
        if (!root) continue;
        for (const el of root.querySelectorAll('button')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.width < 43.5 || r.height < 43.5) {
            bad.push(`${el.getAttribute('aria-label') ?? el.textContent?.trim()} ${Math.round(r.width)}×${Math.round(r.height)}`);
          }
        }
      }
      return bad;
    });
    expect(small, `D-6：觸控裝置上這些按鈕小於 44px → ${small.join(' / ')}`).toEqual([]);
    await context.close();
  });

  test('D-5 手機的 Menu / Popover 是 bottom sheet', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await signIn(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);

    // 底部工具列的「更多」（編輯頁才有）→ 開一個頁面再點
    await openFirstPage(page);
    await page.waitForTimeout(600);
    const more = page
      .locator('nav[aria-label="底部工具列"]')
      .getByRole('button', { name: '更多' })
      .first();
    await more.click();
    await page.waitForTimeout(500);

    const geom = await page.evaluate(() => {
      const el = document.querySelector('[data-sheet="true"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        width: Math.round(r.width),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
        grip: !!el.querySelector('[data-kn-sheet-grip]'),
        backdrop: !!document.querySelector('[data-kn-sheet-backdrop]'),
      };
    });
    expect(geom, 'D-5：手機的選單要是 bottom sheet').not.toBeNull();
    expect(geom?.left, 'sheet 貼齊左緣').toBe(0);
    expect(geom?.width, 'sheet 滿寬').toBe(390);
    expect(geom?.bottom, 'sheet 貼齊底緣').toBeGreaterThanOrEqual(843);
    expect(geom?.height, 'sheet 高度 60%').toBeGreaterThan(844 * 0.5);
    expect(geom?.height).toBeLessThan(844 * 0.7);
    expect(geom?.grip, 'sheet 要有拖曳把手').toBe(true);
    expect(geom?.backdrop, 'sheet 要有遮罩').toBe(true);
    await shot(page, 'rwd-390-sheet');
    await context.close();
  });

  test('D-12 橫向 844×390：無水平捲動、底部工具列仍在畫面內', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await signIn(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await shot(page, 'rwd-844x390-landscape');
    expect(await hasHorizontalScroll(page), '橫向不能有水平捲動').toBe(false);
    // 844 寬 → 已經是平板斷點，側邊欄是佔位欄、沒有底部工具列
    expect(await page.locator('nav[aria-label="底部工具列"]').count()).toBe(0);
  });

  test('四檔寬度 × light/dark 截圖', async ({ page }) => {
    await signIn(page);
    for (const width of [390, 768, 1024, 1280]) {
      for (const theme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);
        await setTheme(page, theme);
        await shot(page, `rwd-${width}-${theme}-home`);
        expect(
          await hasHorizontalScroll(page),
          `${width} ${theme} 不能有水平捲動`,
        ).toBe(false);

        if (await openFirstPage(page)) {
          await page.waitForTimeout(600);
          await shot(page, `rwd-${width}-${theme}-page`);
          expect(
            await hasHorizontalScroll(page),
            `${width} ${theme} 頁面不能有水平捲動`,
          ).toBe(false);
        }
      }
    }
  });
});
