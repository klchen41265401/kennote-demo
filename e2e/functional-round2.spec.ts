/**
 * 功能 QA 第二輪的回歸測試（資料庫為主）。
 *
 * 每一條對應 `docs/qa/functional-round2.md` 裡的一個已修 bug。
 *
 * ```bash
 * BASE_URL=http://127.0.0.1:5299 npx playwright test functional-round2.spec.ts
 * ```
 */
import { expect, test, type Page } from '@playwright/test';

const TITLE = '[aria-label="頁面標題"]';
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

/** 建一頁新頁面，並在內文插入一個內嵌資料庫。 */
async function newInlineDatabase(page: Page, title: string): Promise<void> {
  await page.locator('nav button[aria-label="新增頁面"]').first().click();
  await page.waitForURL(/\/page\//, { timeout: 20_000 });
  await expect(page.locator(HOST).first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.locator(TITLE).first().click();
  await page.keyboard.type(title);
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await page.keyboard.type('/資料庫 - 內嵌');
  await page.waitForTimeout(900);
  await page.keyboard.press('Enter');
  await expect(page.locator('button[aria-label="資料庫設定"]').first()).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(1200);
}

/** 設定 → 編輯屬性 → 新增屬性 → 型別選單 */
async function openPropertyTypeMenu(page: Page): Promise<void> {
  await page.locator('button[aria-label="資料庫設定"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('text="編輯屬性"').last().click();
  await page.waitForTimeout(500);
  await page.locator('text="新增屬性"').last().click();
  await page.waitForTimeout(500);
}

test.describe('功能 QA 第二輪回歸', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await expect(page).not.toHaveURL(/\/login/);
  });

  /** BUG-5：巢狀浮層點下去會把父浮層一起關掉，所以整個資料庫設定都按不動 */
  test('巢狀浮層：在型別選單裡選一個型別真的會新增欄位', async ({ page }) => {
    await newInlineDatabase(page, '巢狀浮層回歸');
    await openPropertyTypeMenu(page);

    // 父浮層（屬性清單）＋ 子浮層（型別選單）同時開著
    await expect(page.locator('[role="dialog"]')).toHaveCount(2);

    // 按下去的當下父浮層**不可以**被關掉
    const item = page.locator('[aria-label="屬性類型"] [role="menuitem"]:has-text("數字")').first();
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 10, box!.y + 10);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await expect(page.locator('[role="dialog"]')).toHaveCount(2);
    await page.mouse.up();

    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(page.locator('[role="columnheader"]:has-text("數字")')).toHaveCount(1);

    // 重整之後還在（＝真的寫進後端了）
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await expect(page.locator('[role="columnheader"]:has-text("數字")')).toHaveCount(1);
  });

  /** BUG-6：多行文字儲存格按 Enter 只會塞 \n，編輯器不關、存下來的值多一個換行 */
  test('文字儲存格：Enter 送出並關閉編輯器（Shift+Enter 才換行）', async ({ page }) => {
    await newInlineDatabase(page, '文字儲存格回歸');

    // 先加一個文字欄位
    await openPropertyTypeMenu(page);
    await page.locator('[aria-label="屬性類型"] [role="menuitem"]:has-text("文字")').first().click();
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await page.locator('button:has-text("新頁面")').first().click();
    await page.waitForTimeout(1200);

    const heads = await page.locator('[role="columnheader"]').allTextContents();
    const col = heads.findIndex((h) => h.includes('文字'));
    expect(col).toBeGreaterThan(-1);

    const cell = page.locator(`[role="gridcell"][data-row="0"][data-col="${col}"]`).first();
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await expect(cell.locator('textarea')).toBeVisible();
    await page.keyboard.type('hello');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);

    // Enter 之後編輯器要關掉
    await expect(cell.locator('textarea')).toHaveCount(0);
    // 而且值不可以多一個換行
    await expect(cell).toHaveText('hello');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await expect(
      page.locator(`[role="gridcell"][data-row="0"][data-col="${col}"]`).first(),
    ).toHaveText('hello');
  });
});
