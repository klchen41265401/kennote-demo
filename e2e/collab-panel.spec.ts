/**
 * 協作面板補完（`docs/qa/gap-review.md` §B-5～B-8 / §C-2 / C-3 / C-8、舊帳 O-8 / O-38 / O-39）。
 *
 * 每一條對應報告裡的一個已修項目：
 *   CP-1  B-7  版本預覽顯示的**真的是那個版本**（不是現況），橫幅寫「正在預覽 … 的版本」
 *   CP-2  B-7  預覽期間唯讀且**不送 tx**（攔 POST /api/pages/:id/transactions）
 *   CP-3  B-7  「還原此版本」→ 內容回到舊版、離開預覽、頁面刷新
 *   CP-4  C-2  右側面板的分頁是「更新 / 分析 / 留言」，版本紀錄是**佔滿面板的另一個檢視**
 *   CP-5  B-5  側邊欄的「更新」打開的是 updates feed，**不是**版本紀錄
 *   CP-6  C-3  留言面板有「未解決 / 全部」篩選
 *   CP-7  B-8  面板 ↔ 行內標註雙向：點卡片 → block 亮；點標註 → 卡片變 active
 *   CP-8  C-8  首頁（沒有 pageId）按側邊欄「留言」→ 跨頁的「所有留言」列表
 *
 * 跑法（本機 vite + 遠端 API；**後端有改動，線上站要先部署才會有 /updates**）：
 * ```bash
 * cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 npx vite --port 5323 --strictPort
 * cd e2e && BASE_URL=http://127.0.0.1:5323 npx playwright test collab-panel.spec.ts
 * ```
 *
 * ⚠️ 線上站是純 HTTP（非 secure origin），`crypto.randomUUID` 在 `page.evaluate` 裡不存在。
 * ⚠️ `POST /api/auth/open` 有 rate limit，每一條最多開 1 個 context。
 */
import { expect, test, type Page } from '@playwright/test';

/* ── 共用（與 gap-review.spec.ts 同一組，刻意複製而不 import：讓這支能單獨跑） ── */

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

/** 後端沒有 uuid 產生器時的替身（線上站是純 HTTP，`crypto.randomUUID` 不存在） */
function uuid(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

/** 送一筆 transaction，回傳新的 seq */
async function tx(page: Page, pageId: string, ops: unknown[]): Promise<number> {
  const res = await api<{ seq: number }>(page, 'POST', `/api/pages/${pageId}/transactions`, {
    txId: uuid(),
    pageId,
    originSessionId: `e2e:${uuid()}`,
    ops,
  });
  expect([200, 201], `送 transaction（${JSON.stringify(ops).slice(0, 80)}）`).toContain(res.status);
  return res.data.seq;
}

/**
 * 逼出一個**版本點邊界**。
 *
 * `bucketVersions()` 是「每 20 筆 tx 或跨過一小時切一個版本點」
 * （shared-types `HISTORY_BUCKET_TX = 20`）。只送兩筆 tx 的話整頁只會有
 * **一個**版本點，而它的 seq 就是現況 —— 點下去看到的當然跟現在一樣，
 * 那是測試資料不足，不是產品沒修好。所以這裡補滿 20 筆。
 */
async function padHistory(page: Page, pageId: string, n = 19): Promise<void> {
  for (let i = 0; i < n; i++) {
    const id = uuid();
    await tx(page, pageId, [
      {
        type: 'block.insert',
        blockId: id,
        parentId: null,
        afterId: null,
        blockType: 'paragraph',
        props: {},
        content: [{ text: `墊檔 ${i}` }],
      },
    ]);
    await tx(page, pageId, [{ type: 'block.delete', blockId: id }]);
  }
}

/**
 * 這一輪**有後端改動**（`GET /api/pages/:id/updates`、
 * `GET /api/workspaces/:id/discussions`）。線上站還沒部署之前，
 * 靠它們的兩條會拿到 404 —— 那不是產品壞了，是環境還沒跟上。
 * 用探測 + `test.skip()` 明寫出來，而不是留一條會紅的測試讓下一輪的人猜。
 */
async function requireDeployed(page: Page, path: string): Promise<void> {
  const probe = await api(page, 'GET', path);
  test.skip(
    probe.status === 404,
    `後端尚未部署：${path} 回 404（本輪新增的端點，需部署）`,
  );
  expect(probe.status, path).toBe(200);
}

const PANEL = 'aside[aria-label="側邊面板"]';

test.describe('gap-review 協作面板', () => {
  test.beforeEach(async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForTimeout(500);
  });

  test('CP-1 / CP-2：版本預覽顯示的是那個版本，而且預覽期間不送 tx（B-7）', async ({ page }) => {
    const id = await newPage(page, 'CP-1 版本預覽');
    const blockId = uuid();
    const oldSeq = await tx(page, id, [
      {
        type: 'block.insert',
        blockId,
        parentId: null,
        afterId: null,
        blockType: 'paragraph',
        props: {},
        content: [{ text: '第一版內容' }],
      },
    ]);
    await padHistory(page, id);
    await tx(page, id, [
      { type: 'block.update', blockId, patch: { content: [{ text: '第二版內容（現況）' }] } },
    ]);

    // 預覽期間送出的任何 transaction 都算失敗（唯讀 + syncDisabled）
    const sent: string[] = [];
    await page.route('**/api/pages/*/transactions', async (route) => {
      sent.push(route.request().url());
      await route.continue();
    });

    await page.goto(`/page/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await expect(page.getByText('第二版內容（現況）')).toBeVisible();

    // 面板 → 版本紀錄
    await page.getByRole('button', { name: '更新', exact: true }).first().click();
    await page.waitForTimeout(600);
    await page.locator(PANEL).getByRole('button', { name: '版本紀錄' }).click();
    await page.waitForTimeout(800);

    const versions = page.locator(PANEL).locator('li button');
    await expect(versions.first()).toBeVisible();
    // 版本清單是**新→舊**（`bucketVersions()` 最後 reverse），最舊的那個點下去
    expect(await versions.count(), '要有兩個以上的版本點才測得出差異').toBeGreaterThan(1);
    await versions.last().click();
    await page.waitForTimeout(1500);

    // CP-1：內容真的變成舊版，橫幅寫「正在預覽 … 的版本」
    // ⚠️ 一定要限定在 <article>（編輯器）裡：版本紀錄面板自己也會列出這一版的文字，
    //    不限定的話 strict mode 會同時命中兩個，而且會把「面板顯示對了」誤當成「編輯器顯示對了」。
    const doc = page.getByRole('article');
    await expect(doc.getByText('第一版內容')).toBeVisible();
    await expect(doc.getByText('第二版內容（現況）')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: '正在預覽' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '離開預覽' }).first()).toBeVisible();

    // CP-2：編輯器唯讀 → 不可 contenteditable，而且整段預覽期間沒有送出任何 tx
    const editable = await page
      .locator('.kn-editor [contenteditable="true"]')
      .count();
    expect(editable, '預覽期間不該有可編輯的 block').toBe(0);

    const before = sent.length;
    await page.locator('.kn-editor').first().click({ position: { x: 20, y: 10 } }).catch(() => undefined);
    await page.keyboard.type('不該進得去');
    await page.waitForTimeout(1500);
    expect(sent.length, '預覽期間不該送出 transaction').toBe(before);

    expect(oldSeq).toBeGreaterThan(0);
  });

  test('CP-3：「還原此版本」把內容換回舊版並離開預覽（B-7）', async ({ page }) => {
    const id = await newPage(page, 'CP-3 還原');
    const blockId = uuid();
    await tx(page, id, [
      {
        type: 'block.insert',
        blockId,
        parentId: null,
        afterId: null,
        blockType: 'paragraph',
        props: {},
        content: [{ text: 'CP3 舊版' }],
      },
    ]);
    await padHistory(page, id);
    await tx(page, id, [
      { type: 'block.update', blockId, patch: { content: [{ text: 'CP3 新版' }] } },
    ]);

    await page.goto(`/page/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    await page.getByRole('button', { name: '更新', exact: true }).first().click();
    await page.waitForTimeout(500);
    await page.locator(PANEL).getByRole('button', { name: '版本紀錄' }).click();
    await page.waitForTimeout(800);
    await page.locator(PANEL).locator('li button').last().click();
    await page.waitForTimeout(1500);
    await expect(page.getByRole('article').getByText('CP3 舊版')).toBeVisible();

    await page.getByRole('button', { name: '還原此版本' }).first().click();
    await page.waitForTimeout(2500);

    // 離開預覽（橫幅消失）+ 內容留在舊版
    await expect(page.getByRole('status').filter({ hasText: '正在預覽' })).toHaveCount(0);
    await expect(page.getByRole('article').getByText('CP3 舊版')).toBeVisible();

    const snapshot = await api<{ recordMap: { block: Record<string, { value: { content: Array<{ text: string }> } }> } }>(
      page,
      'GET',
      `/api/pages/${id}/snapshot`,
    );
    const texts = Object.values(snapshot.data.recordMap.block).map((b) =>
      (b.value.content ?? []).map((n) => n.text).join(''),
    );
    expect(texts.join('|'), '伺服器端也回到舊版').toContain('CP3 舊版');
  });

  test('CP-4 / CP-5：面板是「更新 / 分析 / 留言」，版本紀錄是另一個檢視（B-5 / B-6 / C-2）', async ({
    page,
  }) => {
    const id = await newPage(page, 'CP-4 面板結構');
    await page.goto(`/page/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // CP-5：側邊欄的「更新」打開的是 updates feed，不是版本紀錄
    await page.getByRole('button', { name: '更新', exact: true }).first().click();
    await page.waitForTimeout(900);
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();
    await expect(panel.locator('[aria-label="更新"]')).toBeVisible();
    // 版本紀錄只是面板頭列的一顆入口鈕（aria-label），不是第四個 tab
    await expect(panel.getByRole('button', { name: '版本紀錄' })).toHaveCount(1);

    // CP-4：三個 role=tab，預設「更新」
    const tabs = panel.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveText('更新');
    await expect(tabs.nth(1)).toHaveText('分析');
    await expect(tabs.nth(2)).toHaveText('留言');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');

    await tabs.nth(1).click();
    await page.waitForTimeout(600);
    await expect(panel.locator('[aria-label="分析"]')).toBeVisible();

    // 版本紀錄：佔滿面板（沒有 tab 了）
    await panel.getByRole('button', { name: '版本紀錄' }).click();
    await page.waitForTimeout(700);
    await expect(panel.getByRole('tab')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '返回面板' })).toBeVisible();
    await panel.getByRole('button', { name: '返回面板' }).click();
    await page.waitForTimeout(500);
    await expect(panel.getByRole('tab')).toHaveCount(3);
  });

  test('CP-6 / CP-7：未解決 / 全部篩選，以及留言 ↔ 行內標註雙向（C-3 / B-8）', async ({ page }) => {
    const id = await newPage(page, 'CP-6 留言');
    const blockId = uuid();
    const discussionId = uuid();
    await tx(page, id, [
      {
        type: 'block.insert',
        blockId,
        parentId: null,
        afterId: null,
        blockType: 'paragraph',
        props: {},
        content: [{ text: '被標註的段落', marks: [{ t: 'comment', id: discussionId }] }],
      },
    ]);
    const created = await api(page, 'POST', `/api/pages/${id}/discussions`, {
      discussionId,
      blockId,
      anchor: { kind: 'inline', quote: '被標註的段落' },
      body: [{ text: '這一段要改' }],
    });
    expect(created.status, '建立討論串').toBe(201);

    await page.goto(`/page/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    await page.getByRole('button', { name: '更新', exact: true }).first().click();
    await page.waitForTimeout(600);
    const panel = page.locator(PANEL);
    await panel.getByRole('tab', { name: '留言' }).click();
    await page.waitForTimeout(900);

    // CP-6：篩選鈕在，預設「未解決」
    const openFilter = panel.getByRole('button', { name: '未解決', exact: true });
    const allFilter = panel.getByRole('button', { name: '全部', exact: true });
    await expect(openFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByText('這一段要改')).toBeVisible();

    // CP-7 正向：點卡片 → 對應 block 被標成 active
    await panel.locator(`[data-discussion-id="${discussionId}"]`).click();
    await page.waitForTimeout(500);
    await expect(
      page.locator(`[data-block-id="${blockId}"][data-kn-comment-state="active"]`),
    ).toHaveCount(1);

    // CP-7 反向：點編輯器裡的標註 → 卡片變 active（class 帶 threadActive）
    await page.locator(`[data-block-id="${blockId}"] .kn-comment`).first().click();
    await page.waitForTimeout(500);
    const card = panel.locator(`[data-discussion-id="${discussionId}"]`);
    await expect(card).toHaveClass(/threadActive/);

    // 解決 → 未解決篩選看不到、全部看得到，且標註淡化
    /* ⚠️ 第十二輪的教訓：`name: '解決'` 的模糊比對會吃掉篩選鈕「未解決」。一定要 exact。 */
    await panel.getByRole('button', { name: '解決', exact: true }).first().click();
    await page.waitForTimeout(1200);
    await expect(panel.getByText('這一段要改')).toHaveCount(0);
    await allFilter.click();
    await page.waitForTimeout(600);
    await expect(panel.getByText('這一段要改')).toBeVisible();
    await expect(
      page.locator(`[data-block-id="${blockId}"][data-kn-comment-state="resolved"]`),
    ).toHaveCount(1);
  });

  test('CP-8：首頁按側邊欄「留言」→ 跨頁的「所有留言」列表（C-8）', async ({ page }) => {
    const id = await newPage(page, 'CP-8 跨頁留言');
    const created = await api(page, 'POST', `/api/pages/${id}/discussions`, {
      anchor: { kind: 'page' },
      body: [{ text: 'CP8 跨頁留言內容' }],
    });
    expect(created.status).toBe(201);

    await requireDeployed(page, `/api/workspaces/${await wsId(page)}/discussions`);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: '留言', exact: true }).first().click();
    await page.waitForTimeout(1200);

    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();
    // 以前這裡只有一句「選一個頁面才能看留言與版本歷史」
    await expect(panel.getByText('選一個頁面')).toHaveCount(0);
    await expect(panel.locator('[aria-label="所有留言"]')).toBeVisible();
    await expect(panel.getByText('CP8 跨頁留言內容')).toBeVisible();
    await expect(panel.getByText('CP-8 跨頁留言')).toBeVisible();
  });

  test('CP-9：更新 feed 有「查看本次更新後的版本」，按下去進預覽（B-5）', async ({ page }) => {
    const id = await newPage(page, 'CP-9 更新 feed');
    const blockId = uuid();
    await tx(page, id, [
      {
        type: 'block.insert',
        blockId,
        parentId: null,
        afterId: null,
        blockType: 'paragraph',
        props: {},
        content: [{ text: 'CP9 第一版' }],
      },
    ]);
    await tx(page, id, [
      { type: 'block.update', blockId, patch: { content: [{ text: 'CP9 第二版' }] } },
    ]);

    // 後端聚合端點本身
    await requireDeployed(page, `/api/pages/${id}/updates`);
    const updates = await api<{ entries: Array<{ kind: string; summary: string; seq: number | null }> }>(
      page,
      'GET',
      `/api/pages/${id}/updates`,
    );
    expect(updates.data.entries.length).toBeGreaterThan(0);
    expect(updates.data.entries.some((e) => e.kind === 'edit' && /編輯了 \d+ 個區塊/.test(e.summary))).toBe(
      true,
    );

    await page.goto(`/page/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: '更新', exact: true }).first().click();
    await page.waitForTimeout(1200);

    const panel = page.locator(PANEL);
    const seqButtons = panel.getByRole('button', { name: '查看本次更新後的版本' });
    await expect(seqButtons.first()).toBeAttached();
    await seqButtons.last().click();
    await page.waitForTimeout(1500);
    await expect(page.getByRole('status').filter({ hasText: '正在預覽' }).first()).toBeVisible();
  });
});
