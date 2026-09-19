/**
 * kennote ↔ Notion **逐個 block / 逐個資料庫視圖**的像素比對。
 *
 * 與 `screenshots.spec.ts` 的差別：那支拍的是側邊欄裡第一個頁面（空的），
 * 所以 21 種 block 與 6 種資料庫視圖從來沒被比對到。這支先用 API
 * （`fixtures/reference-page.ts`）把「參考頁」建出來，再對著它拍
 * 與 `reference/notion-capture/INDEX.md` **同代號**的截圖。
 *
 * ```bash
 * cd e2e
 * npm i -D @playwright/test && npx playwright install chromium
 *
 * # 打遠端正式站
 * BASE_URL=http://100.74.148.92:8090 npx playwright test compare
 *
 * # 改 CSS 時打本機 dev server（vite proxy 到遠端 API，有 HMR）
 * cd ../apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 node node_modules/vite/bin/vite.js --port 5173
 * cd ../../e2e && BASE_URL=http://localhost:5173 npx playwright test compare
 *
 * # 只重建資料 / 只重拍 light / 只重產並排圖
 * npx playwright test compare --grep "建立參考頁"
 * npx playwright test compare --grep "拍照（light）"
 * npx playwright test compare --grep "並排"
 * ```
 *
 * 產物：
 *   reference/shots/kennote/<代號>-<theme>.png   kennote 這邊的截圖
 *   reference/shots/compare/<代號>-<theme>.png   左 Notion｜中 kennote｜右差異熱度圖
 *   reference/shots/compare/README.md            每張圖的量化差異（誠實清單）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { seedReferencePage, type SeedResult } from './fixtures/reference-page';
import { composeCompare, decodePng, diffStats, encodePng, type DiffStats } from './fixtures/png';

const EMAIL = process.env['E2E_EMAIL'] ?? 'e2e@kennote.local';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'e2e-password-2026';
const REF_DIR = resolve(process.cwd(), '../reference/notion-capture');
const SHOT_DIR = resolve(process.cwd(), process.env['SHOT_DIR'] ?? '../reference/shots/kennote');
const COMPARE_DIR = resolve(process.cwd(), '../reference/shots/compare');

type Theme = 'light' | 'dark';

mkdirSync(SHOT_DIR, { recursive: true });
mkdirSync(COMPARE_DIR, { recursive: true });

/** 兩支 test 之間共用（workers = 1，同一個檔案＝同一個 worker process） */
let seed: SeedResult | null = null;
const SEED_CACHE = resolve(SHOT_DIR, '_seed.json');

function loadSeed(): SeedResult {
  if (seed) return seed;
  if (existsSync(SEED_CACHE)) {
    seed = JSON.parse(readFileSync(SEED_CACHE, 'utf8')) as SeedResult;
    return seed;
  }
  throw new Error('還沒建參考頁：先跑 `npx playwright test compare --grep 建立參考頁`');
}

/* ── 截圖工具 ────────────────────────────────────────────── */

/** 讀 Notion 參考圖的尺寸（拍 kennote 時用同一個裁切尺寸，才能逐像素疊） */
function refSize(code: string, theme: Theme): { width: number; height: number } | null {
  for (const candidate of [`${code}-${theme}.png`, `${code}-light.png`]) {
    const path = resolve(REF_DIR, candidate);
    if (!existsSync(path)) continue;
    const buf = readFileSync(path);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return null;
}

/** 這一輪真的重拍過的檔名（README 只列這些，避免把舊的 screenshots.spec.ts 產物混進來） */
const FRESH = resolve(SHOT_DIR, '_fresh.json');
const freshSet = new Set<string>();
function markFresh(code: string, theme: Theme): void {
  freshSet.add(`${code}-${theme}.png`);
  writeFileSync(FRESH, JSON.stringify([...freshSet], null, 1));
}

async function shot(page: Page, code: string, theme: Theme): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(SHOT_DIR, `${code}-${theme}.png`) });
  markFresh(code, theme);
}

async function clip(
  page: Page,
  code: string,
  theme: Theme,
  box: { x: number; y: number; width: number; height: number },
): Promise<void> {
  await page.waitForTimeout(150);
  const x = Math.max(0, Math.min(Math.round(box.x), 1440 - Math.round(box.width)));
  const y = Math.max(0, Math.min(Math.round(box.y), 900 - Math.round(box.height)));
  await page.screenshot({
    path: resolve(SHOT_DIR, `${code}-${theme}.png`),
    clip: { x, y, width: Math.round(box.width), height: Math.round(box.height) },
  });
  markFresh(code, theme);
}

/** 把 block 捲到可視範圍的正中央（頁面不是 document 在捲，是 shell 的 content div） */
async function centerBlock(page: Page, target: Locator): Promise<void> {
  await target.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }));
  await page.waitForTimeout(200);
}

/**
 * 依 Notion 參考圖的尺寸，對 kennote 的同一個 block 做「等尺寸、等對齊」的裁切。
 *
 * Notion 那邊的裁切規則（從 05-01 反推）：x = 內容欄左緣 − 22、寬 = 內容欄寬 + 44，
 * 垂直方向大致把 block 置中。這裡照抄，只是內容欄左緣換成 kennote 自己的。
 */
async function clipBlock(
  page: Page,
  code: string,
  theme: Theme,
  target: Locator,
  opts: { padX?: number; padY?: number } = {},
): Promise<void> {
  const size = refSize(code, theme);
  if (!size) throw new Error(`找不到參考圖 ${code}`);
  await centerBlock(page, target);
  const box = await target.boundingBox();
  if (!box) throw new Error(`${code}: 抓不到 boundingBox`);
  // Notion 的裁切左緣 = 文字左緣 − 22；kennote 的 boundingBox 是 wrapper，
  // 文字還要再往內 2px（.kn-block-main 的 padding-left），所以這裡扣 20 才對齊。
  const padX = opts.padX ?? 20;
  await clip(page, code, theme, {
    x: box.x - padX,
    y: opts.padY !== undefined ? box.y - opts.padY : box.y + box.height / 2 - size.height / 2,
    width: size.width,
    height: size.height,
  });
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    localStorage.setItem('kennote:theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(250);
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  if (!page.url().includes('/login')) return;

  const email = page.locator('input[type="email"], input[name="email"]').first();
  if (await email.isVisible().catch(() => false)) {
    await email.fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(2200);
  }
  if (!page.url().includes('/login')) return;

  const guest = page.getByRole('button', { name: /不輸入|直接進入|訪客/ }).first();
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.waitForTimeout(2200);
  }
}

/** 捲到指定位置（shell 的 content div，不是 window） */
async function scrollTo(page: Page, top: number): Promise<void> {
  await page.evaluate((y) => {
    let best: Element | null = null;
    document.querySelectorAll('*').forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 300) {
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
    });
    (best ?? document.scrollingElement)?.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
  }, top);
  await page.waitForTimeout(350);
}

/** 等圖片與字體都載完，不然截圖會抓到半張圖 */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready;
    await Promise.all(
      [...document.images]
        .filter((img) => !img.complete)
        .map((img) => new Promise((r) => { img.onload = r; img.onerror = r; })),
    );
  });
  await page.waitForTimeout(400);
}

/* ── 每種 block 的代號 → 選擇器 ─────────────────────────── */

const BLOCKS: { code: string; selector: string; nth?: number; padX?: number }[] = [
  { code: '05-01-paragraph', selector: '.kn-block--paragraph', nth: 0 },
  { code: '05-02-heading1', selector: '.kn-block--heading1' },
  { code: '05-03-heading2', selector: '.kn-block--heading2' },
  { code: '05-04-heading3', selector: '.kn-block--heading3' },
  { code: '05-05-todo-unchecked', selector: '.kn-block--todo', nth: 0 },
  { code: '05-06-todo-checked', selector: '.kn-block--todo', nth: 1 },
  { code: '05-07-bulleted-list', selector: '.kn-block--bulletedList', nth: 0 },
  { code: '05-08-numbered-list', selector: '.kn-block--numberedList', nth: 0 },
  { code: '05-09-toggle', selector: '.kn-block--toggle' },
  { code: '05-10-quote', selector: '.kn-block--quote' },
  { code: '05-11-divider', selector: '.kn-block--divider' },
  { code: '05-12-callout', selector: '.kn-block--callout' },
  { code: '05-13-code', selector: '.kn-block--code' },
  { code: '05-14-table', selector: '.kn-block--table', padX: 240 },
  { code: '05-15-equation', selector: '.kn-block--equation' },
  { code: '05-16-toc', selector: '.kn-block--tableOfContents' },
  { code: '05-17-synced', selector: '.kn-block--syncedBlock' },
  { code: '05-18-columns', selector: '.kn-block--columnList' },
  { code: '05-19-subpage', selector: '.kn-block--page', padX: 22 },
  { code: '05-20-bookmark', selector: '.kn-block--bookmark' },
  { code: '05-21-image', selector: '.kn-block--image' },
];

const DB_VIEWS: { code: string; tab: RegExp }[] = [
  { code: '07-db-table', tab: /^表格$/ },
  { code: '07e-db-board', tab: /^看板$/ },
  { code: '07f-db-list', tab: /^清單$/ },
  { code: '07g-db-gallery', tab: /^圖庫$/ },
  { code: '07h-db-calendar', tab: /^日曆$/ },
  // 時程表：後端還沒有 'timeline' 視圖型別時 seed 會跳過，這裡 tab 找不到就不拍
  { code: '07i-db-timeline', tab: /^時程表$/ },
];

/* ── 1. 建資料 ───────────────────────────────────────────── */

test.describe.configure({ mode: 'serial' });

test('建立參考頁（含 21 種 block 與 5 種資料庫視圖）', async () => {
  test.setTimeout(120_000);
  seed = await seedReferencePage();
  writeFileSync(SEED_CACHE, JSON.stringify(seed, null, 2));
  expect(seed.pageId).toBeTruthy();
});

/* ── 2. 拍照 ─────────────────────────────────────────────── */

for (const theme of ['light', 'dark'] as Theme[]) {
  test(`拍照（${theme}）`, async ({ page }) => {
    test.setTimeout(300_000);
    const s = loadSeed();
    if (existsSync(FRESH)) {
      for (const name of JSON.parse(readFileSync(FRESH, 'utf8')) as string[]) freshSet.add(name);
    }

    await signIn(page);
    await setTheme(page, theme);
    await page.goto(`/page/${s.pageId}`, { waitUntil: 'domcontentloaded' });
    await setTheme(page, theme);
    await page.locator('.kn-editor .kn-block').first().waitFor({ timeout: 30_000 });
    await settle(page);

    /* 02-*：整頁四段捲動（滑鼠移開，才不會有 hover 殘影） */
    await page.mouse.move(1380, 860);
    for (const [code, top] of [
      ['02-page-top', 0],
      ['02b-page-mid', 900],
      ['02c-page-mid2', 1800],
      ['02d-page-bottom', 99_999],
    ] as [string, number][]) {
      await scrollTo(page, top);
      await settle(page);
      await shot(page, code, theme);
    }

    /* 04-*：頂欄 */
    await scrollTo(page, 0);
    await page.mouse.move(900, 400);
    await page.waitForTimeout(500);
    await clip(page, '04-topbar', theme, { x: 270, y: 0, width: 1170, height: 44 });
    await clip(page, '04b-topbar-right', theme, { x: 1050, y: 0, width: 390, height: 44 });
    await clip(page, '04d-page-cover-icon', theme, { x: 0, y: 0, width: 1440, height: 520 });

    /* 03e：側邊欄底部（驗「新對話」的 AI 星芒 icon） */
    await clip(page, '03e-sidebar-bottom', theme, { x: 0, y: 740, width: 270, height: 159 });

    /* 05-*：每種 block 一張 */
    for (const spec of BLOCKS) {
      const target = page.locator(spec.selector).nth(spec.nth ?? 0);
      if (!(await target.count())) {
        console.warn(`⚠ 找不到 ${spec.code}（${spec.selector}）`);
        continue;
      }
      await page.mouse.move(1380, 860);
      await clipBlock(page, spec.code, theme, target, spec.padX !== undefined ? { padX: spec.padX } : {});
    }

    /* 06f-block-hover：block hover 時左側的 + 與 ⋮⋮
       —— Notion 那張拍的是**標註 callout**，這裡也對著 callout 拍才比得出東西。
       裁切左緣照抄：Notion 的 block 左緣落在裁切圖的 x=104。 */
    {
      const target = page.locator('.kn-block--callout').first();
      await centerBlock(page, target);
      const box = await target.boundingBox();
      if (box) {
        await page.mouse.move(box.x + 200, box.y + box.height / 2);
        await page.waitForTimeout(350);
        const size = refSize('06f-block-hover', theme)!;
        await clip(page, '06f-block-hover', theme, {
          x: box.x - 104,
          y: box.y + box.height / 2 - size.height / 2,
          width: size.width,
          height: size.height,
        });
      }
    }

    /* 06-slash-menu：空白行輸入 `/`（含灰字 placeholder「輸入以搜尋」） */
    {
      // 用「第一段」而不是「最後一段」：最後一段可能在欄/折疊裡面，click 會落空。
      //
      // ⚠️ 捲到**上緣**而不是正中央：斜線選單有 370px 高，錨點放在畫面中央的話
      // 浮層下緣會超出 900px 的視窗，clip() 的 y 會被 clamp 到 900-高，
      // 拍出來的根本不是浮層那一塊（第一輪的 06-slash-menu 就是這樣，數字沒有意義）。
      const anchor = page.locator('.kn-block--paragraph [contenteditable="true"]').first();
      await page.locator('.kn-block--paragraph').first().evaluate((el) => {
        el.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
      });
      await page.waitForTimeout(200);
      await anchor.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/');
      await page.waitForTimeout(700);
      await shot(page, '06-slash-menu-full', theme);
      const menu = page.locator('.kn-popover--slash').first();
      if (await menu.count()) {
        const box = await menu.boundingBox();
        const size = refSize('06-slash-menu', theme)!;
        // Notion 的特寫把「觸發那一行」也框進去：浮層左上角落在裁切圖的 (24, 33)
        if (box) {
          await clip(page, '06-slash-menu', theme, {
            x: box.x - 24, y: box.y - 33, width: size.width, height: size.height,
          });
        }
      }
      await page.keyboard.press('Escape');
      await page.keyboard.press('Backspace'); // 去掉 `/`
      await page.keyboard.press('Backspace'); // 去掉剛剛 Enter 出來的空段落
      await page.waitForTimeout(300);
    }

    /* 07-*：資料庫六種視圖 + 互動狀態 */
    const db = page.locator('.kn-block--collectionView').first();
    if (await db.count()) {
      for (const view of DB_VIEWS) {
        const tab = db.getByRole('tab', { name: view.tab }).first();
        if (await tab.count()) {
          await tab.click();
          await page.waitForTimeout(900);
        } else if (view.code.startsWith('07i')) {
          console.warn('⚠ 找不到「時程表」tab —— 後端還沒有 timeline 視圖型別，略過 07i');
          continue;
        }
        await settle(page);
        await page.mouse.move(1380, 860);
        await centerBlock(page, db);
        const box = await db.boundingBox();
        const size = refSize(view.code, theme)!;
        if (box) {
          await clip(page, view.code, theme, { x: box.x - 48, y: box.y - 26, width: size.width, height: size.height });
          await shot(page, `${view.code}-full`, theme);
        }
      }

      // 回表格視圖做互動狀態
      const tableTab = db.getByRole('tab', { name: /^表格$/ }).first();
      if (await tableTab.count()) {
        await tableTab.click();
        await page.waitForTimeout(900);
      }
      await centerBlock(page, db);
      const box = await db.boundingBox();
      if (box) {
        await clip(page, '07n-db-view-tabs', theme, {
          x: box.x - 48, y: box.y - 26, width: refSize('07n-db-view-tabs', theme)!.width, height: refSize('07n-db-view-tabs', theme)!.height,
        });

        /* 07b：欄位標頭 hover */
        const header = db.locator('[role="columnheader"], [class*="headerCell"]').first();
        if (await header.count()) {
          await header.hover();
          await page.waitForTimeout(300);
          const size = refSize('07b-db-header-hover', theme)!;
          const hb = await header.boundingBox();
          if (hb) await clip(page, '07b-db-header-hover', theme, { x: box.x - 48, y: hb.y - 30, width: size.width, height: size.height });
        }

        /* 07k / 07l / 07m：篩選 / 排序 / 設定浮層 */
        // Notion 的裁切把浮層外面的陰影也框進去：面板左上角落在 (13,17)（07m 是 (13,13)）。
        // 直接用 pb.x / pb.y 會整張差 13~17px，最佳位移一路頂到 ±6 的搜尋上限。
        for (const [code, label, padX, padY] of [
          ['07k-db-filter', '篩選', 17, 21],
          ['07l-db-sort', '排序', 17, 21],
          ['07m-db-settings', '設定', 17, 17],
        ] as [string, string, number, number][]) {
          const button = db.getByRole('button', { name: label }).first();
          if (!(await button.count())) continue;
          await button.click();
          await page.waitForTimeout(600);
          const popover = page.locator('[role="dialog"], .kn-popover').last();
          const pb = await popover.boundingBox().catch(() => null);
          const size = refSize(code, theme)!;
          if (pb) await clip(page, code, theme, { x: pb.x - padX, y: pb.y - padY, width: size.width, height: size.height });
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }

        /* 07c：列 hover */
        const row = db.locator('[class*="_row_"]').first();
        if (await row.count()) {
          await row.hover();
          await page.waitForTimeout(300);
          const size = refSize('07c-db-row-hover', theme)!;
          const rb = await row.boundingBox();
          if (rb) await clip(page, '07c-db-row-hover', theme, { x: box.x - 48, y: rb.y - 40, width: size.width, height: size.height });

          /* 07d：儲存格「選取中」——Notion 那張是點一下的選取態（藍框 + 右下角小方塊），
             不是打開編輯器的狀態（UI-SPEC §8.2），而且拍的是**名稱欄**。 */
          const cell = row.locator('[class*="cellWrap"]').first();
          if (await cell.count()) {
            await cell.click();
            await page.waitForTimeout(500);
            const size2 = refSize('07d-db-cell-edit', theme)!;
            const cb = await cell.boundingBox();
            if (cb) await clip(page, '07d-db-cell-edit', theme, { x: box.x - 48, y: cb.y - 40, width: size2.width, height: size2.height });
            await page.keyboard.press('Escape');
          }

          /* 07o：開啟一列（側邊 peek） */
          const open = row.getByRole('button', { name: /開啟/ }).first();
          if (await open.count()) {
            await open.click();
            await page.waitForTimeout(900);
            await shot(page, '07o-db-row-peek', theme);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
          }
        }
      }
    }
  });
}

/* ── 3. 並排拼接 + README ────────────────────────────────── */

test('並排比對圖與差異報告', async () => {
  test.setTimeout(300_000);
  const rows: { code: string; theme: Theme; stats: DiffStats }[] = [];
  const missing: string[] = [];

  const kennoteShots = new Set(readdirSync(SHOT_DIR).filter((f) => f.endsWith('.png')));
  // 只報告這一輪重拍過的（舊的 screenshots.spec.ts 產物不算數）
  const fresh: Set<string> | null = existsSync(FRESH)
    ? new Set(JSON.parse(readFileSync(FRESH, 'utf8')) as string[])
    : null;

  for (const file of readdirSync(REF_DIR).filter((f) => f.endsWith('.png')).sort()) {
    if (!kennoteShots.has(file)) continue;
    if (fresh && !fresh.has(file)) continue;
    const theme: Theme = file.endsWith('-dark.png') ? 'dark' : 'light';
    const code = file.replace(/-(light|dark)\.png$/, '');
    try {
      const notion = decodePng(readFileSync(resolve(REF_DIR, file)));
      const kennote = decodePng(readFileSync(resolve(SHOT_DIR, file)));
      const canvas = composeCompare(notion, kennote, `${code} ${theme}`, theme === 'dark');
      writeFileSync(resolve(COMPARE_DIR, `${code}-${theme}.png`), encodePng(canvas));
      rows.push({ code, theme, stats: diffStats(notion, kennote) });
    } catch (error) {
      missing.push(`${file}：${(error as Error).message}`);
    }
  }

  // 有參考圖但 kennote 沒拍到的
  for (const file of readdirSync(REF_DIR).filter((f) => /^(05|07)/.test(f) && f.endsWith('.png'))) {
    if (!fresh?.has(file)) missing.push(`${file}：kennote 沒有對應截圖`);
  }

  writeFileSync(resolve(COMPARE_DIR, 'README.md'), renderReadme(rows, missing));
  expect(rows.length).toBeGreaterThan(0);
});

function renderReadme(
  rows: { code: string; theme: Theme; stats: DiffStats }[],
  missing: string[],
): string {
  const byCode = new Map<string, { light?: DiffStats; dark?: DiffStats }>();
  for (const r of rows) {
    const entry = byCode.get(r.code) ?? {};
    entry[r.theme] = r.stats;
    byCode.set(r.code, entry);
  }

  const fmt = (s?: DiffStats) => {
    if (!s) return '—';
    const shift =
      s.bestShift.dx === 0 && s.bestShift.dy === 0
        ? '對齊'
        : `偏移 ${s.bestShift.dx >= 0 ? '+' : ''}${s.bestShift.dx},${s.bestShift.dy >= 0 ? '+' : ''}${s.bestShift.dy}`;
    return `${s.meanAbs.toFixed(1)} / ${(s.diffRatio * 100).toFixed(1)}% / ${shift}`;
  };

  const lines = [
    '# kennote ↔ Notion 並排比對',
    '',
    `產生時間：${new Date().toISOString()}`,
    '',
    '每張圖三格：**左 = Notion 原版、中 = kennote、右 = 差異熱度圖**（愈紅差愈多）。',
    '由 `e2e/compare.spec.ts` 產生，重跑：',
    '',
    '```bash',
    '# 打遠端正式站（注意：正式站跑的是**已建置的 bundle**，',
    '#  前端改完沒重新部署的話，拍到的會是舊畫面）',
    'cd e2e && BASE_URL=http://100.74.148.92:8090 npx playwright test compare',
    '',
    '# 改 CSS 時打本機 dev server（vite proxy 到遠端 API，有 HMR）——本報告就是這樣跑出來的',
    'cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 node node_modules/vite/bin/vite.js --port 5173 &',
    'cd e2e && BASE_URL=http://localhost:5173 npx playwright test compare',
    '```',
    '',
    '## 量化差異',
    '',
    '欄位格式：`平均通道差(0-255) / 明顯差異像素佔比 / 最佳對齊位移(dx,dy)`。',
    '「最佳對齊位移」= 把 kennote 平移幾 px 可以讓差異最小 —— 不是 0 就代表版面有位移。',
    '',
    '| 代號 | Light | Dark |',
    '|---|---|---|',
  ];
  for (const code of [...byCode.keys()].sort()) {
    const e = byCode.get(code)!;
    lines.push(`| \`${code}\` | ${fmt(e.light)} | ${fmt(e.dark)} |`);
  }

  if (missing.length) {
    lines.push('', '## 沒有比對到的項目', '');
    for (const m of missing.sort()) lines.push(`- ${m}`);
  }

  lines.push(...KNOWN_GAPS);

  /**
   * 之後每一輪的手寫紀錄放在 `reference/shots/compare/NOTES-round*.md`，
   * 這裡依檔名排序接到最後面 —— 要補紀錄就新增 / 修改那些 .md，不必再動這支 spec。
   */
  for (const file of readdirSync(COMPARE_DIR).filter((f) => /^NOTES-.*\.md$/.test(f)).sort()) {
    lines.push('', readFileSync(resolve(COMPARE_DIR, file), 'utf8').trimEnd());
  }

  return `${lines.join('\n')}\n`;
}

/**
 * 「量化差異」那張表沒辦法解釋的事情，一律寫在這裡。
 * 這段是手寫的 —— 每次改完 UI 請同步更新，不要讓它腐爛。
 */
const KNOWN_GAPS = [
  '',
  '## 已知差異與原因（誠實清單）',
  '',
  '### 一、比不了的（來源本身就不一樣）',
  '',
  '| 代號 | 原因 |',
  '|---|---|',
  '| `02-page-top` / `04d-page-cover-icon` | Notion 參考頁的封面是內建的萊特兄弟黑白照，kennote 用內建漸層 `gradient:dawn`。**封面圖本來就不同**，數字再低也沒意義；該看的是封面高度（270px）、icon 位置與標題字級。 |',
  '| `02c-page-mid2` / `02d-page-bottom` | 固定捲動 1800px / 捲到底。兩邊 block 高度有幾 px 差，累積到第 1800px 已經錯開一整個 block，**內容不同就不是樣式差**。要逐 block 看請用 `05-*`。 |',
  '| `05-19-subpage` | **Notion 那張參考圖拍壞了** —— 267×58 的裁切框落在側邊欄上，裡面是「上線部署 / 測試與 QA」兩列側邊欄項目，根本沒拍到子頁面 block。kennote 這張拍的是真正的子頁面連結，兩邊永遠對不起來。 |',
  '| `05-21-image` | 同一張 Unsplash 照片，但 Notion 依 `aspectRatio` 裁切、kennote 是 `max-width:100%` 等比縮放 → 高度差約 30px，差異集中在上下兩條帶狀。 |',
  '| `07o-db-row-peek` | 整窗截圖，兩邊頁面內容不同（Notion 那頁是空資料庫）。結構（右側滑出面板 + 屬性清單 + 分隔線 + 正文）已經對齊。 |',
  '| `07i-db-timeline-*` | **kennote 沒有時程表視圖**：`shared-types` 的 `VIEW_TYPES` 只有 table/board/list/gallery/calendar。這是功能缺口，不是樣式差。 |',
  '| `07j-db-proptype-menu` | kennote 的型別選單沒有「整合」那一組，入口也在欄位設定裡而不是表頭 `+`。未納入比對。 |',
  '',
  '### 二、比對過程中發現的產品缺陷（不是樣式問題）',
  '',
  '1. **內嵌資料庫從來沒被渲染過**（已修）',
  '   `features/editor/blocks/externalRegistry.ts` 的 `registerInlineDatabase()` **沒有任何地方呼叫過**，',
  '   所以頁面裡的 `collectionView` block 一律畫成「資料庫模組尚未載入」的佔位卡 ——',
  '   也就是說 `07-*` 這一整組在這次之前**從來沒有被比對到**。',
  '   修法：新增 `apps/web/src/features/database/register.tsx`，由 `App.tsx` 呼叫一次。',
  '',
  '2. **`packages/editor-core/src/styles.css` 沒有被任何人 import**（已在 `styles/editor.css` 補上）',
  '   `.kn-todo` / `.kn-toggle` / `.kn-callout` 的 `display:flex` 住在那支 CSS 裡，',
  '   結果待辦的 checkbox、折疊的箭頭、標註的 emoji 全部掉到自己一行去。',
  '',
  '3. **CSS specificity 撞車**（已修）',
  '   `.kn-editor .kn-block-main { padding: 3px 2px; border-radius: 3px }`（0,2,0）',
  '   蓋掉了 `.kn-callout` / `.kn-code-block`（0,1,0）的 `padding: 12px` / `24px 22px` 與 `border-radius: 10px`。',
  '   標註的圓角實際只有 3px、程式碼區塊完全沒有內距。',
  '',
  '4. **資料庫把自己的載體頁當成一列**（⚠️ 未修，屬於後端）',
  '   `apps/server/src/modules/databases/service.ts` 的 `createDatabase()` 會把 `pages.collection_id`',
  '   寫到**資料庫自己那一頁**上；而 `repo.ts` 的 `queryRows()` 只用 `WHERE p.collection_id = $1` 過濾，',
  '   於是載體頁自己也被當成一列回傳。截圖裡就是表格最後多一列「參考資料庫」',
  '   （看板 / 清單 / 圖庫同樣多一張卡）。',
  '   修法：`queryRows` / `countRows` / `queryGroupedRows` / `queryAggregations` 的 WHERE 加上',
  '   `AND p.is_database = FALSE`。**這次沒有動**：後端跑在遠端已建置好的映像檔上，改了也驗證不到，',
  '   而且不在這一輪視覺 QA 的範圍內。',
  '',
  '### 三、修正紀錄（第一輪：五小輪）',
  '',
  '| 輪 | 改了什麼 | 代表性的數字變化（light，平均通道差） |',
  '|---|---|---|',
  '| 0 | 基線：先讓 `collectionView` 真的畫出資料庫、再建出參考頁 | — |',
  '| 1 | `editor.css`：補上 todo/toggle/callout 的 `display:flex`；區塊節奏改成 gap 0 + wrapper padding；標題 30/39、24/31.2、20/26；清單縮排 24→32；分隔線改實心 bar；callout / code / table / bookmark / toc / 欄間距 46px 全部換實測值。DB：內嵌外框拿掉、顯示標題、tab 改膠囊、列高 32→37 | `05-03` 7.0→3.8、`05-06` 6.5→2.9、`05-13` 9.5→6.7 |',
  '| 2 | 看板泳道底色 + 卡片 260/邊框、清單列高 32 去線、圖庫卡片 148 封面、日曆格 124 + 週末底色 + 今天紅點；同步區塊改成只有 hover 才出現；書籤改成縮圖在左 + favicon 自成一行；行內樣式那段搬到頁尾讓捲動位置對齊 | `05-01` 19.3→8.0、`05-03` 3.8→1.0、`05-17` 11.1→8.6 |',
  '| 3 | ⭐ specificity 修正（`.kn-editor` 前綴）讓 callout 圓角 10px、code 內距 24/22 真的生效；06f 改拍 callout；07d 改拍「選取中」並補上右下角小方塊 | `05-12` 9.3→6.1、`05-13` 6.7→5.2、`06f` 19.0→7.4 |',
  '| 4 | 逐像素量 `05-05/06/07` 反推出：清單文字落在 +30（marker 24 + gap 6）、checkbox 框線 1px rgb(56,56,54)、勾選填色 **#2783de**（不是 #2383e2） | `05-06` 4.5→2.0、`05-07` 4.8→**1.6**、`05-08` 3.9→**1.2** |',
  '| 5 | 再量 `05-10` / `05-18` + 讀 `dom/21-column-list.html`：引言內距 14→21px、每欄內距補到 Notion 的 `padding: 12px 6px`；`新建 ⌄` 分段按鈕；側邊欄底部也納入比對 | `05-09` 9.5→9.4、`02b` 6.9→6.6 |',
  '',
  '> 量測方法：把參考 PNG 解碼後逐列掃「最左邊的深色像素」，直接讀出 bullet / 文字 / 框線的 x 座標，',
  '> 不靠目測。腳本邏輯與 `e2e/fixtures/png.ts` 的 decoder 相同。',
  '',
  '### 四、與任務說明不一致的實測值（以實測為準）',
  '',
  '| 項目 | 任務說明 | 實測（來源） |',
  '|---|---|---|',
  '| 資料庫列高 | 32px | **37px**（`UI-SPEC.md` §8.1 + `07-db-table-light.png`） |',
  '| 待辦 checkbox 藍 | `#2383e2` | **`#2783de`** = rgb(39,131,222)（`05-06-todo-checked-light.png` 取色） |',
  '| 標註背景 | `rgb(241,241,239)` | **rgb(249,248,247)** / dark rgb(56,56,54)（`_extra-light.json`） |',
  '| 表格格線 | `rgba(55,53,47,.09)` | **rgb(230,229,227)** / dark rgb(56,56,54)（`_extra-*.json` 的 `tableBorder`） |',
  '',
];
