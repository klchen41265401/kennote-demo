/**
 * 功能 QA 第八輪的回歸測試（**權限總掃**）。
 *
 * 每一條對應 `docs/qa/functional-round8.md` 權限矩陣裡的一格。
 *
 * ```bash
 * # 本機 vite（VITE_PROXY_TARGET 指到遠端）：
 * BASE_URL=http://127.0.0.1:5309 npx playwright test functional-round8.spec.ts
 * ```
 *
 * ⚠️ 標成 `test.fixme` 的全部是**後端**修正（BUG-40 / 41 / 42 / 43 / 44），
 * 遠端跑的還是第七輪的 server。**deploy 之後把 `test.fixme` 改回 `test` 就會綠**
 * ——與第五輪 BUG-27、第六輪 BUG-29、第七輪 BUG-35～39 同一個作法。
 * 現在跑它們會紅，而且紅得很有價值：斷言寫的是修好之後的行為。
 *
 * ⚠️ `POST /api/auth/open` 有 rate limit，所以每一條最多只開 2 個瀏覽器 context，
 * 而且 helper 帶 backoff（第七輪 §5 的教訓）。
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * `POST /api/auth/open` 有 rate limit，而且這一輪一條測試要開兩個帳號 ——
 * 第七輪 §5 就撞到過，所以 backoff 是必要的，不是保險。
 */
async function signIn(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    if (!page.url().includes('/login')) return;
    const guest = page.getByRole('button', { name: /不輸入|直接進入|訪客/ }).first();
    if (await guest.isVisible().catch(() => false)) {
      await guest.click();
      await page.waitForTimeout(3000);
      if (!page.url().includes('/login')) return;
    }
    // 被 rate limit 擋下來了 → 等一下再試（1.5s × n）
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
): Promise<{ status: number; data: T; text: string }> {
  return page.evaluate(
    async ([m, p, b]) => {
      const headers: Record<string, string> = {
        authorization: 'Bearer ' + (window as unknown as { __tok?: string }).__tok,
      };
      // fastify 對「有 content-type 卻沒有 body」一律 400，不能無條件帶（第七輪 §3）
      if (b !== null) headers['content-type'] = 'application/json';
      const r = await fetch(p as string, {
        method: m as string,
        headers,
        credentials: 'include',
        ...(b !== null ? { body: JSON.stringify(b) } : {}),
      });
      const text = await r.text();
      try {
        return { status: r.status, data: JSON.parse(text).data, text };
      } catch {
        return { status: r.status, data: text as never, text };
      }
    },
    [method, path, body ?? null] as const,
  ) as Promise<{ status: number; data: T; text: string }>;
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

interface DbHandles {
  collectionId: string;
  pageId: string;
  viewId: string;
  rowId: string;
}

/** 建一個資料庫、塞一列帶著可辨識字串的資料 */
async function newDatabase(page: Page, title: string, secretRow: string): Promise<DbHandles> {
  const ws = await wsId(page);
  const res = await api<{
    collection: { id: string; pageId: string };
    views: Array<{ id: string }>;
  }>(page, 'POST', '/api/databases', { workspaceId: ws, title });
  expect(res.status, '建立資料庫').toBe(201);
  const collectionId = res.data.collection.id;
  const row = await api<{ id: string }>(page, 'POST', `/api/databases/${collectionId}/rows`, {
    title: secretRow,
  });
  expect(row.status).toBe(201);
  return {
    collectionId,
    pageId: res.data.collection.pageId,
    viewId: res.data.views[0]!.id,
    rowId: row.data.id,
  };
}

/** 丟一個 transaction（envelope 照 blocks/validate-ops.ts 的 transactionSchema） */
async function tx(page: Page, pageId: string, ops: unknown[]) {
  return api(page, 'POST', `/api/pages/${pageId}/transactions`, {
    txId: crypto.randomUUID(),
    pageId,
    originSessionId: crypto.randomUUID(),
    ops,
  });
}

/** 在一頁的第一個 block 裡寫下可辨識的內容 */
async function writeSecret(page: Page, pageId: string, secret: string): Promise<void> {
  const snap = await api<{ rootBlockIds: string[] }>(page, 'GET', `/api/pages/${pageId}/snapshot`);
  expect(snap.status).toBe(200);
  const blockId = snap.data.rootBlockIds[0]!;
  const res = await tx(page, pageId, [
    { type: 'block.update', blockId, patch: { content: [{ text: secret }] } },
  ]);
  expect(res.status).toBe(200);
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

const DENIED = [403, 404];

test.beforeEach(async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
});

/* ─────────────────────────────────────────────────────────
 * BUG-40：整個 databases 模組沒有任何頁面權限
 * ───────────────────────────────────────────────────────── */

test('BUG-40a guest 讀不到未授權資料庫（snapshot / rows / CSV 都要 404）', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const db = await newDatabase(page, '絕密：併購名單', '機密專案 ZULU9');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);

    const meta = await api(b.p2, 'GET', `/api/databases/${db.collectionId}`);
    expect(meta.status, 'GET /api/databases/:id 應該 404（原本 200）').toBe(404);

    const rows = await api(b.p2, 'GET', `/api/databases/${db.collectionId}/rows`);
    expect(rows.status, 'rows 也要 404').toBe(404);
    expect(rows.text, '列的內容一個字都不能外流').not.toContain('ZULU9');

    const csv = await api(b.p2, 'GET', `/api/databases/${db.collectionId}/export.csv`);
    expect(csv.status, 'export.csv 也要 404').toBe(404);
    expect(csv.text).not.toContain('ZULU9');

    // 載體頁本身第七輪就鎖上了，這裡順便釘住「兩邊答案一致」
    const carrier = await api(b.p2, 'GET', `/api/pages/${db.pageId}`);
    expect(carrier.status, '載體頁與資料庫必須同一個答案').toBe(404);
  } finally {
    await b.close();
  }
});

test('BUG-40b guest 寫不進未授權資料庫（列 / schema / 視圖）', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const db = await newDatabase(page, '絕密：預算表', '機密預算 QQ9');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    const c = db.collectionId;

    const created = await api(b.p2, 'POST', `/api/databases/${c}/rows`, { title: 'guest 插入的' });
    expect(DENIED, '新增列（原本 201）').toContain(created.status);

    const patched = await api(b.p2, 'PATCH', `/api/databases/${c}/rows/${db.rowId}`, {
      title: 'guest 改的',
    });
    expect(DENIED, '改儲存格（原本 200）').toContain(patched.status);

    const removed = await api(b.p2, 'DELETE', `/api/databases/${c}/rows/${db.rowId}`);
    expect(DENIED, '刪列（原本 204 —— 別人的資料就這樣沒了）').toContain(removed.status);

    const reordered = await api(b.p2, 'POST', `/api/databases/${c}/rows/reorder`, {
      rowId: db.rowId,
      afterId: null,
    });
    expect(DENIED, '重排（原本 200）').toContain(reordered.status);

    const duplicated = await api(b.p2, 'POST', `/api/databases/${c}/rows/${db.rowId}/duplicate`, {});
    expect(DENIED, '複製列（原本 201，而且複本歸複製者所有）').toContain(duplicated.status);

    const schema = await api(b.p2, 'PATCH', `/api/databases/${c}/schema`, {
      ops: [{ op: 'add', definition: { type: 'text', name: 'guest 欄' } }],
    });
    expect(DENIED, '改 schema（原本 200 —— 回應裡還附整份 schema）').toContain(schema.status);

    const view = await api(b.p2, 'POST', `/api/databases/${c}/views`, {
      type: 'table',
      name: 'guest view',
    });
    expect(DENIED, '新增視圖（原本 201）').toContain(view.status);

    const viewPatch = await api(b.p2, 'PATCH', `/api/databases/${c}/views/${db.viewId}`, {
      name: 'guest 改名',
    });
    expect(DENIED, '改視圖（原本 200）').toContain(viewPatch.status);

    const viewDelete = await api(b.p2, 'DELETE', `/api/databases/${c}/views/${db.viewId}`);
    expect(DENIED, '刪視圖（原本 204）').toContain(viewDelete.status);
  } finally {
    await b.close();
  }
});

test('BUG-40c GET /api/databases?workspaceId 不列出看不見的資料庫', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const ws = await wsId(page);
  await newDatabase(page, '絕密：薪資資料庫', '不該被列到');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    const list = await api<Array<{ name: unknown }>>(
      b.p2,
      'GET',
      `/api/databases?workspaceId=${ws}`,
    );
    expect(list.status).toBe(200);
    expect(list.text, '連資料庫的名字都不該出現').not.toContain('絕密：薪資資料庫');
    expect(list.data, 'guest 看不到任何資料庫').toEqual([]);
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * BUG-41：op log 是第二條內容外流管道
 * ───────────────────────────────────────────────────────── */

test('BUG-41 guest 讀不到未授權頁面的 transactions（op log 就是原文）', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const secret = await newPage(page, '絕密：薪資表');
  await writeSecret(page, secret, 'CEO 年薪 1234 萬');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);

    // 第七輪已經鎖上的兩支（回歸）
    expect((await api(b.p2, 'GET', `/api/pages/${secret}`)).status).toBe(404);
    expect((await api(b.p2, 'GET', `/api/pages/${secret}/snapshot`)).status).toBe(404);

    // 第八輪新鎖的第三支
    const log = await api(b.p2, 'GET', `/api/pages/${secret}/transactions?since=0`);
    expect(log.status, 'op log 也要 404（原本 200）').toBe(404);
    expect(log.text, 'block.update 的 patch 裡就是原文').not.toContain('1234');
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * BUG-42：匯出把整棵子樹交出去
 * ───────────────────────────────────────────────────────── */

test('BUG-42 guest 匯不出未授權的頁面（Markdown / HTML / 子樹）', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const secret = await newPage(page, '絕密：董事會紀錄');
  await writeSecret(page, secret, 'CEO 年薪 1234 萬');
  const child = await newPage(page, '絕密的子頁', secret);
  await writeSecret(page, child, '子頁機密 ZULU9');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);

    const md = await api(b.p2, 'POST', `/api/pages/${secret}/export`, { format: 'markdown' });
    expect(md.status, '匯出要 404（原本 200，整頁 Markdown）').toBe(404);
    expect(md.text).not.toContain('1234');

    const html = await api(b.p2, 'POST', `/api/pages/${secret}/export`, {
      format: 'html',
      includeSubpages: true,
    });
    expect(html.status, '帶子樹的匯出更要擋').toBe(404);
    expect(html.text).not.toContain('ZULU9');
  } finally {
    await b.close();
  }
});

test('BUG-42b 有 read 的人匯出時，看不見的子頁不會被夾帶出去', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const parent = await newPage(page, '可以給你看的專案');
  await writeSecret(page, parent, '這一段可以看');
  const child = await newPage(page, '不給看的子頁', parent);
  await writeSecret(page, child, '子頁機密 ZULU9');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    // 只授權父頁，子頁停止繼承 → 子頁看不見
    expect(
      (
        await api(page, 'POST', `/api/pages/${parent}/permissions`, {
          subjectType: 'user',
          subjectId: b.user.id,
          permission: 'read',
        })
      ).status,
    ).toBe(200);
    await api(page, 'POST', `/api/pages/${child}/permissions`, {
      subjectType: 'user',
      subjectId: b.user.id,
      permission: 'none',
    });

    const zip = await api(b.p2, 'POST', `/api/pages/${parent}/export`, {
      format: 'markdown',
      includeSubpages: true,
    });
    expect(zip.status, '父頁有 read → 匯得出來').toBe(200);
    expect(zip.text, '但子頁的內容不能跟著出去').not.toContain('ZULU9');
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * BUG-43：用「追蹤頁面」把標題洩漏從收件匣繞回來
 * ───────────────────────────────────────────────────────── */

test('BUG-43 guest 不能追蹤未授權的頁面', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const secret = await newPage(page, '絕密：裁員名單');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);
    const sub = await api(b.p2, 'POST', '/api/notifications/subscriptions', {
      pageId: secret,
      kind: 'explicit',
    });
    expect(sub.status, '訂閱要 404（原本 200 —— 之後每次編輯都收到帶標題的通知）').toBe(404);
  } finally {
    await b.close();
  }
});

/* ─────────────────────────────────────────────────────────
 * 已經是對的：這幾條現在就該綠（回歸保護）
 * ───────────────────────────────────────────────────────── */

test('留言 / 版本歷史的權限分層（read 才能看、comment 才能寫、edit 才能還原）', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const secret = await newPage(page, '絕密：法務意見');
  await writeSecret(page, secret, 'CEO 年薪 1234 萬');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);

    // 完全沒授權 → 一律 404
    expect((await api(b.p2, 'GET', `/api/pages/${secret}/discussions`)).status).toBe(404);
    expect((await api(b.p2, 'GET', `/api/pages/${secret}/history`)).status).toBe(404);

    // 給 read → 看得到，但留言與還原要被擋
    const grant = await api(page, 'POST', `/api/pages/${secret}/permissions`, {
      subjectType: 'user',
      subjectId: b.user.id,
      permission: 'read',
    });
    expect(grant.status).toBe(200);

    expect((await api(b.p2, 'GET', `/api/pages/${secret}/discussions`)).status, 'read 看得到討論串').toBe(200);
    expect((await api(b.p2, 'GET', `/api/pages/${secret}/history`)).status, 'read 看得到版本').toBe(200);

    const comment = await api(b.p2, 'POST', `/api/pages/${secret}/discussions`, {
      body: [{ text: '只有 read 不該留得了言' }],
    });
    expect(comment.status, 'read 不能留言').toBe(403);

    const restore = await api(b.p2, 'POST', `/api/pages/${secret}/history/1/restore`, {});
    expect([403, 404], 'read 不能還原版本').toContain(restore.status);
  } finally {
    await b.close();
  }
});

test('工作區設定：member 改不了、admin 移不掉 owner', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const ws = await wsId(page);
  const me = await api<{ user: { id: string } }>(page, 'GET', '/api/auth/me');

  const b = await secondAccount(browser);
  try {
    // 先以 member 身分加入（不是 guest）
    const invite = await api(page, 'POST', `/api/workspaces/${ws}/invites`, {
      email: b.user.email,
      role: 'member',
    });
    expect(invite.status).toBe(201);

    const rename = await api(b.p2, 'PATCH', `/api/workspaces/${ws}`, { name: 'member 改名的' });
    expect([403, 404], 'member 不能改工作區設定').toContain(rename.status);

    const drop = await api(b.p2, 'DELETE', `/api/workspaces/${ws}`);
    expect([403, 404], 'member 不能刪工作區').toContain(drop.status);

    // 升成 admin 之後仍然不能動 owner
    const promote = await api(page, 'PATCH', `/api/workspaces/${ws}/members/${b.user.id}`, {
      role: 'admin',
    });
    expect(promote.status).toBe(200);

    const kickOwner = await api(
      b.p2,
      'DELETE',
      `/api/workspaces/${ws}/members/${me.data.user.id}`,
    );
    expect(kickOwner.status, 'admin 不能移除 owner').toBe(403);

    const demoteOwner = await api(b.p2, 'PATCH', `/api/workspaces/${ws}/members/${me.data.user.id}`, {
      role: 'member',
    });
    expect(demoteOwner.status, 'admin 不能降 owner 的權').toBe(403);
  } finally {
    await b.close();
  }
});

test('公開分享在 FEATURE_PUBLIC_SHARE = false 時整條路都是關的', async ({ page }) => {
  test.setTimeout(120_000);
  const health = await api<{ features: { publicShare: boolean } }>(page, 'GET', '/api/health');
  expect(health.data.features.publicShare, '這一條只在 feature flag 關閉時有意義').toBe(false);

  const pageId = await newPage(page, '想公開的頁');
  const share = await api(page, 'POST', `/api/pages/${pageId}/share`, { enabled: true });
  expect(share.status, '建立公開連結要被擋（NOT_IMPLEMENTED）').toBe(501);

  const anon = await api(page, 'GET', '/api/public/abcdefghij');
  expect(anon.status, '匿名端點一律 404').toBe(404);
});

test('自己的東西只有自己看得到（sessions / notifications）', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const b = await secondAccount(browser);
  try {
    const mine = await api<{ sessions: Array<{ id: string }> }>(page, 'GET', '/api/auth/sessions');
    const theirs = await api<{ sessions: Array<{ id: string }> }>(b.p2, 'GET', '/api/auth/sessions');
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);

    const mineIds = new Set((mine.data.sessions ?? []).map((s) => s.id));
    const theirIds = (theirs.data.sessions ?? []).map((s) => s.id);
    expect(theirIds.some((id) => mineIds.has(id)), '兩個帳號的 session 清單不能有交集').toBe(false);

    // 踢別人的 session family → 打不到（WHERE 帶 user_id）
    const first = [...mineIds][0];
    if (first) {
      const kick = await api(b.p2, 'DELETE', `/api/auth/sessions/${first}`);
      expect([403, 404], '踢不到別人的 session').toContain(kick.status);
    }
  } finally {
    await b.close();
  }
});

test('第七輪的修正沒有被這一輪的改動打壞（樹 / 垃圾桶 / 最近 / 收藏）', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const ws = await wsId(page);
  const secret = await newPage(page, '絕密：薪資表');

  const b = await secondAccount(browser);
  try {
    await inviteGuest(page, b.user.email);

    const tree = await api<unknown[]>(b.p2, 'GET', `/api/workspaces/${ws}/tree`);
    expect(tree.status).toBe(200);
    expect(tree.text, '樹不能有標題').not.toContain('絕密：薪資表');

    const trash = await api<unknown[]>(b.p2, 'GET', `/api/trash?workspaceId=${ws}`);
    expect(trash.text, '垃圾桶不能有標題').not.toContain('絕密：薪資表');

    const fav = await api(b.p2, 'POST', `/api/pages/${secret}/favorite`, {});
    expect([403, 404], '收藏別人的頁面要被擋').toContain(fav.status);

    const visit = await api(b.p2, 'POST', `/api/pages/${secret}/visit`, {});
    expect([403, 404], '「造訪」也要被擋').toContain(visit.status);
  } finally {
    await b.close();
  }
});
