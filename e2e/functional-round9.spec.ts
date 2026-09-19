/**
 * 功能 QA 第九輪的回歸測試（**附件權限 / WS 撤權 / 列頁種子**）。
 *
 * 對應 `docs/qa/functional-round9.md`。
 *
 * ```bash
 * # 本機 vite（VITE_PROXY_TARGET 指到遠端）：
 * BASE_URL=http://127.0.0.1:5310 npx playwright test functional-round9.spec.ts
 * ```
 *
 * ⚠️ **這一輪的每一條都是 `test.fixme`，因為三項修正全部在後端**
 * （migration 0070 + files/permissions/realtime/databases/gc），
 * 遠端跑的還是第八輪的 server。**deploy 之後把 `test.fixme` 改回 `test` 就會綠**
 * ——與第七、八輪同一個作法。
 *
 * 紅線（第一輪分診 §9 的教訓）：`test.fixme` 的斷言**從來沒有被執行過**，
 * 解開的那一輪要逐行看，不能只看「變綠了嗎」。
 *
 * ⚠️ `POST /api/auth/open` 有 rate limit，所以每一條最多只開 2 個瀏覽器 context，
 * 而且 helper 帶 backoff（第七輪 §5 的教訓）。
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

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
        if (auth?.startsWith('Bearer '))
          (window as unknown as { __tok?: string }).__tok = auth.slice(7);
      } catch {
        /* 抄不到就算了 */
      }
      return orig.apply(this, args);
    };
  });
}

/** `raw` = 整份回應原文（第一輪分診 §5：404 沒有 `data`，洩漏斷言要打 raw） */
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

/**
 * 上傳一個 1×1 PNG。`pageId` 是第九輪新增的欄位（migration 0070）——
 * 帶了就把附件的讀取權限綁在那一頁上。
 */
async function uploadPng(
  page: Page,
  pageId: string | null,
): Promise<{ status: number; id: string; raw: string }> {
  const ws = await wsId(page);
  return page.evaluate(
    async ([workspaceId, pid]) => {
      // 最小的合法 PNG（magic number 要過後端的 detectFileType）
      const b64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append('workspaceId', workspaceId as string);
      if (pid) form.append('pageId', pid as string);
      form.append('file', new Blob([bin], { type: 'image/png' }), 'pixel.png');
      const r = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + (window as unknown as { __tok?: string }).__tok },
        credentials: 'include',
        body: form,
      });
      const raw = await r.text();
      let id = '';
      try {
        id = JSON.parse(raw).data.id;
      } catch {
        /* 失敗時 id 留空，由呼叫端斷言 status */
      }
      return { status: r.status, id, raw };
    },
    [ws, pageId] as const,
  );
}

/** 開第二個帳號（自己的工作區、role owner） */
async function secondAccount(
  browser: Browser,
): Promise<{ p2: Page; close: () => Promise<void>; user: { id: string; email: string } }> {
  const ctx = await browser.newContext({ locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  const p2 = await ctx.newPage();
  await installTokenSniffer(p2);
  await signIn(p2);
  const me = await api<{ user: { id: string; email: string } }>(p2, 'GET', '/api/auth/me');
  expect(me.status, '第二個帳號要登得進去').toBe(200);
  return { p2, close: () => ctx.close(), user: me.data.user };
}

/** A 把 B 邀成 guest（baseline = none，什麼頁面都不給） */
async function inviteGuest(owner: Page, email: string): Promise<void> {
  const ws = await wsId(owner);
  const res = await api(owner, 'POST', `/api/workspaces/${ws}/invites`, { email, role: 'guest' });
  expect(res.status, '邀請 guest').toBe(201);
}

async function grant(
  owner: Page,
  pageId: string,
  userId: string,
  permission: string,
): Promise<void> {
  const res = await api(owner, 'POST', `/api/pages/${pageId}/permissions`, {
    subjectType: 'user',
    subjectId: userId,
    permission,
  });
  expect([200, 201]).toContain(res.status);
}

test.beforeEach(async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
});

/* ─────────────────────────────────────────────────────────
 * 1. GET /api/files/:id 依頁面權限（第八輪 §4-1 的已知缺口）
 * ───────────────────────────────────────────────────────── */

test.fixme('R9-1a 上傳時帶 pageId → 同工作區的 guest 拿不到私密頁面的附件', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const pageId = await newPage(page, '絕密：薪資表 R9');
  const up = await uploadPng(page, pageId);
  expect(up.status, '上傳成功').toBe(201);

  // owner 自己讀得到
  const mine = await api(page, 'GET', `/api/files/${up.id}`);
  expect(mine.status).toBe(200);

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    // 第八輪的實測是 200（成員限定就放行）—— 第九輪要變 404
    const asGuest = await api(b.p2, 'GET', `/api/files/${up.id}`);
    expect(asGuest.status, 'guest 拿不到私密頁面的附件').toBe(404);
  } finally {
    await b.close();
  }
});

test.fixme('R9-1b 被授權 read 之後，同一個附件就讀得到（權限跟著頁面走）', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const pageId = await newPage(page, '會議紀錄 R9');
  const up = await uploadPng(page, pageId);
  expect(up.status).toBe(201);

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    expect((await api(b.p2, 'GET', `/api/files/${up.id}`)).status).toBe(404);

    await grant(page, pageId, b.user.id, 'read');
    const after = await api(b.p2, 'GET', `/api/files/${up.id}`);
    expect(after.status, '拿到 read 之後附件也看得到').toBe(200);
  } finally {
    await b.close();
  }
});

test.fixme('R9-1c 不帶 pageId（頭像 / 舊資料）維持工作區成員限定的退路', async ({ page }) => {
  const up = await uploadPng(page, null);
  expect(up.status, 'pageId 是選填').toBe(201);
  const mine = await api(page, 'GET', `/api/files/${up.id}`);
  expect(mine.status).toBe(200);
});

test.fixme('R9-1d 把附件塞進別人的頁面要被擋下（pageId 需要 edit）', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const pageId = await newPage(page, '別人的頁面 R9');
  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    const up = await uploadPng(b.p2, pageId);
    expect([403, 404], 'guest 不能把附件掛到看不見的頁面上').toContain(up.status);
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * 2. WS 房間撤權踢人（第七輪 §4-4 / 第八輪 §4-3，連兩輪未走查）
 * ───────────────────────────────────────────────────────── */

/**
 * 在 page context 裡開一條原生 WS，subscribe 之後把收到的訊息全部留下來。
 * （不開編輯器 UI 是刻意的：這一條測的是**協定層**的行為，
 * UI 走不走唯讀是前端的事，前端已經有 `sync.canEdit`。）
 */
async function openWs(page: Page, pageId: string): Promise<void> {
  await page.evaluate(async (pid) => {
    const w = window as unknown as { __tok?: string; __wsMsgs?: unknown[]; __ws?: WebSocket };
    w.__wsMsgs = [];
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws?token=${w.__tok}`);
    w.__ws = ws;
    ws.addEventListener('message', (e) => w.__wsMsgs!.push(JSON.parse(e.data as string)));
    await new Promise<void>((resolve) => {
      if (ws.readyState === ws.OPEN) return resolve();
      ws.addEventListener('open', () => resolve(), { once: true });
    });
    ws.send(JSON.stringify({ t: 'subscribe', pageId: pid }));
  }, pageId);
  // 等 authOk + synced
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          ((window as unknown as { __wsMsgs?: Array<{ t: string }> }).__wsMsgs ?? []).some(
            (m) => m.t === 'synced',
          ),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
}

function wsMessages(page: Page): Promise<Array<{ t: string; code?: string; permission?: string }>> {
  return page.evaluate(
    () =>
      ((window as unknown as { __wsMsgs?: unknown[] }).__wsMsgs ?? []) as Array<{
        t: string;
        code?: string;
        permission?: string;
      }>,
  );
}

test.fixme('R9-2a 撤權之後，已經連上的 WS 會收到 FORBIDDEN 並被踢出房間', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const pageId = await newPage(page, '撤權測試 R9');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    await grant(page, pageId, b.user.id, 'edit');
    await openWs(b.p2, pageId);

    // 撤權
    await grant(page, pageId, b.user.id, 'none');

    await expect
      .poll(async () => (await wsMessages(b.p2)).some((m) => m.t === 'error' && m.code === 'FORBIDDEN'), {
        timeout: 20_000,
      })
      .toBe(true);

    // 踢出房間之後就收不到內容了：owner 寫一筆，B 不該再收到 txBroadcast
    const before = (await wsMessages(b.p2)).filter((m) => m.t === 'txBroadcast').length;
    const snap = await api<{ rootBlockIds: string[] }>(
      page,
      'GET',
      `/api/pages/${pageId}/snapshot`,
    );
    await api(page, 'POST', `/api/pages/${pageId}/transactions`, {
      txId: crypto.randomUUID(),
      pageId,
      originSessionId: crypto.randomUUID(),
      ops: [
        {
          type: 'block.update',
          blockId: snap.data.rootBlockIds[0],
          patch: { content: [{ text: '撤權之後的內容 R9' }] },
        },
      ],
    });
    await page.waitForTimeout(3000);
    const after = await wsMessages(b.p2);
    expect(after.filter((m) => m.t === 'txBroadcast').length, '撤權後不該再收到內容').toBe(before);
    expect(JSON.stringify(after), '內容一個字都不能外流').not.toContain('撤權之後的內容 R9');
  } finally {
    await b.close();
  }
});

test.fixme('R9-2b 降級成 read → 不踢人，改送 synced{permission: read}', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const pageId = await newPage(page, '降級測試 R9');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    await grant(page, pageId, b.user.id, 'edit');
    await openWs(b.p2, pageId);

    await grant(page, pageId, b.user.id, 'read');

    await expect
      .poll(
        async () =>
          (await wsMessages(b.p2)).some((m) => m.t === 'synced' && m.permission === 'read'),
        { timeout: 20_000 },
      )
      .toBe(true);
    expect((await wsMessages(b.p2)).some((m) => m.t === 'error')).toBe(false);
  } finally {
    await b.close();
  }
});

test.fixme('R9-2c 權限被變更會收到 permission_changed 通知（第 7 種通知型別）', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const pageId = await newPage(page, '通知測試 R9');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    // 第一次授權 → page_shared（第七輪已經有）
    await grant(page, pageId, b.user.id, 'edit');
    // 第二次是「變更」→ permission_changed（第九輪新增的發送端）
    await grant(page, pageId, b.user.id, 'read');

    await expect
      .poll(
        async () => {
          const inbox = await api<{ notifications: Array<{ type: string; pageId: string }> }>(
            b.p2,
            'GET',
            '/api/notifications',
          );
          return (inbox.data?.notifications ?? []).some(
            (n) => n.type === 'permission_changed' && n.pageId === pageId,
          );
        },
        { timeout: 30_000 },
      )
      .toBe(true);
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * 4. 列頁的種子段落由後端建（第一輪分診 §8-5）
 * ───────────────────────────────────────────────────────── */

test.fixme('R9-4a createRow() 就種好一個空段落，snapshot 不再是 0 個 block', async ({ page }) => {
  test.setTimeout(120_000);
  const ws = await wsId(page);
  const db = await api<{ collection: { id: string } }>(page, 'POST', '/api/databases', {
    workspaceId: ws,
    title: '種子段落測試 R9',
  });
  expect(db.status).toBe(201);

  const row = await api<{ id: string }>(page, 'POST', `/api/databases/${db.data.collection.id}/rows`, {
    title: '第一列',
  });
  expect(row.status).toBe(201);

  const snap = await api<{ rootBlockIds: string[]; recordMap: { block: Record<string, unknown> } }>(
    page,
    'GET',
    `/api/pages/${row.data.id}/snapshot`,
  );
  expect(snap.status).toBe(200);
  // 第一輪分診的實測是 `rootBlockIds: []`（列頁是整個 repo 裡唯一 0 個 block 的頁面）
  expect(snap.data.rootBlockIds, '後端就種好一個段落').toHaveLength(1);
  expect(Object.keys(snap.data.recordMap.block)).toHaveLength(1);
});

test.fixme('R9-4b 開了列頁再重整，不會長出第二個空段落', async ({ page }) => {
  test.setTimeout(180_000);
  const ws = await wsId(page);
  const db = await api<{ collection: { id: string } }>(page, 'POST', '/api/databases', {
    workspaceId: ws,
    title: '重複種子測試 R9',
  });
  const row = await api<{ id: string }>(page, 'POST', `/api/databases/${db.data.collection.id}/rows`, {
    title: '一列',
  });

  // 以整頁開啟 → 前端的 fallback 不該再補一個
  await page.goto(`/page/${row.data.id}`, { waitUntil: 'domcontentloaded' });
  await page
    .locator('.kn-editor-host [data-block-id]')
    .first()
    .waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page
    .locator('.kn-editor-host [data-block-id]')
    .first()
    .waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForTimeout(2000);

  const snap = await api<{ rootBlockIds: string[] }>(
    page,
    'GET',
    `/api/pages/${row.data.id}/snapshot`,
  );
  expect(snap.data.rootBlockIds, '不能因為開過頁面就多一個空段落').toHaveLength(1);
});
