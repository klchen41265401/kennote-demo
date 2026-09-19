/**
 * 功能 QA 第四輪的回歸測試（編輯器）。
 *
 * 每一條對應 `docs/qa/functional-round4.md` 裡的一個已修 bug 或一項走查結論。
 *
 * ```bash
 * # 本機 vite（VITE_PROXY_TARGET 指到遠端）：
 * BASE_URL=http://127.0.0.1:5303 npx playwright test functional-round4.spec.ts
 * ```
 *
 * 全部都是**前端**修正，deploy 前端就會在遠端生效（沒有後端那一半）。
 */
import { expect, test, type Page } from '@playwright/test';

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
          h instanceof Headers
            ? h.get('authorization')
            : (h?.['authorization'] ?? h?.['Authorization']);
        if (auth?.startsWith('Bearer ')) {
          (window as unknown as { __tok?: string }).__tok = auth.slice(7);
        }
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

async function newPage(page: Page, title: string): Promise<{ id: string }> {
  let ws: { id: string } | undefined;
  for (let i = 0; i < 10 && !ws; i++) {
    ws = (await api<Array<{ id: string }>>(page, 'GET', '/api/workspaces')).data?.[0];
    if (!ws) await page.waitForTimeout(1000);
  }
  expect(ws, '工作區（token 抄到了嗎）').toBeTruthy();
  const res = await api<{ id: string }>(page, 'POST', '/api/pages', {
    workspaceId: ws!.id,
    title: [{ type: 'text', text: title }],
  });
  expect(res.status).toBe(201);
  return res.data;
}

async function openPage(page: Page, id: string): Promise<void> {
  await page.goto(`/page/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
}

/** 最後一個最上層 block 的 id（table 這種沒有可編輯內容的也算） */
async function lastTopBlockId(page: Page): Promise<string | null> {
  return page.evaluate((host) => {
    const root = document.querySelector(host);
    if (!root) return null;
    const tops = [...root.querySelectorAll('[data-block-id]')].filter(
      (e) => !e.parentElement?.closest('[data-block-id]'),
    );
    return tops.at(-1)?.getAttribute('data-block-id') ?? null;
  }, HOST);
}

/**
 * 在文件尾端弄出一個空段落，游標放進去。
 *
 * ⚠️ 刻意走 gutter 的「插入區塊」而不是點最後一個 block：
 * 文件尾端沒有 Notion 那種「點空白處補一段」的落點（第四輪 §5 的缺口），
 * 最後一個 block 是 table / divider / image 時，`+` 是唯一的路。
 */
async function caretAtFreshTail(page: Page): Promise<void> {
  const id = await lastTopBlockId(page);
  expect(id, '文件裡至少要有一個 block').toBeTruthy();
  const el = page.locator(`[data-block-id="${id}"]`).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await el.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + Math.min(40, box!.width / 2), box!.y + Math.min(12, box!.height / 2));
  await page.waitForTimeout(250);
  const plus = page.locator('[aria-label="插入區塊"]').first();
  await expect(plus).toBeVisible();
  await plus.click();
  await page.waitForTimeout(400);
}

/** `type :: 文字` 的扁平快照，含巢狀縮排 */
function blockDump(page: Page): Promise<string[]> {
  return page.evaluate((host) => {
    const root = document.querySelector(host);
    if (!root) return [];
    return [...root.querySelectorAll('[data-block-id]')].map((e) => {
      const depth = e.parentElement?.closest('[data-block-id]') ? 1 : 0;
      return (
        '  '.repeat(depth) +
        e.getAttribute('data-block-type') +
        ' :: ' +
        (e as HTMLElement).innerText.slice(0, 30).replace(/\n/g, '⏎')
      );
    });
  }, HOST);
}

test.describe('功能 QA 第四輪回歸（編輯器）', () => {
  test.beforeEach(async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForTimeout(600);
  });

  /**
   * BUG-13：`@` 選單的「今天 / 明天」用 `toISOString()` 取日期 —— 那是 **UTC**。
   * 台北是 UTC+8，每天早上 08:00 以前「今天」都會被算成昨天。
   */
  test('BUG-13 @ 選單的「今天」用本地時區，不是 UTC', async ({ page }) => {
    const p = await newPage(page, 'R4-date-' + Date.now());
    await openPage(page, p.id);
    await caretAtFreshTail(page);
    await page.keyboard.type('@');
    await page.waitForTimeout(900);

    const labels = await page.locator('[role="option"]').allInnerTexts();
    const today = labels.find((t) => t.includes('今天'));
    expect(today, '@ 選單有「今天」').toBeTruthy();

    // 瀏覽器（locale zh-TW / timezone Asia/Taipei）此刻的本地日期
    const localToday = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    expect(today!.replace(/\s/g, ''), '「今天」應該是本地日期').toContain(localToday);
  });

  /**
   * BUG-15：`MentionMenu` 把 atom 的 `text` 存成 `@名字`，
   * 而 editor-core 的 `defaultAtomText()` 對 mention **也會**補一個 `@`，
   * 於是畫面上變成「@@訪客」。
   */
  test('BUG-15 插入 @ 提及只會有一個 @', async ({ page }) => {
    const p = await newPage(page, 'R4-at-' + Date.now());
    await openPage(page, p.id);
    await caretAtFreshTail(page);
    await page.keyboard.type('@');
    await page.waitForTimeout(900);

    const person = page.locator('[role="option"]').filter({ hasText: /訪客/ }).first();
    await expect(person).toBeVisible();
    await person.click();
    await page.waitForTimeout(1200);

    const chip = page.locator(`${HOST} [data-atom="mention"]`).last();
    await expect(chip).toBeVisible();
    await expect(chip, 'mention chip 不應該有兩個 @').toHaveText(/^@[^@]/);
    // 觸發用的那個 `@` 也要被吃掉
    const text = await page.locator(`${HOST} [data-block-id]`).last().innerText();
    expect(text.replace(/\s/g, '')).not.toContain('@@');
  });

  /**
   * BUG-16：`@` 以前只在「行首或空白後」才開選單（editor-core 的 triggers.ts），
   * 「談談@」這種緊接在文字後面的 `@` 完全叫不出來。Notion 是任何位置都開。
   */
  test('BUG-16 @ 緊接在文字後面也要叫得出選單', async ({ page }) => {
    const p = await newPage(page, 'R4-at2-' + Date.now());
    await openPage(page, p.id);
    await caretAtFreshTail(page);
    await page.keyboard.type('請教一下');
    await page.waitForTimeout(400);
    await page.keyboard.type('@');
    await page.waitForTimeout(1000);
    await expect(page.locator('[role="option"]').first(), '文字後的 @ 也要開選單').toBeVisible();

    // query 裡有空白也不該被關掉（人員名字會有空格）
    await page.keyboard.type('訪 ');
    await page.waitForTimeout(800);
    const listbox = page.locator('[role="listbox"]');
    await expect(listbox, 'query 有空白時選單仍然開著').toBeVisible();
  });

  /**
   * BUG-14：拖放落點以前只用 X 判斷「開新欄」，
   * 指標貼在 block 的上下邊界（使用者明明是要換順序）也會被吃成 column-left/right。
   * 修正後：左右邊緣帶還要**同時**落在 block 的垂直中間帶才算開欄。
   */
  test('BUG-14 拖曳到區塊上緣是換順序，不是開新欄', async ({ page }) => {
    const p = await newPage(page, 'R4-drag-' + Date.now());
    await openPage(page, p.id);
    await caretAtFreshTail(page);
    await page.keyboard.type('甲');
    await page.keyboard.press('Enter');
    await page.keyboard.type('乙');
    await page.waitForTimeout(1200);

    const tops = await page.evaluate((host) =>
      [...document.querySelectorAll(`${host} [data-block-id]`)]
        .filter((e) => !e.parentElement?.closest('[data-block-id]'))
        .map((e) => [e.getAttribute('data-block-id'), (e as HTMLElement).innerText.replace(/\n/g, '')]),
      HOST,
    );
    const yi = tops.find((x) => x[1] === '乙');
    const jia = tops.find((x) => x[1] === '甲');
    expect(yi && jia, '甲乙兩個段落都在').toBeTruthy();

    const yb = (await page.locator(`[data-block-id="${yi![0]}"]`).first().boundingBox())!;
    const jb = (await page.locator(`[data-block-id="${jia![0]}"]`).first().boundingBox())!;
    await page.mouse.move(yb.x + 30, yb.y + yb.height / 2);
    await page.waitForTimeout(400);
    const gb = (await page.locator('[aria-label="區塊操作"]').first().boundingBox())!;
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.mouse.down();
    // 落在「甲」的**上緣**、而且 X 偏左（以前這一發會變成 column-left）
    await page.mouse.move(jb.x + 100, jb.y + 6, { steps: 10 });
    await page.mouse.move(jb.x + 100, jb.y + 1, { steps: 8 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(1500);

    const dump = await blockDump(page);
    expect(dump.join('\n'), '不應該生出多欄版面').not.toContain('columnList');
    const order = dump.filter((l) => l.includes('甲') || l.includes('乙'));
    expect(order[0], '乙被拖到甲的上面').toContain('乙');
  });

  /**
   * 走查結論：`/` 選單各分組插入的 block 重整後都還在。
   * （第四輪只把「重整後仍在」做成回歸，插入本身在報告的走查表裡。）
   */
  test('slash 選單插入的各類 block 重整後都還在', async ({ page }) => {
    const p = await newPage(page, 'R4-slash-' + Date.now());
    await openPage(page, p.id);

    const cases: Array<[string, RegExp]> = [
      ['標題 1', /標題 1/],
      ['待辦', /待辦/],
      ['表格', /表格/],
      ['圖片', /圖片/],
      ['程式碼', /程式碼/],
      ['目錄', /目錄/],
    ];
    for (const [q, re] of cases) {
      await caretAtFreshTail(page);
      await page.keyboard.type('/');
      await page.waitForTimeout(450);
      await page.keyboard.type(q, { delay: 25 });
      await page.waitForTimeout(700);
      const opt = page.locator('[role="option"]').filter({ hasText: re }).first();
      await expect(opt, `slash 搜得到「${q}」`).toBeVisible();
      await opt.click();
      await page.waitForTimeout(900);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }

    const before = await blockDump(page);
    await page.waitForTimeout(3500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const after = await blockDump(page);
    expect(after, '重整前後的 block 結構一致').toEqual(before);
    const types = after.join(',');
    for (const t of ['heading1', 'todo', 'table', 'image', 'code', 'tableOfContents']) {
      expect(types, `${t} 重整後還在`).toContain(t);
    }
  });

  /** 走查結論：貼上 markdown / Notion HTML 會變成對應的 block 型別 */
  test('貼上 markdown 與 Notion HTML 會轉成對應 block', async ({ page }) => {
    const p = await newPage(page, 'R4-paste-' + Date.now());
    await openPage(page, p.id);

    const MD = '# 標題一\n一般段落\n\n- 項目 A\n\n1. 第一\n\n> 引用一句\n\n```ts\nconst n = 1;\n```\n';
    const NOTION_HTML =
      `<meta charset="utf-8"><h2>小節標題</h2>` +
      `<ul class="bulleted-list"><li style="list-style-type:disc">項目一</li></ul>` +
      `<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div><span>已完成</span></li></ul>` +
      `<pre class="code"><code class="language-TypeScript">const x = 1;</code></pre>` +
      `<p>一般段落含<strong>粗體</strong>。</p>`;

    const firePaste = async (data: Record<string, string>): Promise<void> => {
      await page.evaluate((d) => {
        const dt = new DataTransfer();
        for (const [k, v] of Object.entries(d)) dt.setData(k, v as string);
        (document.activeElement ?? document.body).dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
      }, data);
      await page.waitForTimeout(1000);
    };

    await caretAtFreshTail(page);
    await firePaste({ 'text/plain': MD });
    await caretAtFreshTail(page);
    await firePaste({ 'text/html': NOTION_HTML, 'text/plain': '小節標題' });

    const dump = (await blockDump(page)).join('\n');
    for (const t of ['heading1', 'bulletedList', 'numberedList', 'quote', 'code', 'heading2', 'todo']) {
      expect(dump, `貼上後有 ${t}`).toContain(t);
    }

    await page.waitForTimeout(3000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    expect((await blockDump(page)).join('\n'), '重整後還在').toContain('heading2');
  });

  /** 走查結論：Escape 進 block selection，Shift+方向鍵擴選，Backspace 批次刪除 */
  test('Escape 進區塊選取 → Shift+方向鍵擴選 → Backspace 批次刪除', async ({ page }) => {
    const p = await newPage(page, 'R4-sel-' + Date.now());
    await openPage(page, p.id);
    await caretAtFreshTail(page);
    await page.keyboard.type('一');
    await page.keyboard.press('Enter');
    await page.keyboard.type('二');
    await page.keyboard.press('Enter');
    await page.keyboard.type('三');
    await page.waitForTimeout(1200);

    const selected = (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-selected="true"]')].map((e) =>
          (e as HTMLElement).innerText.replace(/\n/g, ''),
        ),
      );

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    expect(await selected(), 'Escape 之後選中游標所在的 block').toEqual(['三']);

    await page.keyboard.press('Shift+ArrowUp');
    await page.waitForTimeout(400);
    expect((await selected()).length, 'Shift+↑ 要擴選到兩塊').toBeGreaterThan(1);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(900);
    const dump = (await blockDump(page)).join('\n');
    expect(dump, '「三」被批次刪掉').not.toContain(':: 三');
    expect(dump, '「二」被批次刪掉').not.toContain(':: 二');
    expect(dump, '「一」還在').toContain(':: 一');
  });

  /**
   * BUG-18（editor-core 那一半**已修**）：跨 block 的 redo 會把內容再吃掉一段。
   *
   * 根因有兩層，這一條測的是**第一層之後仍然卡住的第二層**：
   *
   *   1. editor-core（已修，見 `docs/adr/0006-ot.md` §2.10）：
   *      history entry 的 op 分流。`contentDeltas()` 只要批次裡有結構 op 就整批放棄 delta，
   *      `historyOps()` 又只從 delta 生 `block.update` 會把 `block.insert` 丟掉。
   *      單元回歸：`packages/editor-core/test/history/cross-block-redo.test.ts`（18 條）。
   *      **實測**：按下 Ctrl+Shift+Z 的當下，編輯器自己的文件是完全正確的
   *      —— 見下面那一條「redo 當下編輯器的狀態是正確的」。
   *   2. **伺服器（未修，不在 editor-core）**：`block.delete` 是 soft delete
   *      （`blocks.deleted_at`），而 `block.insert` 用 `findBlock()` 判斷重複時帶了
   *      `deleted_at IS NULL`，所以「undo 刪掉的 block、redo 再插回來」會撞主鍵：
   *
   *      ```
   *      POST /api/pages/:id/transactions  block.insert  → 200
   *      POST /api/pages/:id/transactions  block.delete  → 200
   *      POST /api/pages/:id/transactions  block.insert（同一個 id）→ 500 INTERNAL_ERROR
   *      ```
   *
   *      前端收到 `txRejected` 之後 `useEditorHost` 會 `reload()`，
   *      而 reload 是用「快取裡那份舊 snapshot」重建編輯器 → 畫面上整段內容消失。
   *      修法：`apps/server/.../apply-transaction.ts` 的 `block.insert` 要能
   *      **復活** soft-deleted 的 block（`ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, …`）。
   *
   * 伺服器那一半修好之後，把 `test.fixme` 拿掉它就會是綠的。
   */
  test.fixme('BUG-18 Ctrl+Z / Ctrl+Shift+Z 跨 block 可以來回還原', async ({ page }) => {
    const p = await newPage(page, 'R4-undo-' + Date.now());
    await openPage(page, p.id);
    await caretAtFreshTail(page);
    await page.keyboard.type('第一段');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await page.keyboard.type('第二段');
    await page.waitForTimeout(2000);
    const typed = await blockDump(page);
    expect(typed.join('\n')).toContain('第二段');

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    expect((await blockDump(page)).join('\n'), 'undo 兩次後「第二段」不見了').not.toContain('第二段');

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(1200);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(1200);
    expect(await blockDump(page), 'redo 兩次要回到原狀').toEqual(typed);
  });

  /**
   * BUG-18 的 editor-core 那一半（**已修**，這一條是綠的）。
   *
   * 與上面那條唯一的差別：在**伺服器把 redo 的 `block.insert` 退件之前**就檢查文件。
   * 這一段時間窗裡看到的就是 editor-core 自己算出來的結果 ——
   * 修好之前這裡會少掉「Enter 拆出來的那個 block」、內容還會被多吃一段。
   */
  test('BUG-18 redo 當下編輯器的狀態是正確的（跨 block，含結構 op）', async ({ page }) => {
    const p = await newPage(page, 'R4-undo-core-' + Date.now());
    await openPage(page, p.id);
    await caretAtFreshTail(page);
    await page.keyboard.type('第一段');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await page.keyboard.type('第二段');
    await page.waitForTimeout(2000);
    const typed = await blockDump(page);
    expect(typed.join('\n')).toContain('第二段');

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    const afterUndo1 = await blockDump(page);
    expect(afterUndo1.join('\n'), 'undo 一次：只還原「第二段」的字').not.toContain('第二段');
    expect(afterUndo1, 'undo 一次不該動到 block 數量').toHaveLength(typed.length);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    expect(await blockDump(page), 'undo 兩次：Enter 拆出來的 block 被收回去').toEqual(
      typed.slice(0, typed.length - 1),
    );

    // ⚠️ 這裡刻意**不等**：等超過一個 WS round-trip，伺服器退件造成的 reload 會把畫面洗掉
    await page.keyboard.press('Control+Shift+z');
    expect(await blockDump(page), 'redo 一次要把 Enter 拆出來的 block 建回來，內容不能被多吃').toEqual(
      afterUndo1,
    );
    await page.keyboard.press('Control+Shift+z');
    expect(await blockDump(page), 'redo 兩次要回到原狀').toEqual(typed);
  });
});
