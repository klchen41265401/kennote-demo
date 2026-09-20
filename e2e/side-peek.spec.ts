/**
 * side peek 補完（`docs/qa/gap-review.md` §B-1 / §B-2 / §B-3 / §B-4 + §C-1 / §C-4 / §C-6）。
 *
 * 量測對象：Notion 桌面版 7.34 zh-TW（`reference/shots/gap-review/notion/_SUMMARY.json`）
 *   · 網址：`?v=<viewId>&p=<pageId>&pm=s`（側邊）／`pm=c`（置中）；完整頁面沒有 p/pm
 *   · 側邊 peek：1440 下寬 720（= 50%），左緣可拖，**推擠**主框架（1170 → 450）
 *   · 頂部工具列 aria-label 由左到右：關閉 / 以完整頁面開啟 / 切換預覽模式 / 上一頁 / 下一頁
 *   · 視圖設定的區塊標題是「頁面打開方式」，三個選項：側邊預覽 / 置中預覽 / 完整頁面
 *   · 表格列 hover 的按鈕文字是「打開」，aria-label 是「以側邊預覽打開」
 *
 * 跑法（本機 vite + 遠端 API）：
 * ```bash
 * cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 npx vite --port 5321 --strictPort
 * cd e2e && BASE_URL=http://127.0.0.1:5321 npx playwright test side-peek.spec.ts
 * ```
 *
 * ⚠️ 線上站是純 HTTP（非 secure origin），`crypto.randomUUID` 在 `page.evaluate` 裡不存在。
 * ⚠️ `POST /api/auth/open` 有 rate limit，每一條最多開 1 個 context。
 */
import { expect, test, type Page } from '@playwright/test';

/* ── 共用（與 gap-review.spec.ts 同一組，刻意複製而不 import） ── */

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

interface Collection {
  id: string;
  pageId: string | null;
  views: Array<{ id: string }>;
}

/** 建一個整頁資料庫 + n 列，回傳 `{collectionId, pageId, rowIds}` */
async function newDatabaseWithRows(
  page: Page,
  title: string,
  titles: string[],
): Promise<{ collectionId: string; pageId: string; rowIds: string[] }> {
  const res = await api<{ collection: Collection }>(page, 'POST', '/api/databases', {
    workspaceId: await wsId(page),
    title,
    inline: false,
    schema: { title: { type: 'title', name: '名稱' } },
  });
  expect(res.status, '建立資料庫').toBe(201);
  const collection = res.data.collection;
  const rowIds: string[] = [];
  for (const t of titles) {
    const row = await api<{ id: string }>(page, 'POST', `/api/databases/${collection.id}/rows`, {
      title: t,
    });
    expect(row.status, '建立列').toBe(201);
    rowIds.push(row.data.id);
  }
  return { collectionId: collection.id, pageId: collection.pageId!, rowIds };
}

/** peek 的根：`<aside aria-label="側邊預覽">`（不是 role=dialog —— 它刻意不是 modal） */
const PEEK = 'aside[aria-label="側邊預覽"]';
const PEEK_CENTER = 'aside[aria-label="置中預覽"]';

/**
 * 表格列 hover 才出現的「打開」鈕（`.openButton` 是 `display:none` + `.row:hover`）。
 * Notion 原文：按鈕寫「打開」，可及名稱是「以<頁面打開方式>打開」。
 * ⚠️ 一定要先 hover 那一列，否則 locator 永遠等不到 visible。
 */
async function clickOpen(page: Page, nth = 0, name = '以側邊預覽打開'): Promise<void> {
  /* ⚠️ `[role="row"]` 也會命中表頭那一列 —— 一定要用 `[data-row-id]` 才是資料列。
     而且 `.openButton` 是 `display:none`，`display:none` 會**整個退出無障礙樹**，
     所以 `getByRole` 在 hover 之前連 attached 都等不到。 */
  const row = page.locator('[data-row-id]').nth(nth);
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.hover();
  const btn = row.getByRole('button', { name });
  await btn.waitFor({ state: 'visible', timeout: 10000 });
  await btn.click();
}

test.describe('side peek', () => {
  test.beforeEach(async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForTimeout(500);
  });

  test('SP-1：點列開 peek → 網址帶 ?p=&pm=s，重整後 peek 還在，上一頁關掉', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const db = await newDatabaseWithRows(page, 'SP-1 URL', ['第一列', '第二列']);
    await page.goto(`/database/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await clickOpen(page);
    await expect(page.locator(PEEK), 'peek 要開出來').toBeVisible({ timeout: 8000 });

    // B-1：peek 是 URL 狀態
    await expect(page, '網址要帶 p 與 pm=s').toHaveURL(
      new RegExp(`[?&]p=${db.rowIds[0]}(&|$)`),
    );
    await expect(page).toHaveURL(/[?&]pm=s(&|$)/);

    // 重整 → peek 還在（這是「元件內 useState」做不到的那一半）
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await expect(page.locator(PEEK), '重整後 peek 要還原').toBeVisible({ timeout: 8000 });

    // 瀏覽器上一頁 → peek 關掉（而不是離開資料庫）
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await expect(page.locator(PEEK), '上一頁要關掉 peek').toBeHidden({ timeout: 8000 });
    expect(page.url(), '上一頁不該離開資料庫').toContain(`/database/${db.pageId}`);
  });

  test('SP-2：1440 下寬約 50%，而且是「推擠」不是「覆蓋」（主頁仍可捲動 / 點擊）', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const db = await newDatabaseWithRows(page, 'SP-2 寬度', ['甲', '乙']);
    await page.goto(`/database/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const shell = page.locator('.kn-shell');
    const before = (await shell.boundingBox())!;

    await clickOpen(page);
    const peek = page.locator(PEEK);
    await expect(peek).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(600);

    const box = (await peek.boundingBox())!;
    const clientW = await page.evaluate(() => document.documentElement.clientWidth);
    // Notion 1440 → 720。給 ±15% 的容差（本機捲軸寬度會吃掉幾個 px）
    expect(box.width, '1440 下 peek 約 50% 視窗寬').toBeGreaterThan(clientW * 0.35);
    expect(box.width, '1440 下 peek 約 50% 視窗寬').toBeLessThan(clientW * 0.65);
    expect(box.x + box.width, 'peek 貼右緣').toBeGreaterThan(clientW - 20);

    // §C-1：推擠 —— shell 的內容區被 padding-right 推窄，主頁沒有被蓋住
    const pad = await page.evaluate(
      () => getComputedStyle(document.querySelector('.kn-shell')!).paddingRight,
    );
    expect(parseFloat(pad), '.kn-shell 要被推窄（padding-right）').toBeGreaterThan(300);
    expect((await shell.boundingBox())!.width, 'shell 外框寬度不變').toBeCloseTo(before.width, 0);

    // 主頁**沒有**被鎖捲動（modal 才會鎖）
    const locked = await page.evaluate(() => {
      const b = getComputedStyle(document.body).overflow;
      const h = getComputedStyle(document.documentElement).overflow;
      return b === 'hidden' || h === 'hidden';
    });
    expect(locked, 'peek 不是 modal：不得鎖住主頁捲動').toBe(false);

    // 背景**沒有** inert（Tab 走得出去）
    const inert = await page.evaluate(
      () => document.querySelectorAll('[inert]').length,
    );
    expect(inert, 'peek 不是 modal：背景不得 inert').toBe(0);

    // 主頁仍然點得到：點第二列的「打開」，peek 換成第二列
    await clickOpen(page, 1);
    await page.waitForTimeout(1200);
    await expect(page).toHaveURL(new RegExp(`[?&]p=${db.rowIds[1]}(&|$)`));
  });

  test('SP-3：上一頁 / 下一頁換列（§C-4）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const db = await newDatabaseWithRows(page, 'SP-3 翻列', ['A 列', 'B 列', 'C 列']);
    await page.goto(`/database/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await clickOpen(page);
    const peek = page.locator(PEEK);
    await expect(peek).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(800);

    const prev = peek.getByRole('button', { name: '上一頁' });
    const next = peek.getByRole('button', { name: '下一頁' });
    await expect(prev, '第一列沒有上一列').toBeDisabled();
    await expect(next, '第一列有下一列').toBeEnabled();

    await next.click();
    await page.waitForTimeout(1200);
    await expect(page, '下一頁 → 第二列').toHaveURL(new RegExp(`[?&]p=${db.rowIds[1]}(&|$)`));

    await peek.getByRole('button', { name: '上一頁' }).click();
    await page.waitForTimeout(1200);
    await expect(page, '上一頁 → 回第一列').toHaveURL(new RegExp(`[?&]p=${db.rowIds[0]}(&|$)`));
  });

  test('SP-4：模式切換（側邊 / 置中 / 完整頁面）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const db = await newDatabaseWithRows(page, 'SP-4 模式', ['模式列']);
    await page.goto(`/database/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await clickOpen(page);
    await expect(page.locator(PEEK)).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(600);

    // 側邊 → 置中
    await page.locator(PEEK).getByRole('button', { name: '切換預覽模式' }).click();
    await page.getByRole('menuitem', { name: /置中預覽/ }).click();
    await page.waitForTimeout(1000);
    await expect(page, 'pm 換成 c').toHaveURL(/[?&]pm=c(&|$)/);
    await expect(page.locator(PEEK_CENTER), '置中面板要出現').toBeVisible({ timeout: 8000 });
    // 置中是覆蓋：不再推擠 shell
    const pad = await page.evaluate(
      () => getComputedStyle(document.querySelector('.kn-shell')!).paddingRight,
    );
    expect(parseFloat(pad) || 0, '置中模式不推擠').toBeLessThan(50);

    // 置中 → 完整頁面（= 導向 /page/:id，網址沒有 p / pm）
    await page.locator(PEEK_CENTER).getByRole('button', { name: '以完整頁面開啟' }).click();
    await page.waitForTimeout(1500);
    await expect(page, '完整頁面 = /page/:id').toHaveURL(new RegExp(`/page/${db.rowIds[0]}`));
    expect(page.url(), '完整頁面沒有 p/pm 參數').not.toMatch(/[?&]pm=/);
  });

  test('SP-5：Escape 關閉 peek 並清掉網址參數', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const db = await newDatabaseWithRows(page, 'SP-5 Escape', ['Esc 列']);
    await page.goto(`/database/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await clickOpen(page);
    await expect(page.locator(PEEK)).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(600);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    await expect(page.locator(PEEK), 'Escape 關閉').toBeHidden({ timeout: 8000 });
    expect(page.url(), '參數要清掉').not.toMatch(/[?&]p=/);
  });

  test('SP-6：390 手機上 peek 滿版', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const db = await newDatabaseWithRows(page, 'SP-6 手機', ['手機列']);
    await page.goto(`/database/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    await clickOpen(page);
    const peek = page.locator(PEEK);
    await expect(peek).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(800);

    const box = (await peek.boundingBox())!;
    const clientW = await page.evaluate(() => document.documentElement.clientWidth);
    expect(Math.abs(box.width - clientW), '手機上 peek 要滿版').toBeLessThanOrEqual(4);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
      '不得出現水平捲動',
    ).toBe(false);
  });

  test('SP-7：視圖設定有「頁面打開方式」三選一，改成完整頁面後點列直接換頁（B-3）', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const db = await newDatabaseWithRows(page, 'SP-7 開啟方式', ['設定列']);
    await page.goto(`/database/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // ⋯ → 版面配置
    await page.getByRole('button', { name: '資料庫設定' }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /版面配置/ }).first().click();
    await page.waitForTimeout(600);

    const group = page.getByRole('radiogroup', { name: '頁面打開方式' });
    await expect(group, '版面配置面板要有「頁面打開方式」').toBeVisible({ timeout: 5000 });
    // 三個選項的原文（採自 Notion 7.34）
    await expect(group.getByRole('radio', { name: /側邊預覽/ })).toBeVisible();
    await expect(group.getByRole('radio', { name: /置中預覽/ })).toBeVisible();
    await expect(group.getByRole('radio', { name: /完整頁面/ })).toBeVisible();

    await group.getByRole('radio', { name: /完整頁面/ }).click();
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // 現在點列應該直接換頁，不開 peek
    await clickOpen(page, 0, '以完整頁面打開');
    await page.waitForTimeout(1500);
    await expect(page, '設定成完整頁面 → 點列直接換頁').toHaveURL(
      new RegExp(`/page/${db.rowIds[0]}`),
    );
    await expect(page.locator(PEEK)).toBeHidden();
  });

  test('SP-8：一般頁面（非資料庫列）也能用 ?p= 開 peek（B-4）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const created = await api<{ id: string }>(page, 'POST', '/api/pages', {
      workspaceId: await wsId(page),
      title: [{ text: 'SP-8 一般頁面 peek' }],
    });
    expect(created.status).toBe(201);
    const target = created.data.id;

    await page.goto(`/?p=${target}&pm=s`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const peek = page.locator(PEEK);
    await expect(peek, '一般頁面也要開得起來').toBeVisible({ timeout: 8000 });
    // 沒有資料庫脈絡 → 翻列鈕停用
    await expect(peek.getByRole('button', { name: '上一頁' })).toBeDisabled();
    await expect(peek.getByRole('button', { name: '下一頁' })).toBeDisabled();
    // peek 沒有麵包屑（這是 peek 的特徵）
    expect(await peek.locator('nav').count(), 'peek 不該有麵包屑').toBe(0);
  });
});
