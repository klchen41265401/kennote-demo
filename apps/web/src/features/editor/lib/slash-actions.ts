/**
 * `/` 選單選定之後真正做事的地方。
 *
 * 放在這裡而不是 Editor.tsx 的理由：這些是「業務流程」（建資料庫、匯入檔案、
 * 複製區塊…），跟 React 無關，抽出來才測得動，Editor.tsx 也才維持在「協調者」的角色。
 *
 * 紀律不變：所有 model 變更都經 `host.*` → Operation；
 * 需要打 API 的（建資料庫、匯入）是在**宿主層**打，不是在 renderer 裡打。
 */
import type { Operation } from '@kennote/editor-core';
import { API_ROUTES } from '@kennote/shared-types';
import { api } from '../../../lib/api-client';
import { invalidateQueries } from '@kennote/ui';
import { queryKeys } from '../../../lib/queries';
import type { EditorHostApi } from '../context';
import { getCreateDatabase } from '../blocks/externalRegistry';
import type { DatabaseViewKind } from '../menus/slashCommands';
import { duplicateBlockOps } from './model-helpers';

/* ── 多欄版面 ───────────────────────────────────────────── */

/** `/2 欄`：建立 columnList + N 個 column，並把目前 block 搬進第一欄 */
export function createColumns(host: EditorHostApi, blockId: string, count: number): void {
  const editor = host.editor;
  const block = host.getBlock(blockId);
  if (!block) return;
  const listId = editor.newId();
  const ops: Operation[] = [
    {
      type: 'block.insert',
      blockId: listId,
      parentId: block.parentId,
      afterId: blockId,
      blockType: 'columnList',
      props: {},
      content: [],
    },
  ];
  const ratio = Math.round((1 / count) * 1000) / 1000;
  let prevColumn: string | null = null;
  const columnIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const columnId = editor.newId();
    columnIds.push(columnId);
    ops.push({
      type: 'block.insert',
      blockId: columnId,
      parentId: listId,
      afterId: prevColumn,
      blockType: 'column',
      props: { ratio },
      content: [],
    });
    prevColumn = columnId;
  }
  ops.push({ type: 'block.move', blockId, parentId: columnIds[0] as string, afterId: null });
  for (let i = 1; i < count; i += 1) {
    ops.push({
      type: 'block.insert',
      blockId: editor.newId(),
      parentId: columnIds[i] as string,
      afterId: null,
      blockType: 'paragraph',
      props: {},
      content: [],
    });
  }
  editor.dispatch({ ops, kind: 'structural', breakHistory: true });
  host.focus(blockId, 0);
}

/**
 * 少於 2 欄的 columnList 自動解散（Notion 的行為）。
 * 純函式：吃 doc，吐 ops，好測也不會不小心遞迴。
 */
export function dissolveThinColumnsOps(
  doc: { rootIds: string[]; blocks: Record<string, { id: string; parentId: string | null; type: string; children: string[] }> },
): Operation[] {
  const ops: Operation[] = [];
  for (const block of Object.values(doc.blocks)) {
    if (block.type !== 'columnList') continue;
    const columns = block.children.map((id) => doc.blocks[id]).filter((c) => c && c.type === 'column');
    if (columns.length >= 2) continue;
    // 把剩下那一欄（如果有）的內容拉回 columnList 的位置，然後刪掉整個容器
    let after: string | null = block.id;
    for (const column of columns) {
      for (const childId of column?.children ?? []) {
        ops.push({ type: 'block.move', blockId: childId, parentId: block.parentId, afterId: after });
        after = childId;
      }
    }
    ops.push({ type: 'block.delete', blockId: block.id });
  }
  return ops;
}

/* ── 表格 ───────────────────────────────────────────────── */

/** 新表格先給 3 列（含標題列），與 Notion 的預設 3×3 一致 */
export function seedTable(host: EditorHostApi, tableId: string, rows = 3): void {
  const table = host.getBlock(tableId);
  const columnCount = Number(table?.props.columnCount ?? 3);
  const editor = host.editor;
  const ops: Operation[] = [];
  let after: string | null = null;
  for (let i = 0; i < rows; i += 1) {
    const rowId = editor.newId();
    ops.push({
      type: 'block.insert',
      blockId: rowId,
      parentId: tableId,
      afterId: after,
      blockType: 'tableRow',
      props: { cells: Array.from({ length: columnCount }, () => []) },
      content: [],
    });
    after = rowId;
  }
  editor.dispatch({ ops, kind: 'structural', breakHistory: true });
}

/* ── 同步區塊 ───────────────────────────────────────────── */

/** 新的同步區塊要先有一個空段落，游標才有地方去 */
export function seedSyncedBlock(host: EditorHostApi, blockId: string): void {
  const paragraphId = host.editor.newId();
  host.editor.dispatch({
    ops: [
      {
        type: 'block.insert',
        blockId: paragraphId,
        parentId: blockId,
        afterId: null,
        blockType: 'paragraph',
        props: {},
        content: [],
      },
    ],
    kind: 'structural',
    breakHistory: true,
  });
  host.focus(paragraphId, 0);
}

/* ── 資料庫 ─────────────────────────────────────────────── */

export interface CreatedDatabase {
  collectionId: string;
  viewIds: string[];
  /** 整頁資料庫的頁面 id（inline 時用不到） */
  pageId: string | null;
}

const VIEW_LABELS: Record<DatabaseViewKind, string> = {
  table: '表格',
  board: '看板',
  gallery: '圖庫',
  list: '清單',
  calendar: '日曆',
  timeline: '時程表',
};

/**
 * 建一個資料庫，並把第一個瀏覽模式換成指定型別。
 * `features/database` 有註冊 `createDatabase` 就用它的（它會順便更新快取），
 * 沒有就直接打 API —— 兩邊回來的形狀一樣。
 */
export async function createDatabase(
  host: EditorHostApi,
  options: { view: DatabaseViewKind; inline: boolean },
): Promise<CreatedDatabase> {
  if (!host.workspaceId) throw new Error('找不到工作區');
  const custom = getCreateDatabase();
  let collectionId: string;
  let viewIds: string[];
  let pageId: string | null = null;

  if (custom) {
    const created = await custom({ workspaceId: host.workspaceId, parentId: host.pageId });
    collectionId = created.collectionId;
    viewIds = created.viewIds;
  } else {
    const result = await api.post<{
      collection: { id: string; pageId: string };
      views: { id: string }[];
    }>(API_ROUTES.databases, {
      workspaceId: host.workspaceId,
      parentId: host.pageId,
      inline: options.inline,
    });
    collectionId = result.collection.id;
    viewIds = result.views.map((v) => v.id);
    pageId = result.collection.pageId ?? null;
  }

  if (options.view !== 'table') {
    try {
      const view = await api.post<{ id: string }>(API_ROUTES.databaseViews(collectionId), {
        type: options.view,
        name: VIEW_LABELS[options.view],
      });
      viewIds = [view.id, ...viewIds];
    } catch {
      // 建不出指定瀏覽模式就維持預設的表格，不要讓整個流程失敗
    }
  }

  invalidateQueries(queryKeys.workspaceTree(host.workspaceId));
  return { collectionId, viewIds, pageId };
}

/** 整頁資料庫：後端已經幫我們開好一個 isDatabase 的頁面，這裡只要連過去 */
export async function resolveDatabasePageId(collectionId: string): Promise<string | null> {
  try {
    const result = await api.get<{ collection: { pageId: string } }>(API_ROUTES.database(collectionId));
    return result.collection?.pageId ?? null;
  } catch {
    return null;
  }
}

/* ── 匯入 ───────────────────────────────────────────────── */

export interface ImportOutcome {
  pages: number;
  firstPageId: string | null;
}

/** 選好檔案 → `POST /api/import`（後端靠副檔名判斷來源） */
export async function importFile(host: EditorHostApi, file: File): Promise<ImportOutcome> {
  if (!host.workspaceId) throw new Error('找不到工作區');
  const form = new FormData();
  form.append('workspaceId', host.workspaceId);
  form.append('parentId', host.pageId);
  form.append('file', file, file.name);
  const result = await api.upload<{ pages?: { id: string }[] }>(API_ROUTES.import, form);
  invalidateQueries(queryKeys.workspaceTree(host.workspaceId));
  const pages = result.pages ?? [];
  return { pages: pages.length, firstPageId: pages[0]?.id ?? null };
}

/* ── 區塊動作 ───────────────────────────────────────────── */

export function duplicateBlocks(host: EditorHostApi, blockIds: string[]): void {
  const doc = host.editor.getDoc();
  const ops = blockIds.flatMap((id) => duplicateBlockOps(doc, id, host.editor.newId).ops);
  if (ops.length > 0) host.applyOps(ops);
}

export function blockLink(blockId: string): string {
  return `${window.location.origin}${window.location.pathname}#${blockId}`;
}
