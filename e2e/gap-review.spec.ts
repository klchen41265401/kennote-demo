/**
 * 「整體差距盤點」（`docs/qa/gap-review.md`）的 A 類 —— 右側面板打不開。
 *
 * 每一條對應報告 §A 的一個已修 bug：
 *   GR-1  A-1  768–1279（平板）：頂欄的「留言」按得下去但面板不掛載 → 改成覆蓋抽屜
 *   GR-2  A-1  390（手機）：同上，抽屜幾乎滿版
 *   GR-3  A-2  <768：頂欄「留言」鈕被 `.compactHide` 藏起來，而 ⋯ 選單裡沒有留言
 *               → 整支手機沒有任何留言入口；現在 ⋯ 選單補上了
 *   GR-4  A-3  整頁資料庫（`/database/:pageId`）：`AppShell` 的 pageId 只認 `/page/`，
 *               面板開了只寫「選一個頁面才能看留言與版本歷史」
 *   GR-5  回歸：≥1280 仍然是**佔位**欄（會把主內容推窄），不是覆蓋
 *
 * 跑法（本機 vite + 遠端 API；線上站還沒部署這批前端改動）：
 * ```bash
 * cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 npx vite --port 5320 --strictPort
 * cd e2e && BASE_URL=http://127.0.0.1:5320 npx playwright test gap-review.spec.ts
 * ```
 *
 * ⚠️ 線上站是純 HTTP（非 secure origin），`crypto.randomUUID` 在 `page.evaluate` 裡不存在。
 * ⚠️ `POST /api/auth/open` 有 rate limit，每一條最多開 1 個 context。
 */
import { expect, test, type Page } from '@playwright/test';

/* ── 共用（與第十三輪同一組，刻意複製而不 import：讓這支能單獨跑） ── */

async function signIn(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    if (!page.url().includes('/login')) return;
    const guest = page.getByRole('button', { name: /不輸入|直接進入|訪客/ }).first();
    if (await guest.isVisible().catch(() => false)) {
      await guest.click().catch(() => undefined);
      await page.waitForTimeout(3000);
      if (!page.url().includes('/login')) return;
    }
    await page.waitForTimeout(1500 * (attempt + 1));
  }
}

async function installTokenSniffer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const orig = window.fetch;
    window.fetch = function patched(...args: Parameters<typeof fetch>) {
      try {
        const h = args[1]?.headers as Record<string, string> | Headers | undefined;
        const auth =
          h instanceof Headers ? h.get('authorization') : (h?.['authorization'] ?? h?.['Authorization']);
        if (auth?.startsWith('Bearer ')) (window as unknown as { __tok?: string }).__tok = auth.slice(7);
      } catch {
        /* 抄不到就算了 */
      }
      return orig.apply(this, args);
    };
  });
}

async function api<T = unknown>(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ([m, p, b]) => {
      const headers: Record<string, string> = {
        authorization: 'Bearer ' + (window as unknown as { __tok?: string }).__tok,
      };
      if (b !== null) headers['content-type'] = 'application/json';
      const r = await fetch(p as string, {
        method: m as string,
        headers,
        credentials: 'include',
        ...(b !== null ? { body: JSON.stringify(b) } : {}),
      });
      const raw = await r.text();
      try {
        return { status: r.status, data: JSON.parse(raw).data };
      } catch {
        return { status: r.status, data: raw as never };
      }
    },
    [method, path, body ?? null] as const,
  ) as Promise<{ status: number; data: T }>;
}

async function wsId(page: Page): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const r = await api<Array<{ id: string }>>(page, 'GET', '/api/workspaces');
    if (r.data?.[0]) return r.data[0].id;
    await page.waitForTimeout(1000);
  }
  throw new Error('抄不到 token / 沒有工作區');
}

async function newPage(page: Page, title: string): Promise<string> {
  const res = await api<{ id: string }>(page, 'POST', '/api/pages', {
    workspaceId: await wsId(page),
    title: [{ text: title }],
  });
  expect(res.status, '建立頁面').toBe(201);
  return res.data.id;
}

/** `aside[aria-label="側邊面板"]` 是 RightPanel 的根（AppShell.tsx） */
const PANEL = 'aside[aria-label="側邊面板"]';

/**
 * shell 的主欄（`.kn-shell > div` 裡裝著 `<Outlet>` 的那一個）。
 * ⚠️ 不能用 `.nth(1)`：側邊欄在 <1280 根本不掛載（`collapsed = 收合 || narrow`），
 * 主欄的索引會從 1 變成 0。改用「裡面有頂欄 ⋯ 按鈕的那一個」來認。
 */
function mainCol(page: Page) {
  return page
    .locator('.kn-shell > div')
    .filter({ has: page.getByRole('button', { name: '動作' }) })
    .first();
}

test.describe('gap-review A：右側面板', () => {
  test.beforeEach(async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForTimeout(500);
  });

  test('GR-1：1024（平板）頂欄「留言」→ 右側面板真的出現，而且是覆蓋不是推擠', async ({ page }) => {
    const id = await newPage(page, 'GR-1 平板留言');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/page/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const panel = page.locator(PANEL);
    await expect(panel, '一開始是收合的').toBeHidden();

    const main = mainCol(page);
    const mainBefore = (await main.boundingBox())!.width;

    await page.getByRole('button', { name: '留言', exact: true }).first().click();
    await expect(panel, '平板按了留言應該要開').toBeVisible({ timeout: 5000 });

    const box = (await panel.boundingBox())!;
    expect(box.width, '抽屜寬 min(380, 100vw)').toBeGreaterThan(300);
    // 覆蓋式 = 主欄寬度**不變**（桌機的 GR-5 剛好相反，那邊會被推窄）
    expect((await main.boundingBox())!.width, '平板是覆蓋，不推擠主欄').toBe(mainBefore);
    // 貼右緣。容差 20：`position: fixed` 的包含區塊是**視覺視窗**，
    // 在有傳統捲軸的環境會比 `documentElement.clientWidth` 少一個捲軸寬（這台 15px）。
    const clientW = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.x + box.width, '抽屜貼在視窗右緣').toBeGreaterThan(clientW - 20);
    expect(box.x, '抽屜在右半邊').toBeGreaterThan(clientW / 2);
    // 不能因此產生水平捲動
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
      '不得出現水平捲動',
    ).toBe(false);

    // 點遮罩關閉
    await page.mouse.click(60, 400);
    await expect(panel, '點遮罩關閉').toBeHidden({ timeout: 5000 });
  });

  test('GR-2：390（手機）也開得起來，抽屜幾乎滿版', async ({ page }) => {
    const id = await newPage(page, 'GR-2 手機留言');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/page/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await page.getByRole('button', { name: '動作' }).first().click();
    await page.getByRole('menuitem', { name: '留言' }).click();

    const panel = page.locator(PANEL);
    await expect(panel, '手機也要開得起來').toBeVisible({ timeout: 5000 });
    const box = (await panel.boundingBox())!;
    expect(box.width, '手機上幾乎滿版').toBeGreaterThanOrEqual(380);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
      '不得出現水平捲動',
    ).toBe(false);
  });

  test('GR-3：390 的 ⋯ 選單裡有「留言」與「版本歷史」兩個入口', async ({ page }) => {
    const id = await newPage(page, 'GR-3 手機入口');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/page/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // 頂欄的留言鈕在 <768 是被 .compactHide 藏起來的 —— 這是刻意的（UI-SPEC §10）
    // RWD D-4 之後手機底部工具列也有一顆可見的「留言」，所以只斷言「頂欄那一顆」被藏起來
    await expect(page.locator('header').getByRole('button', { name: '留言', exact: true })).toBeHidden();

    await page.getByRole('button', { name: '動作' }).first().click();
    await expect(page.getByRole('menuitem', { name: '留言' })).toHaveCount(1);
    await expect(page.getByRole('menuitem', { name: '版本歷史' })).toHaveCount(1);
  });

  test('GR-4：整頁資料庫上開留言，不會顯示「選一個頁面才能看留言與版本歷史」', async ({ page }) => {
    const res = await api<{ collection: { id: string; pageId: string } }>(page, 'POST', '/api/databases', {
      workspaceId: await wsId(page),
      title: 'GR-4 資料庫',
      inline: false,
      schema: { title: { type: 'title', name: '名稱' } },
    });
    expect(res.status, '建立資料庫').toBe(201);
    // ⚠️ `/database/:pageId` 吃的是**頁面** id，不是 collection id
    //   （決策 6：整頁資料庫走獨立路由，那個 :pageId 是 collection.pageId）。
    const dbPageId = res.data.collection.pageId;

    await page.goto(`/database/${dbPageId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await page.getByRole('button', { name: '留言', exact: true }).first().click();
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible({ timeout: 5000 });
    await expect(
      panel.getByText('選一個頁面才能看留言與版本歷史'),
      'pageId 只認 /page/ 的話這句話就會出現',
    ).toHaveCount(0);
  });

  test('GR-5（回歸）：≥1280 仍然是佔位欄 —— 主內容被推窄，不是被蓋住', async ({ page }) => {
    const id = await newPage(page, 'GR-5 桌機佔位');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/page/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const main = mainCol(page);
    const before = (await main.boundingBox())!.width;

    await page.getByRole('button', { name: '留言', exact: true }).first().click();
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible({ timeout: 5000 });
    const after = (await main.boundingBox())!.width;

    expect(after, '桌機的面板是佔位的：主欄要變窄').toBeLessThan(before - 200);
    const box = (await panel.boundingBox())!;
    expect(box.width, '預設 380（Resizable 300–520）').toBeGreaterThan(300);

    /*
     * ⚠️ 第十五輪（協作面板補完）改了面板結構，這幾條跟著改 —— **那是預期的**：
     * 真實 Notion 7.34 的右側面板是 role=tab 的「更新 / 分析」，
     * 版本紀錄是 ⋯ 選單裡另一個獨立項目，不是同一個面板的 tab
     * （`reference/shots/gap-review/notion/_A3-updates.json`）。
     * kennote 多一個「留言」tab（Notion 這一版把頁面留言做成標題下方的 inline 討論串，
     * 但 kennote 的頂欄 / 側邊欄一直有留言入口）。細節見 `e2e/collab-panel.spec.ts` CP-4。
     */
    await expect(panel.getByRole('tab', { name: '更新' })).toHaveCount(1);
    await expect(panel.getByRole('tab', { name: '分析' })).toHaveCount(1);
    await expect(panel.getByRole('tab', { name: '留言' })).toHaveCount(1);
    await expect(panel.getByRole('tab', { name: '版本歷史' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '版本紀錄' })).toHaveCount(1);
  });
});
