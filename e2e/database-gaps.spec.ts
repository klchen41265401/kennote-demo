/**
 * 「資料庫功能缺口補完」的回歸測試（`docs/qa/database-gaps.md`）。
 *
 * ```bash
 * # 本機 vite（VITE_PROXY_TARGET 指到遠端）：
 * BASE_URL=http://127.0.0.1:5304 npx playwright test database-gaps.spec.ts
 * ```
 *
 * ⚠️ 這一批有**一半在後端**（BUG-11 的驗證與 createDual、垃圾桶、CSV 欄序、
 * 預設欄寬、`POST /rows/reorder`）。在 server 重新部署之前，對著遠端舊 server
 * 跑這些條目會紅；註解裡標了「需部署」的就是。純前端的（RowPeek 掛編輯器、
 * 側邊欄入口、列選取 / 批次列）不必部署就會綠。
 */
import { expect, test, type Page } from '@playwright/test';

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
        /* 抄不到就算了 */
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
): Promise<{ status: number; data: T; error?: { message?: string } }> {
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
        const json = JSON.parse(text);
        return { status: r.status, data: json.data, error: json.error };
      } catch {
        return { status: r.status, data: text as never };
      }
    },
    [method, path, body ?? null] as const,
  ) as never;
}

interface Collection {
  id: string;
  pageId: string;
  schema: Record<string, { name: string; type: string; [k: string]: unknown }>;
}
interface Row {
  id: string;
  properties: Record<string, { type: string; [k: string]: unknown }>;
}

async function workspaceId(page: Page): Promise<string> {
  const ws = (await api<Array<{ id: string }>>(page, 'GET', '/api/workspaces')).data[0];
  expect(ws, '工作區').toBeTruthy();
  return ws!.id;
}

async function newDatabase(
  page: Page,
  title: string,
  schema: Record<string, unknown>,
): Promise<Collection> {
  const res = await api<{ collection: Collection }>(page, 'POST', '/api/databases', {
    workspaceId: await workspaceId(page),
    title,
    inline: false,
    schema,
  });
  expect(res.status).toBe(201);
  return res.data.collection;
}

const TITLE_ONLY = { title: { type: 'title', name: '名稱' } };

test.describe('資料庫功能缺口', () => {
  test.beforeEach(async ({ page }) => {
    await installTokenSniffer(page);
    await signIn(page);
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForTimeout(600);
  });

  /* ── 1. BUG-11 ─────────────────────────────────────── */

  test('BUG-11：dualProperty 指到不存在的欄位 → 400（需部署）', async ({ page }) => {
    const target = await newDatabase(page, '缺口-目標', TITLE_ONLY);
    const source = await newDatabase(page, '缺口-來源', TITLE_ONLY);

    const res = await api(page, 'PATCH', `/api/databases/${source.id}/schema`, {
      ops: [
        {
          op: 'add',
          definition: {
            name: '關聯',
            type: 'relation',
            collectionId: target.id,
            dualProperty: 'nope',
          },
        },
      ],
    });
    expect(res.status, '指到不存在的欄位要被擋下來').toBe(400);
    expect(res.error?.message ?? '').toMatch(/沒有欄位|反向/);
  });

  test('BUG-11：createDual 會在目標資料庫建出互指的反向欄位（需部署）', async ({ page }) => {
    const target = await newDatabase(page, '缺口-目標2', TITLE_ONLY);
    const source = await newDatabase(page, '缺口-來源2', TITLE_ONLY);

    const patched = await api<{ collection: Collection }>(
      page,
      'PATCH',
      `/api/databases/${source.id}/schema`,
      {
        ops: [
          {
            op: 'add',
            definition: { name: '關聯', type: 'relation', collectionId: target.id },
            createDual: { name: '反向關聯' },
          },
        ],
      },
    );
    expect(patched.status).toBe(200);

    const sourceSchema = patched.data.collection.schema;
    const relationEntry = Object.entries(sourceSchema).find(([, d]) => d.type === 'relation');
    expect(relationEntry, '來源要有 relation 欄位').toBeTruthy();
    const [sourceProp, sourceDef] = relationEntry!;
    expect(sourceDef.dualProperty, '來源指向反向欄位').toBeTruthy();

    const after = await api<{ collection: Collection }>(page, 'GET', `/api/databases/${target.id}`);
    const dual = after.data.collection.schema[sourceDef.dualProperty as string];
    expect(dual, '目標資料庫要多出反向欄位').toBeTruthy();
    expect(dual!.type).toBe('relation');
    expect(dual!.name).toBe('反向關聯');
    expect(dual!.collectionId).toBe(source.id);
    expect(dual!.dualProperty).toBe(sourceProp);

    // 雙向同步：A 寫入會出現在 B 的反向欄位
    const t1 = (await api<Row>(page, 'POST', `/api/databases/${target.id}/rows`, { title: 'T1' }))
      .data;
    const s1 = (await api<Row>(page, 'POST', `/api/databases/${source.id}/rows`, { title: 'S1' }))
      .data;
    await api(page, 'PATCH', `/api/databases/${source.id}/rows/${s1.id}`, {
      properties: { [sourceProp]: { type: 'relation', pageIds: [t1.id] } },
    });
    const targetRows = (
      await api<{ rows: Row[] }>(page, 'GET', `/api/databases/${target.id}/rows`)
    ).data.rows;
    const back = targetRows.find((r) => r.id === t1.id);
    expect(back?.properties[sourceDef.dualProperty as string]).toMatchObject({
      type: 'relation',
      pageIds: [s1.id],
    });
  });

  /* ── 3. 刪除列進垃圾桶 ─────────────────────────────── */

  test('刪除的列會出現在工作區垃圾桶，並標示所屬資料庫（需部署）', async ({ page }) => {
    const c = await newDatabase(page, '缺口-垃圾桶', TITLE_ONLY);
    const row = (await api<Row>(page, 'POST', `/api/databases/${c.id}/rows`, { title: '要刪的列' }))
      .data;
    expect((await api(page, 'DELETE', `/api/databases/${c.id}/rows/${row.id}`)).status).toBe(204);

    const ws = await workspaceId(page);
    const trash = await api<
      Array<{ id: string; title: string; collectionId?: string | null; collectionTitle?: string | null }>
    >(page, 'GET', `/api/trash?workspaceId=${ws}`);
    const entry = trash.data.find((t) => t.id === row.id);
    expect(entry, '刪掉的列要在垃圾桶裡').toBeTruthy();
    expect(entry!.collectionId).toBe(c.id);
    expect(entry!.collectionTitle).toBe('缺口-垃圾桶');

    // 還原回得來
    expect((await api(page, 'POST', `/api/pages/${row.id}/restore`)).status).toBeLessThan(300);
    const rows = (await api<{ rows: Row[] }>(page, 'GET', `/api/databases/${c.id}/rows`)).data.rows;
    expect(rows.some((r) => r.id === row.id)).toBe(true);
  });

  /* ── 4. CSV 匯出 ───────────────────────────────────── */

  test('CSV：title 在第一欄、relation 輸出目標列標題（需部署）', async ({ page }) => {
    const target = await newDatabase(page, '缺口-CSV目標', TITLE_ONLY);
    const t1 = (await api<Row>(page, 'POST', `/api/databases/${target.id}/rows`, { title: '甲方' }))
      .data;
    const t2 = (await api<Row>(page, 'POST', `/api/databases/${target.id}/rows`, { title: '乙方' }))
      .data;

    const c = await newDatabase(page, '缺口-CSV', {
      // 刻意讓 title 不是 jsonb key 序的第一個
      zz: { type: 'number', name: '數字' },
      title: { type: 'title', name: '名稱' },
    });
    const patched = await api<{ collection: Collection }>(
      page,
      'PATCH',
      `/api/databases/${c.id}/schema`,
      {
        ops: [
          { op: 'add', definition: { name: '關聯', type: 'relation', collectionId: target.id } },
        ],
      },
    );
    const relProp = Object.entries(patched.data.collection.schema).find(
      ([, d]) => d.type === 'relation',
    )![0];
    const row = (await api<Row>(page, 'POST', `/api/databases/${c.id}/rows`, { title: '第一列' }))
      .data;
    await api(page, 'PATCH', `/api/databases/${c.id}/rows/${row.id}`, {
      properties: { [relProp]: { type: 'relation', pageIds: [t1.id, t2.id] } },
    });

    const csv = await page.evaluate(async (id) => {
      const r = await fetch(`/api/databases/${id}/export.csv`, {
        headers: { authorization: 'Bearer ' + (window as unknown as { __tok?: string }).__tok },
      });
      return r.text();
    }, c.id);

    const [header, first] = csv.replace(/^﻿/, '').split('\r\n');
    expect(header!.split(',')[0], 'title 要在第一欄').toBe('名稱');
    expect(first, 'relation 要輸出標題而不是 pageId').toContain('甲方, 乙方');
    expect(first).not.toContain(t1.id);
  });

  /* ── 6. 預設欄寬 ───────────────────────────────────── */

  test('預設欄寬：title 276、其餘 200（需部署）', async ({ page }) => {
    const c = await newDatabase(page, '缺口-欄寬', {
      title: { type: 'title', name: '名稱' },
      n1: { type: 'number', name: '數字' },
    });
    const snapshot = await api<{
      views: Array<{ format: { properties?: Array<{ property: string; width?: number }> } }>;
    }>(page, 'GET', `/api/databases/${c.id}`);
    const props = snapshot.data.views[0]!.format.properties ?? [];
    expect(props.find((p) => p.property === 'title')?.width).toBe(276);
    expect(props.find((p) => p.property === 'n1')?.width).toBe(200);
  });

  /* ── 7. 拖曳排序的後端 ─────────────────────────────── */

  test('POST /rows/reorder 會寫回 sort_key（需部署）', async ({ page }) => {
    const c = await newDatabase(page, '缺口-排序', TITLE_ONLY);
    const a = (await api<Row>(page, 'POST', `/api/databases/${c.id}/rows`, { title: 'A' })).data;
    const b = (await api<Row>(page, 'POST', `/api/databases/${c.id}/rows`, { title: 'B' })).data;
    const cRow = (await api<Row>(page, 'POST', `/api/databases/${c.id}/rows`, { title: 'C' })).data;

    const res = await api(page, 'POST', `/api/databases/${c.id}/rows/reorder`, {
      rowId: cRow.id,
      afterId: null,
    });
    expect(res.status).toBe(200);

    const rows = (await api<{ rows: Row[] }>(page, 'GET', `/api/databases/${c.id}/rows`)).data.rows;
    expect(rows.map((r) => r.id)).toEqual([cRow.id, a.id, b.id]);
  });

  /* ── 2 / 5 / 7：純前端，不必部署 ───────────────────── */

  test('RowPeek 的內容區掛的是真的編輯器（不是佔位文字）', async ({ page }) => {
    const c = await newDatabase(page, '缺口-peek', TITLE_ONLY);
    await api<Row>(page, 'POST', `/api/databases/${c.id}/rows`, { title: 'peek 這一列' });

    await page.goto(`/database/${c.pageId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.getByRole('row').filter({ hasText: 'peek 這一列' }).first().hover();
    /* gap-review §C-1：按鈕改成 Notion 原文「打開」（可及名稱「以側邊預覽打開」），
       peek 也從 `[role="dialog"]` 的 modal 換成 `<aside aria-label="側邊預覽">`。 */
    await page.getByRole('button', { name: '以側邊預覽打開' }).first().click();

    const dialog = page.locator('aside[aria-label="側邊預覽"]');
    await expect(dialog).toBeVisible();
    // 佔位文字不能再出現
    await expect(dialog).not.toContainText('編輯器（editor-core）會掛在這個區塊');
    // 真的編輯器掛載點在 #editor-host-row 裡
    await expect(page.locator('#editor-host-row .kn-editor-host')).toHaveCount(1);

    // 關掉 peek → 編輯器一併卸載
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(page.locator('#editor-host-row')).toHaveCount(0);
  });

  test('側邊欄有「新增資料庫」入口，按下去會建立並導向資料庫', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const entry = page.getByRole('button', { name: '新增資料庫' });
    await expect(entry).toBeVisible();
    await entry.click();
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/database\//);
  });

  test('列選取：hover 出現勾選框、Shift 連選、批次列浮出來', async ({ page }) => {
    const c = await newDatabase(page, '缺口-選取', TITLE_ONLY);
    for (const title of ['列一', '列二', '列三', '列四']) {
      await api(page, 'POST', `/api/databases/${c.id}/rows`, { title });
    }
    await page.goto(`/database/${c.pageId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const first = page.getByRole('checkbox', { name: /選取「列一」/ });
    const third = page.getByRole('checkbox', { name: /選取「列三」/ });
    await page.getByRole('row').filter({ hasText: '列一' }).first().hover();
    await first.check();
    await expect(page.getByRole('toolbar', { name: '批次操作' })).toBeVisible();
    await expect(page.getByText('已選取 1 列')).toBeVisible();

    // Shift 連選：列一 → 列三 之間全選
    await page.getByRole('row').filter({ hasText: '列三' }).first().hover();
    await third.click({ modifiers: ['Shift'] });
    await expect(page.getByText('已選取 3 列')).toBeVisible();

    // 批次刪除
    await page.getByRole('button', { name: '刪除' }).click();
    await page.waitForTimeout(2500);
    const rows = (await api<{ rows: Row[] }>(page, 'GET', `/api/databases/${c.id}/rows`)).data.rows;
    expect(rows).toHaveLength(1);
  });
});
