/**
 * 匯出服務。**這一層不認識 HTTP**（04 §7.3 鐵則 1）。
 *
 * 01 §10 M9.2：「資料可攜性是信任基礎，MVP 就要有」。
 * 單頁 → 單檔；含子頁面 / 含附件 / 含 database → zip（自寫的最小 ZIP writer）。
 */
import type { ExportFormat, ExportPageRequest } from '@kennote/shared-types';
import { db } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { AppError } from '../../lib/errors.js';
import { exportCsv } from '../databases/service.js';
import { toBlock, type BlockRow } from '../blocks/repo.js';
import { toPage, PAGE_COLUMNS, type PageRow } from '../pages/repo.js';
import { createStorage } from '../files/storage/index.js';
import { loadPageTree, safeFileName, walkTree, type ExportNode } from './doc.js';
import { pageToHtml, docToHtmlFragment, EXPORT_CSS } from './html.js';
import { pageToMarkdown, type SerializeContext } from './markdown.js';
import { createZip, type ZipEntryInput } from './zip.js';

export interface ExportOutput {
  filename: string;
  contentType: string;
  body: Buffer;
}

const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;

export async function exportPage(
  pageId: string,
  userId: string,
  request: ExportPageRequest,
): Promise<ExportOutput> {
  if (request.format === 'pdf') {
    // ADR 0005：server 容器沒有瀏覽器，不裝 Playwright。
    throw new AppError(
      'NOT_IMPLEMENTED',
      'PDF 匯出改由瀏覽器列印產生：請先匯出 HTML，或在頁面上按「列印 → 另存為 PDF」（匯出對話框的 PDF 選項會直接開啟列印視窗）。',
      { format: 'pdf', alternative: 'html' },
    );
  }

  const includeSubpages = request.includeSubpages ?? false;
  const includeAttachments = request.includeAttachments ?? true;
  const tree = await loadPageTree(pageId, userId, { includeSubpages });

  const nodes: ExportNode[] = [];
  walkTree(tree, (node) => nodes.push(node));
  const databases = nodes.filter((n) => n.page.isDatabase && n.page.collectionId);

  if (request.format === 'csv') return exportAsCsv(tree, nodes, userId);
  if (request.format === 'json') return exportAsJson(tree, nodes, userId, includeSubpages);

  const multi = nodes.length > 1 || databases.length > 0;
  const attachments = includeAttachments ? await collectAttachments(nodes) : new Map();

  if (!multi && attachments.size === 0) {
    const ctx = singleFileContext();
    const page = tree.page;
    if (request.format === 'html') {
      return {
        filename: `${safeFileName(page.title)}.html`,
        contentType: 'text/html; charset=utf-8',
        body: Buffer.from(pageToHtml(page, ctx), 'utf8'),
      };
    }
    return {
      filename: `${safeFileName(page.title)}.md`,
      contentType: 'text/markdown; charset=utf-8',
      body: Buffer.from(pageToMarkdown(page, ctx), 'utf8'),
    };
  }

  return exportAsZip(tree, nodes, databases, attachments, userId, request.format);
}

/* ── 單頁（沒有 zip，連結就只能指回 API） ───────────── */

function singleFileContext(): SerializeContext {
  return {
    pagePath: () => null,
    filePath: () => null,
    csvPath: () => null,
    selfPath: '',
  };
}

/* ── CSV ──────────────────────────────────────────────── */

async function exportAsCsv(
  tree: ExportNode,
  nodes: ExportNode[],
  userId: string,
): Promise<ExportOutput> {
  const databases = nodes.filter((n) => n.page.isDatabase && n.page.collectionId);
  if (databases.length === 0) {
    throw new AppError('BAD_REQUEST', '只有資料庫頁面可以匯出成 CSV', { pageId: tree.page.id });
  }
  if (databases.length === 1) {
    const only = databases[0]!;
    const csv = await exportCsv(only.page.collectionId!, userId);
    return {
      filename: `${safeFileName(only.page.title)}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: Buffer.from(csv, 'utf8'),
    };
  }
  const entries: ZipEntryInput[] = [];
  for (const node of databases) {
    entries.push({
      name: `${node.path}.csv`,
      data: await exportCsv(node.page.collectionId!, userId),
    });
  }
  return zipOutput(tree, entries);
}

/* ── JSON（record_map 原樣） ─────────────────────────── */

async function exportAsJson(
  tree: ExportNode,
  nodes: ExportNode[],
  userId: string,
  includeSubpages: boolean,
): Promise<ExportOutput> {
  const pageIds = nodes.map((n) => n.page.id);
  const pageRows = await db.query<PageRow>(sql`
    SELECT ${PAGE_COLUMNS} FROM pages
     WHERE id = ANY(${pageIds}::uuid[]) AND deleted_at IS NULL
  `);
  // database 的列也要一起帶走，否則匯出的資料庫是空的
  const rowPages = includeSubpages
    ? await db.query<PageRow>(sql`
        SELECT ${PAGE_COLUMNS} FROM pages
         WHERE parent_id = ANY(${pageIds}::uuid[]) AND collection_id IS NOT NULL
           AND deleted_at IS NULL
      `)
    : [];
  const allPages = [...pageRows, ...rowPages];
  const allIds = allPages.map((p) => p.id);
  const blockRows = await db.query<BlockRow>(sql`
    SELECT id, workspace_id, page_id, parent_id, type, props, content, children, version,
           created_by, updated_by, created_at, updated_at, deleted_at
      FROM blocks
     WHERE page_id = ANY(${allIds}::uuid[]) AND deleted_at IS NULL
  `);
  const collections = await db.query<{ id: string; schema: unknown; name: unknown }>(sql`
    SELECT id, schema, name FROM collections
     WHERE page_id = ANY(${pageIds}::uuid[]) AND deleted_at IS NULL
  `);

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: userId,
    rootPageId: tree.page.id,
    recordMap: {
      page: Object.fromEntries(allPages.map((p) => [p.id, { value: toPage(p), role: 'editor' }])),
      block: Object.fromEntries(blockRows.map((b) => [b.id, { value: toBlock(b), role: 'editor' }])),
      collection: Object.fromEntries(collections.map((c) => [c.id, { value: c, role: 'editor' }])),
    },
  };
  return {
    filename: `${safeFileName(tree.page.title)}.json`,
    contentType: 'application/json; charset=utf-8',
    body: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
  };
}

/* ── 附件 ─────────────────────────────────────────────── */

interface Attachment {
  fileId: string;
  zipPath: string;
  storageKey: string;
}

function collectFileIds(nodes: ExportNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    for (const block of Object.values(node.page.doc.blocks)) {
      const fileId = block.props.fileId;
      if (typeof fileId === 'string' && fileId) ids.add(fileId);
    }
    for (const value of Object.values(node.page.properties ?? {})) {
      const files = (value as { files?: Array<{ fileId?: string }> }).files;
      if (!Array.isArray(files)) continue;
      for (const f of files) if (f.fileId) ids.add(f.fileId);
    }
  }
  return ids;
}

async function collectAttachments(nodes: ExportNode[]): Promise<Map<string, Attachment>> {
  const ids = [...collectFileIds(nodes)];
  const out = new Map<string, Attachment>();
  if (ids.length === 0) return out;

  const rows = await db.query<{
    id: string;
    storage_key: string;
    original_name: string;
    size: number;
  }>(sql`
    SELECT id, storage_key, original_name, size FROM files
     WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL
  `);

  const used = new Set<string>();
  let total = 0;
  for (const row of rows) {
    total += Number(row.size);
    if (total > MAX_ATTACHMENT_BYTES) break;
    const ext = row.original_name.includes('.') ? row.original_name.split('.').pop()! : 'bin';
    let name = safeFileName(row.original_name);
    if (used.has(name.toLowerCase())) name = `${row.id.slice(0, 8)}-${name}`;
    if (!name.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) name = `${name}.${ext}`;
    used.add(name.toLowerCase());
    out.set(row.id, { fileId: row.id, zipPath: `files/${name}`, storageKey: row.storage_key });
  }
  return out;
}

async function readAttachment(attachment: Attachment): Promise<Buffer | null> {
  try {
    const stream = await createStorage().get(attachment.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks);
  } catch {
    // 檔案在磁碟上不見了不該讓整包匯出失敗
    return null;
  }
}

/* ── zip ──────────────────────────────────────────────── */

async function exportAsZip(
  tree: ExportNode,
  nodes: ExportNode[],
  databases: ExportNode[],
  attachments: Map<string, Attachment>,
  userId: string,
  format: ExportFormat,
): Promise<ExportOutput> {
  const ext = format === 'html' ? 'html' : 'md';
  const pathById = new Map(nodes.map((n) => [n.page.id, n.path]));
  const csvByCollection = new Map(
    databases.map((n) => [n.page.collectionId!, `${n.path}.csv`] as const),
  );

  const contextFor = (node: ExportNode): SerializeContext => ({
    pagePath: (id) => pathById.get(id) ?? null,
    filePath: (id) => attachments.get(id)?.zipPath ?? null,
    csvPath: (id) => csvByCollection.get(id) ?? null,
    selfPath: `${node.path}.${ext}`,
  });

  const entries: ZipEntryInput[] = [];
  for (const node of nodes) {
    const ctx = contextFor(node);
    entries.push({
      name: `${node.path}.${ext}`,
      data: format === 'html' ? pageToHtml(node.page, ctx) : pageToMarkdown(node.page, ctx),
    });
    if (node.page.isDatabase && node.page.collectionId) {
      entries.push({ name: `${node.path}.csv`, data: await exportCsv(node.page.collectionId, userId) });
    }
  }

  for (const attachment of attachments.values()) {
    const buf = await readAttachment(attachment);
    if (buf) entries.push({ name: attachment.zipPath, data: buf, store: true });
  }

  entries.push({ name: 'kennote-export.txt', data: manifest(tree, nodes, format) });
  return zipOutput(tree, entries);
}

function manifest(tree: ExportNode, nodes: ExportNode[], format: ExportFormat): string {
  return [
    'kennote 匯出檔',
    `匯出時間：${new Date().toISOString()}`,
    `根頁面：${tree.page.title}`,
    `頁面數：${nodes.length}`,
    `格式：${format}`,
    '',
    '子頁面連結是相對路徑，附件在 files/ 底下。',
    'Markdown 可直接用 Obsidian / Typora 開啟；HTML 是自包含單檔，用瀏覽器列印即可另存 PDF。',
  ].join('\n');
}

function zipOutput(tree: ExportNode, entries: ZipEntryInput[]): ExportOutput {
  return {
    filename: `${safeFileName(tree.page.title)}.zip`,
    contentType: 'application/zip',
    body: createZip(entries),
  };
}

/** 給前端列印樣式用：與匯出 HTML 同一份 CSS */
export { EXPORT_CSS, docToHtmlFragment };
