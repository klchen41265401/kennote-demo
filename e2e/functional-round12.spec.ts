/**
 * 功能 QA 第十二輪（**O-31 / O-32 的反轉 × hover-only 的一般化 × `/settings`**）。
 *
 * 對應 `docs/qa/functional-round12.md`。
 *
 * 這一輪的主題是：**第十一輪記下的兩個「產品缺陷」，兩個都不是產品缺陷。**
 * O-31（手機開不了列 peek）與 O-32（properties 面板沒有觸發點）
 * 一個死在測試的 locator 上、一個死在 grep 的字串上。
 *
 * ```bash
 * cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 npx vite --port 5313 --strictPort
 * cd e2e && BASE_URL=http://127.0.0.1:5313 npx playwright test functional-round12.spec.ts
 * ```
 *
 * ⚠️ 線上站是**純 HTTP**（非 secure origin），`crypto.randomUUID` 在
 * `page.evaluate` 裡不存在 —— helper 裡一律帶 fallback。
 * ⚠️ `POST /api/auth/open` 有 rate limit，每一條最多開 2 個 context。
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

/* ── 共用（與第十輪同一組；刻意複製而不 import，
      讓每一支 spec 都能單獨跑，不會因為改了別輪的 helper 而連坐） ── */

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
          h instanceof Headers
            ? h.get('authorization')
            : (h?.['authorization'] ?? h?.['Authorization']);
        if (auth?.startsWith('Bearer '))
          (window as unknown as { __tok?: string }).__tok = auth.slice(7);
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
): Promise<{ status: number; data: T; raw: string }> {
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
        return { status: r.status, data: JSON.parse(raw).data, raw };
      } catch {
        return { status: r.status, data: raw as never, raw };
      }
    },
    [method, path, body ?? null] as const,
  ) as Promise<{ status: number; data: T; raw: string }>;
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
  const ws = await wsId(page);
  const res = await api<{ id: string }>(page, 'POST', '/api/pages', {
    workspaceId: ws,
    title: [{ text: title }],
  });
  expect(res.status, '建立頁面').toBe(201);
  return res.data.id;
}

async function insertBlock(
  page: Page,
  pageId: string,
  text: string,
  parentId: string | null = null,
): Promise<string> {
  const blockId = await page.evaluate(() => (globalThis.crypto && 'randomUUID' in globalThis.crypto ? globalThis.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); })));
  const txId = await page.evaluate(() => (globalThis.crypto && 'randomUUID' in globalThis.crypto ? globalThis.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); })));
  const res = await api(page, 'POST', `/api/pages/${pageId}/transactions`, {
    txId,
    pageId,
    ops: [
      {
        type: 'block.insert',
        blockId,
        parentId,
        afterId: null,
        blockType: 'paragraph',
        props: {},
        content: [{ text }],
      },
    ],
  });
  expect(res.status, `寫入 block（${res.raw.slice(0, 160)}）`).toBe(200);
  return blockId;
}

/** `PageSnapshot`（03 §9.1 的 record_map 形狀） */
interface Snapshot {
  rootBlockIds: string[];
  recordMap: {
    block: Record<string, { value: { id: string; content?: Array<{ marks?: Array<{ t: string; id?: string }> }> } }>;
  };
}

async function snapshot(page: Page, pageId: string): Promise<Snapshot> {
  const res = await api<Snapshot>(page, 'GET', `/api/pages/${pageId}/snapshot`);
  expect(res.status, `snapshot ${pageId}`).toBe(200);
  return res.data;
}

async function secondAccount(
  browser: Browser,
  contextOptions: Parameters<Browser['newContext']>[0] = {},
): Promise<{ p2: Page; close: () => Promise<void>; user: { id: string; email: string } }> {
  const ctx = await browser.newContext({
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    ...contextOptions,
  });
  const p2 = await ctx.newPage();
  await installTokenSniffer(p2);
  await signIn(p2);
  const me = await api<{ user: { id: string; email: string } }>(p2, 'GET', '/api/auth/me');
  expect(me.status, '第二個帳號要登得進去').toBe(200);
  return { p2, close: () => ctx.close(), user: me.data.user };
}

async function newDatabase(
  page: Page,
  name: string,
): Promise<{ collectionId: string; pageId: string }> {
  const ws = await wsId(page);
  const res = await api<{ collection: { id: string; pageId: string } }>(
    page,
    'POST',
    '/api/databases',
    { workspaceId: ws, title: [{ text: name }] },
  );
  expect([200, 201], `建立資料庫（${res.raw.slice(0, 200)}）`).toContain(res.status);
  return { collectionId: res.data.collection.id, pageId: res.data.collection.pageId };
}


test.beforeEach(async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
});

const PHONE = { width: 390, height: 844 };
/** 有觸控、螢幕卻不窄：`(hover: none)` 與 `(max-width: 767px)` 的差別就在這裡 */
const TOUCH_TABLET = { width: 1180, height: 820 };

/* ─────────────────────────────────────────────────────────
 * 1. O-31 —— 手機上的列 peek 一直都是好的
 * ───────────────────────────────────────────────────────── */

test('R12-1 手機：「開啟」鈕點下去要開出全螢幕的列 peek（O-31 結案）', async ({ browser }) => {
  test.setTimeout(300_000);
  const b = await secondAccount(browser, { viewport: PHONE, isMobile: true, hasTouch: true });
  try {
    const db = await newDatabase(b.p2, 'R12 手機 peek');
    await api(b.p2, 'POST', `/api/databases/${db.collectionId}/rows`, {
      properties: { title: { type: 'title', richText: [{ text: 'peek 全螢幕' }] } },
    });
    await b.p2.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await b.p2.waitForTimeout(5000);

    /*
     * ⭐ 這一整條的重點只有一行：`exact: true`。
     * 第十一輪寫的是 `name: /開啟|展開/` + `.first()`，而 DOM 第 0 個按鈕是
     * 側邊欄的 `aria-label="開啟側邊欄"` —— 手機上它一定看得見、一定點得到，
     * 點完當然沒有 `[role="dialog"]`。於是「元件沒掛上來」這個結論被寫進
     * 報告、README 與 O-31，連兩輪。
     *
     * **可及名稱只要是別人的前綴，模糊比對就會指錯人。**
     */
    /* gap-review：可及名稱改成 Notion 原文「以側邊預覽打開」（按鈕上寫「打開」）。 */
    const opener = b.p2.getByRole('button', { name: '以側邊預覽打開' }).first();
    await expect(opener, '手機上必須看得見列的「打開」鈕（BUG-53）').toBeVisible();
    await opener.click();
    await b.p2.waitForTimeout(2500);

    /* ⚠️ gap-review §C-1：peek 不再是 modal，改成 `<aside aria-label="側邊預覽">`。 */
    const peek = await b.p2.evaluate(() => {
      const r = [...document.querySelectorAll<HTMLElement>('aside[aria-label="側邊預覽"]')]
        .map((e) => e.getBoundingClientRect())
        .filter((x) => x.width > 0)
        .sort((a, c) => c.width - a.width)[0];
      return r ? { w: r.width, h: r.height, vw: window.innerWidth } : null;
    });
    expect(peek, '列 peek 要真的掛上來').not.toBeNull();
    expect(Math.abs(peek!.w - peek!.vw), '手機上的列 peek 要滿版').toBeLessThanOrEqual(2);
    /*
     * peek 裡面是真的那一列。
     * ⚠️ gap-review：標題不再是 `<input>` —— peek 改用 `features/editor` 的
     * `<PageHeader>`（contenteditable 的 h1），所以改成看文字。
     */
    await expect(b.p2.locator('aside[aria-label="側邊預覽"]')).toContainText('peek 全螢幕');
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * 2. O-32 —— properties 面板一直都有觸發點，只是不叫 open('properties')
 * ───────────────────────────────────────────────────────── */

async function openDbMore(page: Page): Promise<void> {
  /*
   * 本輪之前這顆的 `aria-label` 是「設定」，跟側邊欄底下那顆同名，
   * 只好用 DatabaseHeader 自己的 class 限定範圍（R12-1 陷阱的同一個形狀）。
   * 第十三輪 O-33 把它改名為「資料庫設定」，名稱本身就唯一了。
   */
  await page.locator('[aria-label="資料庫設定"]').first().click();
  await page.waitForTimeout(800);
}

test('R12-2 ⋯ →「編輯屬性」真的開得出屬性面板（O-32 結案）', async ({ page }) => {
  test.setTimeout(240_000);
  const db = await newDatabase(page, 'R12 屬性面板');
  await page.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  await openDbMore(page);
  /*
   * 第十一輪的結論是「全檔案沒有任何一處呼叫 `open('properties', …)`」。
   * 那句話是對的 —— 但入口不長那樣：`ViewSettingsPanel` 走的是
   * `onOpen('properties')` → `setPanel({ kind, anchor })`。
   * **grep 找的是實作的寫法，不是使用者的路徑。**
   */
  await expect(page.getByRole('button', { name: /編輯屬性/ }), '⋯ 裡要有「編輯屬性」').toBeVisible();
  await expect(
    page.getByRole('button', { name: /屬性能見度/ }),
    '⋯ 裡要有「屬性能見度」',
  ).toBeVisible();

  await page.getByRole('button', { name: /編輯屬性/ }).first().click();
  await page.waitForTimeout(1200);

  // 面板真的是 PropertyList：標題 + 新增屬性 + 每一列的顯示／隱藏切換
  await expect(page.getByText('此視圖顯示的屬性').first(), '屬性面板要開出來').toBeVisible();
  await expect(page.getByRole('button', { name: /新增屬性/ }).first()).toBeVisible();
  expect(
    await page.getByRole('button', { name: /^隱藏$|^顯示$/ }).count(),
    '每個屬性都要有顯示／隱藏切換',
  ).toBeGreaterThan(0);
});

test('R12-3 屬性面板的「隱藏」真的會把欄位從表格拿掉（O-32：不是只開得起來）', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const db = await newDatabase(page, 'R12 隱藏屬性');
  await page.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const before = await page.locator('[class*="headerButton"]').count();
  expect(before, '預設要有好幾個欄位標頭').toBeGreaterThan(1);

  await openDbMore(page);
  await page.getByRole('button', { name: /編輯屬性/ }).first().click();
  await page.waitForTimeout(1000);
  /*
   * ⭐ 「面板打得開」與「面板上的動作有作用」是兩條斷言。
   * 第十一輪 §6-3 才剛講過同一件事（拿掉舊的 / 接上新的是兩條），
   * 只驗前者的話，一個渲染得出來但 `onChangeFormat` 沒接的面板會變綠。
   */
  await page.getByRole('button', { name: /^隱藏$/ }).last().click();
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  const after = await page.locator('[class*="headerButton"]').count();
  expect(after, '隱藏一個屬性之後表格要少一欄').toBe(before - 1);
});

test('R12-4 手機：⋯ 與屬性面板都是貼底的 bottom sheet（第十一輪 sheetOnMobile）', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const b = await secondAccount(browser, { viewport: PHONE, isMobile: true, hasTouch: true });
  try {
    const db = await newDatabase(b.p2, 'R12 手機屬性 sheet');
    await b.p2.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await b.p2.waitForTimeout(5000);

    await openDbMore(b.p2);
    await b.p2.getByRole('button', { name: /編輯屬性/ }).first().click();
    await b.p2.waitForTimeout(1200);

    const box = await b.p2.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .pop();
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: r.width, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight };
    });
    expect(box, '屬性面板要開出來').not.toBeNull();
    expect(Math.abs(box!.w - box!.vw), 'sheet 要滿寬').toBeLessThanOrEqual(2);
    expect(Math.abs(box!.bottom - box!.vh), 'sheet 要貼著視窗底部').toBeLessThanOrEqual(2);
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * 3. hover-only 的一般化（第十一輪 §9 第 4 項）
 * ───────────────────────────────────────────────────────── */

test('R12-5 觸控：頁面標題的「新增圖示 / 封面 / 留言」不是 hover-only', async ({ browser }) => {
  test.setTimeout(300_000);
  const b = await secondAccount(browser, { viewport: PHONE, isMobile: true, hasTouch: true });
  try {
    const pageId = await newPage(b.p2, 'R12 標題工具列');
    await b.p2.goto(`/page/${pageId}`, { waitUntil: 'domcontentloaded' });
    await b.p2.waitForTimeout(5000);

    /*
     * ⭐ 量 `opacity` 而不是 `isVisible()`：`opacity: 0` 的元素
     * 在 Playwright 眼中**仍然是 visible**（它有盒模型、沒有 display:none）。
     * 所以「hover-only 的入口在觸控上不存在」這一類缺陷
     * **用 toBeVisible() 一定驗不出來** —— 那正是 BUG-53 躲過前十輪的原因
     * （它是 display:none 才被抓到；opacity:0 的那十幾個沒有人量過）。
     */
    const opacity = await b.p2.evaluate(() => {
      const el = document.querySelector('.kn-page-header-tools');
      return el ? Number(getComputedStyle(el).opacity) : null;
    });
    expect(opacity, '找不到 .kn-page-header-tools').not.toBeNull();
    expect(opacity, '觸控裝置上標題工具列要常駐（hover: none）').toBeGreaterThan(0.9);
  } finally {
    await b.close();
  }
});

test('R12-6 觸控：側邊欄每一列的「⋯ / +」不是 hover-only', async ({ browser }) => {
  test.setTimeout(300_000);
  const b = await secondAccount(browser, { viewport: TOUCH_TABLET, hasTouch: true, isMobile: true });
  try {
    await newPage(b.p2, 'R12 側邊欄列動作');
    await b.p2.goto('/', { waitUntil: 'domcontentloaded' });
    await b.p2.waitForTimeout(5000);
    // 平板寬度下側邊欄可能是收起的，先確保它開著
    const toggle = b.p2.getByRole('button', { name: '開啟側邊欄' }).first();
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await b.p2.waitForTimeout(1500);
    }

    const worst = await b.p2.evaluate(() => {
      const els = [...document.querySelectorAll<HTMLElement>('[class*="rowActions"]')];
      if (els.length === 0) return null;
      return Math.min(...els.map((e) => Number(getComputedStyle(e).opacity)));
    });
    test.skip(worst === null, '這個工作區的側邊欄沒有任何頁面列');
    /*
     * 這一條刻意用 1180×820（iPad 橫置）而不是 390：
     * 第十一輪的手機修正全部寫在 `@media (max-width: 767px)` 裡，
     * 而**會撞到 hover-only 的是「沒有滑鼠」，不是「螢幕很窄」**。
     * 1180 寬的觸控裝置在舊斷點下一個都救不到。
     */
    expect(worst, '觸控裝置上側邊欄的列動作要常駐（hover: none）').toBeGreaterThan(0.9);
  } finally {
    await b.close();
  }
});

test('R12-7 觸控筆電（1180 寬）：表格的「開啟」鈕與列勾選框都看得見', async ({ browser }) => {
  test.setTimeout(300_000);
  const b = await secondAccount(browser, { viewport: TOUCH_TABLET, hasTouch: true, isMobile: true });
  try {
    const db = await newDatabase(b.p2, 'R12 平板表格');
    await api(b.p2, 'POST', `/api/databases/${db.collectionId}/rows`, {
      properties: { title: { type: 'title', richText: [{ text: '平板也要點得到' }] } },
    });
    await b.p2.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await b.p2.waitForTimeout(5000);

    const seen = await b.p2.evaluate(() => {
      const shown = (sel: string): boolean | null => {
        const el = document.querySelector<HTMLElement>(sel);
        return el ? getComputedStyle(el).display !== 'none' : null;
      };
      return { open: shown('[class*="openButton"]'), check: shown('[class*="rowCheckbox"]') };
    });
    expect(seen.open, '1180 寬的觸控裝置上也要有「開啟」鈕（O-31 的一般化）').toBe(true);
    expect(seen.check, '1180 寬的觸控裝置上也要有列勾選框').toBe(true);
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * 4. O-12 —— /settings 這個網址
 * ───────────────────────────────────────────────────────── */

test('R12-8 `/settings` 不再是 404，而且會打開設定（O-12）', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await expect(page.getByText('找不到這個頁面'), '/settings 不該掉到 NotFound').toHaveCount(0);
  await expect(page.getByText('我的帳號').first(), '設定要打開').toBeVisible();
});

test('R12-9 `/settings/members` 深連結直接落在「成員」分頁（O-12）', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/settings/members', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  /*
   * ⭐ 「網址不是 404」與「網址帶我到對的地方」是兩條斷言。
   * 只驗前者的話，一個永遠開在 `account` 分頁的 `/settings/:tab`
   * 也會變綠 —— 而那就等於沒有深連結。
   */
  await expect(
    page.locator('[class*="navItemActive"]').first(),
    '左導覽選中的要是「成員」',
  ).toHaveText(/成員/);
  expect(page.url(), '網址要留在 /settings/members（redirect 回首頁等於沒修）').toContain(
    '/settings/members',
  );
});

test('R12-10 打錯的分頁名回到預設分頁，不是 404（O-12）', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/settings/nope', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await expect(page.getByText('找不到這個頁面')).toHaveCount(0);
  await expect(page.getByText('我的帳號').first()).toBeVisible();
});

test('R12-11 關掉設定之後網址要離開 /settings（O-12：不然重新整理又回來）', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);
  expect(page.url(), '關掉之後不該還停在 /settings').not.toContain('/settings');
});
