/**
 * 匯出用的「頁面文件」載入與路徑規劃。
 *
 * 匯出跟編輯器看到的是**同一份資料**（blocks 表），所以這裡不做任何轉換，
 * 只是把 DB 的列整理成 editor-core 的 DocFragment 形狀（rootIds + blocks map），
 * 讓 markdown.ts / html.ts 可以直接重用 editor-core 的 inline 序列化。
 */
import type { Block as CoreBlock, DocFragment } from '@kennote/editor-core/src/model/types.js';
import type { RichText, RowProperties } from '@kennote/shared-types';
import { richTextToPlainText } from '@kennote/shared-types';
import { db } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { pageNotFound } from '../../lib/errors.js';

export interface ExportPage {
  id: string;
  workspaceId: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  isDatabase: boolean;
  collectionId: string | null;
  properties: RowProperties;
  updatedAt: string;
  doc: DocFragment;
}

export interface ExportNode {
  page: ExportPage;
  children: ExportNode[];
  /** zip 內的完整路徑（不含副檔名），例：`工程筆記/2026 規劃` */
  path: string;
}

interface PageRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: RichText;
  icon: string | null;
  children: string[];
  is_database: boolean;
  collection_id: string | null;
  properties: RowProperties;
  updated_at: Date;
  sort_key: string;
}

interface BlockRow {
  id: string;
  page_id: string;
  parent_id: string | null;
  type: string;
  props: Record<string, unknown>;
  content: RichText;
  children: string[];
}

/** 一次撈整棵子樹的頁面（含權限檢查：非成員看不到 = 404） */
export async function loadPageTree(
  pageId: string,
  userId: string,
  options: { includeSubpages: boolean; maxPages?: number },
): Promise<ExportNode> {
  const maxPages = options.maxPages ?? 500;
  const root = await db.queryOne<PageRow>(sql`
    SELECT p.id, p.workspace_id, p.parent_id, p.title, p.icon, p.children,
           p.is_database, p.collection_id, p.properties, p.updated_at, p.sort_key
      FROM pages p
      JOIN workspace_members m
        ON m.workspace_id = p.workspace_id AND m.user_id = ${userId} AND m.deleted_at IS NULL
     WHERE p.id = ${pageId} AND p.deleted_at IS NULL
  `);
  if (!root) throw pageNotFound();

  let rows: PageRow[] = [root];
  if (options.includeSubpages) {
    rows = await db.query<PageRow>(sql`
      WITH RECURSIVE sub AS (
        SELECT p.id, 0 AS depth FROM pages p WHERE p.id = ${pageId}
        UNION ALL
        SELECT c.id, sub.depth + 1 FROM pages c JOIN sub ON c.parent_id = sub.id
         WHERE c.deleted_at IS NULL AND sub.depth < 20
      )
      SELECT p.id, p.workspace_id, p.parent_id, p.title, p.icon, p.children,
             p.is_database, p.collection_id, p.properties, p.updated_at, p.sort_key
        FROM pages p JOIN sub ON sub.id = p.id
       WHERE p.deleted_at IS NULL
       ORDER BY p.sort_key ASC
       LIMIT ${maxPages}
    `);
    if (rows.length === 0) rows = [root];
  }

  const pageIds = rows.map((r) => r.id);
  const blockRows = await db.query<BlockRow>(sql`
    SELECT b.id, b.page_id, b.parent_id, b.type, b.props, b.content, b.children
      FROM blocks b
     WHERE b.page_id = ANY(${pageIds}::uuid[]) AND b.deleted_at IS NULL
  `);

  const byPage = new Map<string, BlockRow[]>();
  for (const b of blockRows) {
    const list = byPage.get(b.page_id);
    if (list) list.push(b);
    else byPage.set(b.page_id, [b]);
  }

  const pages = new Map<string, ExportPage>();
  for (const row of rows) {
    pages.set(row.id, {
      id: row.id,
      workspaceId: row.workspace_id,
      parentId: row.parent_id,
      title: richTextToPlainText(row.title) || '未命名',
      icon: row.icon,
      isDatabase: row.is_database,
      collectionId: row.collection_id,
      properties: (row.properties ?? {}) as RowProperties,
      updatedAt: row.updated_at.toISOString(),
      doc: toDocFragment(row, byPage.get(row.id) ?? []),
    });
  }

  return buildTree(pageId, rows, pages);
}

function toDocFragment(page: PageRow, blocks: BlockRow[]): DocFragment {
  const map: Record<string, CoreBlock> = {};
  for (const b of blocks) {
    map[b.id] = {
      id: b.id,
      parentId: b.parent_id,
      type: b.type as CoreBlock['type'],
      props: b.props ?? {},
      content: (b.content ?? []) as CoreBlock['content'],
      children: (b.children ?? []).filter((id) => id),
      version: 1,
    };
  }
  // children 陣列是排序真值；保險起見補上「有 parent_id 但不在 children 裡」的孤兒
  const referenced = new Set<string>(page.children ?? []);
  for (const b of blocks) for (const c of b.children ?? []) referenced.add(c);
  const rootIds = (page.children ?? []).filter((id) => map[id]);
  for (const b of blocks) {
    if (b.parent_id === null && !referenced.has(b.id)) rootIds.push(b.id);
  }
  return { rootIds, blocks: map };
}

function buildTree(
  rootId: string,
  rows: PageRow[],
  pages: Map<string, ExportPage>,
): ExportNode {
  const childrenOf = new Map<string, PageRow[]>();
  for (const row of rows) {
    if (row.id === rootId || !row.parent_id) continue;
    const list = childrenOf.get(row.parent_id);
    if (list) list.push(row);
    else childrenOf.set(row.parent_id, [row]);
  }

  const used = new Set<string>();
  const make = (id: string, dir: string): ExportNode => {
    const page = pages.get(id)!;
    const slug = uniqueSlug(page.title, page.id, dir, used);
    const path = dir ? `${dir}/${slug}` : slug;
    const kids = (childrenOf.get(id) ?? [])
      // database 的「列」也是 pages，但它們屬於 CSV，不該各自變成一個 .md 檔。
      // 容器頁（is_database=true）要保留 —— 它同樣有 collection_id。
      .filter((row) => row.is_database || !row.collection_id)
      .map((row) => make(row.id, path));
    return { page, children: kids, path };
  };
  return make(rootId, '');
}

/** 檔名安全化：Windows / macOS / Linux 三邊都能用 */
export function safeFileName(input: string): string {
  const cleaned = (input || '未命名')
    // 控制字元在檔名裡是真的會出事（Windows 直接拒絕、Linux 產生打不開的怪檔名），
    // 所以這裡刻意要比對它們。
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : '未命名';
}

function uniqueSlug(title: string, id: string, dir: string, used: Set<string>): string {
  const base = safeFileName(title);
  let slug = base;
  let key = `${dir}/${slug}`.toLowerCase();
  if (used.has(key)) {
    // 撞名就補頁面 id 的前 8 碼（與 Notion 的 `Title <32hex>` 同樣的解法）
    slug = `${base} ${id.replace(/-/g, '').slice(0, 8)}`;
    key = `${dir}/${slug}`.toLowerCase();
  }
  used.add(key);
  return slug;
}

/** 把 zip 內的絕對路徑轉成「從 fromPath 出發」的相對路徑 */
export function relativePath(fromPath: string, toPath: string): string {
  const from = fromPath.split('/').slice(0, -1);
  const to = toPath.split('/');
  const file = to.pop() ?? '';
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const up = from.slice(i).map(() => '..');
  const down = to.slice(i);
  const parts = [...up, ...down, file];
  return parts.join('/') || file;
}

/** 走訪整棵樹（前序） */
export function walkTree(node: ExportNode, visit: (node: ExportNode) => void): void {
  visit(node);
  for (const child of node.children) walkTree(child, visit);
}
