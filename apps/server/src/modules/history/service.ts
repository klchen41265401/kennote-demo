/**
 * 版本歷史（04 §8 M5-13）。
 *
 * 沒有另外一張快照表：`page_transactions` 就是完整歷史，任意 seq 的狀態
 * 都能用 rebuild.ts 的純函式重播出來。還原時**再送一筆 transaction**
 * （diff 出來的 ops），因此歷史永遠是 append-only，還原本身也能被還原。
 *
 * 已知限制（寫進 docs/adr/0004）：頁面複製（duplicatePage）是直接 INSERT 的，
 * 沒有經過 operation log，因此複本在被編輯之前沒有可重建的歷史。
 */
import type {
  Block,
  HistoryListResponse,
  HistorySnapshotResponse,
  Operation,
  PageSnapshot,
  RestoreVersionResponse,
} from '@kennote/shared-types';
import { db } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { AppError, pageNotFound } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { applyTransaction } from '../blocks/apply-transaction.js';
import { listBlocksByPage, toBlock } from '../blocks/repo.js';
import { findPageById, toPage } from '../pages/repo.js';
import { requirePagePermission } from '../permissions/service.js';
import {
  bucketVersions,
  createEmptyDoc,
  diffDocs,
  rebuildAt,
  type DocState,
} from './rebuild.js';

interface TxRow {
  seq: number;
  ops: Operation[];
  applied_at: Date;
  actor_id: string | null;
}

const MAX_REPLAY = 5000;

async function loadTransactions(pageId: string, upToSeq?: number): Promise<TxRow[]> {
  const limit = upToSeq === undefined ? sql.empty : sql` AND seq <= ${upToSeq}`;
  return db.query<TxRow>(sql`
    SELECT seq, ops, applied_at, actor_id FROM page_transactions
     WHERE page_id = ${pageId}${limit}
     ORDER BY seq ASC
     LIMIT ${MAX_REPLAY}
  `);
}

export async function listVersions(
  pageId: string,
  userId: string,
): Promise<HistoryListResponse> {
  await requirePagePermission(userId, pageId, 'read');
  const page = await findPageById(pageId);
  if (!page) throw pageNotFound();

  const rows = await loadTransactions(pageId);
  const versions = bucketVersions(
    rows.map((r) => ({
      seq: Number(r.seq),
      appliedAt: r.applied_at.toISOString(),
      actorId: r.actor_id,
    })),
  );
  return { pageId, currentSeq: Number(page.seq), versions };
}

/** 目前的真實狀態（來自 blocks 表，而不是重播）—— 還原的 diff 基準 */
async function currentDoc(pageId: string): Promise<DocState> {
  const page = await findPageById(pageId);
  if (!page) throw pageNotFound();
  const blocks = await listBlocksByPage(pageId);
  const doc = createEmptyDoc();
  doc.title = page.title ?? [];
  doc.icon = page.icon;
  doc.cover = page.cover;
  doc.children = page.children ?? [];
  for (const row of blocks) {
    doc.blocks.set(row.id, {
      id: row.id,
      parentId: row.parent_id,
      type: row.type,
      props: row.props ?? {},
      content: row.content ?? [],
      children: row.children ?? [],
    });
  }
  return doc;
}

export async function getSnapshotAt(
  pageId: string,
  userId: string,
  seq: number,
): Promise<HistorySnapshotResponse> {
  await requirePagePermission(userId, pageId, 'read');
  const pageRow = await findPageById(pageId);
  if (!pageRow) throw pageNotFound();

  const rows = await loadTransactions(pageId, seq);
  if (rows.length === 0 && seq > 0) {
    throw new AppError('NOT_FOUND', '找不到這個版本（歷史可能已被壓縮）');
  }
  const doc = rebuildAt(
    rows.map((r) => ({ seq: Number(r.seq), ops: r.ops })),
    seq,
  );

  const at = rows[rows.length - 1]?.applied_at ?? null;
  const page = toPage(pageRow);
  const blocks: Record<string, { value: Block; role: 'reader' }> = {};
  for (const block of doc.blocks.values()) {
    blocks[block.id] = {
      value: {
        id: block.id,
        pageId,
        parentId: block.parentId,
        type: block.type,
        props: block.props as Block['props'],
        content: block.content,
        children: block.children,
        version: 0,
        createdAt: pageRow.created_at.toISOString(),
        updatedAt: (at ?? pageRow.updated_at).toISOString(),
        createdBy: null,
        updatedBy: null,
      },
      role: 'reader',
    };
  }

  const snapshot: PageSnapshot = {
    pageId,
    seq,
    rootBlockIds: doc.children,
    recordMap: {
      // 歷史預覽是唯讀的（02 §3.6：預覽期間必須停用編輯與即時同步寫入）
      page: {
        [pageId]: {
          value: { ...page, title: doc.title, icon: doc.icon, cover: doc.cover, children: doc.children, seq },
          role: 'reader',
        },
      },
      block: blocks,
      user: {},
    },
  };

  return { pageId, seq, at: at ? at.toISOString() : null, snapshot };
}

export async function restoreVersion(
  pageId: string,
  userId: string,
  seq: number,
): Promise<RestoreVersionResponse> {
  await requirePagePermission(userId, pageId, 'edit');

  const rows = await loadTransactions(pageId, seq);
  if (rows.length === 0) {
    throw new AppError('NOT_FOUND', '找不到這個版本（歷史可能已被壓縮）');
  }
  const target = rebuildAt(
    rows.map((r) => ({ seq: Number(r.seq), ops: r.ops })),
    seq,
  );
  const current = await currentDoc(pageId);
  const ops = diffDocs(current, target);

  if (ops.length === 0) {
    const page = await findPageById(pageId);
    return {
      pageId,
      restoredFromSeq: seq,
      newSeq: Number(page?.seq ?? 0),
      opCount: 0,
    };
  }
  if (ops.length > 200) {
    // MAX_OPS_PER_TRANSACTION = 200；超過就分批送，仍然每批都是原子的
    let newSeq = 0;
    for (let i = 0; i < ops.length; i += 200) {
      const result = await applyTransaction(
        { pageId, userId },
        {
          txId: uuidv7(),
          pageId,
          originSessionId: 'server:history-restore',
          ops: ops.slice(i, i + 200),
        },
      );
      newSeq = result.seq;
    }
    return { pageId, restoredFromSeq: seq, newSeq, opCount: ops.length };
  }

  const result = await applyTransaction(
    { pageId, userId },
    { txId: uuidv7(), pageId, originSessionId: 'server:history-restore', ops },
  );
  return { pageId, restoredFromSeq: seq, newSeq: result.seq, opCount: ops.length };
}

/** 給 pages 模組以外的地方用（測試、未來的排程壓縮） */
export { rebuildAt, diffDocs } from './rebuild.js';
export { toBlock };
