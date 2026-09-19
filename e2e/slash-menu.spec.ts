/**
 * `/` 斜線選單的逐項截圖（M2-C）。
 *
 * ```bash
 * cd e2e
 * BASE_URL=http://localhost:5173 npx playwright test slash-menu.spec.ts
 * ```
 *
 * 輸出：`reference/shots/kennote/slash/`
 *   00-open           選單剛打開（對照 06-slash-menu-light.png）
 *   01-scrolled       捲到「基本區塊」中段（對照 06c-slash-scrolled-light.png）
 *   02-filtered       打「標」之後（對照 06b-slash-filtered-light.png）
 *   03-no-result      沒有結果
 *   10-*              每一個項目插入後的樣子
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, type Page } from '@playwright/test';

const EMAIL = process.env['E2E_EMAIL'] ?? 'e2e@kennote.local';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'e2e-password-2026';
const SHOT_DIR = resolve(process.cwd(), process.env['SHOT_DIR'] ?? '../reference/shots/kennote/slash');

mkdirSync(SHOT_DIR, { recursive: true });

/**
 * `STUB_TX=1`：攔截 `POST /api/pages/:id/transactions` 直接回成功。
 *
 * 為什麼需要：截圖用的後端（100.74.148.92:8090）跑的是舊版建置，
 * 它的 BLOCK_TYPES 還沒有 audio / pdf / breadcrumb / button / syncedBlock
 * （migration 0040 尚未部署），會把這些 op 退回來，block 就消失了。
 * 要驗證的是**前端渲染**，所以截圖時把寫入通道短路掉。
 * 搭配 `VITE_EDITOR_HTTP_TRANSPORT=1` 啟動的 dev server 使用。
 */
const STUB_TX = process.env['STUB_TX'] === '1';

async function stubTransactions(page: Page): Promise<void> {
  if (!STUB_TX) return;
  let seq = 1;
  await page.route('**/api/pages/*/transactions', async (route) => {
    const body = route.request().postDataJSON() as { txId?: string; ops?: unknown[] };
    seq += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          txId: body?.txId ?? 'stub',
          pageId: 'stub',
          seq,
          ops: body?.ops ?? [],
          appliedAt: new Date().toISOString(),
          actorId: 'stub',
        },
      }),
    });
  });
}

async function signIn(page: Page): Promise<void> {
  await stubTransactions(page);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  if (!page.url().includes('/login')) return;

  const guest = page.getByRole('button', { name: /不輸入|直接進入|訪客/ }).first();
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.waitForTimeout(2500);
  }
  if (!page.url().includes('/login')) return;

  const email = page.locator('input[type="email"], input[name="email"]').first();
  if (await email.isVisible().catch(() => false)) {
    await email.fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(2500);
  }
}

async function openScratchPage(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const rows = page.locator('[role="treeitem"]');
  if ((await rows.count()) === 0) {
    await page.getByRole('button', { name: '新增頁面' }).first().click({ timeout: 20_000 });
  } else {
    await page.getByRole('button', { name: '新增頁面' }).first().click({ timeout: 20_000 });
  }
  await page.waitForTimeout(2500);
}

/** 把游標放到本頁最後一個空段落 */
async function focusLastBlock(page: Page): Promise<void> {
  const blocks = page.locator('[data-block-content]');
  const count = await blocks.count();
  if (count === 0) {
    await page.locator('.kn-editor-host').click();
    await page.waitForTimeout(300);
    return;
  }
  await blocks.nth(count - 1).click();
  await page.waitForTimeout(200);
}

async function openSlash(page: Page, query = ''): Promise<void> {
  await focusLastBlock(page);
  await page.keyboard.press('End');
  await page.keyboard.type('/', { delay: 40 });
  await page.waitForTimeout(400);
  if (query) {
    await page.keyboard.type(query, { delay: 45 });
    await page.waitForTimeout(350);
  }
}

/** Esc 之後把留在區塊裡的觸發字串刪掉（Notion 也是留著，所以要自己清） */
async function clearTyped(page: Page, typed: number): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  for (let i = 0; i < typed + 1; i += 1) await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
}

async function shotMenu(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  const menu = page.locator('.kn-popover--slash');
  if (await menu.isVisible().catch(() => false)) {
    await menu.screenshot({ path: resolve(SHOT_DIR, `${name}.png`) });
  } else {
    await page.screenshot({ path: resolve(SHOT_DIR, `${name}.png`) });
  }
}

test.describe('斜線選單', () => {
  test('選單本體', async ({ page }) => {
    await signIn(page);
    await openScratchPage(page);

    await openSlash(page);
    await shotMenu(page, '00-open');
    await page.locator('.kn-slash-scroll').hover();
    await page.mouse.wheel(0, 260);
    await shotMenu(page, '01-scrolled');
    await clearTyped(page, 0);

    await openSlash(page, '標');
    await shotMenu(page, '02-filtered');
    await clearTyped(page, 1);

    await openSlash(page, 'zz');
    await shotMenu(page, '03-no-result');
    await clearTyped(page, 2);

    await openSlash(page, '紅色');
    await shotMenu(page, '04-color');
    await clearTyped(page, 2);

    await openSlash(page, '瀏覽模式');
    await shotMenu(page, '05-database');
    await clearTyped(page, 4);

    await openSlash(page, 'figma');
    await shotMenu(page, '06-embed');
    await clearTyped(page, 5);

    await openSlash(page, '匯入');
    await shotMenu(page, '07-import');
    await clearTyped(page, 2);
  });

  /** 逐項插入：只跑「真的會產生 block」的那些 */
  const ITEMS: [file: string, query: string][] = [
    ['10-heading1', '標題 1'],
    ['11-heading4', '標題 4'],
    ['12-bulleted', '項目符號列表'],
    ['13-numbered', '編號列表'],
    ['14-todo', '待辦清單'],
    ['15-toggle', '摺疊列表'],
    ['16-quote', '引用'],
    ['17-callout', '標註'],
    ['18-divider', '分隔線'],
    ['19-code', '程式碼'],
    ['20-image', '圖片'],
    ['21-video', '影片'],
    ['22-audio', '音訊'],
    ['23-file', '檔案'],
    ['24-pdf', 'PDF'],
    ['25-bookmark', '網頁書籤'],
    ['26-embed', '嵌入'],
    ['27-table', '表格'],
    ['28-toc', '目錄'],
    ['29-equation', '方程式區塊'],
    ['30-button', '按鈕'],
    ['31-breadcrumb', '頁面路徑'],
    ['32-synced', '同步區塊'],
    ['33-columns2', '2 欄'],
    ['34-columns3', '3 欄'],
    ['35-toggleHeading1', '摺疊標題 1'],
    ['36-mermaid', 'Mermaid'],
  ];

  for (const [file, query] of ITEMS) {
    test(`插入：${query}`, async ({ page }) => {
      await signIn(page);
      await openScratchPage(page);
      await openSlash(page, query);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(900);
      await page.locator('.kn-editor-host').screenshot({ path: resolve(SHOT_DIR, `${file}.png`) });
    });
  }
});
