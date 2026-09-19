/**
 * 匯入服務。**這一層不認識 HTTP**（04 §7.3 鐵則 1）。
 *
 * ⭐ 紀律：所有 block 的建立都走 `applyTransaction()`，**不直接 INSERT INTO blocks**
 *    （00-README §5 風險二）。匯入是最容易破戒的地方（「反正是批次，直接塞比較快」），
 *    但破了戒，M6 的 OT 與版本歷史就會漏掉這一整批內容。
 *
 * 支援來源（01 §10 M9.1）：
 *   .md / .markdown / .txt / .html   單檔
 *   .csv                              一個資料庫
 *   .zip                              Notion 官方匯出（Markdown & CSV 或 HTML）
 */
import type {
  CollectionSchema,
  FieldValue,
  ImportResult,
  ImportSource,
  ImportedPageRef,
  Operation,
  RichText,
  RowProperties,
} from '@kennote/shared-types';
import type { Block as CoreBlock, DocFragment } from '@kennote/editor-core/src/model/types.js';
import { parsePlainTextToBlocks } from '@kennote/editor-core/src/clipboard/parse-markdown.js';
import { db } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { AppError, workspaceNotFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { applyTransaction } from '../blocks/apply-transaction.js';
import { createDatabase, createRow } from '../databases/service.js';
import { getFieldType } from '../databases/field-types/index.js';
import { insertFile } from '../files/repo.js';
import { buildStorageKey, createStorage, detectFileType } from '../files/storage/index.js';
import { createPage } from '../pages/service.js';
import { getMemberRole } from '../workspaces/repo.js';
import { ZipArchive, type ZipEntry } from '../export/zip.js';
import { normalizeCellForImport, parseCsv, planCsvSchema } from './csv.js';
import { markdownToFragment } from './markdown.js';
import { htmlToBlocks } from './mini-html.js';
import { createLinkResolver, planNotionImport, type NotionNode } from './notion.js';

/** 一次 transaction 最多 200 個 op（MAX_OPS_PER_TRANSACTION），這裡留一點餘裕 */
const OPS_PER_TX = 150;
const MAX_ROWS_PER_CSV = 2000;
const MAX_ASSETS = 500;
const MAX_PAGES = 500;

export interface ImportInput {
  workspaceId: string;
  parentId?: string | null;
  filename: string;
  data: Buffer;
}

export function detectSource(filename: string, data: Buffer): ImportSource {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.zip')) return 'notionZip';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.txt')) return 'text';
  // 沒有副檔名時看內容：PK 開頭是 zip
  if (data.length > 4 && data[0] === 0x50 && data[1] === 0x4b) return 'notionZip';
  const head = data.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html';
  return 'markdown';
}

export async function importFile(input: ImportInput, userId: string): Promise<ImportResult> {
  if (!(await getMemberRole(input.workspaceId, userId))) throw workspaceNotFound();
  if (input.parentId) {
    const parent = await db.queryOne<{ id: string }>(sql`
      SELECT id FROM pages
       WHERE id = ${input.parentId} AND workspace_id = ${input.workspaceId} AND deleted_at IS NULL
    `);
    if (!parent) throw new AppError('PAGE_NOT_FOUND', '找不到要匯入到的父頁面');
  }

  const source = detectSource(input.filename, input.data);
  const ctx: ImportContext = {
    workspaceId: input.workspaceId,
    parentId: input.parentId ?? null,
    userId,
    warnings: [],
    pages: [],
    databases: 0,
  };

  switch (source) {
    case 'notionZip':
      await importNotionZip(input.data, ctx);
      break;
    case 'csv':
      await importCsvAsDatabase(baseName(input.filename), input.data.toString('utf8'), ctx, ctx.parentId);
      break;
    case 'html':
      await importSingleDocument(baseName(input.filename), input.data.toString('utf8'), 'html', ctx);
      break;
    case 'text':
      await importPlainText(baseName(input.filename), input.data.toString('utf8'), ctx);
      break;
    default:
      await importSingleDocument(baseName(input.filename), input.data.toString('utf8'), 'markdown', ctx);
  }

  return {
    createdPages: ctx.pages.filter((p) => !p.isDatabase).length,
    createdDatabases: ctx.databases,
    rootPageId: ctx.pages[0]?.pageId ?? null,
    pages: ctx.pages,
    warnings: ctx.warnings,
    source,
  };
}

interface ImportContext {
  workspaceId: string;
  parentId: string | null;
  userId: string;
  warnings: string[];
  pages: ImportedPageRef[];
  databases: number;
}

function baseName(filename: string): string {
  const file = filename.split(/[\\/]/).pop() ?? filename;
  const dot = file.lastIndexOf('.');
  return (dot > 0 ? file.slice(0, dot) : file).trim() || '匯入的頁面';
}

/* ── 單檔 ─────────────────────────────────────────────── */

async function importSingleDocument(
  fallbackTitle: string,
  text: string,
  kind: 'markdown' | 'html',
  ctx: ImportContext,
): Promise<void> {
  const fragment =
    kind === 'html'
      ? (() => {
          const parsed = htmlToBlocks(text, uuidv7);
          return { fragment: { rootIds: parsed.rootIds, blocks: parsed.blocks }, title: parsed.title };
        })()
      : (() => {
          const parsed = markdownToFragment(text, uuidv7);
          return { fragment: { rootIds: parsed.rootIds, blocks: parsed.blocks }, title: parsed.title };
        })();

  const title = fragment.title ?? fallbackTitle;
  const pageId = await createEmptyPage(title, ctx.parentId, ctx);
  await writeFragment(pageId, fragment.fragment, ctx);
  ctx.pages.push({ pageId, title, isDatabase: false });
}

async function importPlainText(title: string, text: string, ctx: ImportContext): Promise<void> {
  const fragment = parsePlainTextToBlocks(text, { newId: uuidv7 });
  const pageId = await createEmptyPage(title, ctx.parentId, ctx);
  await writeFragment(pageId, fragment, ctx);
  ctx.pages.push({ pageId, title, isDatabase: false });
}

/* ── CSV → database ───────────────────────────────────── */

async function importCsvAsDatabase(
  title: string,
  csvText: string,
  ctx: ImportContext,
  parentId: string | null,
): Promise<string | null> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    ctx.warnings.push(`「${title}」是空的 CSV，已略過`);
    return null;
  }
  const plan = planCsvSchema(rows);
  ctx.warnings.push(...plan.warnings);

  const snapshot = await createDatabase(
    {
      workspaceId: ctx.workspaceId,
      parentId,
      title: [{ text: title }] as RichText,
      schema: plan.schema as CollectionSchema,
    },
    ctx.userId,
  );
  ctx.databases += 1;
  const collectionId = snapshot.collection.id;
  const pageId = snapshot.collection.pageId;
  ctx.pages.push({ pageId, title, isDatabase: true });

  const body = rows.slice(1);
  if (body.length > MAX_ROWS_PER_CSV) {
    ctx.warnings.push(`「${title}」有 ${body.length} 列，只匯入前 ${MAX_ROWS_PER_CSV} 列`);
  }

  for (const row of body.slice(0, MAX_ROWS_PER_CSV)) {
    const properties: RowProperties = {};
    let rowTitle: RichText = [];
    for (const column of plan.columns) {
      const raw = row[column.index] ?? '';
      if (column.propertyId === 'title') {
        rowTitle = raw.trim() ? [{ text: raw.trim() }] : [];
        continue;
      }
      const def = plan.schema[column.propertyId];
      if (!def) continue;
      const text = normalizeCellForImport(column.type, raw);
      if (text === '') continue;
      const fieldType = getFieldType(def.type);
      const value = fieldType.fromPlainText?.(text, def) ?? null;
      if (value) properties[column.propertyId] = value as FieldValue;
    }
    try {
      await createRow(collectionId, ctx.userId, { title: rowTitle, properties });
    } catch (err) {
      ctx.warnings.push(
        `「${title}」有一列匯入失敗：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return pageId;
}

/* ── Notion zip ───────────────────────────────────────── */

async function importNotionZip(data: Buffer, ctx: ImportContext): Promise<void> {
  const archive = ZipArchive.open(data);
  const entries = archive.entries().filter((e) => !e.isDirectory);
  const plan = planNotionImport(entries.map((e) => e.name));
  ctx.warnings.push(...plan.warnings);

  const entryByPath = new Map<string, ZipEntry>();
  for (const entry of entries) entryByPath.set(entry.name, entry);
  const readEntry = (strippedPath: string): ZipEntry | undefined =>
    entryByPath.get(plan.prefix + strippedPath);

  // 1) 附件先上傳，拿到 fileId（圖片連結改寫要用）
  const assetFileIds = new Map<string, string>();
  for (const asset of plan.assets.slice(0, MAX_ASSETS)) {
    const entry = readEntry(asset.path);
    if (!entry) continue;
    try {
      const buf = archive.read(entry);
      const detected = detectFileType(buf);
      if (!detected) {
        ctx.warnings.push(`附件格式不支援，已略過：${asset.name}`);
        continue;
      }
      const fileId = uuidv7();
      const storage = createStorage();
      const key = buildStorageKey(ctx.workspaceId, fileId, detected.ext);
      await storage.put(key, buf, detected.mime);
      await insertFile(db, {
        id: fileId,
        workspaceId: ctx.workspaceId,
        storageKey: key,
        storageDriver: storage.driver,
        originalName: asset.name.slice(0, 500),
        contentType: detected.mime,
        size: buf.length,
        uploadedBy: ctx.userId,
      });
      assetFileIds.set(asset.path, fileId);
    } catch (err) {
      logger.warn({ err, asset: asset.path }, '匯入附件失敗');
      ctx.warnings.push(`附件匯入失敗：${asset.name}`);
    }
  }
  if (plan.assets.length > MAX_ASSETS) {
    ctx.warnings.push(`附件超過 ${MAX_ASSETS} 個，只匯入前 ${MAX_ASSETS} 個`);
  }

  // 2) 先把所有頁面建出來（空的），才有 pageId 可以改寫子頁面連結
  const pageIdByNode = new Map<NotionNode, string>();
  let created = 0;

  const createNodes = async (nodes: NotionNode[], parentId: string | null): Promise<void> => {
    for (const node of nodes) {
      if (created >= MAX_PAGES) {
        ctx.warnings.push(`頁面數超過 ${MAX_PAGES}，其餘未匯入`);
        return;
      }
      if (node.kind === 'database') {
        const entry = node.csvPath ? readEntry(node.csvPath) : undefined;
        if (!entry) {
          ctx.warnings.push(`找不到資料庫的 CSV：${node.title}`);
          continue;
        }
        const pageId = await importCsvAsDatabase(node.title, archive.readText(entry), ctx, parentId);
        if (pageId) {
          pageIdByNode.set(node, pageId);
          created++;
        }
        continue;
      }
      const pageId = await createEmptyPage(node.title, parentId, ctx);
      pageIdByNode.set(node, pageId);
      created++;
      ctx.pages.push({ pageId, title: node.title, isDatabase: false });
      await createNodes(node.children, pageId);
    }
  };
  await createNodes(plan.roots, ctx.parentId);

  // 3) 再灌內容（這時子頁面連結才對得到新 id）
  const resolveLink = createLinkResolver(plan, (node) => pageIdByNode.get(node));
  const fillNodes = async (nodes: NotionNode[]): Promise<void> => {
    for (const node of nodes) {
      const pageId = pageIdByNode.get(node);
      if (!pageId || node.kind !== 'page' || !node.docPath) {
        await fillNodes(node.children);
        continue;
      }
      const entry = readEntry(node.docPath);
      if (!entry) {
        await fillNodes(node.children);
        continue;
      }
      const text = archive.readText(entry);
      const isHtml = /\.html?$/i.test(node.docPath);
      const fragment: DocFragment = isHtml
        ? (() => {
            const parsed = htmlToBlocks(text, uuidv7);
            return { rootIds: parsed.rootIds, blocks: parsed.blocks };
          })()
        : (() => {
            const parsed = markdownToFragment(text, uuidv7);
            return { rootIds: parsed.rootIds, blocks: parsed.blocks };
          })();

      rewriteFragment(fragment, node.docPath, resolveLink, assetFileIds, ctx);
      await writeFragment(pageId, fragment, ctx);
      await fillNodes(node.children);
    }
  };
  await fillNodes(plan.roots);
}

/**
 * 把「指向 zip 內其他檔案」的連結改寫成指向新頁面 / 新附件。
 *  - 整段就是一個子頁面連結的段落 → 直接變成 page block（側邊欄才會出現層級）
 *  - 其他連結 → 改成站內路徑 /page/<id>
 *  - 圖片的相對路徑 → 換成已上傳的 fileId
 */
function rewriteFragment(
  fragment: DocFragment,
  docPath: string,
  resolveLink: (href: string, fromPath: string) => string | null,
  assetFileIds: Map<string, string>,
  ctx: ImportContext,
): void {
  const dir = docPath.split('/').slice(0, -1).join('/');
  const resolveAsset = (src: string): string | undefined => {
    if (!src || /^https?:/i.test(src)) return undefined;
    let decoded = src;
    try {
      decoded = decodeURIComponent(src);
    } catch {
      /* 保持原樣 */
    }
    const parts = dir ? dir.split('/') : [];
    for (const part of decoded.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return assetFileIds.get(parts.join('/'));
  };

  for (const block of Object.values(fragment.blocks)) {
    if (block.type === 'image' || block.type === 'video' || block.type === 'file') {
      const src = typeof block.props.externalUrl === 'string' ? block.props.externalUrl : '';
      const fileId = resolveAsset(src);
      if (fileId) {
        block.props = { ...block.props, fileId, externalUrl: null };
      } else if (src && !/^https?:/i.test(src)) {
        ctx.warnings.push(`找不到圖片檔案，已保留原始路徑：${src}`);
      }
      continue;
    }

    // 整段就是一個連結 → 子頁面
    if (block.content.length === 1) {
      const node = block.content[0]!;
      if ('text' in node && node.marks) {
        const link = node.marks.find((m) => m.t === 'link');
        if (link && link.t === 'link') {
          const targetId = resolveLink(link.href, docPath);
          if (targetId && block.children.length === 0) {
            block.type = 'page';
            block.props = { pageId: targetId };
            block.content = [];
            continue;
          }
        }
      }
    }

    block.content = block.content.map((node) => {
      if (!('text' in node) || !node.marks) return node;
      const marks = node.marks.map((mark) => {
        if (mark.t !== 'link') return mark;
        const targetId = resolveLink(mark.href, docPath);
        return targetId ? { t: 'link' as const, href: `/page/${targetId}` } : mark;
      });
      return { text: node.text, marks };
    });
  }
}

/* ── 共用：建頁面 + 寫 block ─────────────────────────── */

async function createEmptyPage(
  title: string,
  parentId: string | null,
  ctx: ImportContext,
): Promise<string> {
  const page = await createPage(
    {
      workspaceId: ctx.workspaceId,
      parentId,
      title: [{ text: title }] as RichText,
    },
    ctx.userId,
  );
  return page.id;
}

/** 把 DocFragment 展平成 block.insert 的順序（前序，afterId 串成一條鏈） */
export function fragmentToOps(
  fragment: DocFragment,
  firstAfterId: string | null,
): Operation[] {
  const ops: Operation[] = [];
  const visit = (ids: string[], parentId: string | null, afterId: string | null): void => {
    let previous = afterId;
    for (const id of ids) {
      const block = fragment.blocks[id];
      if (!block) continue;
      ops.push({
        type: 'block.insert',
        blockId: block.id,
        parentId,
        afterId: previous,
        blockType: block.type as CoreBlock['type'],
        props: block.props,
        content: block.content as RichText,
      } as Operation);
      previous = block.id;
      if (block.children.length > 0) visit(block.children, block.id, null);
    }
  };
  visit(fragment.rootIds, null, firstAfterId);
  return ops;
}

/**
 * 寫入內容。⭐ 一律走 applyTransaction，且切成 ≤150 個 op 一批
 * （MAX_OPS_PER_TRANSACTION = 200；03 §9.5 也要求單一交易不要太長）。
 */
async function writeFragment(
  pageId: string,
  fragment: DocFragment,
  ctx: ImportContext,
): Promise<void> {
  // createPage 會自動建一個空 paragraph；內容插在它後面，最後再把它刪掉
  const row = await db.queryOne<{ children: string[] }>(sql`
    SELECT children FROM pages WHERE id = ${pageId}
  `);
  const placeholder = row?.children?.[0] ?? null;

  const ops = fragmentToOps(fragment, placeholder);
  if (ops.length === 0) return;
  if (placeholder) ops.push({ type: 'block.delete', blockId: placeholder } as Operation);

  for (let i = 0; i < ops.length; i += OPS_PER_TX) {
    const batch = ops.slice(i, i + OPS_PER_TX);
    try {
      await applyTransaction(
        { pageId, userId: ctx.userId },
        {
          txId: uuidv7(),
          pageId,
          originSessionId: 'server:import',
          ops: batch,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err, pageId }, '匯入時有一批 operation 失敗');
      ctx.warnings.push(`有一批內容匯入失敗（已略過）：${message}`);
    }
  }
}
