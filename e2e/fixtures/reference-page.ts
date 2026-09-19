/**
 * 建出 kennote 版的「參考頁」——內容對照真實 Notion 的
 * `reference/notion-capture/【kennote 參考用】`（見 `02*-page-*.png`）。
 *
 * 為什麼要有這支：`e2e/screenshots.spec.ts` 拍的是側邊欄裡「第一個頁面」，
 * 那頁是空的，所以 21 種 block 與 6 種資料庫視圖**從來沒有被比對到**。
 * 這支用純 HTTP API 把內容灌進去，`compare.spec.ts` 再去拍它。
 *
 * ## 用法
 *
 * ```bash
 * cd e2e
 * # 只建資料（不拍圖）
 * BASE_URL=http://100.74.148.92:8090 npx playwright test compare --grep "建立參考頁"
 * # 建資料 + 拍圖 + 產並排圖
 * BASE_URL=http://100.74.148.92:8090 npx playwright test compare
 * ```
 *
 * 環境變數：`BASE_URL` / `E2E_EMAIL` / `E2E_PASSWORD`（與 screenshots.spec.ts 同一組帳號）。
 *
 * ## 冪等
 *
 * 每次執行都會先把同名的頁（含子頁「子頁面範例 Sub-page」）移到垃圾桶再永久刪除，
 * 然後整頁重建 —— 所以重跑幾次都只會有一份，且內容永遠是最新版。
 */
import { randomUUID } from 'node:crypto';

export const REFERENCE_TITLE = '【kennote 參考用】';
export const SUBPAGE_TITLE = '子頁面範例 Sub-page';
export const DATABASE_TITLE = '參考資料庫';

/** 圖片 / 書籤封面用的外部圖（與 Notion 參考頁同一張 Unsplash 圖） */
const IMAGE_URL = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200&q=70';

export interface SeedResult {
  workspaceId: string;
  pageId: string;
  subPageId: string;
  collectionId: string;
  /** viewId 依序：table / board / list / gallery / calendar / timeline
   *  （timeline 需要後端 `VIEW_TYPES` 也有 'timeline'；舊版後端會回 null） */
  viewIds: Record<'table' | 'board' | 'list' | 'gallery' | 'calendar', string> & {
    timeline: string | null;
  };
  accessToken: string;
}

/* ── RichText 小工具 ─────────────────────────────────────── */

type Mark =
  | { t: 'b' } | { t: 'i' } | { t: 'u' } | { t: 's' } | { t: 'code' }
  | { t: 'link'; href: string }
  | { t: 'color'; fg?: string; bg?: string };

type Span = { text: string; marks?: Mark[] };

const t = (text: string, marks?: Mark[]): Span => (marks ? { text, marks } : { text });

/* ── 極小的 API client ───────────────────────────────────── */

class Client {
  token = '';
  constructor(readonly base: string) {}

  async call<T = unknown>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    // ⚠️ 沒有 body 時**不能**帶 Content-Type: application/json ——
    // fastify 會回 400「Body cannot be empty」，DELETE 就永遠刪不掉（冪等會壞）。
    const res = await fetch(`${this.base}/api${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}\n${text.slice(0, 800)}`);
    }
    if (!text) return undefined as T;
    const json = JSON.parse(text) as { data?: T };
    return (json.data ?? (json as T)) as T;
  }
}

/* ── ops builder ─────────────────────────────────────────── */

interface InsertOp {
  type: 'block.insert';
  blockId: string;
  parentId: string | null;
  afterId: string | null;
  blockType: string;
  props: Record<string, unknown>;
  content: Span[];
}

class Ops {
  readonly list: InsertOp[] = [];
  private lastRoot: string | null = null;

  /** 接在頁面根層的最後一個 block 後面 */
  root(blockType: string, props: Record<string, unknown> = {}, content: Span[] = []): string {
    const blockId = randomUUID();
    this.list.push({
      type: 'block.insert', blockId, parentId: null, afterId: this.lastRoot,
      blockType, props, content,
    });
    this.lastRoot = blockId;
    return blockId;
  }

  /** 接在 parent 底下（afterId = null 代表插在最前面，所以要串著傳） */
  child(
    parentId: string,
    blockType: string,
    props: Record<string, unknown> = {},
    content: Span[] = [],
    afterId: string | null = null,
  ): string {
    const blockId = randomUUID();
    this.list.push({ type: 'block.insert', blockId, parentId, afterId, blockType, props, content });
    return blockId;
  }
}

/* ── 資料庫 schema ───────────────────────────────────────── */

const SCHEMA = {
  title: { name: '名稱', type: 'title' },
  Tag1: {
    name: '標籤',
    type: 'multiSelect',
    options: [
      { id: 'opt_design', value: '設計', color: 'purple' },
      { id: 'opt_dev', value: '開發', color: 'blue' },
      { id: 'opt_qa', value: '測試', color: 'orange' },
    ],
  },
  Sta1: {
    name: '狀態',
    type: 'select',
    options: [
      { id: 'opt_todo', value: '未開始', color: 'gray' },
      { id: 'opt_doing', value: '進行中', color: 'blue' },
      { id: 'opt_done', value: '已完成', color: 'green' },
    ],
  },
  Due1: { name: '日期', type: 'date' },
  Num1: { name: '數字', type: 'number', numberFormat: 'number' },
  Chk1: { name: '勾選', type: 'checkbox' },
  Ppl1: { name: '人員', type: 'person', allowMultiple: true },
  Url1: { name: '網址', type: 'url' },
} as const;

/** 六筆列，刻意讓看板 / 日曆 / 圖庫都有東西可以畫 */
function rows(userId: string, baseDate: string) {
  const day = (n: number) => {
    const d = new Date(`${baseDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return [
    { title: '上線部署', Sta1: 'opt_done', Tag1: ['opt_dev'], Due1: day(0), Num1: 120, Chk1: true, Ppl1: [userId], Url1: 'https://kennote.local/deploy' },
    { title: '測試與 QA', Sta1: 'opt_doing', Tag1: ['opt_qa', 'opt_dev'], Due1: day(1), Num1: 48, Chk1: false, Ppl1: [userId], Url1: 'https://kennote.local/qa' },
    { title: '設計稿', Sta1: 'opt_done', Tag1: ['opt_design'], Due1: day(2), Num1: 16, Chk1: true, Ppl1: [], Url1: 'https://kennote.local/design' },
    { title: '前端開發', Sta1: 'opt_doing', Tag1: ['opt_dev'], Due1: day(3), Num1: 256, Chk1: false, Ppl1: [userId], Url1: 'https://kennote.local/web' },
    { title: '後端 API', Sta1: 'opt_todo', Tag1: ['opt_dev'], Due1: day(5), Num1: 64, Chk1: false, Ppl1: [], Url1: 'https://kennote.local/api' },
    { title: '使用者研究', Sta1: 'opt_todo', Tag1: ['opt_design', 'opt_qa'], Due1: day(8), Num1: 8, Chk1: true, Ppl1: [userId], Url1: 'https://kennote.local/ux' },
  ];
}

function propertiesOf(row: ReturnType<typeof rows>[number]) {
  return {
    Sta1: { type: 'select', optionId: row.Sta1 },
    Tag1: { type: 'multiSelect', optionIds: row.Tag1 },
    Due1: { type: 'date', start: row.Due1, end: null, includeTime: false },
    Num1: { type: 'number', number: row.Num1 },
    Chk1: { type: 'checkbox', checkbox: row.Chk1 },
    Ppl1: { type: 'person', userIds: row.Ppl1 },
    Url1: { type: 'url', url: row.Url1 },
  };
}

/* ── 主流程 ──────────────────────────────────────────────── */

export async function seedReferencePage(options: {
  baseUrl?: string;
  email?: string;
  password?: string;
  /** 日曆視圖要落在哪一個月（預設今天），格式 YYYY-MM-DD */
  baseDate?: string;
} = {}): Promise<SeedResult> {
  const base = (options.baseUrl ?? process.env['BASE_URL'] ?? 'http://100.74.148.92:8090').replace(/\/$/, '');
  const email = options.email ?? process.env['E2E_EMAIL'] ?? 'e2e@kennote.local';
  const password = options.password ?? process.env['E2E_PASSWORD'] ?? 'e2e-password-2026';
  const baseDate = options.baseDate ?? new Date().toISOString().slice(0, 10);

  const api = new Client(base);

  /* 1. 登入（帳號不存在就自動註冊；與網頁「不輸入，直接進入」同一支端點） */
  const auth = await api.call<{
    accessToken: string;
    user: { id: string };
    workspaces: { id: string }[];
  }>('/auth/open', { method: 'POST', body: { email, password, name: 'E2E 測試員' } });
  api.token = auth.accessToken;
  const workspaceId = auth.workspaces[0]!.id;
  const userId = auth.user.id;

  /* 2. 冪等：舊的同名頁（含子頁）全部永久刪除 */
  const MINE = new Set([REFERENCE_TITLE, SUBPAGE_TITLE, DATABASE_TITLE]);
  const tree = await api.call<{ id: string; title: string; parentId: string | null }[]>(
    `/workspaces/${workspaceId}/tree`,
  );
  const doomed = new Set(tree.filter((n) => MINE.has(n.title)).map((n) => n.id));
  // 子頁（含 inline database 的載體頁）跟著一起刪，不然側邊欄會愈跑愈多殘骸
  for (let i = 0; i < 4; i += 1) {
    for (const n of tree) if (n.parentId && doomed.has(n.parentId)) doomed.add(n.id);
  }
  for (const id of doomed) {
    await api.call(`/pages/${id}`, { method: 'DELETE' }).catch(() => undefined);
    await api.call(`/pages/${id}/permanent`, { method: 'DELETE' }).catch(() => undefined);
  }

  /* 3. 主頁 + 封面 + icon */
  const page = await api.call<{ id: string }>('/pages', {
    method: 'POST',
    body: { workspaceId, title: [t(REFERENCE_TITLE)], icon: '⭐' },
  });
  await api.call(`/pages/${page.id}`, { method: 'PATCH', body: { cover: 'gradient:dawn#y=50' } });
  await api.call(`/pages/${page.id}/favorite`, { method: 'POST' }).catch(() => undefined);

  /* 4. 子頁面（給 05-19-subpage 用） */
  const sub = await api.call<{ id: string }>('/pages', {
    method: 'POST',
    body: { workspaceId, parentId: page.id, title: [t(SUBPAGE_TITLE)], icon: '📄' },
  });

  /* 5. inline database（先建，collectionView block 才有 id 可以指） */
  const db = await api.call<{
    collection: { id: string };
    views: { id: string; type: string }[];
  }>('/databases', {
    method: 'POST',
    body: {
      workspaceId,
      parentPageId: page.id,
      title: DATABASE_TITLE,
      inline: true,
      schema: SCHEMA,
    },
  });
  const collectionId = db.collection.id;

  const propertyFormat = Object.keys(SCHEMA).map((property, i) => ({
    property,
    visible: i < 5,
    // Notion 的名稱欄實測 280px，其餘欄 160px（UI-SPEC §8.1）
    width: property === 'title' ? 280 : 160,
  }));

  const tableView = db.views.find((v) => v.type === 'table')!;
  await api.call(`/databases/${collectionId}/views/${tableView.id}`, {
    method: 'PATCH',
    body: { name: '表格', format: { ...{ properties: propertyFormat }, tableFreezeColumns: 1, tableRowNumbers: false } },
  });

  const mkView = (body: Record<string, unknown>) =>
    api.call<{ id: string }>(`/databases/${collectionId}/views`, { method: 'POST', body });

  const board = await mkView({
    type: 'board', name: '看板',
    query: { groupBy: { property: 'Sta1', hideEmptyGroups: false } },
    format: { boardColumnWidth: 260, boardCover: { type: 'none' }, properties: propertyFormat },
  });
  const list = await mkView({
    type: 'list', name: '清單',
    format: { listShowProperties: true, properties: propertyFormat },
  });
  const gallery = await mkView({
    type: 'gallery', name: '圖庫',
    format: { galleryCover: { type: 'pageCover' }, gallerySize: 'medium', galleryFitImage: true, properties: propertyFormat },
  });
  const calendar = await mkView({
    type: 'calendar', name: '日曆',
    format: { calendarDateProperty: 'Due1', calendarShowWeekend: true, properties: propertyFormat },
  });
  /**
   * 時程表（07i-db-timeline-*）。
   * `collection_view_type` 是 PostgreSQL enum，新增視圖型別要跑 `0060_timeline_view.sql`；
   * 打到**還沒重新部署**的後端時 `z.enum(VIEW_TYPES)` 會直接 400，
   * 所以這裡吞掉錯誤、回傳 null，讓其他截圖照常跑（compare 會列在「沒有比對到」）。
   */
  const timeline = await mkView({
    type: 'timeline', name: '時程表',
    format: {
      timelineStartProperty: 'Due1',
      timelineEndProperty: null,
      timelineScale: 'month',
      timelineShowTable: true,
      timelineTableWidth: 200,
      properties: propertyFormat,
    },
  }).catch((error: unknown) => {
    console.warn('⚠ 後端還不認識 timeline 視圖（要跑 0060_timeline_view.sql 並重新部署）：' + String(error));
    return null;
  });

  /* 6. 六筆資料 */
  for (const row of rows(userId, baseDate)) {
    await api.call(`/databases/${collectionId}/rows`, {
      method: 'POST',
      body: { title: row.title, properties: propertiesOf(row) },
    });
  }

  /* 7. 一整批 block.insert —— 順序刻意對照 05-01 … 05-21 */
  const ops = new Ops();

  // 05-01 段落（與 Notion 參考頁逐字相同）
  ops.root('paragraph', {}, [
    t('這是一段普通段落文字 paragraph block。Notion text block 預設字型 16px。'),
  ]);
  ops.root('heading1', {}, [t('標題一 Heading 1')]);                // 05-02
  ops.root('heading2', {}, [t('標題二 Heading 2')]);                // 05-03
  ops.root('heading3', {}, [t('標題三 Heading 3')]);                // 05-04
  ops.root('todo', { checked: false }, [t('未勾選的待辦事項')]);      // 05-05
  ops.root('todo', { checked: true }, [t('已勾選的待辦事項')]);       // 05-06

  ops.root('bulletedList', {}, [t('項目符號清單 第一項')]);          // 05-07
  const bullet2 = ops.root('bulletedList', {}, [t('第二項')]);
  ops.child(bullet2, 'bulletedList', {}, [t('巢狀子項目 (Tab 縮排)')]);
  ops.root('bulletedList', {}, [t('第三項')]);

  ops.root('numberedList', {}, [t('編號清單 第一項')]);              // 05-08
  ops.root('numberedList', {}, [t('第二項')]);
  ops.root('numberedList', {}, [t('第三項')]);

  const toggle = ops.root('toggle', { defaultOpen: true }, [t('折疊清單 Toggle list')]); // 05-09
  ops.child(toggle, 'paragraph', {}, [t('折疊裡面的內容，點箭頭可以收合。')]);

  ops.root('quote', {}, [t('這是一段引言 blockquote，左側有一條粗線。')]);  // 05-10
  ops.root('divider');                                                    // 05-11
  ops.root('callout', { icon: '💡' }, [
    t('這是一個標註 callout，預設有灯泡 emoji 與背景色。'),
  ]);                                                                     // 05-12
  ops.root('code', { language: 'javascript' }, [
    t('function greet(name) {\n  console.log("Hello, " + name);\n}'),
  ]);                                                                     // 05-13

  // 05-14 簡單表格 3×3（含標題列）
  const table = ops.root('table', { columnCount: 3, hasColumnHeader: true });
  let prevRow: string | null = null;
  for (const cells of [
    ['欄位 A', '欄位 B', '欄位 C'],
    ['資料 1', '資料 2', '資料 3'],
    ['資料 4', '資料 5', '資料 6'],
  ]) {
    prevRow = ops.child(table, 'tableRow', { cells: cells.map((c) => [t(c)]) }, [], prevRow);
  }

  ops.root('equation', { expression: 'E=mc^2' });                         // 05-15
  ops.root('tableOfContents');                                            // 05-16

  const synced = ops.root('syncedBlock', { syncedFrom: null });           // 05-17
  ops.child(synced, 'paragraph', {}, [
    t('同步區塊 Synced block 的內容，可以在其他頁面貼上。'),
  ]);

  const columnList = ops.root('columnList');                              // 05-18
  const col1 = ops.child(columnList, 'column', { ratio: 0.5 });
  const col2 = ops.child(columnList, 'column', { ratio: 0.5 }, [], col1);
  ops.child(col1, 'paragraph', {}, [t('第 1 欄的內容')]);
  ops.child(col2, 'paragraph', {}, [t('第 2 欄的內容')]);

  ops.root('page', { pageId: sub.id });                                   // 05-19
  ops.root('bookmark', {                                                  // 05-20
    url: 'https://www.notion.so',
    meta: {
      title: 'The AI workspace that works for you. | Notion',
      description:
        'Build Custom Agents, search across all your apps, and automate busywork. The AI workspace where teams get more done, faster.',
      coverUrl: IMAGE_URL,
      status: 'ok',
    },
  });
  ops.root('image', { externalUrl: IMAGE_URL });                          // 05-21

  /**
   * 行內樣式總表（粗體 / 斜體 / 底線 / 刪除線 / 行內程式碼 / 連結 / 顏色）。
   * 刻意擺在**最後面**：Notion 參考頁沒有這一段，放在前面會讓整頁往下推，
   * 02-page-top / 02b / 02c 的捲動位置就對不起來了。
   */
  ops.root('paragraph', {}, [
    t('行內樣式：'),
    t('粗體', [{ t: 'b' }]), t('、'),
    t('斜體', [{ t: 'i' }]), t('、'),
    t('底線', [{ t: 'u' }]), t('、'),
    t('刪除線', [{ t: 's' }]), t('、'),
    t('inline code', [{ t: 'code' }]), t('、'),
    t('連結', [{ t: 'link', href: 'https://www.notion.so' }]), t('、'),
    t('紅字', [{ t: 'color', fg: 'red' }]), t('、'),
    t('黃底', [{ t: 'color', bg: 'yellow' }]), t('。'),
  ]);

  // 07-* 內嵌資料庫
  ops.root('collectionView', {
    collectionId,
    viewIds: [tableView.id, board.id, list.id, gallery.id, calendar.id, ...(timeline ? [timeline.id] : [])],
  });

  await api.call(`/pages/${page.id}/transactions`, {
    method: 'POST',
    body: { txId: randomUUID(), originSessionId: 'seed', ops: ops.list },
  });

  return {
    workspaceId,
    pageId: page.id,
    subPageId: sub.id,
    collectionId,
    viewIds: {
      table: tableView.id,
      board: board.id,
      list: list.id,
      gallery: gallery.id,
      calendar: calendar.id,
      timeline: timeline?.id ?? null,
    },
    accessToken: auth.accessToken,
  };
}
