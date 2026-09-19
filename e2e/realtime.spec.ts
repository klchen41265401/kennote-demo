/**
 * 即時協作（04 §6.6 / ADR 0006）與 BUG-4 的 e2e 回歸。
 *
 * 1. Markdown 捷徑（`# ` `- ` `1. ` `[] ` `> ` ```` ``` ````）打完重整，內容必須一字不差
 *    —— 這是 `docs/qa/functional-round1.md` 的 BUG-4（`> quote` 重整後變 `quote>`）。
 * 2. 兩個分頁開同一頁：A 打字 B 1 秒內看到、同一段雙打兩邊的字都留著、
 *    A 用 Markdown 捷徑時 B 端跟著轉型別、presence 名牌會出現。
 *
 * ```bash
 * # 對遠端站台（預設）
 * npx playwright test realtime.spec.ts
 * # 對本機前端 + 遠端後端（前端改動可以立刻驗證）
 * BASE_URL=http://127.0.0.1:5199 npx playwright test realtime.spec.ts
 * ```
 *
 * ⚠️ 這一輪的修正**全部在前端**（editor-core + apps/web）。
 * 遠端站台還跑著舊的前端 bundle 時，第 1 條會紅 —— deploy 之後才會綠。
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const EMAIL = process.env['E2E_EMAIL'] ?? 'e2e@kennote.local';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'e2e-password-2026';
const HOST = '.kn-editor-host';
const TITLE = '[aria-label="頁面標題"]';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  if (!page.url().includes('/login')) return;

  const email = page.locator('input[type="email"], input[name="email"]').first();
  if (await email.isVisible().catch(() => false)) {
    await email.fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(2000);
  }
  if (!page.url().includes('/login')) return;

  const guest = page.getByRole('button', { name: /不輸入|直接進入|訪客/ }).first();
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.waitForTimeout(2500);
  }
}

/** 建一頁新的頂層頁面，回傳它的網址。 */
async function newPage(page: Page, title: string): Promise<string> {
  await page.locator('nav button[aria-label="新增頁面"]').first().click();
  await page.waitForURL(/\/page\//, { timeout: 20_000 });
  await expect(page.locator(HOST).first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.locator(TITLE).first().click();
  await page.keyboard.type(title);
  await page.waitForTimeout(600);
  return page.url();
}

/**
 * 目前畫面上的 block：`[型別, 純文字]`。
 *
 * 只讀 `[data-block-content]`，避開 checkbox、語言下拉，
 * 以及 presence 畫上去的名牌（`span.kn-presence-label` 是 block 元素的子節點）。
 */
async function blocks(page: Page): Promise<Array<[string, string]>> {
  return page.locator('[data-block-id]').evaluateAll((els) =>
    els.map((el) => {
      const host = el as HTMLElement;
      const content = host.querySelector<HTMLElement>('[data-block-content]') ?? host;
      return [
        host.dataset['blockType'] ?? '',
        (content.innerText ?? '').replace(/​/g, '').trim(),
      ];
    }),
  ) as Promise<Array<[string, string]>>;
}

/** 游標放到第一個 block 裡。 */
async function focusFirstBlock(page: Page): Promise<void> {
  await page.locator('[data-block-id]').first().click();
  await page.waitForTimeout(400);
}

test.describe('Markdown 捷徑寫進後端的內容（BUG-4）', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await expect(page).not.toHaveURL(/\/login/);
  });

  /**
   * 根因：markdown 規則產生的是「換型別 + 整段覆寫 content」的 `block.update`，
   * 它帶著 content 走 tx 通道（debounce 300ms），而「打空白鍵」那一下的 `text.delta`
   * 還被 OT 三狀態機 buffer 著 —— 兩條通道撞在一起，前綴字元就留在字尾。
   * 修法（ADR 0006 §2.9）：content 一律變成 delta 走 OT 通道，型別/props 才走 tx。
   */
  test('六種捷徑打完重整，內容一字不差', async ({ page }) => {
    await newPage(page, `即時同步${Date.now()}`);
    await focusFirstBlock(page);

    const cases: Array<[string, string, string]> = [
      ['> ', 'quote', 'quote'],
      ['# ', '標題', 'heading1'],
      ['- ', 'bullet', 'bulletedList'],
      ['1. ', 'item', 'numberedList'],
      ['[] ', 'todo', 'todo'],
      ['```', 'code', 'code'], // code 的捷徑不需要尾端空白
    ];

    for (let i = 0; i < cases.length; i += 1) {
      const [prefix, body] = cases[i]!;
      await page.keyboard.type(prefix, { delay: 60 });
      await page.waitForTimeout(250);
      await page.keyboard.type(body, { delay: 40 });
      await page.waitForTimeout(600);
      // code block 裡按 Enter 只是換行，所以最後一筆不按
      if (i < cases.length - 1) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(400);
      }
    }
    await page.waitForTimeout(2000); // 等 debounce + ack

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(HOST).first()).toBeVisible();
    await page.waitForTimeout(2500);

    const after = await blocks(page);
    for (const [prefix, body, type] of cases) {
      const hit = after.find(([t, text]) => t === type && text.includes(body));
      expect(hit, `「${prefix}${body}」重整後應該是 ${type} 且內容是「${body}」，實際：${JSON.stringify(after)}`).toBeTruthy();
      // ⭐ 前綴字元不可以留在內容裡（BUG-4 的表現是 `quote>` / `標題#`）
      expect(hit![1]).not.toContain(prefix.trim());
    }
  });
});

test.describe('兩個分頁的即時同步', () => {
  async function openSecondTab(browser: Browser, url: string): Promise<Page> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(HOST).first()).toBeVisible();
    await page.waitForTimeout(2000);
    return page;
  }

  test('A 打字 B 1 秒內看到、同段落雙打都保留、捷徑同步、presence 名牌出現', async ({
    page,
    browser,
  }) => {
    test.slow();
    await signIn(page);
    await expect(page).not.toHaveURL(/\/login/);
    const url = await newPage(page, `雙分頁${Date.now()}`);

    const b = await openSecondTab(browser, url);
    try {
      /* ── 1. A 打字，B 1 秒內看得到 ─────────────────── */
      await focusFirstBlock(page);
      await page.keyboard.type('AAAA', { delay: 50 });
      await expect
        .poll(async () => (await blocks(b)).map(([, t]) => t).join('|'), { timeout: 5000 })
        .toContain('AAAA');

      /* ── 2. 同一段各打各的，兩邊的字都要留著 ────────── */
      // B 把游標移到句首後打字（A 在句尾）
      await focusFirstBlock(b);
      await b.keyboard.press('Home');
      await b.keyboard.type('BBBB', { delay: 50 });
      await page.keyboard.press('End');
      await page.keyboard.type('CCCC', { delay: 50 });
      await page.waitForTimeout(2500);

      const settle = async (p: Page): Promise<string> =>
        (await blocks(p)).map(([, t]) => t).join('|');
      const aText = await settle(page);
      const bText = await settle(b);
      expect(aText, 'A 端應該同時看得到雙方的字').toContain('BBBB');
      expect(aText).toContain('AAAA');
      expect(aText).toContain('CCCC');
      expect(bText, '兩個分頁必須收斂到同一份內容').toBe(aText);

      /* ── 3. A 用 Markdown 捷徑，B 端跟著轉型別且內容正確 ── */
      await page.keyboard.press('Enter');
      await page.keyboard.type('> ', { delay: 60 });
      await page.waitForTimeout(300);
      await page.keyboard.type('引用', { delay: 50 });
      await page.waitForTimeout(2500);

      const bBlocks = await blocks(b);
      const quote = bBlocks.find(([t]) => t === 'quote');
      expect(quote, `B 端應該看到 quote block，實際：${JSON.stringify(bBlocks)}`).toBeTruthy();
      expect(quote![1]).toBe('引用'); // 不是「引用>」
      expect(await settle(b)).toBe(await settle(page));

      /* ── 4. presence 名牌 ───────────────────────────── */
      await focusFirstBlock(b);
      await b.keyboard.press('End');
      await expect
        .poll(async () => page.locator('.kn-presence-label').count(), { timeout: 8000 })
        .toBeGreaterThan(0);
    } finally {
      await b.context().close();
    }
  });
});
