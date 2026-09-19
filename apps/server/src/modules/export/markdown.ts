/**
 * Block → Markdown。驗收標準（04 §8 M6）：**匯出的 Markdown 可被 Obsidian / Typora 正常開啟**。
 *
 * 因此這裡刻意只用「兩邊都懂」的語法：
 *   標題 / 清單 / 待辦 `- [ ]` / 引言 / ``` fence / 圖片相對路徑 / GFM 表格 / `$$` 公式
 * 兩個例外（Obsidian、Typora、GitHub 都吃得下，且沒有純 Markdown 的等價寫法）：
 *   toggle → `<details><summary>`
 *   callout → `> 💡 內容`（Notion 自己的匯出也是這樣）
 *
 * 行內語法直接重用 editor-core 的 `inlineToMarkdown`（複製貼上與匯出必須一致，
 * 否則「複製到 Obsidian」跟「匯出後在 Obsidian 開」會長不一樣）。
 */
import {
  inlineToMarkdown,
  inlineToPlainText,
} from '@kennote/editor-core/src/clipboard/serialize.js';
import type { Block as CoreBlock, RichText } from '@kennote/editor-core/src/model/types.js';
import type { ExportPage } from './doc.js';
import { relativePath } from './doc.js';

export interface SerializeContext {
  /** pageId → zip 內的完整路徑（不含副檔名）；null = 這一頁沒有一起匯出 */
  pagePath(pageId: string): string | null;
  /** fileId → zip 內的路徑；null = 沒打包附件，改用 `/api/files/:id` */
  filePath(fileId: string): string | null;
  /** collectionId → CSV 在 zip 內的路徑 */
  csvPath(collectionId: string): string | null;
  /** 目前這一頁在 zip 內的完整路徑（含副檔名），算相對連結用 */
  selfPath: string;
}

export function emptyContext(selfPath = ''): SerializeContext {
  return {
    pagePath: () => null,
    filePath: () => null,
    csvPath: () => null,
    selfPath,
  };
}

function prop<T>(block: CoreBlock, key: string): T | undefined {
  return block.props[key] as T | undefined;
}

/** 解析媒體 block 的來源網址（優先用打包進 zip 的相對路徑） */
function mediaSrc(block: CoreBlock, ctx: SerializeContext): string {
  const fileId = prop<string>(block, 'fileId');
  if (fileId) {
    const packed = ctx.filePath(fileId);
    if (packed) return ctx.selfPath ? relativePath(ctx.selfPath, packed) : packed;
    return `/api/files/${fileId}`;
  }
  return prop<string>(block, 'externalUrl') ?? '';
}

function pageLink(ctx: SerializeContext, pageId: string | null | undefined, label: string): string {
  if (!pageId) return label;
  const target = ctx.pagePath(pageId);
  if (!target) return label;
  const href = ctx.selfPath ? relativePath(ctx.selfPath, `${target}.md`) : `${target}.md`;
  return `[${label}](${encodeURI(href)})`;
}

function tableToMarkdown(block: CoreBlock, doc: { blocks: Record<string, CoreBlock> }): string[] {
  const rows = block.children
    .map((id) => doc.blocks[id])
    .filter((b): b is CoreBlock => !!b && b.type === 'tableRow');
  if (rows.length === 0) return [];
  const cellsOf = (row: CoreBlock): string[] =>
    ((row.props.cells as RichText[] | undefined) ?? []).map((cell) =>
      inlineToMarkdown(cell ?? []).replace(/\|/g, '\\|').replace(/\n/g, ' '),
    );
  const hasHeader = block.props.hasColumnHeader !== false;
  const header = cellsOf(rows[0]!);
  const width = Math.max(1, ...rows.map((r) => cellsOf(r).length));
  const pad = (cells: string[]): string[] => {
    const out = cells.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  };

  const lines: string[] = [];
  if (hasHeader) {
    lines.push(`| ${pad(header).join(' | ')} |`);
    lines.push(`| ${pad([]).map(() => '---').join(' | ')} |`);
    for (const row of rows.slice(1)) lines.push(`| ${pad(cellsOf(row)).join(' | ')} |`);
  } else {
    lines.push(`| ${pad([]).map((_, i) => `欄 ${i + 1}`).join(' | ')} |`);
    lines.push(`| ${pad([]).map(() => '---').join(' | ')} |`);
    for (const row of rows) lines.push(`| ${pad(cellsOf(row)).join(' | ')} |`);
  }
  return lines;
}

/**
 * 一個 block → 若干行 Markdown（尚未縮排）。
 * 回 null = 這個 block 自己不輸出，但子層仍然要輸出（columnList / column）。
 */
function blockToLines(
  block: CoreBlock,
  ctx: SerializeContext,
  doc: { blocks: Record<string, CoreBlock> },
  counter: { n: number },
): string[] | null {
  const inner = inlineToMarkdown(block.content);

  switch (block.type) {
    case 'heading1':
      return [`# ${inner}`];
    case 'heading2':
      return [`## ${inner}`];
    case 'heading3':
      return [`### ${inner}`];
    case 'bulletedList':
      return [`- ${inner}`];
    case 'numberedList':
      return [`${counter.n}. ${inner}`];
    case 'todo':
      return [`- [${block.props.checked ? 'x' : ' '}] ${inner}`];
    case 'quote':
      return [`> ${inner}`];
    case 'callout': {
      const icon = typeof block.props.icon === 'string' ? block.props.icon : '💡';
      return [`> ${icon} ${inner}`];
    }
    case 'divider':
      return ['---'];
    case 'code': {
      const lang = typeof block.props.language === 'string' ? block.props.language : '';
      const text = inlineToPlainText(block.content);
      return ['```' + (lang === 'plain' ? '' : lang), ...text.split('\n'), '```'];
    }
    case 'equation': {
      const expression = prop<string>(block, 'expression') ?? inlineToPlainText(block.content);
      return ['$$', expression, '$$'];
    }
    case 'image':
    case 'video': {
      const src = mediaSrc(block, ctx);
      const alt = prop<string>(block, 'altText') ?? inner ?? '';
      const caption = inlineToMarkdown((prop<RichText>(block, 'caption') ?? []) as RichText);
      const line = src ? `![${alt}](${encodeURI(src)})` : '';
      return caption ? [line, '', `*${caption}*`] : [line];
    }
    case 'file': {
      const src = mediaSrc(block, ctx);
      const name = prop<string>(block, 'name') ?? inner ?? '附件';
      return src ? [`[${name}](${encodeURI(src)})`] : [name];
    }
    case 'bookmark':
    case 'embed': {
      const url = prop<string>(block, 'url') ?? '';
      const title = prop<{ title?: string }>(block, 'meta')?.title ?? url;
      return url ? [`[${title}](${url})`] : [];
    }
    case 'page': {
      const pageId = prop<string>(block, 'pageId') ?? null;
      const label = inner || '子頁面';
      return [pageLink(ctx, pageId, label)];
    }
    case 'toggle':
      // children 在外層處理（要夾在 <details> 中間），所以這裡回 null 讓呼叫端接手
      return null;
    case 'table':
      return tableToMarkdown(block, doc);
    case 'tableRow':
      return []; // 由 table 一起輸出
    case 'tableOfContents':
      return ['<!-- 目錄（由編輯器動態產生） -->'];
    case 'collectionView': {
      const collectionId = prop<string>(block, 'collectionId');
      const csv = collectionId ? ctx.csvPath(collectionId) : null;
      if (!csv) return ['<!-- 內嵌資料庫 -->'];
      const href = ctx.selfPath ? relativePath(ctx.selfPath, csv) : csv;
      return [`[內嵌資料庫](${encodeURI(href)})`];
    }
    case 'columnList':
    case 'column':
      return null;
    default:
      return inner ? [inner] : [];
  }
}

function serializeLevel(
  ids: string[],
  doc: { blocks: Record<string, CoreBlock> },
  ctx: SerializeContext,
  depth: number,
  out: string[],
): void {
  const indent = '  '.repeat(depth);
  const counter = { n: 1 };

  for (const id of ids) {
    const block = doc.blocks[id];
    if (!block) continue;

    if (block.type === 'numberedList') {
      // 連號只在同一層的連續 numberedList 之間累加
    } else {
      counter.n = 1;
    }

    if (block.type === 'toggle') {
      const summary = inlineToMarkdown(block.content);
      out.push(`${indent}<details>`, `${indent}<summary>${summary}</summary>`, '');
      serializeLevel(block.children, doc, ctx, depth, out);
      out.push('', `${indent}</details>`, '');
      continue;
    }

    const lines = blockToLines(block, ctx, doc, counter);
    if (block.type === 'numberedList') counter.n += 1;

    if (lines === null) {
      // columnList / column：自己不輸出，子層平鋪在同一個縮排層級
      serializeLevel(block.children, doc, ctx, depth, out);
      continue;
    }

    for (const line of lines) out.push(line === '' ? '' : indent + line);
    if (lines.length > 0) out.push('');

    if (block.children.length > 0 && block.type !== 'table') {
      const childDepth = INLINE_CHILD_TYPES.has(block.type) ? depth + 1 : depth;
      serializeLevel(block.children, doc, ctx, childDepth, out);
    }
  }
}

/** 這些型別的子層在 Markdown 裡要縮排（才會被解析回巢狀結構） */
const INLINE_CHILD_TYPES = new Set([
  'bulletedList',
  'numberedList',
  'todo',
  'quote',
  'callout',
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
]);

export function docToMarkdown(
  doc: { rootIds: string[]; blocks: Record<string, CoreBlock> },
  ctx: SerializeContext,
): string {
  const out: string[] = [];
  serializeLevel(doc.rootIds, doc, ctx, 0, out);
  return collapseBlankLines(out).join('\n');
}

export function pageToMarkdown(page: ExportPage, ctx: SerializeContext): string {
  const head = `# ${page.icon ? `${page.icon} ` : ''}${page.title}`;
  const body = docToMarkdown(page.doc, ctx);
  return `${head}\n\n${body}`.replace(/\n{3,}$/, '\n');
}

function collapseBlankLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && (out.length === 0 || out[out.length - 1]!.trim() === '')) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1]!.trim() === '') out.pop();
  return out;
}
