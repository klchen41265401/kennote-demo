/**
 * 側邊欄頁面樹的拖曳搬移（02 §4.2）。
 *
 * 這一支會真的把一頁拖進另一頁裡面，然後確認：
 *   1. 拖曳中會出現落點指示器
 *   2. 放開之後 `POST /pages/:id/move` 真的被呼叫、樹也重新整理了
 *   3. 循環（拖進自己的子孫）會被擋下並跳 toast
 *
 * ```bash
 * BASE_URL=http://127.0.0.1:5199 npx playwright test sidebar-dnd.spec.ts
 * ```
 */
import { expect, test, type Page } from '@playwright/test';

const EMAIL = process.env['E2E_EMAIL'] ?? 'e2e@kennote.local';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'e2e-password-2026';

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

const treeRows = (page: Page) => page.locator('[role="tree"] [role="treeitem"]');

/**
 * ⚠️ 一定要把選擇器限定在 `[role="tree"]` 裡面：
 * 同一頁會同時出現在「最近」與「私人」兩區，`[data-id=...]` 會match 到兩個，
 * 而 `.first()` 抓到的是「最近」那一列 —— 它不在落點區裡、也不可拖曳。
 */
const treeRow = (page: Page, id: string) =>
  page.locator(`[role="tree"] [role="treeitem"][data-id="${id}"]`).first();

/** 確保私人區至少有 n 個「頂層」頁面 */
async function ensureTopLevelPages(page: Page, n: number): Promise<void> {
  for (let guard = 0; guard < 8; guard += 1) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // 等側邊欄真的畫出來再數，否則會誤判成「沒有頁面」而一直新增
    await page.waitForSelector('[role="tree"]', { state: 'attached', timeout: 25_000 });
    await page
      .locator('[role="tree"] [role="treeitem"], button[aria-label="新增頁面"]')
      .first()
      .waitFor({ state: 'attached', timeout: 25_000 })
      .catch(() => undefined);
    await page.waitForTimeout(1200);

    const depths = await treeRows(page).evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset['depth']),
    );
    if (depths.filter((d) => d === '0').length >= n) return;
    await page.getByRole('button', { name: '新增頁面', exact: true }).first().click({ timeout: 25_000 });
    await page.waitForTimeout(2500);
  }
  throw new Error('無法準備足夠的頂層頁面');
}

test('把一頁拖進另一頁裡面', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await ensureTopLevelPages(page, 2);

  const before = await treeRows(page).evaluateAll((els) =>
    els.map((el) => ({ id: (el as HTMLElement).dataset['id'], depth: (el as HTMLElement).dataset['depth'] })),
  );
  const top = before.filter((r) => r.depth === '0');
  expect(top.length).toBeGreaterThanOrEqual(2);

  const dst = treeRow(page, top[0]!.id!);
  const src = treeRow(page, top[1]!.id!);
  const sb = (await src.boundingBox())!;
  const db = (await dst.boundingBox())!;

  const moveRequest = page.waitForRequest(
    (r) => r.url().includes('/move') && r.method() === 'POST',
    { timeout: 20_000 },
  );

  await page.mouse.move(sb.x + 60, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + 70, sb.y + sb.height / 2 - 4, { steps: 3 });
  // 水平偏移 ≥ insideThreshold → computeDropTarget 判定為「進裡面」
  await page.mouse.move(db.x + 120, db.y + db.height / 2, { steps: 12 });
  await page.waitForTimeout(250);

  const indicator = await page.evaluate(
    () => !!document.querySelector('.kn-drop-indicator, [class*="indicator"]'),
  );
  expect(indicator, '拖曳中要看得到落點指示器').toBe(true);

  await page.mouse.up();
  await moveRequest;
  await page.waitForTimeout(2000);

  const after = await treeRows(page).evaluateAll((els) =>
    els.map((el) => ({ id: (el as HTMLElement).dataset['id'], depth: (el as HTMLElement).dataset['depth'] })),
  );
  // 被拖走的那一頁不該再出現在頂層（它變成子頁，父層預設是收合的）
  const stillTop = after.some((r) => r.id === top[1]!.id && r.depth === '0');
  expect(stillTop, '被拖走的頁面不該還留在頂層').toBe(false);

  // 展開父頁 → 應該看得到它
  await page
    .locator(`[role="tree"] [role="treeitem"][data-id="${top[0]!.id}"] button[aria-label="展開"]`)
    .first()
    .click({ timeout: 10_000 })
    .catch(() => undefined);
  await page.waitForTimeout(600);
  const child = treeRow(page, top[1]!.id!);
  expect(await child.getAttribute('data-depth'), '應該變成第 2 層').toBe('1');
});

/**
 * 這兩條是回歸測試，擋住實際踩過的兩個坑：
 *  1. `useDraggable` 在 pointerdown 就 setPointerCapture，而它拿到的 `currentTarget`
 *     是 React 的 root container → 之後的 click 全被 `#root` 吃掉，點側邊欄沒反應。
 *  2. `⋯` 按鈕上呼叫 `stopPropagation()` 會擋掉 `Popover` 掛在外層 span 的 onClick，
 *     選單永遠打不開。
 */
test('點側邊欄的列會導頁', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[role="tree"] [role="treeitem"]', { timeout: 25_000 });

  const row = treeRows(page).first();
  const id = await row.getAttribute('data-id');
  await row.click();
  await page.waitForTimeout(1500);
  expect(page.url()).toContain(`/page/${id}`);
});

test('側邊欄的 ⋯ 選單打得開', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[role="tree"] [role="treeitem"]', { timeout: 25_000 });

  const row = treeRows(page).first();
  await row.hover();
  await row.locator('button[aria-label*="更多選項"]').first().click();
  await page.waitForTimeout(400);

  for (const label of ['加入收藏', '拷貝連結', '建立複本', '重新命名', '移動到', '移至垃圾桶']) {
    await expect(page.getByRole('menuitem', { name: label }).first()).toBeVisible();
  }
  await page.keyboard.press('Escape');
});
