/**
 * 自研 Markdown → Block[] 解析器（只支援我們自己的子集）。
 *
 * 區塊：# ## ###、- * +、1.、[] [x]、>、```lang、---
 * 行內：**粗體**、*斜體*、_斜體_、~~刪除線~~、`程式碼`、[文字](網址)
 * 巢狀：以每行前導空白（2 空白或 1 個 tab 為一層）決定清單層級。
 */
import type { Block, BlockType, DocFragment, Mark, RichText } from '../model/types.js';
import { createId } from '../model/document.js';
import { normalize } from '../text/richtext.js';
import { safeUrl } from '../view/dom-utils.js';

export interface ParseMarkdownOptions {
  newId?: () => string;
}

interface Builder {
  blocks: Record<string, Block>;
  rootIds: string[];
  newId: () => string;
}

function addBlock(
  b: Builder,
  parentId: string | null,
  type: BlockType,
  content: RichText,
  props: Record<string, unknown> = {},
): Block {
  const id = b.newId();
  const block: Block = { id, parentId, type, props, content: normalize(content), children: [], version: 1 };
  b.blocks[id] = block;
  if (parentId === null) b.rootIds.push(id);
  else b.blocks[parentId]?.children.push(id);
  return block;
}

const INLINE_PATTERNS: { re: RegExp; make(m: RegExpExecArray): { text: string; marks: Mark[] } | null }[] = [
  { re: /^`([^`]+)`/, make: (m) => ({ text: m[1]!, marks: [{ t: 'code' }] }) },
  { re: /^\*\*([^*]+)\*\*/, make: (m) => ({ text: m[1]!, marks: [{ t: 'b' }] }) },
  { re: /^__([^_]+)__/, make: (m) => ({ text: m[1]!, marks: [{ t: 'b' }] }) },
  { re: /^~~([^~]+)~~/, make: (m) => ({ text: m[1]!, marks: [{ t: 's' }] }) },
  { re: /^\*([^*\s][^*]*)\*/, make: (m) => ({ text: m[1]!, marks: [{ t: 'i' }] }) },
  { re: /^_([^_\s][^_]*)_/, make: (m) => ({ text: m[1]!, marks: [{ t: 'i' }] }) },
];

/** Markdown 行內語法 → RichText。 */
export function parseInlineMarkdown(text: string): RichText {
  const out: RichText = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer.length > 0) {
      out.push({ text: buffer });
      buffer = '';
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);

    if (rest.startsWith('\\') && rest.length > 1) {
      buffer += rest[1];
      i += 2;
      continue;
    }

    // [文字](網址)
    const link = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(rest);
    if (link) {
      flush();
      const href = safeUrl(link[2] ?? '');
      const inner = parseInlineMarkdown(link[1] ?? '');
      for (const node of inner) {
        if ('text' in node) {
          const marks: Mark[] = [...(node.marks ?? [])];
          if (href) marks.push({ t: 'link', href });
          out.push(marks.length > 0 ? { text: node.text, marks } : { text: node.text });
        } else {
          out.push(node);
        }
      }
      i += link[0].length;
      continue;
    }

    let matched = false;
    for (const pattern of INLINE_PATTERNS) {
      const m = pattern.re.exec(rest);
      if (!m) continue;
      const made = pattern.make(m);
      if (!made) continue;
      flush();
      // 粗體/斜體內部可再解析（程式碼不行）
      if (made.marks.some((mk) => mk.t === 'code')) {
        out.push({ text: made.text, marks: made.marks });
      } else {
        for (const node of parseInlineMarkdown(made.text)) {
          if ('text' in node) {
            out.push({ text: node.text, marks: [...(node.marks ?? []), ...made.marks] });
          } else {
            out.push(node);
          }
        }
      }
      i += m[0].length;
      matched = true;
      break;
    }
    if (matched) continue;

    buffer += text[i];
    i += 1;
  }
  flush();
  return normalize(out);
}

function indentLevel(line: string): number {
  const m = /^([ \t]*)/.exec(line);
  const ws = m?.[1] ?? '';
  let level = 0;
  for (const ch of ws) level += ch === '\t' ? 1 : 0.5;
  return Math.floor(level);
}

/** Markdown 全文 → DocFragment。 */
export function parseMarkdownToBlocks(markdown: string, options: ParseMarkdownOptions = {}): DocFragment {
  const b: Builder = { blocks: {}, rootIds: [], newId: options.newId ?? createId };
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  /** levelIds[L] = 縮排層級 L 的最後一個 block id，用來決定 parentId。 */
  const levelIds: (string | null)[] = [];

  const parentFor = (level: number): string | null => {
    for (let l = Math.min(level, levelIds.length) - 1; l >= 0; l--) {
      const candidate = levelIds[l];
      if (candidate) return candidate;
    }
    return null;
  };

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    const line = raw.trimEnd();
    const level = indentLevel(raw);
    const body = line.trim();

    if (body === '') {
      i++;
      continue;
    }

    // 程式碼區塊
    const fence = /^```([a-zA-Z0-9+#.-]*)\s*$/.exec(body);
    if (fence) {
      const lang = fence[1] && fence[1].length > 0 ? fence[1] : 'plain';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) {
        buf.push(lines[i]!);
        i++;
      }
      i++; // 吃掉收尾的 ```
      const text = buf.join('\n');
      const block = addBlock(b, parentFor(level), 'code', text.length > 0 ? [{ text }] : [], { language: lang });
      setStack(levelIds, level, block.id);
      continue;
    }

    // 分隔線
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(body)) {
      const block = addBlock(b, parentFor(level), 'divider', []);
      setStack(levelIds, level, block.id);
      i++;
      continue;
    }

    // 標題
    const heading = /^(#{1,6})\s+(.*)$/.exec(body);
    if (heading) {
      const depth = Math.min(heading[1]!.length, 3);
      const block = addBlock(b, parentFor(level), `heading${depth}` as BlockType, parseInlineMarkdown(heading[2] ?? ''));
      setStack(levelIds, level, block.id);
      i++;
      continue;
    }

    // 引言
    const quote = /^>\s?(.*)$/.exec(body);
    if (quote) {
      const block = addBlock(b, parentFor(level), 'quote', parseInlineMarkdown(quote[1] ?? ''));
      setStack(levelIds, level, block.id);
      i++;
      continue;
    }

    // 待辦
    const todo = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(body);
    if (todo) {
      const block = addBlock(b, parentFor(level), 'todo', parseInlineMarkdown(todo[2] ?? ''), {
        checked: todo[1]!.toLowerCase() === 'x',
      });
      setStack(levelIds, level, block.id);
      i++;
      continue;
    }

    // 無序清單
    const bullet = /^[-*+]\s+(.*)$/.exec(body);
    if (bullet) {
      const block = addBlock(b, parentFor(level), 'bulletedList', parseInlineMarkdown(bullet[1] ?? ''));
      setStack(levelIds, level, block.id);
      i++;
      continue;
    }

    // 有序清單
    const ordered = /^\d+[.)]\s+(.*)$/.exec(body);
    if (ordered) {
      const block = addBlock(b, parentFor(level), 'numberedList', parseInlineMarkdown(ordered[1] ?? ''));
      setStack(levelIds, level, block.id);
      i++;
      continue;
    }

    // 一般段落（連續非空行併成同一段，保留軟換行）
    const buf: string[] = [body];
    i++;
    while (i < lines.length) {
      const nextLine = lines[i]!;
      const nextBody = nextLine.trim();
      if (nextBody === '') break;
      if (isBlockStart(nextBody)) break;
      buf.push(nextBody);
      i++;
    }
    const block = addBlock(b, parentFor(level), 'paragraph', parseInlineMarkdown(buf.join('\n')));
    setStack(levelIds, level, block.id);
  }

  return { rootIds: b.rootIds, blocks: b.blocks };
}

function isBlockStart(body: string): boolean {
  return (
    /^#{1,6}\s/.test(body) ||
    /^[-*+]\s/.test(body) ||
    /^\d+[.)]\s/.test(body) ||
    /^>\s?/.test(body) ||
    /^```/.test(body) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(body)
  );
}

function setStack(levelIds: (string | null)[], level: number, id: string): void {
  // 比自己更深的層級全部失效
  levelIds.length = Math.min(levelIds.length, level + 1);
  while (levelIds.length < level) levelIds.push(null);
  levelIds[level] = id;
}

/** 純文字 fallback：按行切段落（空行分段）。 */
export function parsePlainTextToBlocks(text: string, options: ParseMarkdownOptions = {}): DocFragment {
  const newId = options.newId ?? createId;
  const blocks: Record<string, Block> = {};
  const rootIds: string[] = [];
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n/);
  for (const line of paragraphs) {
    if (line.trim() === '') continue;
    const id = newId();
    blocks[id] = { id, parentId: null, type: 'paragraph', props: {}, content: [{ text: line }], children: [], version: 1 };
    rootIds.push(id);
  }
  return { rootIds, blocks };
}

/** 這段純文字看起來像 Markdown 嗎？（決定要不要走 Markdown 解析） */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|---)/.test(text) || /\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)/.test(text);
}
