/**
 * 貼上的兩個補丁（第五輪 §3）：**Markdown 表格**與**純 URL**。
 *
 * 為什麼放在宿主而不是 `packages/editor-core` 的 markdown parser：
 * 那個套件這一輪由另一個代理施工中，不得改動；而且這兩條規則都需要宿主才有的
 * 東西（`tableRow` 的 `props.cells` 形狀、`link` mark 的產生方式），
 * 本來就不屬於純文字解析層。
 *
 * 判斷一律「寧可不接手」：不像表格 / 不像 URL 就回 `null`，
 * 讓 editor-core 原本的貼上邏輯照跑。
 */
import type { Operation, RichText } from '@kennote/shared-types';

/* ── Markdown 表格 ─────────────────────────────────────── */

/** `| --- | :--: |` 這種分隔列 */
function isDelimiterRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
}

/** 切一列：去掉頭尾的 `|` 再用未跳脫的 `|` 分欄 */
function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return body.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/**
 * 解析一段 GFM 表格。
 *
 * 必要條件：至少 2 行、第 2 行是分隔列（`| --- |`）——
 * 沒有分隔列的話 `| 一 | 二 |` 很可能只是使用者在打字，不該偷偷變成表格。
 * 欄數以**表頭**為準，短的補空、長的截掉（Notion 也是這樣對齊）。
 */
export function parseMarkdownTable(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;

  const header = splitRow(lines[0]!);
  const delimiter = splitRow(lines[1]!);
  if (!header || !delimiter || header.length < 2) return null;
  if (!isDelimiterRow(delimiter)) return null;
  if (delimiter.length !== header.length) return null;

  const rows: string[][] = [header];
  for (const line of lines.slice(2)) {
    const cells = splitRow(line);
    if (!cells) break; // 表格結束：剩下的交還給原本的貼上流程
    rows.push(
      Array.from({ length: header.length }, (_, i) => cells[i] ?? ''),
    );
  }
  return rows;
}

/** 把解析好的表格轉成 `table` + `tableRow` 的 ops */
export function tableOps(
  rows: string[][],
  ids: { table: string; rows: string[] },
  parentId: string | null,
  afterId: string | null,
): Operation[] {
  const columnCount = rows[0]?.length ?? 2;
  const ops: Operation[] = [
    {
      type: 'block.insert',
      blockId: ids.table,
      parentId,
      afterId,
      blockType: 'table',
      // 第一列當表頭：Markdown 表格本來就有表頭
      props: { columnCount, hasColumnHeader: true },
      content: [],
    },
  ];
  let after: string | null = null;
  rows.forEach((cells, i) => {
    const rowId = ids.rows[i];
    if (!rowId) return;
    ops.push({
      type: 'block.insert',
      blockId: rowId,
      parentId: ids.table,
      afterId: after,
      blockType: 'tableRow',
      props: { cells: cells.map((c): RichText => (c ? [{ text: c }] : [])) },
      content: [],
    });
    after = rowId;
  });
  return ops;
}

/* ── 純 URL ────────────────────────────────────────────── */

/**
 * 整段剪貼簿內容就是**一條** http(s) 網址嗎？
 *
 * 刻意嚴格：有空白、有換行、多於一條都不算 —— 那些情況使用者多半是在貼一段文字，
 * 整段變成連結會很難刪。
 */
export function bareUrl(text: string): string | null {
  const t = text.trim();
  if (t === '' || /\s/.test(t)) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:' ? t : null;
  } catch {
    return null;
  }
}

/** 純 URL → 帶 `link` mark 的一段文字（Notion 的「貼上為連結」預設行為） */
export function linkRichText(url: string): RichText {
  return [{ text: url, marks: [{ t: 'link', href: url }] }];
}
