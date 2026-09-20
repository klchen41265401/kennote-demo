/**
 * 種子資料。內容**對照 `e2e/fixtures/reference-page.ts`**（21 種 block +
 * 6 種視圖 + 6 筆資料），只是把 HTTP 呼叫換成直接呼叫 demo 的 service 層。
 *
 * 只在「IndexedDB 是空的」時跑一次；設定頁的「重設 Demo 資料」會清空後重跑。
 */
import type { CollectionSchema, RichText, RowProperties, Transaction } from '@kennote/shared-types';
import { applyTransaction, createPage } from './core';
import { createDatabase, createRow } from './handlers/databases';
import { ensureDemoUser } from './handlers/auth';
import { commit, db } from './store';
import { nowIso, uuid } from './util';

export const REFERENCE_TITLE = '【kennote 參考用】';
export const SUBPAGE_TITLE = '子頁面範例 Sub-page';
export const DATABASE_TITLE = '參考資料庫';
export const WORKSPACE_NAME = 'kennote Demo';

const IMAGE_URL = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200&q=70';

type Mark =
  | { t: 'b' } | { t: 'i' } | { t: 'u' } | { t: 's' } | { t: 'code' }
  | { t: 'link'; href: string }
  | { t: 'color'; fg?: string; bg?: string };

const t = (text: string, marks?: Mark[]): RichText[number] =>
  (marks ? { text, marks } : { text }) as RichText[number];

/* ── ops builder（與 e2e fixture 同一套）─────────────────── */

class Ops {
  readonly list: Transaction['ops'] = [];
  private lastRoot: string | null = null;

  root(blockType: string, props: Record<string, unknown> = {}, content: RichText = []): string {
    const blockId = uuid();
    this.list.push({
      type: 'block.insert',
      blockId,
      parentId: null,
      afterId: this.lastRoot,
      blockType: blockType as never,
      props,
      content,
    });
    this.lastRoot = blockId;
    return blockId;
  }

  child(
    parentId: string,
    blockType: string,
    props: Record<string, unknown> = {},
    content: RichText = [],
    afterId: string | null = null,
  ): string {
    const blockId = uuid();
    this.list.push({
      type: 'block.insert',
      blockId,
      parentId,
      afterId,
      blockType: blockType as never,
      props,
      content,
    });
    return blockId;
  }
}

/* ── 資料庫 schema / 資料 ───────────────────────────────── */

const SCHEMA: CollectionSchema = {
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
};

interface SeedRow {
  title: string;
  Sta1: string;
  Tag1: string[];
  Due1: string;
  Num1: number;
  Chk1: boolean;
  Ppl1: string[];
  Url1: string;
}

function seedRows(userId: string, baseDate: string): SeedRow[] {
  const day = (n: number): string => {
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

function propertiesOf(row: SeedRow): RowProperties {
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

/* ── 主流程 ─────────────────────────────────────────────── */

export interface SeedResult {
  workspaceId: string;
  pageId: string;
  subPageId: string;
  collectionId: string;
  viewIds: Record<string, string>;
}

export function seedDemoData(): SeedResult {
  const state = db();
  const user = ensureDemoUser();
  state.sessionUserId = user.id;

  const workspaceId = uuid();
  state.workspaces[workspaceId] = {
    id: workspaceId,
    name: WORKSPACE_NAME,
    slug: 'kennote-demo',
    icon: '🗒️',
    role: 'owner',
    createdAt: nowIso(),
    deletedAt: null,
  };

  /* 1. 主頁 */
  const page = createPage({
    workspaceId,
    title: [t(REFERENCE_TITLE)],
    icon: '⭐',
    cover: 'gradient:dawn#y=50',
    seedParagraph: false,
  });
  state.favorites.push({ pageId: page.id, userId: user.id, at: nowIso() });

  /* 2. 子頁面 */
  const sub = createPage({
    workspaceId,
    parentId: page.id,
    title: [t(SUBPAGE_TITLE)],
    icon: '📄',
  });

  /* 3. inline database（先建，collectionView block 才有 id 可以指） */
  const { collection, views } = createDatabase({
    workspaceId,
    parentId: page.id,
    title: [t(DATABASE_TITLE)],
    schema: SCHEMA,
    inline: true,
  });
  const collectionId = collection.id;
  const propertyFormat = Object.keys(SCHEMA).map((property, i) => ({
    property,
    visible: i < 5,
    width: property === 'title' ? 280 : 160,
  }));

  const tableView = views[0]!;
  tableView.name = '表格';
  tableView.format = { properties: propertyFormat, tableFreezeColumns: 1, tableRowNumbers: false };

  const mkView = (input: Parameters<typeof addView>[1]) => addView(collectionId, input);
  const board = mkView({
    type: 'board',
    name: '看板',
    query: { groupBy: { property: 'Sta1', hideEmptyGroups: false } },
    format: { boardColumnWidth: 260, boardCover: { type: 'none' }, properties: propertyFormat },
  });
  const list = mkView({
    type: 'list',
    name: '清單',
    format: { listShowProperties: true, properties: propertyFormat },
  });
  const gallery = mkView({
    type: 'gallery',
    name: '圖庫',
    format: { galleryCover: { type: 'pageCover' }, gallerySize: 'medium', galleryFitImage: true, properties: propertyFormat },
  });
  const calendar = mkView({
    type: 'calendar',
    name: '日曆',
    format: { calendarDateProperty: 'Due1', calendarShowWeekend: true, properties: propertyFormat },
  });
  const timeline = mkView({
    type: 'timeline',
    name: '時程表',
    format: {
      timelineStartProperty: 'Due1',
      timelineEndProperty: null,
      timelineScale: 'month',
      timelineShowTable: true,
      timelineTableWidth: 200,
      properties: propertyFormat,
    },
  });

  /* 4. 六筆資料 */
  const baseDate = new Date().toISOString().slice(0, 10);
  for (const row of seedRows(user.id, baseDate)) {
    createRow(collectionId, { title: row.title, properties: propertiesOf(row) });
  }

  /* 5. 一整批 block.insert —— 順序對照 e2e fixture 的 05-01 … 05-21 */
  const ops = new Ops();
  ops.root('paragraph', {}, [
    t('這是一段普通段落文字 paragraph block。Notion text block 預設字型 16px。'),
  ]);
  ops.root('heading1', {}, [t('標題一 Heading 1')]);
  ops.root('heading2', {}, [t('標題二 Heading 2')]);
  ops.root('heading3', {}, [t('標題三 Heading 3')]);
  ops.root('todo', { checked: false }, [t('未勾選的待辦事項')]);
  ops.root('todo', { checked: true }, [t('已勾選的待辦事項')]);

  ops.root('bulletedList', {}, [t('項目符號清單 第一項')]);
  const bullet2 = ops.root('bulletedList', {}, [t('第二項')]);
  ops.child(bullet2, 'bulletedList', {}, [t('巢狀子項目 (Tab 縮排)')]);
  ops.root('bulletedList', {}, [t('第三項')]);

  ops.root('numberedList', {}, [t('編號清單 第一項')]);
  ops.root('numberedList', {}, [t('第二項')]);
  ops.root('numberedList', {}, [t('第三項')]);

  const toggle = ops.root('toggle', { defaultOpen: true }, [t('折疊清單 Toggle list')]);
  ops.child(toggle, 'paragraph', {}, [t('折疊裡面的內容，點箭頭可以收合。')]);

  ops.root('quote', {}, [t('這是一段引言 blockquote，左側有一條粗線。')]);
  ops.root('divider');
  ops.root('callout', { icon: '💡' }, [t('這是一個標註 callout，預設有燈泡 emoji 與背景色。')]);
  ops.root('code', { language: 'javascript' }, [
    t('function greet(name) {\n  console.log("Hello, " + name);\n}'),
  ]);

  const table = ops.root('table', { columnCount: 3, hasColumnHeader: true });
  let prevRow: string | null = null;
  for (const cells of [
    ['欄位 A', '欄位 B', '欄位 C'],
    ['資料 1', '資料 2', '資料 3'],
    ['資料 4', '資料 5', '資料 6'],
  ]) {
    prevRow = ops.child(table, 'tableRow', { cells: cells.map((c) => [t(c)]) }, [], prevRow);
  }

  ops.root('equation', { expression: 'E=mc^2' });
  ops.root('tableOfContents');

  const synced = ops.root('syncedBlock', { syncedFrom: null });
  ops.child(synced, 'paragraph', {}, [t('同步區塊 Synced block 的內容，可以在其他頁面貼上。')]);

  const columnList = ops.root('columnList');
  const col1 = ops.child(columnList, 'column', { ratio: 0.5 });
  const col2 = ops.child(columnList, 'column', { ratio: 0.5 }, [], col1);
  ops.child(col1, 'paragraph', {}, [t('第 1 欄的內容')]);
  ops.child(col2, 'paragraph', {}, [t('第 2 欄的內容')]);

  ops.root('page', { pageId: sub.id });
  ops.root('bookmark', {
    url: 'https://www.notion.so',
    meta: {
      title: 'The AI workspace that works for you. | Notion',
      description:
        'Build Custom Agents, search across all your apps, and automate busywork.',
      coverUrl: IMAGE_URL,
      status: 'ok',
    },
  });
  ops.root('image', { externalUrl: IMAGE_URL });

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

  ops.root('collectionView', {
    collectionId,
    viewIds: [tableView.id, board.id, list.id, gallery.id, calendar.id, timeline.id],
  });

  applyTransaction(page.id, {
    txId: uuid(),
    pageId: page.id,
    originSessionId: 'demo-seed',
    ops: ops.list,
  });

  /* 6. 範本頁與筆記頁（首頁「最近造訪」才有東西） */
  const meeting = createPage({ workspaceId, title: [t('會議記錄範本')], icon: '📝', seedParagraph: false });
  applyTransaction(meeting.id, {
    txId: uuid(),
    pageId: meeting.id,
    originSessionId: 'demo-seed',
    ops: (() => {
      const o = new Ops();
      o.root('heading2', {}, [t('議程')]);
      o.root('bulletedList', {}, [t('上週進度回顧')]);
      o.root('bulletedList', {}, [t('本週目標')]);
      o.root('bulletedList', {}, [t('阻礙與風險')]);
      o.root('heading2', {}, [t('待辦')]);
      o.root('todo', { checked: false }, [t('把結論寄給團隊')]);
      o.root('todo', { checked: false }, [t('更新專案時程')]);
      o.root('divider');
      o.root('callout', { icon: '📌' }, [t('這是一個範本頁：複製它就能開始新的會議記錄。')]);
      return o.list;
    })(),
  });

  const notes = createPage({ workspaceId, title: [t('讀書筆記')], icon: '📚', seedParagraph: false });
  applyTransaction(notes.id, {
    txId: uuid(),
    pageId: notes.id,
    originSessionId: 'demo-seed',
    ops: (() => {
      const o = new Ops();
      o.root('paragraph', {}, [t('在這裡試試看：按 Enter 換行，打 `/` 會跳出 164 項的指令選單。')]);
      o.root('quote', {}, [t('「所有的資料都存在你的瀏覽器裡，重新整理也不會消失。」')]);
      o.root('heading3', {}, [t('小技巧')]);
      o.root('bulletedList', {}, [t('Ctrl+K 快速尋找')]);
      o.root('bulletedList', {}, [t('拖曳左側手把可以搬移區塊')]);
      return o.list;
    })(),
  });

  /* 7. 最近造訪：首頁一進去就有內容 */
  const at = Date.now();
  state.visits = [
    { pageId: notes.id, userId: user.id, at: new Date(at - 3 * 60_000).toISOString() },
    { pageId: meeting.id, userId: user.id, at: new Date(at - 2 * 60_000).toISOString() },
    { pageId: sub.id, userId: user.id, at: new Date(at - 60_000).toISOString() },
    { pageId: page.id, userId: user.id, at: new Date(at).toISOString() },
  ];

  state.seededAt = nowIso();
  commit();

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
      timeline: timeline.id,
    },
  };
}

/** createDatabase 只建 table 視圖；其餘視圖用這支補 */
function addView(
  collectionId: string,
  input: { type: string; name: string; query?: Record<string, unknown>; format?: Record<string, unknown> },
) {
  const state = db();
  const collection = state.collections[collectionId]!;
  const at = new Date(Date.now() + Object.keys(state.views).length).toISOString();
  const view = {
    id: uuid(),
    workspaceId: collection.workspaceId,
    collectionId,
    type: input.type as never,
    name: input.name,
    query: (input.query ?? {}) as never,
    format: (input.format ?? {}) as never,
    manualOrder: [] as string[],
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  state.views[view.id] = view;
  return view;
}
