/**
 * 功能 QA 第一輪的回歸測試。
 *
 * 每一條都對應 `docs/qa/functional-round1.md` 裡的一個已修 bug，
 * 修法一旦被改壞，這裡就會紅。
 *
 * ```bash
 * BASE_URL=http://127.0.0.1:5199 npx playwright test functional-round1.spec.ts
 * ```
 */
import { expect, test, type Page } from '@playwright/test';

const EMAIL = process.env['E2E_EMAIL'] ?? 'e2e@kennote.local';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'e2e-password-2026';
const TITLE = '[aria-label="頁面標題"]';
const HOST = '.kn-editor-host';

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

/** 建一頁新的頂層頁面並停在它上面。 */
async function newPage(page: Page, title: string): Promise<void> {
  await page.locator('nav button[aria-label="新增頁面"]').first().click();
  await page.waitForURL(/\/page\//, { timeout: 20_000 });
  await expect(page.locator(HOST).first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.locator(TITLE).first().click();
  await page.keyboard.type(title);
  await page.waitForTimeout(600);
}

const privateTree = (page: Page) => page.locator('[role="tree"][aria-label="私人頁面"]');
const rowByName = (page: Page, name: string) =>
  privateTree(page)
    .locator(`[role="treeitem"]:has(span:text-is("${name}"))`)
    .first();

test.describe('功能 QA 第一輪回歸', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await expect(page).not.toHaveURL(/\/login/);
  });

  /**
   * BUG-1：`<Menu>` 是 TreeRow 的 React 子節點（portal 出去了，但 React 事件照樣冒泡），
   * 於是選單項目上的 pointerdown 會觸發這一列的 `useDraggable` → `setPointerCapture()`
   * → 選單項目收不到 click，整組列選單（重新命名 / 收藏 / 複本 / 移動到 / 垃圾桶）全部失效。
   */
  test('側邊欄列選單的項目真的會被執行（重新命名）', async ({ page }) => {
    const name = `QA選單${Date.now()}`;
    await newPage(page, name);
    await expect(rowByName(page, name)).toBeVisible();

    const row = rowByName(page, name);
    await row.hover();
    await row.locator('button[aria-label*="更多選項"]').click();
    await page.getByRole('menuitem', { name: '重新命名' }).click();

    // 選單項目有被執行 → 列上出現輸入框（而不是「點了沒反應、反而跳頁」）
    const input = privateTree(page).locator('input');
    await expect(input.first()).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Control+a');
    await page.keyboard.type(`${name}已改名`);
    await page.keyboard.press('Enter');
    await expect(rowByName(page, `${name}已改名`)).toBeVisible({ timeout: 10_000 });
  });

  /**
   * BUG-2：`useEditorHost` 的 useLayoutEffect 依賴陣列裡放了 `snapshot?.seq`。
   * 改標題會 `invalidateQueries(snapshot)` → seq 一變 effect 整段重跑 →
   * 用快取裡那份**舊 doc** 重建 editor → 剛打的內文整段被清空。
   */
  test('改完標題之後內文不會被清空', async ({ page }) => {
    const name = `QA內文${Date.now()}`;
    await newPage(page, name); // newPage 本身就會編輯標題
    const body = `內文保留測試 ${Date.now()}`;

    await page.locator(`${HOST} [data-block-id]`).first().click();
    await page.keyboard.type(body);
    await expect(page.locator(HOST)).toContainText(body);

    // 標題的 PATCH（500ms debounce）＋ snapshot revalidate 都跑完之後再看一次
    await page.waitForTimeout(4000);
    await expect(page.locator(HOST)).toContainText(body);

    // 重整之後也還在（確認真的有存到後端，而不是只留在畫面上）
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(HOST)).toContainText(body, { timeout: 20_000 });
  });

  /**
   * BUG-3：`duplicatePage` 依 `sort_key` 排序插入頁面，子頁的 sort_key 常常排在父頁前面，
   * 撞上 `pages.parent_id` 的自參照外鍵 → 整個交易回滾 → `POST /pages/:id/duplicate` 回 500。
   */
  test('有子頁的頁面可以建立複本', async ({ page }) => {
    const parent = `QA複本${Date.now()}`;
    await newPage(page, parent);
    await expect(rowByName(page, parent)).toBeVisible();

    const row = rowByName(page, parent);
    await row.hover();
    await row.locator('button[aria-label*="底下新增頁面"]').click();
    await page.waitForTimeout(2500);
    await page.locator(TITLE).first().click();
    await page.keyboard.type('QA子頁');
    await page.waitForTimeout(1200);

    const duplicate = page.waitForResponse(
      (r) => r.url().includes('/duplicate') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    const parentRow = rowByName(page, parent);
    await parentRow.hover();
    await parentRow.locator('button[aria-label*="更多選項"]').click();
    await page.getByRole('menuitem', { name: '建立複本' }).click();
    expect((await duplicate).status()).toBe(201);
  });
});
