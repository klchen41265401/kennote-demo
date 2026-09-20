/**
 * 功能 QA 第十三輪回歸。
 *
 * 對應 `docs/qa/functional-round13.md`：
 *   R13-1  O-33  資料庫的 ⋯ 不再跟側邊欄的「設定」同名
 *   R13-2  O-17  屬性清單：Alt+↓ 換順序（鍵盤），並有 aria-live 播報
 *   R13-3  O-17  把手是真的 <button>（原本是 aria-hidden 的 <span>，鍵盤摸不到）
 *   R13-4  O-17  視圖有排序條件時，手動拖曳的把手停用
 *   R13-5  O-22  文件尾端點空白處補一段
 *   R13-6  O-20  批次列有「加到收藏」
 *
 * 跑法（本機 vite + 遠端 API；前端改動線上站還沒有）：
 * ```bash
 * cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 npx vite --port 5314 --strictPort
 * cd e2e && BASE_URL=http://127.0.0.1:5314 npx playwright test functional-round13.spec.ts
 * ```
 *
 * ⚠️ 線上站是**純 HTTP**（非 secure origin），`crypto.randomUUID` 在
 * `page.evaluate` 裡不存在 —— helper 裡一律帶 fallback。
 * ⚠️ `POST /api/auth/open` 有 rate limit，每一條最多開 2 個 context。
 * ⚠️ `permission_changed` 的**工作區層**發送端是後端改動、**線上站尚未部署**，
 *    所以那一項由 `apps/server/test/notify-permission-changed.test.ts` 守，不在這裡。
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

/** 建一個有幾列的資料庫並開到它的頁面 */
async function openDatabasePage(
  page: Page,
  name: string,
): Promise<{ collectionId: string; pageId: string }> {
  const db = await newDatabase(page, name);
  for (const t of ['甲', '乙', '丙']) {
    await api(page, 'POST', `/api/databases/${db.collectionId}/rows`, {
      properties: { title: { type: 'title', richText: [{ text: t }] } },
    });
  }
  await page.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  return db;
}

/** ⋯ →「編輯屬性」（O-32：入口走 ViewSettingsPanel 的 onOpen('properties')） */
async function openPropertyPanel(page: Page): Promise<void> {
  await page.locator('button[aria-label="資料庫設定"]').first().click();
  await page.waitForTimeout(900);
  await page.locator('text="編輯屬性"').last().click();
  await page.waitForTimeout(900);
}

/* ─────────────────────────────────────────────────────────
 * 1. O-33 —— 一頁兩顆同名按鈕
 * ───────────────────────────────────────────────────────── */

test('R13-1 資料庫的 ⋯ 叫「資料庫設定」，不再與側邊欄的「設定」撞名（O-33）', async ({ page }) => {
  test.setTimeout(240_000);
  await openDatabasePage(page, 'R13 O-33 ' + Date.now());

  const dbMore = page.locator('button[aria-label="資料庫設定"]');
  await expect(dbMore.first()).toBeVisible();

  /*
   * ⭐ 這一條的重點不是「新名字在」，而是**舊名字不再有兩個主人**。
   * 第十二輪的 `openDbMore()` 只好用 class 限定範圍，就是因為
   * `getByRole('button', { name: '設定' })` 在這一頁上有兩個答案 ——
   * 螢幕閱讀器面對的是同一個問題，而它沒有 class 可以用。
   */
  const sameName = await page.getByRole('button', { name: '設定', exact: true }).count();
  expect(sameName, '「設定」這個可及名稱在同一頁上只能有一個主人').toBeLessThanOrEqual(1);

  // 而且新名字真的打得開面板（改名不能只是改字串）
  await dbMore.first().click();
  await page.waitForTimeout(1000);
  await expect(page.locator('text="編輯屬性"').last()).toBeVisible();
});

/* ─────────────────────────────────────────────────────────
 * 2. O-17 —— 拖曳排序的鍵盤替代路徑
 * ───────────────────────────────────────────────────────── */

test('R13-2 屬性清單：Alt+↓ 換順序，並由 aria-live 播報新位置（O-17）', async ({ page }) => {
  test.setTimeout(240_000);
  await openDatabasePage(page, 'R13 O-17 鍵盤 ' + Date.now());
  await openPropertyPanel(page);

  const handles = page.locator('[class*="propertyRow"] button[aria-label^="移動"]');
  await expect(handles.first(), '每一列都要有一顆可聚焦的把手').toBeVisible();
  expect(await handles.count(), '至少要有兩列才換得了順序').toBeGreaterThanOrEqual(2);

  const names = page.locator('[class*="propertyRow"] [class*="propertyName"]');
  const nameOf = async (i: number): Promise<string> => (await names.nth(i).innerText()).trim();
  const moved = await nameOf(1);
  const below = await nameOf(2);

  // 第 2 列往下搬一格（title 不能動，所以刻意不挑首列）
  await handles.nth(1).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForTimeout(1500);

  expect(await nameOf(1), `「${below}」要往上遞補`).toBe(below);
  expect(await nameOf(2), `「${moved}」要換到第 3 列`).toBe(moved);

  /*
   * ⭐ 拖曳的回饋是**視覺**的（落點線、半透明的列）。鍵盤移動完畫面一樣會動，
   * 但螢幕閱讀器讀不到「它現在在第幾個」—— 所以每一次移動都要出聲。
   * 這一條量的是 live region 真的被寫進去了，不是「有一個空的 live region」。
   */
  /*
   * ⚠️ 頁面上**不只一個** live region（側邊欄也有一個，而且在 DOM 前面）。
   * 第一版寫 `.first()` 量到的是側邊欄那個空的 —— 第十二輪 BUG-57
   * 「`.first()` 指錯人」的同一個形狀，這次踩在自己新加的元素上。
   */
  const live = (await page.locator('[data-kn-reorder-live]').allTextContents()).join(' | ');
  expect(live, 'aria-live 要報出新位置').toContain('已移到');
});

test('R13-3 把手是真的 <button>：聚焦得到、有可及名稱（O-17）', async ({ page }) => {
  test.setTimeout(240_000);
  await openDatabasePage(page, 'R13 O-17 把手 ' + Date.now());
  await openPropertyPanel(page);

  /*
   * 原本是 `<span aria-hidden="true">` —— 對輔助技術等於不存在。
   * 這一條刻意量 tagName / tabIndex 而不是 `toBeVisible()`：
   * 第十二輪的教訓是「看得見」回答不了「摸得到嗎」。
   */
  const probe = await page.evaluate(() => {
    const el = document.querySelector('[class*="propertyRow"] [class*="dragHandle"]');
    if (!el) return null;
    return {
      tag: el.tagName,
      hidden: el.getAttribute('aria-hidden'),
      tabIndex: (el as HTMLElement).tabIndex,
      label: el.getAttribute('aria-label') ?? '',
    };
  });
  expect(probe, '找得到把手').not.toBeNull();
  expect(probe!.tag).toBe('BUTTON');
  expect(probe!.hidden, '不能再是 aria-hidden').not.toBe('true');
  expect(probe!.tabIndex, '要聚焦得到').toBe(0);
  expect(probe!.label, '可及名稱要講得出怎麼用').toContain('Alt');
});

test('R13-4 視圖有排序條件時，手動拖曳的把手停用（O-17 後半）', async ({ page }) => {
  test.setTimeout(240_000);
  const db = await openDatabasePage(page, 'R13 O-17 sort ' + Date.now());

  const readHandle = async (): Promise<{ draggable: boolean; disabled: boolean } | null> => {
    await page.locator('[role="row"]').nth(1).hover().catch(() => undefined);
    await page.waitForTimeout(800);
    return page.evaluate(() => {
      const el = document.querySelector('[data-row-handle]');
      return el
        ? {
            draggable: (el as HTMLElement).draggable,
            disabled: el.hasAttribute('data-reorder-disabled'),
          }
        : null;
    });
  };

  // 沒有排序時本來是可拖的 —— 沒有這一段，下面兩條在「把手從來就不能拖」時也會綠
  const before = await readHandle();
  expect(before, '沒有排序時就要看得到把手').not.toBeNull();
  expect(before!.disabled, '沒有排序時不該是停用的').toBe(false);

  const detail = await api<{ views?: Array<{ id: string }>; collection?: { views?: Array<{ id: string }> } }>(
    page,
    'GET',
    `/api/databases/${db.collectionId}`,
  );
  const viewId = (detail.data?.views ?? detail.data?.collection?.views ?? [])[0]?.id;
  expect(viewId, `資料庫要有預設視圖（${detail.raw.slice(0, 200)}）`).toBeTruthy();
  const patched = await api(page, 'PATCH', `/api/databases/${db.collectionId}/views/${viewId}`, {
    query: { sort: [{ property: 'title', direction: 'ascending' }] },
  });
  expect([200, 204], `加排序（${patched.raw.slice(0, 200)}）`).toContain(patched.status);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const after = await readHandle();
  expect(after, '把手還是要畫出來（停用不是消失，使用者要看得到原因）').not.toBeNull();
  expect(after!.draggable, '有排序條件時不能再拖').toBe(false);
  expect(after!.disabled, '要標記成停用（title 說明原因）').toBe(true);
});

/* ─────────────────────────────────────────────────────────
 * 3. O-22 —— 文件尾端的落點
 * ───────────────────────────────────────────────────────── */

test('R13-5 文件尾端點空白處會補一段，且不會重複補（O-22）', async ({ page }) => {
  test.setTimeout(240_000);
  const pid = await newPage(page, 'R13 O-22 ' + Date.now());
  await insertBlock(page, pid, '最後一段');
  await page.goto(`/page/${pid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);

  const zone = page.getByTestId('editor-trailing');
  await expect(zone, '文件尾端要有一塊可以點的落點').toBeVisible();

  const countBlocks = async (): Promise<number> =>
    page.locator('.kn-editor-host [data-block-id]').count();

  /*
   * ⭐ 先驗**不補**的那一半。頁面建立時後端會種一個空段落（第九輪），
   * 所以這時候最後一段已經是空的 —— 點下去只該把游標放過去。
   * 不然每點一次就長一個空段落，重整之後看得到一串（第一輪「重複寫入」的形狀）。
   * 第一版的 R13-5 就是沒想到這件事，把「正確地沒有補」讀成「功能壞掉」。
   */
  const seeded = await countBlocks();
  await zone.click();
  await page.waitForTimeout(1800);
  expect(await countBlocks(), '最後一段已經是空的 → 不該再補').toBe(seeded);

  // 把那一段填滿，文件尾端就不再有落點了
  await page.keyboard.type('尾端');
  await page.waitForTimeout(1200);

  await zone.click();
  await page.waitForTimeout(1800);
  const appended = await countBlocks();
  expect(appended, '最後一段有內容 → 點空白處要補一段').toBe(seeded + 1);

  // 補完之後最後一段又是空的，再點一次不該再補
  await zone.click();
  await page.waitForTimeout(1800);
  expect(await countBlocks(), '第二下不該再補一段').toBe(appended);
});

/* ─────────────────────────────────────────────────────────
 * 4. O-20 —— 批次操作
 * ───────────────────────────────────────────────────────── */

test('R13-6 批次列有「加到收藏」，按下去真的進收藏（O-20 部分）', async ({ page }) => {
  test.setTimeout(240_000);
  await openDatabasePage(page, 'R13 O-20 ' + Date.now());

  const row = page.locator('[role="row"]').nth(1);
  await row.hover();
  await page.waitForTimeout(700);
  const check = row.locator('input[type="checkbox"]').first();
  await expect(check, '列上要有勾選框（第十二輪把它放進 (hover: none)）').toBeVisible();
  await check.check({ force: true });
  await page.waitForTimeout(900);

  const bar = page.getByRole('toolbar', { name: '批次操作' });
  await expect(bar).toBeVisible();
  const fav = bar.getByRole('button', { name: '加到收藏' });
  await expect(fav, '批次列要有「加到收藏」').toBeVisible();

  const ws = await wsId(page);
  const len = (r: { data: unknown }): number => (Array.isArray(r.data) ? r.data.length : 0);
  const before = await api(page, 'GET', `/api/pages/favorites?workspaceId=${ws}`);
  await fav.click();
  await page.waitForTimeout(3000);
  const after = await api(page, 'GET', `/api/pages/favorites?workspaceId=${ws}`);
  // 收藏端點的形狀各輪不同，這裡只要求「數量有變多」——量的是動作有作用，不是回應長怎樣
  expect(len(after), '按下去要真的多一筆收藏').toBeGreaterThan(len(before));
});
