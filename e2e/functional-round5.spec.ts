/**
 * 功能 QA 第五輪的回歸測試（協作 / 頁面功能 + 390 手機版）。
 *
 * 每一條對應 `docs/qa/functional-round5.md` 裡的一個已修 bug 或一項走查結論。
 *
 * ```bash
 * # 本機 vite（VITE_PROXY_TARGET 指到遠端）：
 * BASE_URL=http://127.0.0.1:5306 npx playwright test functional-round5.spec.ts
 * ```
 *
 * 除了 BUG-27 以外全部是**前端**修正（匯出 / 匯入 / 留言 / 版本歷史的後端本來就是
 * 好的，這一輪只是把 UI 接上去），deploy 前端就會在遠端生效。
 * BUG-27 是後端的權限漏洞，**需要部署 server**，所以那一條先標成 `test.fixme`。
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

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

/** 派發一個帶 text/plain 的 paste 事件到目前焦點 */
async function pasteText(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    document.activeElement?.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, text);
  await page.waitForTimeout(900);
}

/* ═══════════════════════════════════════════════════════════
   1. 協作：留言 / 版本歷史 / 權限
   ═══════════════════════════════════════════════════════════ */

test('留言：建立討論串 → 回覆 → 解決 → 重開，面板上看得到', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const pid = await newPage(page, 'R5 留言 ' + Date.now());

  const created = await api<{ id: string; comments: unknown[] }>(page, 'POST', `/api/pages/${pid}/discussions`, {
    anchor: { kind: 'inline', quote: '一段被選取的文字' },
    body: [{ text: '這裡要改' }],
  });
  expect(created.status).toBe(201);
  const did = created.data.id;

  expect((await api(page, 'POST', `/api/discussions/${did}/comments`, { body: [{ text: '收到' }] })).status).toBe(201);

  const resolved = await api<{ resolvedAt: string | null }>(page, 'POST', `/api/discussions/${did}/resolve`, {});
  expect(resolved.status).toBe(200);
  expect(resolved.data.resolvedAt).not.toBeNull();

  // 重開（DELETE /resolve）
  const reopened = await api<{ resolvedAt: string | null }>(page, 'DELETE', `/api/discussions/${did}/resolve`);
  expect(reopened.status).toBe(200);
  expect(reopened.data.resolvedAt).toBeNull();

  // 右側面板
  await openPage(page, pid);
  await page.locator('[aria-label="留言"]').first().click();
  await page.waitForTimeout(1500);
  const panel = page.locator('[aria-label="側邊面板"]');
  await expect(panel).toContainText('留言（1）');
  await expect(panel).toContainText('一段被選取的文字');
  await expect(panel).toContainText('這裡要改');
  await expect(panel).toContainText('收到');
});

test('版本歷史：改一次內容就有版本，面板列得出來', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const pid = await newPage(page, 'R5 歷史 ' + Date.now());
  await openPage(page, pid);

  await page.locator(`${HOST} [data-block-id]`).first().click();
  await page.keyboard.type('版本一');
  await page.waitForTimeout(3500);

  const hist = await api<{ currentSeq: number; versions: Array<{ seq: number }> }>(
    page,
    'GET',
    `/api/pages/${pid}/history`,
  );
  expect(hist.status).toBe(200);
  expect(hist.data.versions.length).toBeGreaterThan(0);

  await page.locator('[aria-label="動作"]').first().click();
  await page.getByRole('menuitem', { name: /版本歷史/ }).click();
  await page.waitForTimeout(2000);
  // 協作面板改版後：版本紀錄是側邊面板內的獨立檢視（Notion 原文「版本紀錄」）
  await expect(page.locator('[aria-label="側邊面板"]')).toContainText(/版本紀錄|版本歷史/);
  await expect(page.locator('[aria-label="側邊面板"]')).toContainText('次變更');
});

test('權限：只有 comment 權限的第二個帳號改不動內容，但留得了言', async ({ page, browser }: { page: Page; browser: Browser }) => {
  test.setTimeout(180_000);
  await installTokenSniffer(page);
  await signIn(page);
  const pid = await newPage(page, 'R5 權限 ' + Date.now());

  const ctx2 = await browser.newContext({ locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  const p2 = await ctx2.newPage();
  await installTokenSniffer(p2);
  await signIn(p2);
  const me2 = await api<{ user: { id: string; email: string } }>(p2, 'GET', '/api/auth/me');
  expect(me2.status).toBe(200);

  // 先邀進工作區（BUG-27：只給頁面層級權限、沒加進工作區的話，對方連 404 都過不了）
  const ws = await wsId(page);
  const invite = await api(page, 'POST', `/api/workspaces/${ws}/invites`, {
    email: me2.data.user.email,
    role: 'guest',
  });
  expect(invite.status, '邀請第二個帳號當 guest').toBe(201);

  const grant = await api(page, 'POST', `/api/pages/${pid}/permissions`, {
    subjectType: 'user',
    subjectId: me2.data.user.id,
    permission: 'comment',
  });
  expect(grant.status).toBe(200);

  // 讀得到
  expect((await api(p2, 'GET', `/api/pages/${pid}/snapshot`)).status).toBe(200);

  // 寫不得（後端要擋，不能只靠 UI）。envelope 照 blocks/validate-ops.ts 的 transactionSchema
  const write = await api(p2, 'POST', `/api/pages/${pid}/transactions`, {
    txId: crypto.randomUUID(),
    pageId: pid,
    originSessionId: 'r5-test',
    ops: [
      {
        type: 'block.insert',
        blockId: crypto.randomUUID(),
        parentId: null,
        afterId: null,
        blockType: 'paragraph',
        props: {},
        content: [{ text: '訪客亂寫' }],
      },
    ],
  });
  expect(write.status, 'comment 權限不該寫得進去').toBe(403);

  // 但留言要成功
  const comment = await api(p2, 'POST', `/api/pages/${pid}/discussions`, {
    anchor: { kind: 'page' },
    body: [{ text: '訪客留言' }],
  });
  expect(comment.status, 'comment 權限本來就該留得了言').toBe(201);

  await ctx2.close();
});

/**
 * BUG-27（**後端修正，需部署**）：頁面 meta 的寫入沒有權限檢查。
 *
 * block 的寫入早就有 guard（`registerPermissionGuard`），但
 * `PATCH /api/pages/:id`（標題 / icon / 封面）、`DELETE /api/pages/:id`、
 * `POST /api/pages/:id/move` 只檢查「看不看得見」。
 * 修正在 `apps/server/src/modules/pages/service.ts`，deploy 之後這一條才會綠：
 * 把 `test.fixme` 改回 `test` 即可（作法與第四輪的 BUG-18 相同）。
 */
test('BUG-27 comment 權限不該改得了頁面標題 / 刪頁 / 搬頁（需部署後端）', async ({ page, browser }: { page: Page; browser: Browser }) => {
  test.setTimeout(180_000);
  await installTokenSniffer(page);
  await signIn(page);
  const ws = await wsId(page);
  const pid = await newPage(page, 'R5 權限 meta ' + Date.now());

  const ctx2 = await browser.newContext({ locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  const p2 = await ctx2.newPage();
  await installTokenSniffer(p2);
  await signIn(p2);
  const me2 = await api<{ user: { id: string; email: string } }>(p2, 'GET', '/api/auth/me');
  expect((await api(page, 'POST', `/api/workspaces/${ws}/invites`, { email: me2.data.user.email, role: 'guest' })).status).toBe(201);
  expect(
    (await api(page, 'POST', `/api/pages/${pid}/permissions`, {
      subjectType: 'user',
      subjectId: me2.data.user.id,
      permission: 'comment',
    })).status,
  ).toBe(200);

  const patch = await api(p2, 'PATCH', `/api/pages/${pid}`, { title: [{ text: '訪客改標題' }] });
  expect(patch.status, 'comment 權限不該改得了標題').toBe(403);

  const move = await api(p2, 'POST', `/api/pages/${pid}/move`, { parentId: null });
  expect(move.status, 'comment 權限不該搬得動頁面').toBe(403);

  const del = await api(p2, 'DELETE', `/api/pages/${pid}`);
  expect(del.status, 'comment 權限不該刪得掉頁面').toBe(403);

  await ctx2.close();
});

/* ═══════════════════════════════════════════════════════════
   2. 匯出 / 匯入（BUG-19：UI 沒接上後端）
   ═══════════════════════════════════════════════════════════ */

test('BUG-19 ⋯選單的「匯出」開的是匯出對話框（Markdown / HTML / PDF），不是直接下載', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const pid = await newPage(page, 'R5 匯出 ' + Date.now());
  await openPage(page, pid);

  await page.locator('[aria-label="動作"]').first().click();
  await page.getByRole('menuitem', { name: /^匯出$/ }).click();
  await page.waitForTimeout(800);

  const dialog = page.locator('[role="dialog"]').first();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('匯出');
  // 格式選單三種（CSV 只有 database 頁面才會多一個）
  await expect(dialog).toContainText('匯出格式');
  await expect(dialog).toContainText('包含子頁面');

  // 格式是 Select（收合時只看得到目前值），打開才數得到選項
  await dialog.getByRole('combobox', { name: '匯出格式' }).click();
  await page.waitForTimeout(500);
  const options = await page.locator('[role="option"]').allInnerTexts();
  expect(options.join('|')).toMatch(/Markdown/);
  expect(options.join('|')).toMatch(/HTML/);
  expect(options.join('|')).toMatch(/PDF/);
});

test('BUG-19 ⋯選單的「匯入」開的是匯入對話框，不是「尚未開放」的 toast', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const pid = await newPage(page, 'R5 匯入 ' + Date.now());
  await openPage(page, pid);

  await page.locator('[aria-label="動作"]').first().click();
  await page.getByRole('menuitem', { name: /^匯入$/ }).click();
  await page.waitForTimeout(800);

  const dialog = page.locator('[role="dialog"]').first();
  await expect(dialog).toBeVisible();
  const text = await dialog.innerText();
  expect(text).toMatch(/Markdown/);
  expect(text, '不能再是那個「尚未開放」的 toast').not.toMatch(/尚未開放/);
});

test('匯出 Markdown / HTML 的內容正確，PDF 回 501 並指路去列印', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const pid = await newPage(page, 'R5 匯出內容 ' + Date.now());
  await openPage(page, pid);
  await page.locator(`${HOST} [data-block-id]`).first().click();
  await page.keyboard.type('匯出的內文');
  await page.waitForTimeout(3500);

  const grab = async (format: string) =>
    page.evaluate(
      async ([id, f]) => {
        const r = await fetch(`/api/pages/${id}/export`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + (window as unknown as { __tok?: string }).__tok,
            'content-type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ format: f }),
        });
        return { status: r.status, cd: r.headers.get('content-disposition') ?? '', body: await r.text() };
      },
      [pid, format] as const,
    );

  const md = await grab('markdown');
  expect(md.status).toBe(200);
  expect(md.cd, '中文檔名要走 filename*=UTF-8').toContain("filename*=UTF-8''");
  expect(md.body).toContain('匯出的內文');

  const html = await grab('html');
  expect(html.status).toBe(200);
  expect(html.body).toContain('<!DOCTYPE html>');
  expect(html.body).toContain('匯出的內文');

  const pdf = await grab('pdf');
  expect(pdf.status, 'PDF 由瀏覽器列印產生（ADR 0005）').toBe(501);
  expect(pdf.body).toContain('列印');
});

test('匯入 Markdown 檔：標題 / 清單 / 程式碼都建成對的 block', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const ws = await wsId(page);

  const result = await page.evaluate(
    async ([w]) => {
      const md = '# 匯入標題\n\n一段文字\n\n- 項目一\n- 項目二\n\n```ts\nconst a = 1;\n```\n';
      const form = new FormData();
      form.append('workspaceId', w as string);
      form.append('file', new File([md], 'r5-import.md', { type: 'text/markdown' }));
      const r = await fetch('/api/import', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + (window as unknown as { __tok?: string }).__tok },
        credentials: 'include',
        body: form,
      });
      return { status: r.status, body: await r.text() };
    },
    [ws] as const,
  );
  expect(result.status).toBe(201);
  const rootPageId = JSON.parse(result.body).data.rootPageId as string;

  const snap = await api<{ recordMap: { block: Record<string, { value: { type: string } }> } }>(
    page,
    'GET',
    `/api/pages/${rootPageId}/snapshot`,
  );
  const types = Object.values(snap.data.recordMap.block).map((b) => b.value.type);
  expect(types).toContain('paragraph');
  expect(types).toContain('bulletedList');
  expect(types).toContain('code');
});

/* ═══════════════════════════════════════════════════════════
   3. 頁面功能：複本（含子頁）/ 鎖定 / 公開連結停用提示
   ═══════════════════════════════════════════════════════════ */

test('建立複本會把子頁一起複製，標題補「（複本）」', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const ws = await wsId(page);
  const parent = await newPage(page, 'R5 複本 ' + Date.now());
  const child = await api<{ id: string }>(page, 'POST', '/api/pages', {
    workspaceId: ws,
    parentId: parent,
    title: [{ text: '子頁' }],
  });
  expect(child.status).toBe(201);

  const dup = await api<{ page: { id: string; title: Array<{ text?: string }>; children: string[] } }>(
    page,
    'POST',
    `/api/pages/${parent}/duplicate`,
    { workspaceId: ws },
  );
  expect(dup.status).toBe(201);
  expect(dup.data.page.title.map((t) => t.text ?? '').join('')).toContain('（複本）');

  const tree = await api<unknown>(page, 'GET', `/api/workspaces/${ws}/tree`);
  const find = (nodes: unknown, id: string): Record<string, unknown> | null => {
    for (const n of (nodes as Array<Record<string, unknown>>) ?? []) {
      if (n['id'] === id) return n;
      const hit = find(n['children'], id);
      if (hit) return hit;
    }
    return null;
  };
  const dupNode = find((tree.data as { pages?: unknown })?.pages ?? tree.data, dup.data.page.id);
  expect(dupNode, '側邊欄樹裡要看得到複本').not.toBeNull();
  // tree 是 lazy 的（只回 hasChildren），所以子頁要另外確認
  expect(dupNode!['hasChildren'], '複本底下要有子頁').toBe(true);

  // 子頁的實體：duplicate 回傳的 children 是「複本自己的 block/子頁 id」
  expect(dup.data.page.children.length, '複本要有子節點').toBeGreaterThan(0);
});

test('BUG-20 鎖定頁面不會把剛打的字弄不見，而且打字真的進不去', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const pid = await newPage(page, 'R5 鎖定 ' + Date.now());
  await openPage(page, pid);
  await page.locator(`${HOST} [data-block-id]`).first().click();
  await page.keyboard.type('原本的內容');
  // 先等 transport 真的把字沖出去，否則後面比對的是「還沒存到的內容」
  await expect
    .poll(async () => JSON.stringify((await api(page, 'GET', `/api/pages/${pid}/snapshot`)).data), { timeout: 20_000 })
    .toContain('原本的內容');
  await page.waitForTimeout(500);

  const typed = await blockDump(page);
  expect(typed.join(' | ')).toContain('原本的內容');

  await page.locator('[aria-label="動作"]').first().click();
  await page.getByRole('menuitem', { name: /鎖定頁面/ }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);

  const before = await blockDump(page);
  expect(before.join(' | '), '鎖定不該把剛打的字弄不見').toContain('原本的內容');
  await page.locator(`${HOST} [data-block-id]`).first().click({ force: true });
  await page.keyboard.type('不該打得進去');
  await page.waitForTimeout(900);
  expect(await blockDump(page)).toEqual(before);

  // 沒有任何可編輯的區域
  const editable = await page.evaluate(
    (h) => [...(document.querySelector(h)?.querySelectorAll('[contenteditable="true"]') ?? [])].length,
    HOST,
  );
  expect(editable).toBe(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  expect(await blockDump(page)).toEqual(before);
});

test('BUG-21 FEATURE_PUBLIC_SHARE=false 時，公開連結開關要停用並寫明原因', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const health = await api<{ features?: { publicShare?: boolean } }>(page, 'GET', '/api/health');
  test.skip(health.data?.features?.publicShare === true, '這個站台開著公開分享，這一條不適用');

  const pid = await newPage(page, 'R5 分享 ' + Date.now());
  await openPage(page, pid);
  // ⚠️ `/分享/` 在整頁裡會撞到 6 個按鈕（側邊欄那些），一定要鎖在頂欄
  await page.locator('header').getByRole('button', { name: '分享', exact: true }).first().click();
  await page.waitForTimeout(1000);

  const hint = page.locator('[data-public-share="disabled"]');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('FEATURE_PUBLIC_SHARE');
  // 開關要是停用的，不能讓人按下去才吃一個 501
  const disabled = await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent?.includes('公開連結'));
    return label?.querySelector('input')?.disabled ?? null;
  });
  expect(disabled).toBe(true);

  // 後端也要確實擋著
  const res = await api(page, 'POST', `/api/pages/${pid}/share`, { enabled: true });
  expect(res.status).toBe(501);
});

/* ═══════════════════════════════════════════════════════════
   4. 貼上（第四輪 §5 的觀察）
   ═══════════════════════════════════════════════════════════ */

test('BUG-22 貼上 Markdown 表格會變成 table block', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const pid = await newPage(page, 'R5 貼表格 ' + Date.now());
  await openPage(page, pid);

  await page.locator(`${HOST} [data-block-id]`).first().click();
  await pasteText(page, '| 欄一 | 欄二 |\n| --- | --- |\n| a1 | b1 |\n| a2 | b2 |');

  const dump = await blockDump(page);
  expect(dump.some((d) => d.startsWith('table ::')), `實際：${JSON.stringify(dump)}`).toBe(true);
  expect(dump.filter((d) => d.startsWith('tableRow ::')).length).toBe(3);
  expect(dump.some((d) => d.includes('| 欄一'))).toBe(false);

  // 重整後還在（真的寫回伺服器了）
  await page.waitForTimeout(3500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const after = await blockDump(page);
  expect(after.some((d) => d.startsWith('table ::'))).toBe(true);
  expect(after.join('\n')).toContain('欄一');
  expect(after.join('\n')).toContain('b2');
});

test('BUG-23 貼上純 URL 會變成連結（不是純文字）', async ({ page }) => {
  await installTokenSniffer(page);
  await signIn(page);
  const pid = await newPage(page, 'R5 貼網址 ' + Date.now());
  await openPage(page, pid);

  await page.locator(`${HOST} [data-block-id]`).first().click();
  await pasteText(page, 'https://example.com/some/article');

  const href = await page.evaluate(
    (h) => document.querySelector(h)?.querySelector('a')?.getAttribute('href') ?? null,
    HOST,
  );
  expect(href).toBe('https://example.com/some/article');
});

/* ═══════════════════════════════════════════════════════════
   5. 390 手機版
   ═══════════════════════════════════════════════════════════ */

test.describe('390 手機版', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('BUG-24 `/` 選單是 bottom sheet：貼底、滿寬、60% 高', async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    const pid = await newPage(page, 'R5 手機 slash ' + Date.now());
    await openPage(page, pid);

    await page.locator(`${HOST} [data-block-id]`).first().click();
    await page.keyboard.type('/');
    await page.waitForTimeout(900);

    const sheet = page.locator('[data-sheet="true"]');
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x, '貼齊左緣').toBe(0);
    expect(box!.width, '滿寬').toBe(390);
    expect(Math.round(box!.y + box!.height), '貼齊底緣').toBe(844);
    // 規格 02 §2.5：佔 60% 高
    expect(box!.height).toBeGreaterThan(844 * 0.55);
    expect(box!.height).toBeLessThan(844 * 0.65);
    // 由下滑入
    await expect(page.locator('[data-kn-sheet-backdrop]')).toBeVisible();
    // 點得到項目
    await expect(page.locator('[role="option"]').first()).toBeVisible();
  });

  test('BUG-25 長按 400ms 叫得出 block 選單（觸控沒有 gutter）', async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    const pid = await newPage(page, 'R5 長按 ' + Date.now());
    await openPage(page, pid);

    const block = page.locator(`${HOST} [data-block-id]`).first();
    await block.click();
    await page.keyboard.type('長按我');
    await page.waitForTimeout(600);

    const box = await block.boundingBox();
    expect(box).not.toBeNull();
    // 真的 pointerType='touch' 的長按（Playwright 的 touchscreen.tap 按不住）
    await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x as number, y as number);
        el?.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x as number,
            clientY: y as number,
          }),
        );
      },
      [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
    );
    await page.waitForTimeout(700);

    const menu = page.locator('[aria-label="區塊操作"]');
    await expect(menu, '長按 400ms 之後要出現 block 選單').toBeVisible();
    await expect(menu).toContainText('在下方插入區塊');
    await expect(menu).toContainText('轉換成');
    // 手機上它也是 bottom sheet
    await expect(menu).toHaveAttribute('data-sheet', 'true');
  });

  test('BUG-25 長按開的選單能插入新 block（觸控的插入替代路徑）', async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    const pid = await newPage(page, 'R5 長按插入 ' + Date.now());
    await openPage(page, pid);

    const block = page.locator(`${HOST} [data-block-id]`).first();
    await block.click();
    await page.keyboard.type('第一段');
    await page.waitForTimeout(600);
    const before = (await blockDump(page)).length;

    const box = await block.boundingBox();
    await page.evaluate(
      ([x, y]) => {
        document.elementFromPoint(x as number, y as number)?.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x as number,
            clientY: y as number,
          }),
        );
      },
      [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
    );
    await page.waitForTimeout(700);
    await page.getByText('在下方插入區塊').click();
    await page.waitForTimeout(600);

    expect((await blockDump(page)).length).toBe(before + 1);
  });

  test('BUG-26 浮動工具列會吸在虛擬鍵盤上緣（模擬 visualViewport 縮短）', async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    const pid = await newPage(page, 'R5 鍵盤 ' + Date.now());

    // headless 沒有真的虛擬鍵盤 → 在載入前把 visualViewport 換成可控的假物件
    await page.addInitScript(() => {
      const listeners: Record<string, Array<() => void>> = { resize: [], scroll: [] };
      const fake = {
        width: 390,
        height: 844,
        offsetTop: 0,
        offsetLeft: 0,
        pageTop: 0,
        pageLeft: 0,
        scale: 1,
        addEventListener: (t: string, fn: () => void) => listeners[t]?.push(fn),
        removeEventListener: (t: string, fn: () => void) => {
          const a = listeners[t];
          if (a) a.splice(a.indexOf(fn), 1);
        },
        dispatchEvent: () => true,
      };
      Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
      (window as unknown as { __openKeyboard: (h: number) => void }).__openKeyboard = (h: number) => {
        fake.height = h;
        for (const fn of [...listeners.resize!, ...listeners.scroll!]) fn();
      };
    });

    await openPage(page, pid);
    await page.locator(`${HOST} [data-block-id]`).first().click();
    await page.keyboard.type('選我看看工具列');
    await page.waitForTimeout(600);

    // 鍵盤打開：可視區從 844 縮到 480
    await page.evaluate(() => (window as unknown as { __openKeyboard: (h: number) => void }).__openKeyboard(480));
    await page.waitForTimeout(300);

    // 選取文字叫出浮動工具列
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.waitForTimeout(900);

    const bubble = page.locator('.kn-popover--bubble');
    await expect(bubble).toBeVisible();
    const box = await bubble.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height, '工具列底緣不能掉到鍵盤上緣 480 以下').toBeLessThanOrEqual(480);
    expect(box!.width, '不能超出 390 寬').toBeLessThanOrEqual(390);
  });

  test('設定 Dialog 每一頁都開得起來，而且是滿版', async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    const pid = await newPage(page, 'R5 手機設定 ' + Date.now());
    await openPage(page, pid);

    await page.locator('[aria-label="開啟側邊欄"]').first().click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: '設定', exact: true }).first().click();
    await page.waitForTimeout(1200);

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBe(0);
    expect(box!.width, '滿寬').toBe(390);

    // 每一個分頁都點得開、都有內容
    for (const tab of ['我的帳號', '我的設定', '通知', '成員', '一般']) {
      await page.getByRole('button', { name: tab, exact: true }).first().click();
      await page.waitForTimeout(400);
      const text = await dialog.innerText();
      expect(text.length, `${tab} 這一頁是空的`).toBeGreaterThan(20);
      // 橫向不能溢出
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${tab} 這一頁有橫向溢出`).toBeLessThanOrEqual(0);
    }
  });
});
