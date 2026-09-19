/**
 * 功能 QA 第七輪的回歸測試（讀取權限下推 / 側邊欄與垃圾桶洩漏 / block 提及通知）。
 *
 * 每一條對應 `docs/qa/functional-round7.md` 裡的一個已修 bug 或一項走查結論。
 *
 * ```bash
 * # 本機 vite（VITE_PROXY_TARGET 指到遠端）：
 * BASE_URL=http://127.0.0.1:5308 npx playwright test functional-round7.spec.ts
 * ```
 *
 * ⚠️ 標成 `test.fixme` 的全部是**後端**修正（BUG-35 / BUG-36 / BUG-37 / BUG-38 /
 * BUG-39），遠端跑的還是第六輪的 server。**deploy 之後把 `test.fixme` 改回 `test`
 * 就會綠**（作法與第五輪 BUG-27、第六輪 BUG-29 相同）。
 * 這些條目現在跑的話會**紅**，而且紅得很有價值 —— 斷言寫的是修好之後的行為。
 *
 * ⚠️ `POST /api/auth/open` 有 rate limit，所以每一條最多只開 2 個瀏覽器 context。
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const HOST = '.kn-editor-host';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  if (!page.url().includes('/login')) return;
  const guest = page.getByRole('button', { name: /不輸入|直接進入|訪客/ }).first();
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.waitForTimeout(3000);
  }
}

/** access token 只活在記憶體裡，所以攔 `window.fetch` 把它抄下來。 */
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
      // 注意：fastify 對「有 content-type 卻沒有 body」會回 400，不能無條件帶
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

async function wsId(page: Page): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const r = await api<Array<{ id: string }>>(page, 'GET', '/api/workspaces');
    if (r.data?.[0]) return r.data[0].id;
    await page.waitForTimeout(1000);
  }
  throw new Error('抄不到 token / 沒有工作區');
}

async function newPage(page: Page, title: string, parentId?: string): Promise<string> {
  const ws = await wsId(page);
  const res = await api<{ id: string }>(page, 'POST', '/api/pages', {
    workspaceId: ws,
    title: [{ text: title }],
    ...(parentId ? { parentId } : {}),
  });
  expect(res.status).toBe(201);
  return res.data.id;
}

interface Snapshot {
  pageId: string;
  seq: number;
  rootBlockIds: string[];
}

async function snapshot(page: Page, pageId: string): Promise<Snapshot> {
  const res = await api<Snapshot>(page, 'GET', `/api/pages/${pageId}/snapshot`);
  expect(res.status).toBe(200);
  return res.data;
}

/** 丟一個 transaction（envelope 照 blocks/validate-ops.ts 的 transactionSchema） */
async function tx(
  page: Page,
  pageId: string,
  ops: unknown[],
): Promise<{ status: number; data: { seq?: number } }> {
  return api(page, 'POST', `/api/pages/${pageId}/transactions`, {
    txId: crypto.randomUUID(),
    pageId,
    originSessionId: crypto.randomUUID(),
    ops,
  });
}

/** 把一個 block 的整段內容換掉（LWW 通道，不必認識 OT） */
const setContent = (blockId: string, content: unknown[]) => [
  { type: 'block.update', blockId, patch: { content } },
];

/** 開第二個帳號（自己的工作區、role owner） */
async function secondAccount(
  browser: Browser,
): Promise<{ p2: Page; close: () => Promise<void>; user: { id: string; email: string; name: string } }> {
  const ctx = await browser.newContext({ locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  const p2 = await ctx.newPage();
  await installTokenSniffer(p2);
  await signIn(p2);
  const me = await api<{ user: { id: string; email: string; name: string } }>(p2, 'GET', '/api/auth/me');
  expect(me.status, '第二個帳號要登得進去').toBe(200);
  return { p2, close: () => ctx.close(), user: me.data.user };
}

/** A 把 B 邀成 guest（baseline = none，什麼頁面都不給） */
async function inviteGuest(owner: Page, email: string): Promise<void> {
  const ws = await wsId(owner);
  const res = await api(owner, 'POST', `/api/workspaces/${ws}/invites`, { email, role: 'guest' });
  expect(res.status, '邀請 guest').toBe(201);
}

test.beforeEach(async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
});

/* ─────────────────────────────────────────────────────────
 * BUG-35：整份頁面內容對 baseline `none` 的 guest 是敞開的
 * ───────────────────────────────────────────────────────── */

test('BUG-35 guest 讀不到未被授權的頁面（/pages/:id 與 /snapshot 都要 404）', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const secret = await newPage(page, '絕密：薪資表');
  const snap = await snapshot(page, secret);
  const written = await tx(page, secret, setContent(snap.rootBlockIds[0]!, [{ text: 'CEO 年薪 1234 萬' }]));
  expect(written.status).toBe(200);

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    const meta = await api(b.p2, 'GET', `/api/pages/${secret}`);
    expect(meta.status, 'guest 對沒被授權的頁面應該是 404').toBe(404);

    const snapshotRes = await api(b.p2, 'GET', `/api/pages/${secret}/snapshot`);
    expect(snapshotRes.status, 'snapshot 也要 404').toBe(404);
    expect(JSON.stringify(snapshotRes.data), '內容一個字都不能外流').not.toContain('1234');
  } finally {
    await b.close();
  }
});

test('BUG-36 guest 不能 duplicate 沒有 edit 權限的頁面', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const secret = await newPage(page, '絕密：併購計畫');
  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    const dup = await api(b.p2, 'POST', `/api/pages/${secret}/duplicate`, {});
    expect([403, 404], 'guest 複製別人的頁面應該被擋（原本回 201）').toContain(dup.status);
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * BUG-37：側邊欄頁面樹 / 垃圾桶 / 最近 / 收藏洩漏標題
 * ───────────────────────────────────────────────────────── */

test('BUG-37 側邊欄頁面樹只列出被授權的子樹', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const secret = await newPage(page, '絕密：薪資表');
  await newPage(page, '絕密的子頁', secret);
  const shared = await newPage(page, '可以給你看的頁');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    const grant = await api(page, 'POST', `/api/pages/${shared}/permissions`, {
      subjectType: 'user',
      subjectId: b.user.id,
      permission: 'read',
    });
    expect(grant.status).toBe(200);

    const ws = await wsId(page);
    const tree = await api<Array<{ id: string; title: string; parentId: string | null }>>(
      b.p2,
      'GET',
      `/api/workspaces/${ws}/tree`,
    );
    expect(tree.status).toBe(200);
    const titles = tree.data.map((n) => n.title);
    expect(titles, '被授權的那一頁看得到').toContain('可以給你看的頁');
    expect(titles.join('|'), '沒被授權的標題一個都不能出現').not.toContain('絕密');
  } finally {
    await b.close();
  }
});

test('BUG-37 垃圾桶 / 最近 / 收藏都不會洩漏別人的標題', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const secret = await newPage(page, '絕密：資遣名單');
  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    const ws = await wsId(page);

    // 收藏：連「加進收藏」這個動作本身都該被擋（沒有 read 權限）
    const fav = await api(b.p2, 'POST', `/api/pages/${secret}/favorite`, {});
    expect([403, 404], 'guest 不該能收藏沒權限的頁面').toContain(fav.status);
    const favList = await api<Array<{ title: string }>>(
      b.p2,
      'GET',
      `/api/pages/favorites?workspaceId=${ws}`,
    );
    expect(JSON.stringify(favList.data)).not.toContain('絕密');

    // 最近瀏覽
    const visit = await api(b.p2, 'POST', `/api/pages/${secret}/visit`, {});
    expect([403, 404], 'guest 不該能記錄未授權頁面的瀏覽').toContain(visit.status);
    const recent = await api<Array<{ title: string }>>(b.p2, 'GET', `/api/recent?workspaceId=${ws}`);
    expect(JSON.stringify(recent.data)).not.toContain('絕密');

    // 垃圾桶
    const del = await api(page, 'DELETE', `/api/pages/${secret}`);
    expect(del.status).toBe(200);
    const trash = await api<Array<{ title: string }>>(b.p2, 'GET', `/api/trash?workspaceId=${ws}`);
    expect(trash.status).toBe(200);
    expect(JSON.stringify(trash.data), 'guest 不該看得到別人刪掉的標題').not.toContain('絕密');
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * BUG-38 / BUG-39：block 內的 @提及 與「分享給你」通知
 * ───────────────────────────────────────────────────────── */

test('BUG-38 頁面 block 裡的 @提及 會產生 mention 通知（且只通知新增的）', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const pageId = await newPage(page, '提及測試');
  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    // 被提及的人要看得到這一頁，否則（刻意）不通知
    await api(page, 'POST', `/api/pages/${pageId}/permissions`, {
      subjectType: 'user',
      subjectId: b.user.id,
      permission: 'read',
    });

    const snap = await snapshot(page, pageId);
    const blockId = snap.rootBlockIds[0]!;
    const mention = [
      { text: '請 ' },
      { atom: 'mention', data: { userId: b.user.id, label: b.user.name } },
      { text: ' 看一下' },
    ];
    expect((await tx(page, pageId, setContent(blockId, mention))).status).toBe(200);
    await page.waitForTimeout(2000);

    const inbox = await api<{ unread: number; notifications: Array<{ type: string; pageId: string }> }>(
      b.p2,
      'GET',
      '/api/notifications',
    );
    const mentions = inbox.data.notifications.filter((n) => n.type === 'mention' && n.pageId === pageId);
    expect(mentions.length, 'block 裡的提及要產生通知').toBe(1);

    // 再打一次字（提及沒有變）→ 不該再來一則
    expect(
      (await tx(page, pageId, setContent(blockId, [...mention, { text: '，謝謝' }]))).status,
    ).toBe(200);
    await page.waitForTimeout(2000);
    const again = await api<{ notifications: Array<{ type: string; pageId: string }> }>(
      b.p2,
      'GET',
      '/api/notifications',
    );
    expect(
      again.data.notifications.filter((n) => n.type === 'mention' && n.pageId === pageId).length,
      '同一個提及不能每打一個字就再通知一次',
    ).toBe(1);
  } finally {
    await b.close();
  }
});

test('BUG-39 頁面被分享給你 → page_shared 通知', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const pageId = await newPage(page, '分享通知測試');
  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    const grant = await api(page, 'POST', `/api/pages/${pageId}/permissions`, {
      subjectType: 'user',
      subjectId: b.user.id,
      permission: 'comment',
    });
    expect(grant.status).toBe(200);
    await page.waitForTimeout(2000);

    const inbox = await api<{ notifications: Array<{ type: string; pageId: string }> }>(
      b.p2,
      'GET',
      '/api/notifications',
    );
    expect(
      inbox.data.notifications.some((n) => n.type === 'page_shared' && n.pageId === pageId),
      '7 種通知型別裡的 page_shared 要真的發得出來',
    ).toBe(true);
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * §5 走查：以下在**現行**（第六輪）server 上就該是綠的
 * ───────────────────────────────────────────────────────── */

test('清空垃圾桶：別人的頁面被跳過，自己的被刪掉', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const mine = await newPage(page, '我的草稿');
  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    const ws = await wsId(page);
    expect((await api(page, 'DELETE', `/api/pages/${mine}`)).status).toBe(200);

    const guestEmpty = await api<{ deleted: number; skipped: number }>(
      b.p2,
      'DELETE',
      `/api/trash?workspaceId=${ws}`,
    );
    expect(guestEmpty.status).toBe(200);
    expect(guestEmpty.data.deleted, 'guest 不能刪掉不是他的頁面').toBe(0);
    expect(guestEmpty.data.skipped).toBeGreaterThan(0);

    const ownerEmpty = await api<{ deleted: number; skipped: number }>(
      page,
      'DELETE',
      `/api/trash?workspaceId=${ws}`,
    );
    expect(ownerEmpty.data.deleted, '擁有者清得掉').toBeGreaterThan(0);
    const trash = await api<unknown[]>(page, 'GET', `/api/trash?workspaceId=${ws}`);
    expect(trash.data.length).toBe(0);
  } finally {
    await b.close();
  }
});

test('版本歷史：還原本身會成為一個新版本（append-only）', async ({ page }) => {
  const pageId = await newPage(page, '版本測試');
  const snap = await snapshot(page, pageId);
  const blockId = snap.rootBlockIds[0]!;

  for (const t of ['第一版', '第二版']) {
    expect((await tx(page, pageId, setContent(blockId, [{ text: t }]))).status).toBe(200);
    // bucketVersions() 會把短時間內同一個人的 tx 併成同一個版本
    await page.waitForTimeout(1200);
  }

  const before = await api<{ currentSeq: number; versions: Array<{ seq: number }> }>(
    page,
    'GET',
    `/api/pages/${pageId}/history`,
  );
  expect(before.status).toBe(200);
  const target = before.data.versions.at(-1)!.seq;

  const restored = await api<{ restoredFromSeq: number; newSeq: number }>(
    page,
    'POST',
    `/api/pages/${pageId}/history/${target}/restore`,
    {},
  );
  expect(restored.status).toBe(200);
  expect(restored.data.restoredFromSeq).toBe(target);
  expect(restored.data.newSeq, '還原本身是一筆新的 transaction').toBeGreaterThan(
    before.data.currentSeq,
  );

  const after = await api<{ currentSeq: number }>(page, 'GET', `/api/pages/${pageId}/history`);
  expect(after.data.currentSeq).toBe(restored.data.newSeq);
});

test('版本預覽期間編輯器唯讀，而且一筆 transaction 都不會送出', async ({ page }) => {
  test.setTimeout(120_000);
  const pageId = await newPage(page, '預覽唯讀測試');
  const snap = await snapshot(page, pageId);
  expect((await tx(page, pageId, setContent(snap.rootBlockIds[0]!, [{ text: '原本的內容' }]))).status).toBe(
    200,
  );

  await page.goto(`/page/${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // 從 ⋯ 選單開版本歷史（TopBar 的 MenuItem「版本歷史」）
  const menuButtons = page.locator('header button');
  const count = await menuButtons.count();
  for (let i = count - 1; i >= 0; i -= 1) {
    await menuButtons.nth(i).click({ timeout: 3000 }).catch(() => {});
    if (await page.getByText('版本歷史', { exact: true }).first().isVisible().catch(() => false)) break;
    await page.keyboard.press('Escape').catch(() => {});
  }
  const entry = page.getByText('版本歷史', { exact: true }).first();
  await entry.click();
  const panel = page.locator('aside[aria-label="版本歷史"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  await panel.locator('ul li button').first().click();
  await expect(panel.getByRole('status')).toContainText('編輯已停用', { timeout: 10_000 });

  // 從這裡開始數 transaction
  const posted: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/transactions')) posted.push(r.url());
  });

  const editor = page.locator(`${HOST} [data-block-id]`).first();
  await editor.click({ timeout: 5000 }).catch(() => {});
  await page.keyboard.type('預覽時打的字不該存進去');
  await page.waitForTimeout(2500);

  expect(posted, '版本預覽期間不能送出任何 transaction').toEqual([]);
  const body = await api<{ rootBlockIds: string[] }>(page, 'GET', `/api/pages/${pageId}/snapshot`);
  expect(body.status).toBe(200);
});
