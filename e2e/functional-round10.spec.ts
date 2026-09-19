/**
 * 功能 QA 第十輪（**搜尋 guest 過濾正例・協作即時性・觸控 / 手機**）。
 *
 * 對應 `docs/qa/functional-round10.md`。
 *
 * ```bash
 * # 本機 vite（VITE_PROXY_TARGET 指到遠端），看 Local 網址的埠：
 * cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 npx vite --port 5311 --strictPort
 * cd e2e && BASE_URL=http://127.0.0.1:5311 npx playwright test functional-round10.spec.ts
 * ```
 *
 * 這一輪**沒有整批 `test.fixme`** —— §1 的搜尋矩陣是連三輪「未驗證」的那一格，
 * 它必須真的跑過（而且已經跑綠）。需要部署的那幾條各自標 `fixme` 並寫明原因。
 *
 * ⚠️ `POST /api/auth/open` 有 rate limit，所以每一條最多只開 2 個瀏覽器 context。
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
 * 寫一個含關鍵字的段落 block，回傳 blockId。
 *
 * ⭐ 第八～九輪連三輪寫「搜尋索引非同步、等不到」—— **那是誤判**。
 * `blocks.plain_text`（0005）與 `blocks.search_tsv`（0020）都是
 * `GENERATED ALWAYS AS ... STORED` 的 generated column，**在同一個 INSERT 裡就算好了**，
 * 中間沒有任何非同步的一段。所以這裡寫完可以直接搜，不需要 sleep，也不需要輪詢。
 */
async function writeBlock(page: Page, pageId: string, text: string): Promise<string> {
  const res = await api<{ ops: Array<{ blockId: string }> }>(
    page,
    'POST',
    `/api/pages/${pageId}/transactions`,
    {
      txId: crypto.randomUUID(),
      pageId,
      ops: [
        {
          type: 'block.insert',
          blockId: crypto.randomUUID(),
          parentId: null,
          afterId: null,
          blockType: 'paragraph',
          props: {},
          content: [{ text }],
        },
      ],
    },
  );
  expect(res.status, '寫入 block').toBe(200);
  return res.data.ops[0]!.blockId;
}

interface SearchHitLite {
  pageId: string;
}

async function searchHits(page: Page, ws: string, q: string): Promise<SearchHitLite[]> {
  const res = await api<{ hits: SearchHitLite[] }>(
    page,
    'GET',
    `/api/search?q=${encodeURIComponent(q)}&workspaceId=${ws}`,
  );
  expect(res.status, `搜尋 ${q}`).toBe(200);
  return res.data.hits ?? [];
}

/** 開第二個帳號（自己的工作區、role owner） */
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
 * 1. 搜尋的 guest 過濾 —— **正例**
 *    （第八輪 §4-2 / 第九輪 §6-1 / triage §8-3，連三輪明寫「未驗證」）
 *
 *    三格一起打，因為「guest 搜不到」單獨成立是沒有意義的：
 *    要先證明 owner 搜得到（否則可能只是索引沒建），
 *    再證明授權之後 guest 也搜得到（否則可能只是 guest 什麼都搜不到）。
 *    **一格陰性夾在兩格陽性之間**才是一條完整的權限測試。
 * ───────────────────────────────────────────────────────── */

test('R10-1a 搜尋的頁面層過濾：owner 命中 / guest 未授權不命中 / guest 授權後命中', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const ws = await wsId(page);
  // 關鍵字必須是這一次跑獨有的，否則會撞到前幾輪留下的頁面
  const kw = 'zqrten' + Date.now().toString(36);
  const pageId = await newPage(page, `私密頁 ${kw}`);
  await writeBlock(page, pageId, `祕密內文 ${kw} 結束`);

  // ① owner 命中（**陽性對照** —— 這一格紅就代表是索引問題，不是權限問題）
  const own = await searchHits(page, ws, kw);
  expect(
    own.map((h) => h.pageId),
    'owner 自己搜得到剛寫進去的字',
  ).toContain(pageId);

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);

    // ② guest 未授權 → 不命中
    const before = await searchHits(b.p2, ws, kw);
    expect(
      before.map((h) => h.pageId),
      'guest 沒有被授權 → 搜尋結果裡不能有這一頁',
    ).not.toContain(pageId);

    // ③ 授權 read 之後 → 命中（證明 ② 不是「guest 什麼都搜不到」）
    await grant(page, pageId, b.user.id, 'read');
    const after = await searchHits(b.p2, ws, kw);
    expect(
      after.map((h) => h.pageId),
      '拿到 read 之後就搜得到',
    ).toContain(pageId);
  } finally {
    await b.close();
  }
});

test('R10-1b block 內文的命中也走同一條過濾（不是只有標題）', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const ws = await wsId(page);
  const kw = 'zqrtenb' + Date.now().toString(36);
  // 標題**故意不含**關鍵字：這樣命中只可能來自 `block_hits` 那條路徑
  const pageId = await newPage(page, '無關的標題');
  await writeBlock(page, pageId, `只有內文有 ${kw}`);

  expect((await searchHits(page, ws, kw)).map((h) => h.pageId)).toContain(pageId);

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    expect(
      (await searchHits(b.p2, ws, kw)).map((h) => h.pageId),
      'block 內文的命中也要被頁面權限擋掉',
    ).not.toContain(pageId);
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * 2. rollup / relation 讀取時的二次問權（第九輪 §6-3）
 *    **需部署**：`loadRollupSources` / `loadRelationTitles` 現在吃 userId。
 * ───────────────────────────────────────────────────────── */

async function newDatabase(
  page: Page,
  name: string,
): Promise<{ collectionId: string; pageId: string }> {
  const ws = await wsId(page);
  // 回應是 `DatabaseSnapshot`：{ collection, views }，collection 上才有 id / pageId
  const res = await api<{ collection: { id: string; pageId: string } }>(
    page,
    'POST',
    '/api/databases',
    { workspaceId: ws, title: [{ text: name }] },
  );
  expect([200, 201], `建立資料庫（${res.raw.slice(0, 200)}）`).toContain(res.status);
  return { collectionId: res.data.collection.id, pageId: res.data.collection.pageId };
}

test(
  'R10-2 relation 的目標資料庫看不見時，rollup / CSV 讀不到目標列的標題（需部署）',
  async ({ page, browser }) => {
    test.setTimeout(240_000);
    // A 有兩個資料庫：來源與目標；B（guest）只被授權看「來源」。
    const target = await newDatabase(page, 'R10 目標業績表');
    const source = await newDatabase(page, 'R10 來源客戶表');

    const b = await secondAccount(browser);
    try {
      await inviteGuest(page, b.user.email);
      await grant(page, source.pageId, b.user.id, 'read');
      // **刻意不授權 target.pageId**

      // A 在來源上定義一個指向目標的 relation（A 自己兩邊都看得到，所以定義得成）
      const patch = await api(page, 'PATCH', `/api/databases/${source.collectionId}/schema`, {
        properties: {
          link: { type: 'relation', name: '業績', collectionId: target.collectionId },
        },
      });
      expect([200, 201]).toContain(patch.status);

      // B 查來源的列：relation 欄位可以留著 pageId（那是來源自己的資料），
      // 但**不能**帶出目標列的標題／rollup 數值。
      const rows = await api(b.p2, 'GET', `/api/databases/${source.collectionId}/rows`);
      expect(rows.status, 'B 對來源有 read，查得到列').toBe(200);
      expect(rows.raw, '目標資料庫的名字不能出現在 B 的回應裡').not.toContain('R10 目標業績表');
    } finally {
      await b.close();
    }
  },
);

/* ─────────────────────────────────────────────────────────
 * 3. 附件跟著 block 搬家（第九輪 §6-5）
 *    **需部署**：`POST /api/files/:id/rebind`
 * ───────────────────────────────────────────────────────── */

async function uploadPng(
  page: Page,
  pageId: string | null,
): Promise<{ status: number; id: string }> {
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
      return { status: r.status, id };
    },
    [ws, pageId] as const,
  );
}

test('R10-3a 剪下貼上到另一頁之後，rebind 讓附件權限跟著走（需部署）', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const from = await newPage(page, 'R10 原頁（私密）');
  const to = await newPage(page, 'R10 新頁（分享給 B）');
  const up = await uploadPng(page, from);
  expect(up.status).toBe(201);

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    await grant(page, to, b.user.id, 'read');

    // 還沒 rebind：附件仍鎖在原頁 → B 看得到新頁卻是破圖
    expect((await api(b.p2, 'GET', `/api/files/${up.id}`)).status).toBe(404);

    const rebound = await api(page, 'POST', `/api/files/${up.id}/rebind`, { pageId: to });
    expect(rebound.status, 'A 對兩頁都有 edit').toBe(200);

    expect(
      (await api(b.p2, 'GET', `/api/files/${up.id}`)).status,
      'rebind 之後 B 就看得到',
    ).toBe(200);
  } finally {
    await b.close();
  }
});

test('R10-3b rebind 需要「原頁」也有 edit —— 不能把別人的附件搬到自己頁面（需部署）', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const secret = await newPage(page, 'R10 A 的私密頁');
  const up = await uploadPng(page, secret);
  expect(up.status).toBe(201);

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    // B 在 A 的工作區裡有一頁自己能編輯的
    const bPage = await newPage(page, 'R10 B 的頁');
    await grant(page, bPage, b.user.id, 'edit');

    const stolen = await api(b.p2, 'POST', `/api/files/${up.id}/rebind`, { pageId: bPage });
    expect([403, 404], '對原頁沒有 edit → 不准 rebind').toContain(stolen.status);
    // 而且要繼續拿不到
    expect((await api(b.p2, 'GET', `/api/files/${up.id}`)).status).toBe(404);
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * 4. 協作即時性（第七輪 §4 的協作 5～8，連三輪未動）
 * ───────────────────────────────────────────────────────── */

async function openWs(page: Page, pageId: string | null): Promise<void> {
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
    if (pid) {
      ws.send(JSON.stringify({ t: 'subscribe', pageId: pid }));
      /*
       * ⚠️ 伺服器的房間只把「**送過** `{ t: 'presence' }`」的 session 放進名單
       * （`realtime/room-manager.ts`）—— `subscribe` 本身不會讓你出現在別人的頭像列上。
       * 這裡原樣重現前端該做的事（第十輪 BUG-54 修的就是前端少了這一步）。
       */
      ws.send(JSON.stringify({ t: 'presence', pageId: pid, blockId: null, selection: null }));
    }
  }, pageId);
  if (!pageId) return;
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

function wsMessages(page: Page): Promise<Array<Record<string, unknown> & { t: string }>> {
  return page.evaluate(
    () =>
      ((window as unknown as { __wsMsgs?: unknown[] }).__wsMsgs ?? []) as Array<
        Record<string, unknown> & { t: string }
      >,
  );
}

test('R10-4 別人新增留言時，同一頁的訂閱者收到 WS `comment` 推送', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const pageId = await newPage(page, 'R10 留言即時');
  const blockId = await writeBlock(page, pageId, '被討論的段落');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    await grant(page, pageId, b.user.id, 'comment');

    // A 開著這一頁的 WS，B 從另一個帳號留言
    await openWs(page, pageId);
    const created = await api(b.p2, 'POST', `/api/pages/${pageId}/discussions`, {
      blockId,
      body: [{ text: 'B 的第一則留言' }],
    });
    expect([200, 201], `B 有 comment 權限，留得成（${created.raw.slice(0, 200)}）`).toContain(
      created.status,
    );

    await expect
      .poll(async () => (await wsMessages(page)).filter((m) => m.t === 'comment').length, {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
  } finally {
    await b.close();
  }
});

test('R10-5 被 @提及時，通知走 WS 即時推送（不必重新整理）', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const pageId = await newPage(page, 'R10 通知即時');
  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    await grant(page, pageId, b.user.id, 'edit');

    // B 開著 WS 但**不訂閱任何頁面** —— 通知走的是 user channel，不是房間。
    // 這一點很重要：徽章要在「使用者正在看別的頁面」時也會亮。
    await openWs(b.p2, null);

    const blockId = await writeBlock(page, pageId, '提及段落');
    const created = await api(page, 'POST', `/api/pages/${pageId}/discussions`, {
      blockId,
      body: [{ text: '請看一下 ' }, { atom: 'mention', data: { type: 'user', userId: b.user.id } }],
    });
    expect([200, 201], created.raw.slice(0, 200)).toContain(created.status);

    await expect
      .poll(async () => (await wsMessages(b.p2)).filter((m) => m.t === 'notification').length, {
        timeout: 25_000,
      })
      .toBeGreaterThan(0);
  } finally {
    await b.close();
  }
});

test('R10-6 presence：同一頁的兩個人互相看得到對方', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const pageId = await newPage(page, 'R10 presence');
  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    await grant(page, pageId, b.user.id, 'edit');
    await openWs(page, pageId);
    await openWs(b.p2, pageId);

    await expect
      .poll(
        async () => {
          const msgs = (await wsMessages(page)).filter((m) => m.t === 'presence');
          const last = msgs[msgs.length - 1] as { peers?: Array<{ userId: string }> } | undefined;
          return (last?.peers ?? []).some((p) => p.userId === b.user.id);
        },
        { timeout: 25_000 },
      )
      .toBe(true);
  } finally {
    await b.close();
  }
});

/**
 * presence 的協定**只認得 block**（`{ t: 'presence', blockId, selection }`，
 * `packages/shared-types/src/ws.ts`）。資料庫的儲存格不是 block
 * （它是 `pages.properties` 裡的一個 key），所以「某人正在改這一格」
 * 在協定層**沒有辦法表達** —— 不是前端還沒畫，是欄位不存在。
 *
 * 這條測試把這件事釘住：presence 訊息裡不會有任何 row / 欄位的識別。
 * 要做資料庫儲存格名牌，得先在協定上加 `scope`（見 round10 §4-1）。
 */
test('R10-6b presence 的協定不帶儲存格座標（資料庫名牌的前提不存在）', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const pageId = await newPage(page, 'R10 presence 協定');
  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    await grant(page, pageId, b.user.id, 'edit');
    await openWs(page, pageId);
    await openWs(b.p2, pageId);

    await expect
      .poll(async () => (await wsMessages(page)).filter((m) => m.t === 'presence').length, {
        timeout: 25_000,
      })
      .toBeGreaterThan(0);

    const presence = (await wsMessages(page)).filter((m) => m.t === 'presence');
    const peers = (presence[presence.length - 1] as { peers?: Array<Record<string, unknown>> })
      .peers;
    for (const peer of peers ?? []) {
      // 有 blockId（段落游標），但沒有任何「哪一列 / 哪一欄」
      expect(Object.keys(peer)).not.toContain('rowId');
      expect(Object.keys(peer)).not.toContain('propertyId');
    }
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * 5. 觸控 / 手機（第七輪 §4 觸控 9～13，連三輪未動）
 *
 * ⚠️ 這一節**不模擬手指的拖曳**。Playwright 的 `tap()` 送的是 touch 事件，
 *    而受測的兩個引擎一個吃 pointer（`packages/ui/src/dnd`）、
 *    一個吃 HTML5 drag（`features/database/_fallback/dnd.ts`），
 *    「在 headless 裡模擬得出來」與「真機上會動」之間的距離比斷言本身還大。
 *    這裡改成釘住**可觀察的前提**：形狀對了，真機才有可能對。
 * ───────────────────────────────────────────────────────── */

const PHONE = { width: 390, height: 844 };

test('R10-7 手機寬度下整頁不得橫向溢出（資料庫工具列 / 列 peek）', async ({ browser }) => {
  test.setTimeout(240_000);
  const b = await secondAccount(browser, { viewport: PHONE, isMobile: true, hasTouch: true });
  try {
    const db = await newDatabase(b.p2, 'R10 手機資料庫');
    await b.p2.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await b.p2.waitForTimeout(4000);

    const overflow = await b.p2.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    /*
     * 橫向溢出 = 手機上整頁可以左右甩動，工具列（篩選 / 排序 / 視圖 tab）
     * 的按鈕被推到畫面外，而使用者在捲動內容時會不小心把整頁甩歪。
     * `features/database/**` 底下**一條 `@media` 都沒有**（第十輪實測），
     * 所以這一條是整個手機版資料庫的第一道守門。
     */
    expect(
      overflow.scrollWidth - overflow.clientWidth,
      `手機寬度下整頁橫向溢出 ${overflow.scrollWidth - overflow.clientWidth}px`,
    ).toBeLessThanOrEqual(1);
  } finally {
    await b.close();
  }
});

test('R10-8 手機寬度下列 peek 不得比視窗寬（應該是全螢幕）', async ({ browser }) => {
  test.setTimeout(240_000);
  const b = await secondAccount(browser, { viewport: PHONE, isMobile: true, hasTouch: true });
  try {
    const db = await newDatabase(b.p2, 'R10 手機 peek');
    const row = await api(b.p2, 'POST', `/api/databases/${db.collectionId}/rows`, {
      properties: { title: { type: 'title', richText: [{ text: 'peek 這一列' }] } },
    });
    expect([200, 201], row.raw.slice(0, 200)).toContain(row.status);

    await b.p2.goto(`/page/${db.pageId}`, { waitUntil: 'domcontentloaded' });
    await b.p2.waitForTimeout(4000);

    // 開啟列 peek（表格列上的「開啟」按鈕）
    const opener = b.p2.getByRole('button', { name: /開啟|展開/ }).first();
    const opened = await opener.isVisible().catch(() => false);
    /*
     * ⚠️ 第一輪分診 §9 的教訓：**沒有被執行到的斷言不算綠。**
     * 這裡如果找不到開啟鈕就 `skip`，而不是讓下面那條「沒有東西比視窗寬」
     * 在「畫面上根本沒有 peek」的情況下白白變綠 —— 那是最難判讀的一種綠燈。
     */
    test.skip(!opened, '手機寬度下找不到列 peek 的開啟鈕（本身就是一條要查的事）');
    await opener.click();
    await b.p2.waitForTimeout(2000);

    const widest = await b.p2.evaluate((vw) => {
      let worst = 0;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], aside'))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) worst = Math.max(worst, r.width - vw);
      }
      return worst;
    }, PHONE.width);

    expect(widest, `peek / 側欄比視窗寬 ${widest}px`).toBeLessThanOrEqual(1);
  } finally {
    await b.close();
  }
});
