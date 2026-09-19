/**
 * 功能 QA 第六輪的回歸測試（垃圾桶權限 / 工作區外分享 / 版本歷史 / 通知 + 390 手機版）。
 *
 * 每一條對應 `docs/qa/functional-round6.md` 裡的一個已修 bug 或一項走查結論。
 *
 * ```bash
 * # 本機 vite（VITE_PROXY_TARGET 指到遠端）：
 * BASE_URL=http://127.0.0.1:5307 npx playwright test functional-round6.spec.ts
 * ```
 *
 * 標成 `test.fixme` 的三條（BUG-29 兩條、BUG-31 §3 一條）是**後端**修正
 * ——「訪客不能永久刪別人的頁」、「`DELETE /api/trash` 清空垃圾桶」、
 * 「工作區外的被授權者看得到被分享的那一頁」在遠端還是舊的 server，
 * **deploy 之後把 `test.fixme` 改回 `test` 即可**（作法與第五輪的 BUG-27 相同）。
 *
 * 其餘的（版本歷史、提及通知、追蹤 / 靜音、收件匣、分享彈窗、手機版設定、觸控拖曳）
 * 在現行 server 上就該是綠的。
 *
 * ⚠️ `POST /api/auth/open` 有 rate limit，所以每一條最多只開 2 個瀏覽器 context，
 * 而且用到兩個帳號的都要 `test.setTimeout(180_000)`。
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
          h instanceof Headers ? h.get('authorization') : (h?.['authorization'] ?? h?.['Authorization']);
        if (auth?.startsWith('Bearer ')) (window as unknown as { __tok?: string }).__tok = auth.slice(7);
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
  expect(res.status).toBe(201);
  return res.data.id;
}

async function openPage(page: Page, id: string): Promise<void> {
  await page.goto(`/page/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
}

/** `type :: 文字` 的扁平快照 */
function blockDump(page: Page): Promise<string[]> {
  return page.evaluate((host) => {
    const root = document.querySelector(host);
    if (!root) return [];
    return [...root.querySelectorAll('[data-block-id]')].map(
      (e) => `${e.getAttribute('data-block-type')} :: ${(e as HTMLElement).innerText.replace(/\n/g, '⏎')}`,
    );
  }, HOST);
}

/* ── 第六輪自己的小工具 ───────────────────────────────────── */

/** 開第二個帳號（自己的工作區、role owner），回 page / 工作區 / 使用者。 */
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

/** 丟一個 transaction（envelope 照 blocks/validate-ops.ts 的 transactionSchema） */
async function tx(
  page: Page,
  pageId: string,
  baseSeq: number,
  ops: unknown[],
): Promise<{ status: number; data: unknown }> {
  return api(page, 'POST', `/api/pages/${pageId}/transactions`, {
    txId: crypto.randomUUID(),
    pageId,
    originSessionId: 'r6-test',
    baseSeq,
    ops,
  });
}

/** 取得（必要時建立）這一頁的第一個 root block */
async function firstRootBlock(page: Page, pageId: string): Promise<string> {
  const snap = await api<{ seq: number; rootBlockIds: string[] }>(page, 'GET', `/api/pages/${pageId}/snapshot`);
  expect(snap.status).toBe(200);
  const existing = snap.data.rootBlockIds?.[0];
  if (existing) return existing;

  const blockId = crypto.randomUUID();
  const res = await tx(page, pageId, snap.data.seq, [
    {
      type: 'block.insert',
      blockId,
      parentId: null,
      afterId: null,
      blockType: 'paragraph',
      props: {},
      content: [{ text: '起始段落' }],
    },
  ]);
  expect(res.status, '插入起始 block').toBe(200);
  return blockId;
}

async function currentSeq(page: Page, pageId: string): Promise<number> {
  const snap = await api<{ seq: number }>(page, 'GET', `/api/pages/${pageId}/snapshot`);
  return snap.data.seq;
}

/** B 目前的未讀數 */
async function unreadOf(page: Page): Promise<number> {
  const res = await api<{ unread: number }>(page, 'GET', '/api/notifications');
  expect(res.status).toBe(200);
  return res.data.unread;
}

/* ═══════════════════════════════════════════════════════════
   1. 垃圾桶：權限 + 清空（BUG-29，需部署後端）
   ═══════════════════════════════════════════════════════════ */

/**
 * BUG-29（**後端修正，需部署**）：`DELETE /api/pages/:id/permanent` 只檢查
 * 「看不看得見」，所以工作區裡的 guest 可以把**別人的**頁面從垃圾桶裡永久刪掉
 * （不可逆！）。修正在 `apps/server/src/modules/pages/service.ts` 的
 * `canControlTrashedPage()`：只有頁面的擁有者 / 工作區 owner・admin 能動。
 * deploy 之後把 `test.fixme` 改回 `test`。
 */
test('BUG-29 工作區 guest 不該能永久刪除別人的頁面（需部署後端）', async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  test.setTimeout(180_000);
  await installTokenSniffer(page);
  await signIn(page);
  const ws = await wsId(page);
  const pid = await newPage(page, 'R6 垃圾桶權限 ' + Date.now());

  const b = await secondAccount(browser);

  // B 進 A 的工作區當 guest（invites 而不是 members —— 後者不存在）
  const invite = await api(page, 'POST', `/api/workspaces/${ws}/invites`, {
    email: b.user.email,
    role: 'guest',
  });
  expect(invite.status, '邀請第二個帳號當 guest').toBe(201);

  // A 先把自己的頁面丟進垃圾桶
  expect((await api(page, 'DELETE', `/api/pages/${pid}`)).status, 'A 軟刪除自己的頁面').toBe(200);

  // B（guest）不該永久刪得掉 —— 舊的 server 這裡是 200
  const bDelete = await api(b.p2, 'DELETE', `/api/pages/${pid}/permanent`);
  expect(bDelete.status, 'guest 不該永久刪得掉別人的頁面').toBe(403);

  // 還在垃圾桶裡（沒被 B 幹掉）
  const trash = await api<Array<{ id: string }>>(page, 'GET', `/api/trash?workspaceId=${ws}`);
  expect(trash.status).toBe(200);
  expect(trash.data.map((t) => t.id), 'B 擋下來之後頁面要還在垃圾桶').toContain(pid);

  // 還原得回來，代表真的沒有被硬刪
  expect((await api(page, 'POST', `/api/pages/${pid}/restore`)).status, 'A 還原得回來').toBe(200);

  // 換 A 自己來就該過
  expect((await api(page, 'DELETE', `/api/pages/${pid}`)).status).toBe(200);
  expect(
    (await api(page, 'DELETE', `/api/pages/${pid}/permanent`)).status,
    '頁面的擁有者本來就該永久刪得掉',
  ).toBe(200);

  await b.close();
});

/**
 * BUG-29（**後端新端點，需部署**）：垃圾桶沒有「清空」，只能一頁一頁刪。
 * 新增 `DELETE /api/trash?workspaceId=...` → `{ deleted, skipped }`，
 * 刪不掉的（別人的頁面）算 skipped，不會讓整批失敗。
 * deploy 之後把 `test.fixme` 改回 `test`。
 */
test('BUG-29 清空垃圾桶 `DELETE /api/trash` 會回 {deleted, skipped}（需部署後端）', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const ws = await wsId(page);

  const stamp = Date.now();
  const a = await newPage(page, 'R6 清空 A ' + stamp);
  const c = await newPage(page, 'R6 清空 B ' + stamp);
  for (const id of [a, c]) {
    expect((await api(page, 'DELETE', `/api/pages/${id}`)).status).toBe(200);
  }

  const before = await api<Array<{ id: string }>>(page, 'GET', `/api/trash?workspaceId=${ws}`);
  expect(before.status).toBe(200);
  expect(before.data.map((t) => t.id)).toEqual(expect.arrayContaining([a, c]));

  const emptied = await api<{ deleted: number; skipped: number }>(
    page,
    'DELETE',
    `/api/trash?workspaceId=${ws}`,
  );
  expect(emptied.status).toBe(200);
  expect(typeof emptied.data.deleted, 'deleted 是數字').toBe('number');
  expect(typeof emptied.data.skipped, 'skipped 是數字').toBe('number');
  expect(emptied.data.deleted, '自己的兩頁都該被清掉').toBeGreaterThanOrEqual(2);

  const after = await api<Array<{ id: string }>>(page, 'GET', `/api/trash?workspaceId=${ws}`);
  expect(after.status).toBe(200);
  const ids = after.data.map((t) => t.id);
  expect(ids, '清空之後自己的頁面不該還在').not.toContain(a);
  expect(ids).not.toContain(c);
});

/* ═══════════════════════════════════════════════════════════
   2. 工作區外的分享（BUG-31 §3，需部署後端）
   ═══════════════════════════════════════════════════════════ */

/**
 * BUG-31 §3（**後端修正 + 新端點，需部署**）：第五輪為了讓被分享的人打得開頁面，
 * 只好先把他「邀進工作區」—— 但那等於把整個工作區攤開給他看。
 * 正確作法是：`POST /api/pages/:id/permissions` 本身就足以開那**一頁**，
 * 其他頁面照樣 404，工作區樹也照樣看不到；另外補一個
 * `GET /api/pages/shared-with-me` 讓他找得到被分享的頁。
 * deploy 之後把 `test.fixme` 改回 `test`。
 */
test('BUG-31 工作區外的被授權者開得了被分享的那一頁，但看不到其他頁（需部署後端）', async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  test.setTimeout(180_000);
  await installTokenSniffer(page);
  await signIn(page);
  const ws = await wsId(page);
  const stamp = Date.now();
  const page1 = await newPage(page, 'R6 分享的那一頁 ' + stamp);
  const page2 = await newPage(page, 'R6 不該看到的那一頁 ' + stamp);

  const b = await secondAccount(browser);

  // 關鍵：**不**邀進工作區，只給 page1 的頁面層級權限
  const grant = await api(page, 'POST', `/api/pages/${page1}/permissions`, {
    subjectType: 'user',
    subjectId: b.user.id,
    permission: 'comment',
  });
  expect(grant.status).toBe(200);

  const entries = await api<{ entries: Array<{ subjectId: string; permission: string }> }>(
    page,
    'GET',
    `/api/pages/${page1}/permissions`,
  );
  expect(entries.status).toBe(200);
  expect(
    entries.data.entries.some((e) => e.subjectId === b.user.id && e.permission === 'comment'),
    '授權要寫得進去',
  ).toBe(true);

  // 被分享的那一頁：讀得到
  expect((await api(b.p2, 'GET', `/api/pages/${page1}`)).status, '被分享的頁面要開得起來').toBe(200);
  expect((await api(b.p2, 'GET', `/api/pages/${page1}/snapshot`)).status, '內容也要載得到').toBe(200);

  // 同一個工作區的其他頁：不該存在
  expect((await api(b.p2, 'GET', `/api/pages/${page2}`)).status, '沒分享的頁面要 404').toBe(404);

  // 工作區本身也不該攤開（404 或 403 都可以，重點是拿不到樹）
  const tree = await api(b.p2, 'GET', `/api/workspaces/${ws}/tree`);
  expect([404, 403], `實際：${tree.status}`).toContain(tree.status);

  // 但要找得到「與我共用」
  const shared = await api<Array<{ id: string }>>(b.p2, 'GET', '/api/pages/shared-with-me');
  expect(shared.status).toBe(200);
  expect(shared.data.map((n) => n.id), '與我共用要列得出被分享的那一頁').toContain(page1);

  await b.close();
});

/* ═══════════════════════════════════════════════════════════
   3. 版本歷史：預覽唯讀 + 還原本身也是一個版本
   ═══════════════════════════════════════════════════════════ */

test('版本歷史：預覽是唯讀的，而且「還原」會變成新的版本', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const pid = await newPage(page, 'R6 歷史 ' + Date.now());

  const blockId = await firstRootBlock(page, pid);

  // 改兩次 → 至少兩個版本
  for (const text of ['第一次改的內容', '第二次改的內容']) {
    const seq = await currentSeq(page, pid);
    const res = await tx(page, pid, seq, [
      { type: 'block.update', blockId, patch: { content: [{ text }] } },
    ]);
    expect(res.status, `寫入「${text}」`).toBe(200);
  }

  const hist = await api<{ pageId: string; currentSeq: number; versions: Array<{ seq: number; txCount: number }> }>(
    page,
    'GET',
    `/api/pages/${pid}/history`,
  );
  expect(hist.status).toBe(200);
  expect(hist.data.pageId).toBe(pid);
  /*
   * ⚠️ 不能斷言「改兩次 = 兩個版本」：`history/rebuild.ts` 的 `bucketVersions()`
   * 會把短時間內同一個人的 tx 併成**同一個版本**（Notion 也是這樣分組）。
   * 實測連續兩筆 tx 只會得到 1 個 bucket。這一條真正要釘的是下面的
   * 「預覽唯讀」與「還原會變成新版本」。
   */
  expect(hist.data.versions.length, '至少要有一個版本').toBeGreaterThanOrEqual(1);
  const seqBefore = hist.data.currentSeq;

  // 預覽：整個 recordMap 都要被降成 reader，不能讓人在歷史畫面上直接改東西
  const preview = await api<{
    pageId: string;
    seq: number;
    snapshot: { recordMap: Record<string, Record<string, { role: string }>> };
  }>(page, 'GET', `/api/pages/${pid}/history/1`);
  expect(preview.status).toBe(200);
  expect(preview.data.seq).toBe(1);
  const roles = Object.values(preview.data.snapshot.recordMap).flatMap((table) =>
    Object.values(table).map((rec) => rec.role),
  );
  expect(roles.length, '預覽快照不該是空的').toBeGreaterThan(0);
  expect(roles.every((r) => r === 'reader'), `實際角色：${JSON.stringify([...new Set(roles)])}`).toBe(true);

  // 還原：不是把 seq 倒回去，而是往前再壓一個版本（歷史不可竄改）
  const restored = await api<{ pageId: string; restoredFromSeq: number; newSeq: number; opCount: number }>(
    page,
    'POST',
    `/api/pages/${pid}/history/1/restore`,
  );
  expect(restored.status).toBe(200);
  expect(restored.data.restoredFromSeq).toBe(1);
  expect(restored.data.newSeq, '還原要產生比目前更新的 seq').toBeGreaterThan(seqBefore);

  const after = await api<{ currentSeq: number; versions: Array<{ seq: number }> }>(
    page,
    'GET',
    `/api/pages/${pid}/history`,
  );
  expect(after.status).toBe(200);
  expect(after.data.currentSeq, '還原本身也算一個版本').toBeGreaterThan(seqBefore);
  expect(after.data.versions.length).toBeGreaterThanOrEqual(hist.data.versions.length);
});

/* ═══════════════════════════════════════════════════════════
   4. 提及 → 通知 → 已讀
   ═══════════════════════════════════════════════════════════ */

test('提及 → 通知 → 標為已讀 → 全部已讀', async ({ page, browser }: { page: Page; browser: Browser }) => {
  test.setTimeout(180_000);
  await installTokenSniffer(page);
  await signIn(page);
  const ws = await wsId(page);
  const pid = await newPage(page, 'R6 提及 ' + Date.now());

  const b = await secondAccount(browser);
  expect(
    (await api(page, 'POST', `/api/workspaces/${ws}/invites`, { email: b.user.email, role: 'member' })).status,
    '邀請第二個帳號當 member',
  ).toBe(201);

  // 留言裡放一個 mention atom（形狀見 shared-types 的 extractMentionedUserIds）
  const discussion = await api<{ id: string }>(page, 'POST', `/api/pages/${pid}/discussions`, {
    anchor: { kind: 'page' },
    body: [{ text: '麻煩你看一下 ' }, { atom: 'mention', data: { userId: b.user.id, text: '@被提及的人' } }],
  });
  expect(discussion.status).toBe(201);

  // 通知是非同步 fan-out，要 poll
  await expect.poll(() => unreadOf(b.p2), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  const inbox = await api<{
    notifications: Array<{ id: string; type: string; pageId: string | null; readAt: string | null }>;
    unread: number;
  }>(b.p2, 'GET', '/api/notifications');
  expect(inbox.status).toBe(200);
  const hit = inbox.data.notifications.find((n) => n.pageId === pid);
  expect(hit, `收件匣裡要有這一頁的通知，實際：${JSON.stringify(inbox.data.notifications)}`).toBeTruthy();
  expect(hit!.type, '被 @ 的人拿的是 mention，不是 comment_reply').toBe('mention');
  expect(hit!.readAt, '剛收到的通知是未讀').toBeNull();

  expect((await api(b.p2, 'POST', `/api/notifications/${hit!.id}/read`)).status).toBe(200);
  await expect.poll(() => unreadOf(b.p2), { timeout: 20_000 }).toBe(0);

  const readAll = await api<{ updated: number; unread: number }>(b.p2, 'POST', '/api/notifications/read-all');
  expect(readAll.status).toBe(200);
  expect(readAll.data.unread, '全部已讀之後未讀數是 0').toBe(0);

  await b.close();
});

/**
 * BUG-30（**已知缺口，這一條把「現況」釘住**）：
 * 後端只掃**留言 body** 的 mention atom（`comments/service.ts` 的 `normalizeBody()`
 * → `extractMentionedUserIds()` → `fanOutNotifications()`）。
 * 頁面 block 內容裡的 `{ atom:'mention' }` **完全不會**產生通知 ——
 * 也就是在正文裡 @ 某個人，那個人永遠不知道。
 *
 * ⚠️ 修好之後這一條要**反過來**寫：
 * 把 `expect(...).toBe(before)` 改成 `expect.poll(...).toBeGreaterThan(before)`，
 * 並且改成斷言通知 type === 'mention'、pageId 對得上。
 */
test.skip('BUG-30 頁面 block 裡的提及目前不會產生通知（釘住現況；第七輪已實作 block 提及通知，改由 functional-round7 覆蓋）', async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  test.setTimeout(180_000);
  await installTokenSniffer(page);
  await signIn(page);
  const ws = await wsId(page);
  const pid = await newPage(page, 'R6 正文提及 ' + Date.now());

  const b = await secondAccount(browser);
  expect(
    (await api(page, 'POST', `/api/workspaces/${ws}/invites`, { email: b.user.email, role: 'member' })).status,
  ).toBe(201);

  // 先把 B 的未讀清乾淨（邀請本身可能就是一則通知），才量得準
  expect((await api(b.p2, 'POST', '/api/notifications/read-all')).status).toBe(200);
  const before = await unreadOf(b.p2);
  expect(before).toBe(0);

  // 正文（block）裡放 mention atom
  const blockId = await firstRootBlock(page, pid);
  const seq = await currentSeq(page, pid);
  const written = await tx(page, pid, seq, [
    {
      type: 'block.update',
      blockId,
      patch: {
        content: [
          { text: '正文裡 @ 一下 ' },
          { atom: 'mention', data: { userId: b.user.id, text: '@被提及的人' } },
        ],
      },
    },
  ]);
  expect(written.status, 'mention atom 本身是合法的 rich text').toBe(200);

  // 內容真的寫進去了（不是因為寫失敗才沒通知）
  const snap = await api<{ recordMap: { block: Record<string, { value: { content?: unknown[] } }> } }>(
    page,
    'GET',
    `/api/pages/${pid}/snapshot`,
  );
  expect(
    JSON.stringify(snap.data.recordMap.block[blockId]?.value.content ?? null),
    'mention atom 要真的寫進 block 的 content',
  ).toContain(b.user.id);

  // ⚠️ 現況：等 15 秒也不會有通知
  await page.waitForTimeout(15_000);
  expect(await unreadOf(b.p2), 'BUG-30：正文提及目前不會通知（修好後要把這條反過來）').toBe(before);

  // UI 上也看得到那個 mention（至少字是進去了）
  await openPage(page, pid);
  expect((await blockDump(page)).join(' | ')).toContain('正文裡 @ 一下');

  await b.close();
});

test('頁面追蹤 / 靜音：subscriptions 端點兩種 kind 都吃得下', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const pid = await newPage(page, 'R6 追蹤 ' + Date.now());

  const explicit = await api(page, 'POST', '/api/notifications/subscriptions', {
    pageId: pid,
    kind: 'explicit',
  });
  expect(explicit.status, '追蹤這一頁').toBe(200);

  const muted = await api(page, 'POST', '/api/notifications/subscriptions', {
    pageId: pid,
    kind: 'muted',
  });
  expect(muted.status, '把同一頁靜音').toBe(200);
});

test('收件匣：未讀 badge 看得到，點通知會跳到對應的頁面', async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  test.setTimeout(180_000);
  await installTokenSniffer(page);
  await signIn(page);
  const ws = await wsId(page);
  const pid = await newPage(page, 'R6 收件匣 ' + Date.now());

  const b = await secondAccount(browser);
  expect(
    (await api(page, 'POST', `/api/workspaces/${ws}/invites`, { email: b.user.email, role: 'member' })).status,
  ).toBe(201);

  expect(
    (await api(page, 'POST', `/api/pages/${pid}/discussions`, {
      anchor: { kind: 'page' },
      body: [{ text: '收件匣測試 ' }, { atom: 'mention', data: { userId: b.user.id, text: '@被提及的人' } }],
    })).status,
  ).toBe(201);

  await expect.poll(() => unreadOf(b.p2), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  // B 用 UI 看收件匣
  await b.p2.goto('/inbox', { waitUntil: 'domcontentloaded' });
  await b.p2.waitForTimeout(4000);

  // ⚠️ `[aria-label="通知"]` 會撞到兩個（側邊欄的入口鈕 + 面板本身），要鎖 `aside`
  const panel = b.p2.locator('aside[aria-label="通知"]');
  await expect(panel, '收件匣面板要出得來').toBeVisible();

  // 未讀 badge（側邊欄；手機版可能收起來，所以只在看得到的時候才驗）
  const badge = b.p2.locator('[aria-label$="則未讀通知"]').first();
  if (await badge.isVisible().catch(() => false)) {
    await expect(badge).toHaveText(/\d|99\+/);
  }

  const item = panel.locator('li button').first();
  await expect(item, '收件匣要列得出剛剛那一則').toBeVisible();
  await expect(item).toContainText('提到你');

  await item.click();
  await b.p2.waitForTimeout(3000);
  expect(b.p2.url(), '點通知要跳到對應的頁面').toContain(`/page/${pid}`);

  await b.close();
});

/* ═══════════════════════════════════════════════════════════
   5. 分享彈窗（BUG-31）
   ═══════════════════════════════════════════════════════════ */

test('BUG-31 分享彈窗的邀請框有 member / guest 角色下拉', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  /*
   * ⚠️ 這一條刻意**用點側邊欄的方式**進頁面，不用 `goto('/page/:id')`：
   * 直接 goto 進去時分享彈窗開不起來（頂欄按鈕點得到，但 popover 不出現），
   * 走正常的導覽路徑才穩。這一條只驗 UI，用哪一頁都行。
   */
  await page.waitForTimeout(2500);
  const firstRow = page.locator('[role="tree"] [data-id]').first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  await firstRow.click();
  await page.waitForTimeout(3000);

  // ⚠️ `/分享/` 在整頁裡會撞到 6 個按鈕（側邊欄那些），一定要鎖在 `header`
  await page.locator('header').getByRole('button', { name: /分享/ }).first().click();
  await page.waitForTimeout(1800);

  // ⚠️ 分享彈窗是 `Popover`，**不是** `[role="dialog"]` —— 用彈窗裡的欄位定位
  await expect(page.getByLabel('邀請成員的 email')).toBeVisible();

  const roleSelect = page.locator('[data-invite-role]').first();
  await expect(roleSelect, '邀請框旁邊要有角色下拉').toBeVisible();

  const values = await roleSelect.locator('option').evaluateAll((els) =>
    els.map((el) => (el as HTMLOptionElement).value),
  );
  expect(values, `實際：${JSON.stringify(values)}`).toContain('member');
  expect(values).toContain('guest');

  // 選成 guest 之後說明文字要跟著換（訪客只看得到被分享的頁）
  await roleSelect.selectOption('guest');
  await page.waitForTimeout(400);
  await expect(page.getByText('訪客只能留言', { exact: false }).first()).toBeVisible();
});

/* ═══════════════════════════════════════════════════════════
   6. 390 手機版
   ═══════════════════════════════════════════════════════════ */

test.describe('390 手機版', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  /**
   * BUG-33：手機版的設定 Dialog 用的是 `max-height: 88vh`，實測只有 742.7px，
   * 上下各留一條沒用的空白，內容還被擠到要捲。改成 `100dvh` 之後要真的滿版。
   */
  test('BUG-33 390×844 的設定 Dialog 真的滿版（不是 742.7 的 88vh）', async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    const pid = await newPage(page, 'R6 手機設定 ' + Date.now());
    await openPage(page, pid);

    await page.locator('[aria-label="開啟側邊欄"]').first().click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: '設定', exact: true }).first().click();
    await page.waitForTimeout(1500);

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x, '貼齊左緣').toBe(0);
    expect(box!.width, '滿寬').toBe(390);
    // 88vh = 742.7 → 不合格；100dvh 才算滿版（留一點點誤差給捲軸 / 安全區）
    expect(Math.round(box!.height), `實際高度：${box!.height}`).toBeGreaterThanOrEqual(840);
    expect(Math.round(box!.y), '貼齊上緣').toBeLessThanOrEqual(4);

    // 滿版了就不該再有橫向溢出
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, '設定 Dialog 有橫向溢出').toBeLessThanOrEqual(0);
  });

  /**
   * 側邊欄頁面樹的拖曳用的是 `@kennote/ui` 的 DragController：
   * 觸控要**按住 400ms**（TOUCH_HOLD_MS）才會 begin()，期間移動就當成捲動而取消。
   * ⚠️ `page.touchscreen.tap()` 按不住（按下去馬上放開），所以一定要自己
   * `dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }))`，
   * 等超過 400ms，再往 window 派 pointermove / pointerup 收尾。
   */
  test('側邊欄頁面樹在觸控下可長按拖曳（kn-dragging）', async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    const pid = await newPage(page, 'R6 觸控拖曳 ' + Date.now());
    await openPage(page, pid);

    // 手機版側邊欄是抽屜，要先拉開
    // 實測這顆的 aria-label 不是「開啟側邊欄」，用模糊比對才抓得到
    const toggle = page.locator('button[aria-label*="側邊"], button[aria-label*="選單"]').first();
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(1200);
    }

    const rows = page.locator('[role="tree"] [data-kn-dnd-item]');
    const count = await rows.count().catch(() => 0);
    test.skip(count === 0, '這個畫面上找不到側邊欄的頁面樹列，跳過觸控拖曳');

    const row = rows.first();
    const box = await row.boundingBox();
    test.skip(box === null, '側邊欄的列量不到座標（抽屜沒拉開？），跳過觸控拖曳');

    const cx = box!.x + Math.min(60, box!.width / 2);
    const cy = box!.y + box!.height / 2;

    await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x as number, y as number);
        el?.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX: x as number,
            clientY: y as number,
          }),
        );
      },
      [cx, cy] as const,
    );

    // 按住超過 TOUCH_HOLD_MS（400ms）；期間不能移動，否則會被當成捲動而取消
    await page.waitForTimeout(700);

    const dragging = await page.evaluate(() => document.documentElement.classList.contains('kn-dragging'));
    expect(dragging, '長按 400ms 之後 <html> 要帶上 kn-dragging').toBe(true);

    // 收尾：往下拖一點再放開，別把後面的測試卡在拖曳狀態
    await page.evaluate(
      ([x, y]) => {
        for (const type of ['pointermove', 'pointerup'] as const) {
          window.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType: 'touch',
              isPrimary: true,
              clientX: x as number,
              clientY: (y as number) + 40,
            }),
          );
        }
      },
      [cx, cy] as const,
    );
    await page.waitForTimeout(600);
    expect(
      await page.evaluate(() => document.documentElement.classList.contains('kn-dragging')),
      '放開之後要把 kn-dragging 拿掉',
    ).toBe(false);
  });
});
