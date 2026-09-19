/**
 * Block → 自包含 HTML（樣式內嵌，離線可看，可直接列印成 PDF）。
 *
 * class 名稱刻意沿用 Notion 匯出 HTML 的結構（`.page-body`、`.callout`、
 * `.bulleted-list`、`.collection-content`…），這樣使用者既有的樣式表、
 * 轉檔腳本、以及「把 Notion 匯出檔丟進來」的匯入器都能對得上。
 *
 * PDF：04 §8 M6 原訂用 Playwright `page.pdf()`，但 server 容器內沒有瀏覽器
 * （見 ADR 0005）。這份 HTML 內含 `@media print` 規則，使用者用瀏覽器
 * 「列印 → 另存 PDF」即可得到排版正確的 PDF。
 */
import {
  inlineToHTML,
  inlineToPlainText,
} from '@kennote/editor-core/src/clipboard/serialize.js';
import type { Block as CoreBlock, RichText } from '@kennote/editor-core/src/model/types.js';
import type { ExportPage } from './doc.js';
import { relativePath } from './doc.js';
import type { SerializeContext } from './markdown.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function prop<T>(block: CoreBlock, key: string): T | undefined {
  return block.props[key] as T | undefined;
}

function mediaSrc(block: CoreBlock, ctx: SerializeContext): string {
  const fileId = prop<string>(block, 'fileId');
  if (fileId) {
    const packed = ctx.filePath(fileId);
    if (packed) return ctx.selfPath ? relativePath(ctx.selfPath, packed) : packed;
    return `/api/files/${fileId}`;
  }
  return prop<string>(block, 'externalUrl') ?? '';
}

const LIST_TAG: Record<string, 'ul' | 'ol'> = {
  bulletedList: 'ul',
  numberedList: 'ol',
  todo: 'ul',
};

const LIST_CLASS: Record<string, string> = {
  bulletedList: 'bulleted-list',
  numberedList: 'numbered-list',
  todo: 'to-do-list',
};

function blockToHtml(
  block: CoreBlock,
  ctx: SerializeContext,
  doc: { blocks: Record<string, CoreBlock> },
  childrenHtml: string,
): string {
  const inner = inlineToHTML(block.content);
  const color = typeof block.props.color === 'string' ? ` block-color-${block.props.color}` : '';

  switch (block.type) {
    case 'heading1':
      return `<h2 class="header${color}">${inner}</h2>${childrenHtml}`;
    case 'heading2':
      return `<h3 class="sub_header${color}">${inner}</h3>${childrenHtml}`;
    case 'heading3':
      return `<h4 class="sub_sub_header${color}">${inner}</h4>${childrenHtml}`;
    case 'bulletedList':
    case 'numberedList':
      return `<li>${inner}${childrenHtml}</li>`;
    case 'todo':
      return (
        `<li><div class="checkbox checkbox-${block.props.checked ? 'on' : 'off'}"></div>` +
        `<span class="to-do-children-${block.props.checked ? 'checked' : 'unchecked'}">${inner}</span>` +
        `${childrenHtml}</li>`
      );
    case 'toggle':
      return `<ul class="toggle"><li><details open><summary>${inner}</summary>${childrenHtml}</details></li></ul>`;
    case 'quote':
      return `<blockquote class="${color.trim() || 'quote'}">${inner}</blockquote>${childrenHtml}`;
    case 'callout': {
      const icon = typeof block.props.icon === 'string' ? block.props.icon : '💡';
      return (
        `<figure class="callout${color}"><div class="callout-icon">${escapeHtml(icon)}</div>` +
        `<div class="callout-body">${inner}${childrenHtml}</div></figure>`
      );
    }
    case 'divider':
      return '<hr class="divider"/>';
    case 'code': {
      const lang = escapeHtml(String(block.props.language ?? 'plain'));
      return `<pre class="code code-wrap"><code class="language-${lang}">${escapeHtml(inlineToPlainText(block.content))}</code></pre>`;
    }
    case 'equation': {
      const expression = prop<string>(block, 'expression') ?? inlineToPlainText(block.content);
      return `<figure class="equation"><div class="equation-source">${escapeHtml(expression)}</div></figure>`;
    }
    case 'image':
    case 'video': {
      const src = mediaSrc(block, ctx);
      const alt = escapeHtml(prop<string>(block, 'altText') ?? '');
      const caption = inlineToHTML((prop<RichText>(block, 'caption') ?? []) as RichText);
      const media =
        block.type === 'video'
          ? `<video controls src="${escapeHtml(encodeURI(src))}"></video>`
          : `<img alt="${alt}" src="${escapeHtml(encodeURI(src))}"/>`;
      return `<figure class="image">${media}${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
    }
    case 'file': {
      const src = mediaSrc(block, ctx);
      const name = escapeHtml(prop<string>(block, 'name') ?? '附件');
      return `<figure class="file"><a href="${escapeHtml(encodeURI(src))}">${name}</a></figure>`;
    }
    case 'bookmark':
    case 'embed': {
      const url = prop<string>(block, 'url') ?? '';
      const title = prop<{ title?: string }>(block, 'meta')?.title ?? url;
      if (!url) return '';
      return `<figure class="bookmark"><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></figure>`;
    }
    case 'page': {
      const pageId = prop<string>(block, 'pageId') ?? null;
      const target = pageId ? ctx.pagePath(pageId) : null;
      const label = inner || '子頁面';
      if (!target) return `<p class="page-link">${label}</p>`;
      const href = ctx.selfPath ? relativePath(ctx.selfPath, `${target}.html`) : `${target}.html`;
      return `<figure class="link-to-page"><a href="${escapeHtml(encodeURI(href))}">${label}</a></figure>`;
    }
    case 'table':
      return tableToHtml(block, doc);
    case 'tableRow':
      return '';
    case 'tableOfContents':
      return '<nav class="table_of_contents"></nav>';
    case 'columnList':
      return `<div class="column-list">${childrenHtml}</div>`;
    case 'column':
      return `<div class="column">${childrenHtml}</div>`;
    case 'collectionView':
      return `<div class="collection-content">${childrenHtml}</div>`;
    default:
      return `<p class="${block.type}${color}">${inner}</p>${childrenHtml}`;
  }
}

function tableToHtml(block: CoreBlock, doc: { blocks: Record<string, CoreBlock> }): string {
  const rows = block.children
    .map((id) => doc.blocks[id])
    .filter((b): b is CoreBlock => !!b && b.type === 'tableRow');
  if (rows.length === 0) return '';
  const hasHeader = block.props.hasColumnHeader !== false;
  const cellsOf = (row: CoreBlock): string[] =>
    ((row.props.cells as RichText[] | undefined) ?? []).map((cell) => inlineToHTML(cell ?? []));

  const out: string[] = ['<table class="simple-table"><tbody>'];
  rows.forEach((row, index) => {
    const tag = hasHeader && index === 0 ? 'th' : 'td';
    out.push(`<tr>${cellsOf(row).map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`);
  });
  out.push('</tbody></table>');
  return out.join('');
}

function serializeLevel(
  ids: string[],
  doc: { blocks: Record<string, CoreBlock> },
  ctx: SerializeContext,
): string {
  let out = '';
  let openList: { tag: 'ul' | 'ol'; type: string } | null = null;
  const closeList = () => {
    if (openList) {
      out += `</${openList.tag}>`;
      openList = null;
    }
  };

  for (const id of ids) {
    const block = doc.blocks[id];
    if (!block) continue;
    const wantTag = LIST_TAG[block.type];
    if (wantTag) {
      if (!openList || openList.type !== block.type) {
        closeList();
        out += `<${wantTag} class="${LIST_CLASS[block.type]}">`;
        openList = { tag: wantTag, type: block.type };
      }
    } else {
      closeList();
    }
    const childrenHtml =
      block.children.length > 0 && block.type !== 'table'
        ? serializeLevel(block.children, doc, ctx)
        : '';
    out += blockToHtml(block, ctx, doc, childrenHtml);
  }
  closeList();
  return out;
}

export function docToHtmlFragment(
  doc: { rootIds: string[]; blocks: Record<string, CoreBlock> },
  ctx: SerializeContext,
): string {
  return serializeLevel(doc.rootIds, doc, ctx);
}

/** 自包含樣式：離線、單檔、可列印。刻意不引任何外部 CSS / 字型 */
export const EXPORT_CSS = `
:root{--kn-text:#37352f;--kn-muted:#787774;--kn-line:#e9e9e7;--kn-bg:#fff;--kn-code-bg:#f7f6f3;--kn-accent:#2383e2}
@media (prefers-color-scheme:dark){:root{--kn-text:#d4d4d4;--kn-muted:#9b9b9b;--kn-line:#2f2f2f;--kn-bg:#191919;--kn-code-bg:#252525}}
*{box-sizing:border-box}
body{margin:0;background:var(--kn-bg);color:var(--kn-text);
 font-family:ui-sans-serif,-apple-system,"Segoe UI","PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif;
 font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
article.page{max-width:900px;margin:0 auto;padding:60px 96px 120px}
.page-title{font-size:40px;line-height:1.2;font-weight:700;margin:0 0 24px}
.page-body>*{margin:1px 0}
h2.header{font-size:30px;margin:32px 0 4px;font-weight:600}
h3.sub_header{font-size:24px;margin:24px 0 2px;font-weight:600}
h4.sub_sub_header{font-size:20px;margin:18px 0 2px;font-weight:600}
p{margin:3px 0;min-height:1em}
a{color:inherit;text-decoration:underline;text-decoration-color:rgba(120,119,116,.4)}
ul,ol{margin:2px 0;padding-left:1.7em}
ul.to-do-list{list-style:none;padding-left:.6em}
ul.to-do-list li{display:flex;gap:8px;align-items:flex-start}
.checkbox{width:16px;height:16px;margin-top:4px;border:1.3px solid var(--kn-muted);border-radius:3px;flex:none}
.checkbox-on{background:var(--kn-accent);border-color:var(--kn-accent);position:relative}
.checkbox-on::after{content:"";position:absolute;left:4.5px;top:1px;width:4px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.to-do-children-checked{text-decoration:line-through;opacity:.5}
ul.toggle{list-style:none;padding-left:0}
summary{cursor:pointer;font-weight:500}
blockquote{margin:6px 0;padding-left:14px;border-left:3px solid currentColor;font-size:1.05em}
figure{margin:6px 0}
figure.callout{display:flex;gap:10px;padding:16px;border-radius:4px;border:1px solid var(--kn-line);background:var(--kn-code-bg)}
.callout-icon{flex:none;font-size:18px;line-height:1.4}
pre.code{background:var(--kn-code-bg);border-radius:4px;padding:18px 16px;overflow:auto;
 font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;line-height:1.5}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em;
 background:var(--kn-code-bg);border-radius:3px;padding:.1em .3em}
pre.code code{background:none;padding:0}
hr.divider{border:none;border-top:1px solid var(--kn-line);margin:12px 0}
figure.image img,figure.image video{max-width:100%;border-radius:2px}
figcaption{color:var(--kn-muted);font-size:14px;margin-top:6px}
figure.equation{background:var(--kn-code-bg);padding:12px;border-radius:4px;text-align:center;font-family:ui-monospace,monospace}
table{border-collapse:collapse;margin:8px 0;width:100%}
th,td{border:1px solid var(--kn-line);padding:7px 9px;text-align:left;vertical-align:top}
th{background:var(--kn-code-bg);font-weight:600}
.column-list{display:flex;gap:32px}
.column{flex:1;min-width:0}
.link-to-page a{font-weight:500}
.kn-meta{color:var(--kn-muted);font-size:13px;margin:0 0 28px}
@media print{
  @page{margin:16mm}
  body{background:#fff;color:#000;font-size:11pt}
  article.page{padding:0;max-width:none}
  a{text-decoration:none;color:#000}
  pre.code,figure.callout,th{background:#f4f4f4 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  h2.header,h3.sub_header,h4.sub_sub_header{break-after:avoid}
  pre.code,figure,table,blockquote{break-inside:avoid}
  details{display:block}
  details>summary{list-style:none}
  details:not([open])>*:not(summary){display:block}
}
@media (max-width:800px){article.page{padding:32px 20px 80px}.page-title{font-size:32px}.column-list{display:block}}
`.trim();

export function pageToHtml(page: ExportPage, ctx: SerializeContext): string {
  const body = docToHtmlFragment(page.doc, ctx);
  const title = escapeHtml(page.title);
  const icon = page.icon ? `<span class="page-icon">${escapeHtml(page.icon)}</span> ` : '';
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<article id="${escapeHtml(page.id)}" class="page sans">
<header><h1 class="page-title">${icon}${title}</h1>
<p class="kn-meta">由 kennote 匯出，最後編輯於 ${escapeHtml(page.updatedAt.slice(0, 10))}</p></header>
<div class="page-body">${body}</div>
</article>
</body>
</html>`;
}
