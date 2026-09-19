/**
 * 內建範本（最小版，01 §3）。
 *
 * 建立流程：`POST /api/pages`（會自動帶一個空 paragraph）→
 * 一筆 `POST /api/pages/:id/transactions` 把範本內容塞進去。
 * 所有 block 變更都走 transaction，沒有任何直接寫 block 的捷徑（00-README 紀律 #1）。
 */
import type { BlockType, Operation, RichText } from '@kennote/shared-types';
import { API_ROUTES, plainTextToRichText } from '@kennote/shared-types';
import { api } from '../../lib/api-client';
import { createPage } from '../../lib/queries';

export interface TemplateBlock {
  type: BlockType;
  text?: string;
  props?: Record<string, unknown>;
}

export interface Template {
  id: string;
  name: string;
  icon: string;
  description: string;
  blocks: TemplateBlock[];
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'meeting',
    name: '會議記錄',
    icon: '🗓️',
    description: '議程、決議、待辦',
    blocks: [
      { type: 'heading2', text: '議程' },
      { type: 'bulletedList', text: '' },
      { type: 'heading2', text: '決議' },
      { type: 'bulletedList', text: '' },
      { type: 'heading2', text: '待辦事項' },
      { type: 'todo', text: '', props: { checked: false } },
      { type: 'todo', text: '', props: { checked: false } },
    ],
  },
  {
    id: 'weekly',
    name: '週報',
    icon: '📈',
    description: '本週完成、下週計畫、風險',
    blocks: [
      { type: 'heading2', text: '本週完成' },
      { type: 'bulletedList', text: '' },
      { type: 'heading2', text: '下週計畫' },
      { type: 'bulletedList', text: '' },
      { type: 'heading2', text: '風險與阻礙' },
      { type: 'callout', text: '目前沒有阻礙。', props: { icon: '⚠️' } },
    ],
  },
  {
    id: 'spec',
    name: '需求規格',
    icon: '📐',
    description: '背景、目標、非目標、驗收',
    blocks: [
      { type: 'heading2', text: '背景' },
      { type: 'paragraph', text: '' },
      { type: 'heading2', text: '目標' },
      { type: 'bulletedList', text: '' },
      { type: 'heading2', text: '非目標' },
      { type: 'bulletedList', text: '' },
      { type: 'heading2', text: '驗收標準' },
      { type: 'todo', text: '', props: { checked: false } },
    ],
  },
];

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // 後備：不需要加密強度，只要不撞號
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function rich(text: string): RichText {
  return text ? plainTextToRichText(text) : [];
}

/** 由範本建立一個新頁面，回傳新頁面 id */
export async function createFromTemplate(
  template: Template,
  workspaceId: string,
  parentId: string | null = null,
): Promise<string> {
  const page = await createPage({
    workspaceId,
    parentId,
    title: rich(template.name),
    icon: template.icon,
  });

  let afterId: string | null = null;
  const ops: Operation[] = template.blocks.map((b) => {
    const blockId = uuid();
    const op: Operation = {
      type: 'block.insert',
      blockId,
      parentId: null,
      afterId,
      blockType: b.type,
      props: b.props ?? {},
      content: rich(b.text ?? ''),
    };
    afterId = blockId;
    return op;
  });

  if (ops.length > 0) {
    await api.post(API_ROUTES.pageTransactions(page.id), {
      txId: uuid(),
      pageId: page.id,
      originSessionId: uuid(),
      ops,
    });
  }
  return page.id;
}
