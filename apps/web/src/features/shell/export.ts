/**
 * 匯出（最小版）：把頁面 snapshot 轉成 Markdown 下載。
 *
 * 規格把完整的匯出（PDF / HTML / 子頁面遞迴）排在 M6 的 `features/export`；
 * 那個模組出現之後，這支只要改成轉呼叫它即可（呼叫端不用動）。
 */
import type { Block, PageSnapshot } from '@kennote/shared-types';
import { API_ROUTES, richTextToPlainText } from '@kennote/shared-types';
import { toast } from '@kennote/ui';
import { api } from '../../lib/api-client';

type ExportFn = (pageId: string) => Promise<void>;

let externalExport: ExportFn | null = null;

/** 給 M6 的 features/export 註冊用（runtime 擴充點，避免 import 還不存在的模組） */
export function registerExport(fn: ExportFn): void {
  externalExport = fn;
}

export async function exportPage(pageId: string): Promise<void> {
  if (externalExport) {
    await externalExport(pageId);
    return;
  }
  try {
    const snapshot = await api.get<PageSnapshot>(API_ROUTES.pageSnapshot(pageId));
    const md = snapshotToMarkdown(snapshot);
    download(`${pageTitle(snapshot) || 'kennote'}.md`, md);
    toast.success('已匯出 Markdown');
  } catch {
    toast.error('匯出失敗');
  }
}

function pageTitle(snapshot: PageSnapshot): string {
  const page = snapshot.recordMap.page[snapshot.pageId]?.value;
  return page ? richTextToPlainText(page.title).trim() : '';
}

export function snapshotToMarkdown(snapshot: PageSnapshot): string {
  const lines: string[] = [];
  const title = pageTitle(snapshot);
  if (title) lines.push(`# ${title}`, '');

  const walk = (ids: readonly string[], depth: number): void => {
    for (const id of ids) {
      const block = snapshot.recordMap.block[id]?.value;
      if (!block) continue;
      const line = blockToMarkdown(block, depth);
      if (line !== null) lines.push(line);
      if (block.children?.length) walk(block.children, depth + 1);
    }
  };
  walk(snapshot.rootBlockIds, 0);
  return lines.join('\n');
}

function blockToMarkdown(block: Block, depth: number): string | null {
  const indent = '  '.repeat(depth);
  const text = block.content ? richTextToPlainText(block.content) : '';
  const props = block.props as Record<string, unknown>;
  switch (block.type) {
    case 'heading1':
      return `${indent}# ${text}`;
    case 'heading2':
      return `${indent}## ${text}`;
    case 'heading3':
      return `${indent}### ${text}`;
    case 'bulletedList':
      return `${indent}- ${text}`;
    case 'numberedList':
      return `${indent}1. ${text}`;
    case 'todo':
      return `${indent}- [${props['checked'] ? 'x' : ' '}] ${text}`;
    case 'quote':
      return `${indent}> ${text}`;
    case 'divider':
      return `${indent}---`;
    case 'code':
      return `${indent}\`\`\`${String(props['language'] ?? '')}\n${text}\n${indent}\`\`\``;
    case 'callout':
      return `${indent}> ${String(props['icon'] ?? '💡')} ${text}`;
    default:
      return text ? `${indent}${text}` : '';
  }
}

function download(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
