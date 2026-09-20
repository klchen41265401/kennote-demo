/**
 * 功能 QA 第十一輪（**殘餘佔位 × 觸控**）。
 *
 * 對應 `docs/qa/functional-round11.md`。主題是「把還在說『M3 / M5 才會開放』的
 * 入口接到後面那個**早就做好的模組**上」，加上第十輪 §7 排在第一項的
 * 「刪掉 `features/database/_fallback/dnd.ts`」。
 *
 * ```bash
 * # 本機 vite（前端 HMR + 遠端 API）；WS 不跟著 proxy（O-28）
 * cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 npx vite --port 5312 --strictPort
 * cd e2e && BASE_URL=http://127.0.0.1:5312 npx playwright test functional-round11.spec.ts
 * ```
 *
 * 分工：
 * - **前端接線**（留言入口、搜尋 chips、dnd 引擎、手機斷點）→ 打本機 vite 就跑得到。
 * - **後端新端點**（`POST /api/pages/:id/blocks/move-to`）→ 線上站還是第十輪的 commit，
 *   所以標 `test.fixme` 並寫明「需部署」。
 *   ⚠️ triage §9 的教訓：解開 `fixme` 的那一輪要**逐行看斷言**，不能只看它變綠。
 *
 * ⚠️ `POST /api/auth/open` 有 rate limit，所以每一條最多只開 2 個瀏覽器 context。
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

/* ─────────────────────────────────────────────────────────
 * 1. 編輯器裡的「留言」入口
 *    —— `CommentPopover` 從 M5 起就在 repo 裡，但**零呼叫端**
 *       （第六輪「前端沒有呼叫端」那個型態的又一例）。
 * ───────────────────────────────────────────────────────── */

test('R11-1 選取文字 → BubbleMenu 的「留言」真的建得出 discussion（不再是 toast）', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const pageId = await newPage(page, 'R11 行內留言');
  await insertBlock(page, pageId, '這一段要被留言');

  await page.goto(`/page/${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const target = page.locator('[data-block-id]').filter({ hasText: '這一段要被留言' }).first();
  await expect(target).toBeVisible();
  // 三連點選整段（BubbleMenu 的出現條件是「選取非空」）
  await target.click({ clickCount: 3 });
  await page.waitForTimeout(800);

  const commentBtn = page.locator('button[title^="留言"]').first();
  await expect(commentBtn, 'BubbleMenu 要有「留言」按鈕').toBeVisible();
  await commentBtn.click();

  const box = page.getByRole('dialog', { name: '新增留言' });
  await expect(box, '按了留言要開草稿框，不是 toast').toBeVisible();

  /*
   * ⚠️ 這一條的重點不是「有沒有跳框」，是**伺服器上真的多了一個 discussion**。
   * 第五～六輪一再出現的形狀是「UI 做出來了、後端也做好了，中間沒接」，
   * 只驗 UI 會讓那個形狀再溜過去一次。
   */
  await box.getByRole('textbox', { name: '留言內容' }).fill('第十一輪的行內留言');
  await box.getByRole('button', { name: '留言' }).click();
  await page.waitForTimeout(2500);

  const res = await api<{ discussions: Array<{ blockId: string | null }> }>(
    page,
    'GET',
    `/api/pages/${pageId}/discussions`,
  );
  expect(res.status).toBe(200);
  expect(res.data.discussions.length, '伺服器上要有一個 discussion').toBeGreaterThan(0);
  expect(
    res.data.discussions.some((d) => d.blockId !== null),
    '行內留言的 discussion 要綁在 block 上（錨點）',
  ).toBe(true);
});

test('R11-2 送出留言後，選取範圍上要留下 comment mark（錨點不是字元位移）', async ({ page }) => {
  test.setTimeout(180_000);
  const pageId = await newPage(page, 'R11 comment mark');
  const blockId = await insertBlock(page, pageId, 'mark 要套在這一段上');

  await page.goto(`/page/${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const target = page.locator(`[data-block-id="${blockId}"]`).first();
  await target.click({ clickCount: 3 });
  await page.waitForTimeout(800);
  await page.locator('button[title^="留言"]').first().click();
  const box = page.getByRole('dialog', { name: '新增留言' });
  await expect(box).toBeVisible();
  await box.getByRole('textbox', { name: '留言內容' }).fill('錨點測試');
  await box.getByRole('button', { name: '留言' }).click();
  await page.waitForTimeout(3000);

  /*
   * `shared-types/comments.ts` 明訂：**行內留言一律用 rich text 上的
   * `{t:'comment',id}` mark**，不用字元位移（位移會在原文被編輯後失效）。
   * 所以這裡查的是伺服器上那一段 content 的 marks，不是畫面上的底線。
   */
  const snap = await snapshot(page, pageId);
  const content = snap.recordMap.block[blockId]?.value.content ?? [];
  const ids = content.flatMap((n) => (n.marks ?? []).filter((m) => m.t === 'comment'));
  expect(ids.length, 'content 上要有 comment mark').toBeGreaterThan(0);
  expect(typeof ids[0]?.id, 'comment mark 要帶 discussionId').toBe('string');
});

test('R11-3 編輯器的 block 選單不得再有「… 才會開放」的佔位項', async ({ page }) => {
  test.setTimeout(180_000);
  const pageId = await newPage(page, 'R11 佔位掃描');
  const blockId = await insertBlock(page, pageId, '掃描用段落');
  await page.goto(`/page/${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // 右鍵開 BlockMenu（gutter 的把手是 mousemove 驅動的，右鍵比較穩）
  const row = page.locator(`[data-block-id="${blockId}"]`).first();
  await row.click();
  await row.click({ button: 'right' });
  await page.waitForTimeout(1000);

  /*
   * ⚠️ 選單的容器沒有固定的 role（編輯器的 `ui/overlay` 用的是自家的 Popover），
   * 所以用「選單項目的文字」定位。**不要用 role 當作選單存在的證據** ——
   * 那會讓「選單沒開」與「role 不一樣」兩件事長得一模一樣。
   */
  await expect(page.getByText('移動到…'), '區塊選單要有「移動到…」').toBeVisible();
  await expect(page.getByText('留言', { exact: true }), '區塊選單要有「留言」').toBeVisible();

  await page.getByText('移動到…').click();
  await page.waitForTimeout(1500);

  /*
   * 佔位 toast 的問題不在「顯示了一句話」，在於它會讓使用者**不再嘗試**那條路
   *（第十輪 BUG-47 講過同一件事：UI 說謊會讓人不去做那件事）。
   */
  expect(
    await page.getByText(/才會開放/).count(),
    '畫面上不該再有「… 才會開放」的佔位字串',
  ).toBe(0);
  await expect(page.getByRole('dialog', { name: '移動到…' })).toBeVisible();
});

/* ─────────────────────────────────────────────────────────
 * 2. 「移動到…」跨頁面搬移 block（**需部署**）
 * ───────────────────────────────────────────────────────── */

test(
  'R11-4 block 跨頁搬移：來源頁刪掉、目標頁出現，**block id 不變**（需部署）',
  async ({ page }) => {
    test.setTimeout(180_000);
    const src = await newPage(page, 'R11 來源頁');
    const dst = await newPage(page, 'R11 目標頁');
    const parent = await insertBlock(page, src, '要搬走的父段落');
    const child = await insertBlock(page, src, '跟著走的子段落', parent);

    const res = await api(page, 'POST', `/api/pages/${src}/blocks/move-to`, {
      blockIds: [parent],
      targetPageId: dst,
    });
    expect(res.status, res.raw.slice(0, 300)).toBe(200);

    const after = await snapshot(page, src);
    expect(after.rootBlockIds, '來源頁的根層不該再有它').not.toContain(parent);
    expect(after.recordMap.block[parent], '來源頁的 record_map 不該再有它').toBeUndefined();

    const target = await snapshot(page, dst);
    expect(target.rootBlockIds, '目標頁的根層要有它').toContain(parent);
    /*
     * ⭐ **id 不變**是這個設計的核心，不是實作細節：
     * 行內留言的 comment mark、`#blockId` 深連結、`files.page_id` 全部認 id。
     * 如果搬家時發新 id，上面三樣會同時斷掉，而且**畫面上完全看不出來**。
     */
    expect(target.recordMap.block[parent]?.value.id).toBe(parent);
    expect(target.recordMap.block[child], '子孫要一起搬（而且 id 也不變）').toBeTruthy();
  },
);

test(
  'R11-5 跨頁搬移：對來源頁沒有 edit 的人搬不動（需部署）',
  async ({ page, browser }) => {
    test.setTimeout(240_000);
    const src = await newPage(page, 'R11 權限來源頁');
    const blockId = await insertBlock(page, src, '別人的內容');

    const b = await secondAccount(browser);
    try {
      // B 在自己的工作區建一頁（他當然有 edit），但對 A 的來源頁什麼都沒有
      const mine = await newPage(b.p2, 'R11 B 自己的頁');
      const res = await api(b.p2, 'POST', `/api/pages/${src}/blocks/move-to`, {
        blockIds: [blockId],
        targetPageId: mine,
      });
      /*
       * 只對「目標頁」有 edit 就能把別人私密頁的內容搬到自己頁面上，
       * 等於一次繞過整套頁面權限。**放寬權限的操作，對「放寬之前」的那一邊也要有權限**
       *（第十輪 §3-1 的 rebind 是同一條紅線）。
       */
      expect([400, 403, 404], res.raw.slice(0, 200)).toContain(res.status);
    } finally {
      await b.close();
    }
  },
);

test('R11-6 跨頁搬移：目標頁就是本頁時一律擋下（需部署）', async ({ page }) => {
  test.setTimeout(180_000);
  const src = await newPage(page, 'R11 同頁檢查');
  const blockId = await insertBlock(page, src, '原地不動');
  const same = await api(page, 'POST', `/api/pages/${src}/blocks/move-to`, {
    blockIds: [blockId],
    targetPageId: src,
  });
  // 同頁搬移有 `block.move`，走這支等於白白多記兩筆 transaction，而且先刪後插會直接把它弄丟
  expect(same.status, same.raw.slice(0, 200)).toBe(400);
});

/* ─────────────────────────────────────────────────────────
 * 3. 搜尋 chips
 * ───────────────────────────────────────────────────────── */

test('R11-7 搜尋的三顆 chip 都不會讓結果整個空掉（「標題」以前會 400）', async ({ page }) => {
  test.setTimeout(240_000);
  const keyword = `chip${Date.now().toString().slice(-6)}`;
  const pageId = await newPage(page, `R11 ${keyword} 標題命中`);
  await insertBlock(page, pageId, `${keyword} 內文也命中`);
  await page.waitForTimeout(1500);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog').first();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: '搜尋' }).fill(keyword);
  await page.waitForTimeout(2500);

  expect(await page.getByRole('option').count(), '不套 chip 時要搜得到').toBeGreaterThan(0);

  /*
   * ⭐ 以前「標題」chip 送的是 `type: 'title'` —— 那是 `search/routes.ts`
   * 的 zod enum（`page | database`）**不認得的值**，後端直接 400，
   * 前端 `.catch(() => setHits([]))` 把它吞掉變成「找不到符合的頁面」。
   * 使用者會以為「這個關鍵字在標題裡沒有」，而事實是**請求根本沒成功**。
   * 會 400 的篩選器比沒有篩選器更糟：它給出一個看起來合理的錯誤答案。
   */
  for (const label of ['僅標題', '我建立的', '最近 7 天']) {
    await dialog.getByRole('button', { name: label }).click();
    await page.waitForTimeout(2500);
    expect(
      await page.getByRole('option').count(),
      `套上「${label}」之後結果整個空了`,
    ).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: label }).click(); // 取消，回到 all
    await page.waitForTimeout(1200);
  }
});

/* ─────────────────────────────────────────────────────────
 * 4. 看板 / 日曆的觸控拖曳（第十輪 §7 的第一項）
 * ───────────────────────────────────────────────────────── */

test('R11-8 資料庫視圖裡不得再有 HTML5 `draggable=true`（兩套引擎只能留一套）', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const db = await newDatabase(page, 'R11 看板引擎');
  await api(page, 'POST', `/api/databases/${db.collectionId}/rows`, {
    properties: { title: { type: 'title', richText: [{ text: 'R11 卡片' }] } },
  });
  await page.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  /*
   * `_fallback/dnd.ts` 的 `useDragHandle()` 回的是 `draggable: true` + `onDragStart`
   * —— 那是 HTML5 Drag & Drop，**行動版瀏覽器不會由 touch 觸發它**。
   * 所以手機上「把卡片換一組」不是難用，是**沒有任何路徑**。
   *
   * 這一條刻意不去驗「拖得動」（那要真的模擬 400ms 長按 + 指標移動，在 CI 上很脆），
   * 而是驗**舊引擎的指紋已經消失**：
   * 指紋還在 = 一定還有一條路走舊引擎；指紋沒了 = 只剩 pointer 那一套。
   */
  const legacy = await page.evaluate(
    () => document.querySelectorAll('[draggable="true"]').length,
  );
  expect(legacy, '還有元素掛著 HTML5 draggable=true（＝舊引擎沒拔乾淨）').toBe(0);
});

test('R11-9 資料庫頁上掛著的是 pointer 引擎（`@kennote/ui` 的拖放層）', async ({ page }) => {
  test.setTimeout(240_000);
  const db = await newDatabase(page, 'R11 引擎確認');
  await page.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  /*
   * R11-8 驗的是「舊引擎的指紋不見了」，這一條驗的是「新引擎真的在」——
   * 兩條要一起看：只驗前者的話，「兩套都拔掉了」也會變綠
   *（那正是「手機上完全沒有路徑」的另一種寫法）。
   *
   * `.kn-drag-layer` 是 `DndProvider` 掛在 OverlayRoot 裡的唯一幽靈層，
   * 它在 = controller 有實例、`registerSource()` 有地方放幽靈。
   */
  await expect(page.locator('.kn-drag-layer')).toHaveCount(1);
  expect(
    await page.evaluate(() => document.querySelectorAll('[draggable]').length),
    '資料庫頁上不該再有任何 draggable 屬性（連 false 都不必寫在 DOM 上）',
  ).toBeLessThanOrEqual(0);
});

/* ─────────────────────────────────────────────────────────
 * 5. 手機版資料庫（第十輪 §4 的 11 / 12、O-13）
 * ───────────────────────────────────────────────────────── */

const PHONE = { width: 390, height: 844 };

test('R11-10 手機：篩選面板是 bottom sheet（貼著視窗底部、滿寬）', async ({ browser }) => {
  test.setTimeout(300_000);
  const b = await secondAccount(browser, { viewport: PHONE, isMobile: true, hasTouch: true });
  try {
    const db = await newDatabase(b.p2, 'R11 手機篩選');
    await b.p2.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await b.p2.waitForTimeout(5000);

    const filterBtn = b.p2.getByRole('button', { name: '篩選' }).first();
    test.skip(!(await filterBtn.isVisible().catch(() => false)), '手機寬度下找不到「篩選」按鈕');
    await filterBtn.click();
    await b.p2.waitForTimeout(1500);

    /*
     * 桌機的 popover 在 390 寬時會**蓋住觸發它的那顆按鈕**，而且定位演算法一旦
     * 撞到視窗下緣就翻到上面去 —— 使用者按下面的按鈕、面板出現在上面。
     * sheet 的形狀是固定的：永遠貼著底部、永遠滿寬、拇指構得到。
     */
    const geo = await b.p2.evaluate(() => {
      const r = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
        .map((e) => e.getBoundingClientRect())
        .filter((x) => x.width > 0)
        .sort((a, c) => c.width - a.width)[0];
      return r
        ? { width: r.width, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight }
        : null;
    });
    expect(geo, '篩選面板要真的開出來').not.toBeNull();
    expect(Math.abs(geo!.width - geo!.vw), 'sheet 要滿寬').toBeLessThanOrEqual(2);
    expect(Math.abs(geo!.bottom - geo!.vh), 'sheet 要貼著視窗底部').toBeLessThanOrEqual(2);
  } finally {
    await b.close();
  }
});

test('R11-11 手機：列 peek 的「開啟」鈕看得見（BUG-53）', async ({ browser }) => {
  test.setTimeout(300_000);
  const b = await secondAccount(browser, { viewport: PHONE, isMobile: true, hasTouch: true });
  try {
    const db = await newDatabase(b.p2, 'R11 手機開啟鈕');
    const row = await api(b.p2, 'POST', `/api/databases/${db.collectionId}/rows`, {
      properties: { title: { type: 'title', richText: [{ text: 'peek 全螢幕' }] } },
    });
    expect([200, 201], row.raw.slice(0, 200)).toContain(row.status);
    await b.p2.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await b.p2.waitForTimeout(5000);

    /*
     * ⭐ BUG-53：`.openButton` 是 `display: none` + `.row:hover` 才 `inline-flex`
     * —— **觸控裝置沒有 hover，那顆按鈕從來沒有出現過**。
     * 第十輪 R10-8 量不到 peek 的寬度，當時記成「找不到開啟鈕」就停住了。
     *
     * **hover-only 的入口在觸控裝置上等於不存在。**
     * 這是整個手機版走查最容易漏掉的一類缺陷：桌機上每一次都看得到，
     * 而手機上它連「難用」都算不上。
     */
    /*
     * ⚠️ 第十二輪修正：這一條原本寫 `name: /開啟|展開/` + `.first()` ——
     * 而**側邊欄的收合鈕 `aria-label="開啟側邊欄"` 排在 DOM 第 0 個**，
     * 手機上它一定看得見，於是這條斷言從頭到尾量的都是那顆按鈕。
     * 它是綠的，但它綠得**與 BUG-53 無關**。
     * 名字用 exact 才指得到表格列上那一顆（它的可及名稱就是「開啟」）。
     */
    const opener = b.p2.getByRole('button', { name: '開啟', exact: true }).first();
    await expect(opener, '手機上列 peek 的開啟鈕必須看得見（BUG-53）').toBeVisible();
  } finally {
    await b.close();
  }
});

test('R11-13 手機：點開啟鈕之後列 peek 要滿版（第十二輪解開）', async ({ browser }) => {
  /*
   * ✅ 第十二輪解開（O-31）。
   *
   * 第十一輪的結論「`RowPeek` 在手機上沒有掛上來」是**錯的**，
   * 而且錯在量測而不是產品：`name: /開啟|展開/` 的 `.first()`
   * 抓到的是側邊欄的 `aria-label="開啟側邊欄"`（DOM 第 0 個按鈕）。
   * 點下去只是把側邊欄拉開，當然不會有 `[role="dialog"]`。
   *
   * 換成 `name: '開啟', exact: true` 之後實測 390×844：
   * `.dialogSide` 量到 390×844，與視窗同寬 —— 第十一輪加的斷點一直都是對的。
   *
   * ⭐ 「元件沒渲染」與「我沒點到那顆按鈕」在 DOM 上長得一模一樣。
   *   下一次要先確認**點到的是哪一個元素**，再去懷疑元件。
   */
  test.setTimeout(300_000);
  const b = await secondAccount(browser, { viewport: PHONE, isMobile: true, hasTouch: true });
  try {
    const db = await newDatabase(b.p2, 'R11 手機 peek');
    await api(b.p2, 'POST', `/api/databases/${db.collectionId}/rows`, {
      properties: { title: { type: 'title', richText: [{ text: 'peek 全螢幕' }] } },
    });
    await b.p2.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await b.p2.waitForTimeout(5000);
    await b.p2.getByRole('button', { name: '開啟', exact: true }).first().click();
    await b.p2.waitForTimeout(3000);

    const width = await b.p2.evaluate(() => {
      const r = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
        .map((e) => e.getBoundingClientRect())
        .filter((x) => x.width > 0)
        .sort((a, c) => c.width - a.width)[0];
      return r ? { w: r.width, vw: window.innerWidth } : null;
    });
    expect(width, '列 peek 要開出來').not.toBeNull();
    expect(Math.abs(width!.w - width!.vw), '手機上的列 peek 要滿版').toBeLessThanOrEqual(2);
  } finally {
    await b.close();
  }
});

test('R11-12 手機：表格首欄橫捲時黏住（O-13，連六輪沒走查）', async ({ browser }) => {
  test.setTimeout(300_000);
  const b = await secondAccount(browser, { viewport: PHONE, isMobile: true, hasTouch: true });
  try {
    const db = await newDatabase(b.p2, 'R11 手機橫捲');
    await api(b.p2, 'POST', `/api/databases/${db.collectionId}/rows`, {
      properties: { title: { type: 'title', richText: [{ text: '黏住的首欄' }] } },
    });
    await b.p2.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await b.p2.waitForTimeout(5000);

    const cell = b.p2.getByText('黏住的首欄').first();
    const before = await cell.boundingBox().catch(() => null);
    test.skip(before === null, '找不到首欄的儲存格');

    /*
     * ⚠️ 只捲**表格自己**那個容器。
     * 第一版把整個文件裡所有可捲元素都捲到底 —— 外層的內容區也被捲走了，
     * 於是 sticky 的首欄當然「動了 406px」。那是量錯，不是產品壞掉。
     * **量 sticky 的時候，要捲的是那個 sticky 的捲動祖先，不是所有東西。**
     */
    await cell.evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      while (node) {
        if (node.scrollWidth > node.clientWidth + 20) {
          node.scrollLeft = node.scrollWidth;
          return;
        }
        node = node.parentElement;
      }
    });
    await b.p2.waitForTimeout(1000);
    const after = await cell.boundingBox().catch(() => null);

    /*
     * 「黏住」的意思是 **橫捲之後 x 幾乎不動**。
     * 如果首欄跟著捲走，手機上捲到第五欄時就完全不知道自己在看哪一列 ——
     * 那才是 O-13 真正的症狀，不是「會不會溢出」。
     */
    expect(after, '橫捲後首欄仍要在畫面上').not.toBeNull();
    expect(
      Math.abs((after!.x ?? 0) - (before!.x ?? 0)),
      '首欄沒有黏住（跟著橫捲走了）',
    ).toBeLessThanOrEqual(4);
  } finally {
    await b.close();
  }
});
