/**
 * Markdown → Block（匯入端）。
 *
 * 主體直接重用 editor-core 的 `parseMarkdownToBlocks()`（複製貼上與匯入必須是
 * 同一套語法，否則「貼一段 md」跟「匯入同一段 md」結果會不一樣）。
 * 這裡只補 editor-core 刻意不做的三件事 —— 它們在剪貼簿情境沒有意義，
 * 但在匯入情境是必要的：
 *
 *   1. `![alt](src)` 圖片 → image block（剪貼簿是靠 HTML 帶圖，不走 md）
 *   2. `$$ … $$` → equation block
 *   3. GFM 表格 → table / tableRow block（我們自己匯出的 md 就長這樣，要能往返）
 *
 * 做法：先把這三種結構抽掉換成哨兵行（保留縮排，所以巢狀關係不受影響），
 * 交給 editor-core 解析，再把哨兵段落換回真正的 block。
 */
import {
  parseInlineMarkdown,
  parseMarkdownToBlocks,
} from '@kennote/editor-core/src/clipboard/parse-markdown.js';
import type {
  Block as CoreBlock,
  DocFragment,
  RichText,
} from '@kennote/editor-core/src/model/types.js';

const SENTINEL = 'kn';

interface Extracted {
  kind: 'image' | 'equation' | 'table';
  props: Record<string, unknown>;
  /** table 才有：每一列的儲存格 */
  rows?: RichText[][];
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/;

export interface MarkdownParseResult extends DocFragment {
  /** 檔案開頭的 `# 標題`（Notion 匯出一定有），已從 blocks 中移除 */
  title: string | null;
}

export function markdownToFragment(
  markdown: string,
  newId: () => string,
  options: { extractTitle?: boolean } = {},
): MarkdownParseResult {
  const extracted: Extracted[] = [];
  const source = preprocess(markdown, extracted);
  const fragment = parseMarkdownToBlocks(source, { newId });

  for (const block of Object.values(fragment.blocks)) {
    const index = sentinelIndexOf(block);
    if (index === null) continue;
    const item = extracted[index];
    if (!item) continue;
    applyExtracted(block, item, fragment, newId);
  }

  let title: string | null = null;
  if (options.extractTitle !== false) {
    const firstId = fragment.rootIds[0];
    const first = firstId ? fragment.blocks[firstId] : undefined;
    if (first && first.type === 'heading1' && first.children.length === 0) {
      title = plainOf(first.content).trim() || null;
      if (title) {
        fragment.rootIds.shift();
        delete fragment.blocks[first.id];
      }
    }
  }

  return { ...fragment, title };
}

function plainOf(content: RichText): string {
  let out = '';
  for (const node of content) if ('text' in node) out += node.text;
  return out;
}

function sentinelIndexOf(block: CoreBlock): number | null {
  if (block.type !== 'paragraph' || block.content.length !== 1) return null;
  const node = block.content[0]!;
  if (!('text' in node)) return null;
  const m = new RegExp(`^${SENTINEL}(\\d+)$`).exec(node.text.trim());
  return m ? Number(m[1]) : null;
}

function applyExtracted(
  block: CoreBlock,
  item: Extracted,
  fragment: DocFragment,
  newId: () => string,
): void {
  block.content = [];
  if (item.kind === 'image') {
    block.type = 'image';
    block.props = item.props;
    return;
  }
  if (item.kind === 'equation') {
    block.type = 'equation';
    block.props = item.props;
    return;
  }
  block.type = 'table';
  block.props = item.props;
  for (const cells of item.rows ?? []) {
    const id = newId();
    fragment.blocks[id] = {
      id,
      parentId: block.id,
      type: 'tableRow',
      props: { cells },
      content: [],
      children: [],
      version: 1,
    };
    block.children.push(id);
  }
}

function preprocess(markdown: string, extracted: Extracted[]): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;
  let i = 0;

  const push = (indent: string, item: Extracted) => {
    out.push(`${indent}${SENTINEL}${extracted.length}`);
    extracted.push(item);
  };

  while (i < lines.length) {
    const raw = lines[i]!;
    const body = raw.trim();
    const indent = raw.slice(0, raw.length - raw.trimStart().length);

    if (/^```/.test(body)) {
      inFence = !inFence;
      out.push(raw);
      i++;
      continue;
    }
    if (inFence) {
      out.push(raw);
      i++;
      continue;
    }

    // $$ 公式（單行或多行）
    if (body.startsWith('$$')) {
      if (body.length > 2 && body.endsWith('$$')) {
        push(indent, { kind: 'equation', props: { expression: body.slice(2, -2).trim() } });
        i++;
        continue;
      }
      const buf: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== '$$') {
        buf.push(lines[i]!);
        i++;
      }
      i++; // 吃掉收尾的 $$
      push(indent, { kind: 'equation', props: { expression: buf.join('\n').trim() } });
      continue;
    }

    // 圖片行
    const image = IMAGE_LINE.exec(body);
    if (image) {
      push(indent, {
        kind: 'image',
        props: {
          externalUrl: decodeMaybe(image[2] ?? ''),
          altText: image[1] ?? '',
          ...(image[3] ? { caption: parseInlineMarkdown(image[3]) } : {}),
        },
      });
      i++;
      continue;
    }

    // GFM 表格：`| a | b |` 後面接 `| --- | --- |`
    if (body.startsWith('|') && i + 1 < lines.length && isDelimiterRow(lines[i + 1]!)) {
      const rows: RichText[][] = [splitTableRow(body)];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i]!.trim()));
        i++;
      }
      const columnCount = Math.max(1, ...rows.map((r) => r.length));
      for (const row of rows) while (row.length < columnCount) row.push([]);
      push(indent, {
        kind: 'table',
        props: { columnCount, hasColumnHeader: true },
        rows,
      });
      continue;
    }

    out.push(raw);
    i++;
  }
  return out.join('\n');
}

function decodeMaybe(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

function isDelimiterRow(line: string): boolean {
  const body = line.trim();
  if (!body.startsWith('|')) return false;
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(body);
}

function splitTableRow(line: string): RichText[] {
  const body = line.replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '\\' && body[i + 1] === '|') {
      current += '|';
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((cell) => parseInlineMarkdown(cell.trim()));
}
