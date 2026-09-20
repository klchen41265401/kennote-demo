/**
 * 功能 QA 第三輪的回歸測試。
 *
 * 每一條對應 `docs/qa/functional-round3.md` 裡的一個已修 bug 或一項走查結論。
 *
 * ```bash
 * # 本機 vite（VITE_PROXY_TARGET 指到遠端）：
 * BASE_URL=http://127.0.0.1:5301 npx playwright test functional-round3.spec.ts
 * ```
 *
 * ⚠️ BUG-10 的後端那一半（`defaultViewFormat`）要**部署後**才會在遠端生效，
 * 在那之前「預設表格視圖把欄位全開」那一條會紅。測試裡有註記。
 */
import { expect, test, type Page } from '@playwright/test';

const HOST = '.kn-editor-host';

async function signIn(page: Page): Promise<void> {
  // `POST /api/auth/open` 有 write rate limit（第六～八輪的報告都記過）。撞到的時候
  // 會停在 /login，後面每一個斷言都會紅得像產品壞掉。與 functional-round6/7/8 同一套
  // backoff：1.5s × n，最多 5 次；click 的例外吞掉（導頁中 element 會 detach）。
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    if (!page.url().includes('/login')) return;
    const guest = page.getByRole('button', { name: /不輸入|直接進入|訪客/ }).first();
    if (await guest.isVisible().catch(() => false)) {
      await guest.click({ timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(3000);
      if (!page.url().includes('/login')) return;
    }
    await page.waitForTimeout(1500 * (attempt + 1));
  }
}

/**
 * 直接打 API 建資料，比走 UI 穩得多。
 * access token 只活在記憶體裡，所以攔 `window.fetch` 把它抄下來。
 */
async function installTokenSniffer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const orig = window.fetch;
    window.fetch = function patched(...args: Parameters<typeof fetch>) {
      try {
        const h = args[1]?.headers as Record<string, string> | Headers | undefined;
        const auth =
          h instanceof Headers
            ? h.get('authorization')
            : (h?.['authorization'] ?? h?.['Authorization']);
        if (auth?.startsWith('Bearer ')) {
          (window as unknown as { __tok?: string }).__tok = auth.slice(7);
        }
      } catch {
        /* 抄不到就算了，下面的 api() 會自己噴 */
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
      const text = await r.text();
      try {
        return { status: r.status, data: JSON.parse(text).data };
      } catch {
        return { status: r.status, data: text as never };
      }
    },
    [method, path, body ?? null] as const,
  ) as Promise<{ status: number; data: T }>;
}

interface Collection {
  id: string;
  pageId: string;
}
interface Row {
  id: string;
  properties: Record<string, { type: string; [k: string]: unknown }>;
}
interface View {
  id: string;
  format: { properties?: Array<{ property: string; visible?: boolean; width?: number }> };
}

async function newDatabase(
  page: Page,
  title: string,
  schema: Record<string, unknown>,
): Promise<Collection> {
  const ws = (await api<Array<{ id: string }>>(page, 'GET', '/api/workspaces')).data[0];
  expect(ws, '工作區').toBeTruthy();
  const res = await api<{ collection: Collection }>(page, 'POST', '/api/databases', {
    workspaceId: ws!.id,
    title,
    inline: false,
    schema,
  });
  expect(res.status).toBe(201);
  return res.data.collection;
}

async function rowsOf(page: Page, collectionId: string): Promise<Row[]> {
  const res = await api<{ rows: Row[] }>(page, 'GET', `/api/databases/${collectionId}/rows`);
  return res.data.rows;
}

test.describe('功能 QA 第三輪回歸', () => {
  test.beforeEach(async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForTimeout(600);
  });

  /**
   * BUG-9：時程表的長條是 pointer 拖曳 + `onClick={onOpen}`。
   * 拖完瀏覽器照樣補一發 click，於是每拖一次日期就彈出一個列 peek 蓋住畫面。
   */
  test('BUG-9 時程表：拖曳改日期之後不會順便把列 peek 打開', async ({ page }) => {
    const c = await newDatabase(page, '第三輪-時程表', {
      title: { type: 'title', name: '名稱' },
      dt: { type: 'date', name: '日期' },
    });
    const row = (
      await api<Row>(page, 'POST', `/api/databases/${c.id}/rows`, {
        title: '列一',
        properties: { dt: { type: 'date', start: '2026-09-05', end: null, includeTime: false } },
      })
    ).data;
    await api(page, 'POST', `/api/databases/${c.id}/views`, { type: 'timeline', name: '時程表' });

    await page.goto(`/database/${c.pageId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.locator('nav[aria-label="檢視"] [role="tab"]', { hasText: '時程' }).first().click();
    await page.waitForTimeout(3000);

    const bar = page.locator('[class*="_bar_"]').filter({ hasText: '列一' }).first();
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2, { steps: 6 });
    await page.mouse.move(box!.x + box!.width / 2 + 180, box!.y + box!.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(3000);

    // 日期真的改了
    const after = (await rowsOf(page, c.id)).find((r) => r.id === row.id)?.['properties']?.['dt'];
    expect(after, '拖曳後的日期').toBeTruthy();
    expect(after!['start']).not.toBe('2026-09-05');

    // …而且沒有被 peek 蓋住
    // ⚠️ gap-review §C-1：peek 已經不是 `[role="dialog"]` 的 modal 了 ——
    // 只斷言 dialog 數量的話，peek 就算開了這一條也會靜靜地變綠。
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page.locator('aside[aria-label="側邊預覽"]')).toHaveCount(0);
    expect(page.url(), 'peek 是 URL 狀態：不該被拖曳順手開起來').not.toMatch(/[?&]p=/);
  });

  /**
   * BUG-10：新資料庫的預設表格視圖把第 6 個以後的欄位設成 `visible: false`，
   * 表格上沒有任何提示，使用者只會覺得「欄位不見了」。
   * 全開之後 `.grid` 本來就會橫捲，欄位多也找得回來。
   */
  test('BUG-10 表格：欄位超過 5 個時，預設全部看得到而且可以橫捲到最後一欄', async ({ page }) => {
    const c = await newDatabase(page, '第三輪-欄位全開', {
      title: { type: 'title', name: '名稱' },
      num: { type: 'number', name: '數字' },
      url: { type: 'url', name: '網址' },
      eml: { type: 'email', name: '信箱' },
      tel: { type: 'phone', name: '電話' },
      dte: { type: 'date', name: '日期' },
      per: { type: 'person', name: '人員' },
      fil: { type: 'files', name: '檔案' },
    });
    await api(page, 'POST', `/api/databases/${c.id}/rows`, { title: '列一' });

    // ⚠️ 這一段檢查的是**後端** defaultViewFormat，遠端 deploy 之前會紅。
    const detail = await api<{ views: View[] }>(page, 'GET', `/api/databases/${c.id}`);
    const props = detail.data.views[0]?.format.properties ?? [];
    expect(props.length, '預設視圖有列出全部欄位').toBe(8);
    expect(
      props.filter((p) => p.visible === false).map((p) => p.property),
      '預設視圖不應該偷偷隱藏欄位（後端 defaultViewFormat，需部署）',
    ).toEqual([]);

    await page.goto(`/database/${c.pageId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const header = () =>
      page.evaluate(() => {
        const grid = document.querySelector('[role="grid"]');
        const row = grid?.querySelector('[role="row"]');
        return {
          cols: [...(row?.children ?? [])].map((e) => (e as HTMLElement).innerText.replace(/\n/g, '')),
          scrollLeft: grid?.scrollLeft ?? 0,
          scrollWidth: grid?.scrollWidth ?? 0,
          clientWidth: grid?.clientWidth ?? 0,
        };
      });

    const before = await header();
    expect(before.cols.join(','), '八個欄位都在標頭上').toContain('檔案');
    expect(before.scrollWidth, '欄位總寬超過視窗 → 可以橫捲').toBeGreaterThan(before.clientWidth);

    await page.evaluate(() => {
      const grid = document.querySelector('[role="grid"]');
      if (grid) grid.scrollLeft = grid.scrollWidth;
    });
    await page.waitForTimeout(1200);
    const after = await header();
    expect(after.scrollLeft, '真的捲出去了').toBeGreaterThan(0);

    // 橫捲之後最後面的欄位編輯得到
    const fileCol = after.cols.findIndex((h) => h.includes('檔案'));
    expect(fileCol).toBeGreaterThan(0);
    const cell = page.locator(`[data-row="0"][data-col="${fileCol}"]`).first();
    await expect(cell).toBeVisible();
  });

  /** 走查結論：資料庫的列用「以整頁開啟」之後，內容編輯器可用且會存下來 */
  test('資料庫列以整頁開啟後可以加 block，重整後還在', async ({ page }) => {
    const c = await newDatabase(page, '第三輪-列整頁', { title: { type: 'title', name: '名稱' } });
    const row = (await api<Row>(page, 'POST', `/api/databases/${c.id}/rows`, { title: '列一' })).data;

    await page.goto(`/page/${row.id}`, { waitUntil: 'domcontentloaded' });
    const block = page.locator(`${HOST} [data-block-id]`).first();
    // 列頁（`collection_id` 不為空）的 snapshot 是 0 個 block，編輯器會自己補一個段落，
    // 那一筆 `block.insert` 要真的送到伺服器 —— 這一條測的就是它。
    await block.waitFor({ state: 'visible', timeout: 45_000 });
    await block.click();
    await page.waitForTimeout(600);
    await page.keyboard.type('列頁新增的段落');

    /*
     * 重整之前先確認「伺服器真的收到了」。
     * 原本這裡是 `await page.waitForTimeout(3000)` —— 送出是 debounce 300ms + WS 往返，
     * 遠端站台忙的時候（整份 e2e 連續跑）3 秒不一定夠，重整後會看到空白，
     * 錯誤訊息長得跟「掉資料」一模一樣。等條件，不要等時間。
     */
    await expect
      .poll(
        async () => {
          const snap = await api(page, 'GET', `/api/pages/${row.id}/snapshot`);
          return snap.status === 200 ? JSON.stringify(snap.data) : '';
        },
        { timeout: 30_000 },
      )
      .toContain('列頁新增的段落');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator(`${HOST} [data-block-id]`).first().waitFor({ state: 'visible', timeout: 45_000 });
    await expect(page.locator(HOST).first()).toContainText('列頁新增的段落');
  });
});
