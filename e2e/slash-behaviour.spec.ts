/**
 * `/` 選單的**行為**驗收：每一個會產生 block 的項目，選下去之後
 * 頁面上真的出現對應型別的 block（而不是只有選單好看）。
 *
 * ```bash
 * cd e2e
 * BASE_URL=http://localhost:5174 STUB_TX=1 npx playwright test slash-behaviour.spec.ts
 * ```
 * （`STUB_TX=1` 見 slash-menu.spec.ts 的說明：截圖用的後端還沒套 migration 0040）
 */
import { expect, test, type Page } from '@playwright/test';

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
  const guest = page.getByRole('button', { name: /不輸入|直接進入|訪客/ }).first();
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.waitForTimeout(2500);
  }
}

async function newPage(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '新增頁面' }).first().click({ timeout: 20_000 });
  await page.waitForTimeout(2500);
}

async function pick(page: Page, query: string): Promise<string[]> {
  const blocks = page.locator('[data-block-content]');
  const count = await blocks.count();
  if (count > 0) await blocks.nth(count - 1).click();
  await page.keyboard.press('End');
  await page.keyboard.type(`/${query}`, { delay: 45 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-block-type]')].map((el) => el.getAttribute('data-block-type') ?? ''),
  );
}

/** [搜尋字串, 預期出現的 block type] */
const CASES: [query: string, type: string][] = [
  ['標題 1', 'heading1'],
  ['標題 2', 'heading2'],
  ['標題 3', 'heading3'],
  ['標題 4', 'heading4'],
  ['項目符號列表', 'bulletedList'],
  ['編號列表', 'numberedList'],
  ['待辦清單', 'todo'],
  ['摺疊列表', 'toggle'],
  ['引用', 'quote'],
  ['標註', 'callout'],
  ['分隔線', 'divider'],
  ['程式碼', 'code'],
  ['Mermaid', 'code'],
  ['表格', 'table'],
  ['圖片', 'image'],
  ['影片', 'video'],
  ['音訊', 'audio'],
  ['檔案', 'file'],
  ['PDF', 'pdf'],
  ['網頁書籤', 'bookmark'],
  ['嵌入', 'embed'],
  ['Figma', 'embed'],
  ['Google Drive', 'embed'],
  ['目錄', 'tableOfContents'],
  ['方程式區塊', 'equation'],
  ['按鈕', 'button'],
  ['頁面路徑', 'breadcrumb'],
  ['同步區塊', 'syncedBlock'],
  ['2 欄', 'columnList'],
  ['3 欄', 'columnList'],
  ['5 欄', 'columnList'],
  ['摺疊標題 1', 'heading1'],
];

test.describe('斜線選單：每一項都真的做事', () => {
  /**
   * 刻意把 40 個案例塞進**同一個** test：登入與建頁是最慢的步驟（打的是遠端伺服器），
   * 每個案例各做一次的話整份要跑好幾個小時。同一頁連續插入也更接近真實使用。
   */
  test('每一個項目選下去都會產生對應的 block', async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(page);
    await newPage(page);

    const failures: string[] = [];
    for (const [query, type] of CASES) {
      const types = await pick(page, query);
      if (!types.includes(type)) failures.push(`/${query} 應該產生 ${type}，實際得到：${types.join(', ')}`);
      // 換一個乾淨的段落，避免上一個 block 干擾下一個案例
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
    }
    expect(failures, failures.join(' ｜ ')).toEqual([]);
  });

  test('結構與互動細節', async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(page);
    await newPage(page);

    /* 摺疊標題 2 → 可收合的標題 */
    await pick(page, '摺疊標題 2');
    await expect(page.locator('.kn-heading-toggle')).toHaveCount(1);
    await page.keyboard.press('Enter');

    /* 5 欄 → 5 個 column */
    await pick(page, '5 欄');
    await expect(page.locator('[data-block-type="column"]')).toHaveCount(5);

    /* 表格 → 預設 3 列 */
    await newPage(page);
    await pick(page, '表格');
    await expect(page.locator('[data-block-type="tableRow"]')).toHaveCount(3);

    /* 顏色 / 背景色 */
    await newPage(page);
    const blocks = page.locator('[data-block-content]');
    await blocks.last().click();
    await page.keyboard.type('上色測試', { delay: 25 });
    await page.keyboard.type('/紅色文字', { delay: 40 });
    await page.waitForTimeout(450);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-color="red"]')).toHaveCount(1);

    await page.keyboard.press('End');
    await page.keyboard.type('/黃色背景', { delay: 40 });
    await page.waitForTimeout(450);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-color="yellow_background"]')).toHaveCount(1);

    /* 「轉換成」只在有內容時出現 */
    await newPage(page);
    await blocks.last().click();
    await page.keyboard.type('/標題', { delay: 40 });
    await page.waitForTimeout(420);
    const emptyGroups = await page.locator('.kn-slash-item-group').count();
    await page.keyboard.press('Escape');
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Backspace');
    await page.keyboard.type('一些內容', { delay: 25 });
    await page.keyboard.type('/標題', { delay: 40 });
    await page.waitForTimeout(420);
    expect(await page.locator('.kn-slash-item-group').count()).toBeGreaterThan(emptyGroups);
    await page.keyboard.press('Escape');

    /* 沒有結果 → 再打兩個字自動關閉 */
    await newPage(page);
    await blocks.last().click();
    await page.keyboard.type('/zz', { delay: 45 });
    await page.waitForTimeout(400);
    await expect(page.locator('.kn-menu-empty')).toHaveText('沒有結果');
    await page.keyboard.type('qq', { delay: 55 });
    await page.waitForTimeout(500);
    await expect(page.locator('.kn-popover--slash')).toHaveCount(0);

    /* 鍵盤導覽 */
    await newPage(page);
    await blocks.last().click();
    await page.keyboard.type('/標題', { delay: 40 });
    await page.waitForTimeout(420);
    const third = await page.locator('.kn-slash-item').nth(2).textContent();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    expect(await page.locator('.kn-slash-item[data-active="true"]').textContent()).toBe(third);
  });
});
