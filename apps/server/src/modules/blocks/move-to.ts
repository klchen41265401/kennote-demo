/**
 * 跨頁面搬移 block（第十一輪）。
 *
 * 為什麼是一支獨立的端點，而不是一個新的 op：
 * `Operation` 的 `block.move` 沒有 `pageId` 欄位，而 `applyTransaction()` 的
 * 每一筆 transaction 都綁死在**單一頁面**上（`pages.seq` 是頁面層級的序號、
 * `page_transactions` 也是逐頁記的）。要讓 `block.move` 跨頁，等於要改
 * 協定 + OT + 版本歷史重播三層 —— 那不是這一輪能收斂的。
 *
 * 所以跨頁搬移在協定上就是「剪下 → 貼上」：
 *   來源頁一筆 `block.delete` transaction、目標頁一筆 `block.insert` transaction，
 *   **兩筆在同一個資料庫交易裡**，要嘛都成立、要嘛都不成立。
 *
 * ⭐ block id 不換。
 *   `insertBlock()` 的 `ON CONFLICT ... WHERE blocks.deleted_at IS NOT NULL`
 *   本來就是為了「軟刪除後復活」寫的（BUG-18 的伺服器那一半），而且它會把
 *   `page_id` 換成 EXCLUDED 的值。於是「先刪後插」正好就是一次真正的搬家：
 *   行內留言的 `{t:'comment',id}` mark、`#blockId` 的深連結、
 *   `files.page_id` 的對應全部還指得到同一個 id。
 *   如果改發新 id，上面那三樣會同時斷掉。
 *
 * ⭐ 兩頁都要 `edit`。
 *   `applyWithin()` 對每一頁都會跑 `permissionGuard`，所以兩筆 transaction
 *   等於兩次權限檢查。來源頁要 edit 是因為這是一次刪除；
 *   目標頁要 edit 是因為這是一次寫入。少了任何一邊，
 *   「只對一頁有 edit」就能把別人頁面的內容搬走或塞進去。
 *
 * ⭐ 鎖的順序固定。
 *   `applyWithin()` 會對自己那一頁 `FOR UPDATE`，兩個人同時往相反方向搬
 *   （A→B 與 B→A）就會互等。所以進交易的第一件事是
 *   **照 page id 排序**把兩頁一起鎖起來，之後 applyWithin 再鎖是同一個交易內的 no-op。
 */
import { randomUUID } from 'node:crypto';
import type { Operation, RichText, TransactionResult } from '@kennote/shared-types';
import { MAX_OPS_PER_TRANSACTION } from '@kennote/shared-types';
import type { Tx } from '../../db/client.js';
import { withTransaction } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { AppError, pageNotFound } from '../../lib/errors.js';
import { findPageInUserWorkspace } from '../pages/repo.js';
import { applyTransaction, broadcastResult } from './apply-transaction.js';
import { findBlock, type BlockRow } from './repo.js';

/** 一次能搬多少個 block（含子孫）。上限是 transaction 的 op 上限。 */
export const MAX_MOVE_BLOCKS = MAX_OPS_PER_TRANSACTION;

export interface MoveBlocksToPageInput {
  blockIds: string[];
  targetPageId: string;
  afterId?: string | null;
  originSessionId?: string;
}

export interface MoveBlocksToPageResult {
  movedBlockIds: string[];
  /** 連同子孫一共動了幾個 block */
  totalBlocks: number;
  /** 一起改綁的附件數（files.page_id） */
  rebasedFiles: number;
  source: TransactionResult;
  target: TransactionResult;
}

interface Flattened {
  id: string;
  /** null = 目標頁的根層 */
  parentId: string | null;
  afterId: string | null;
  row: BlockRow;
}

/** 深度優先展開一棵子樹，順序就是 insert 的順序（父一定在子之前）。 */
async function flatten(
  tx: Tx,
  rootId: string,
  parentId: string | null,
  afterId: string | null,
  out: Flattened[],
): Promise<void> {
  const row = await findBlock(rootId, tx);
  if (!row) throw new AppError('BLOCK_NOT_FOUND', undefined, { blockId: rootId });
  if (out.length >= MAX_MOVE_BLOCKS) {
    throw new AppError('INVALID_OPERATION', `一次最多只能搬移 ${MAX_MOVE_BLOCKS} 個區塊`);
  }
  out.push({ id: row.id, parentId, afterId, row });
  let prev: string | null = null;
  for (const childId of row.children ?? []) {
    await flatten(tx, childId, row.id, prev, out);
    prev = childId;
  }
}

/** 從 props 撈出附件 id（目前只有 `fileId` 這一個欄位，見 block-types/index.ts）。 */
function fileIdsOf(rows: readonly Flattened[]): string[] {
  const ids = new Set<string>();
  for (const { row } of rows) {
    const fileId = (row.props as { fileId?: unknown } | null)?.fileId;
    if (typeof fileId === 'string' && fileId.length > 0) ids.add(fileId);
  }
  return [...ids];
}

export async function moveBlocksToPage(
  sourcePageId: string,
  userId: string,
  input: MoveBlocksToPageInput,
): Promise<MoveBlocksToPageResult> {
  const { blockIds, targetPageId } = input;
  if (blockIds.length === 0) throw new AppError('BAD_REQUEST', '沒有要搬移的區塊');
  if (targetPageId === sourcePageId) {
    throw new AppError('INVALID_OPERATION', '目標頁面就是目前這一頁；同頁搬移請用 block.move');
  }
  const originSessionId = input.originSessionId ?? randomUUID();

  const outcome = await withTransaction(async (tx) => {
    /*
     * 先把兩頁照 id 排序一起鎖起來（見檔頭「鎖的順序固定」）。
     * 這一步同時也是存在性檢查：被刪掉的頁面 SELECT 不到。
     */
    const ordered = [sourcePageId, targetPageId].sort();
    const locked = await tx.query<{ id: string; workspace_id: string }>(sql`
      SELECT id, workspace_id FROM pages
       WHERE id = ANY(${ordered}::uuid[]) AND deleted_at IS NULL
       ORDER BY id
       FOR UPDATE
    `);
    if (locked.length !== 2) throw pageNotFound();

    // 「是不是這個工作區的人」——真正的 edit 權限由 applyWithin 的 permissionGuard 把關
    const source = await findPageInUserWorkspace(sourcePageId, userId, tx);
    const target = await findPageInUserWorkspace(targetPageId, userId, tx);
    if (!source || !target) throw pageNotFound();
    if (source.workspace_id !== target.workspace_id) {
      // 附件的儲存路徑帶 workspaceId（buildStorageKey），blocks.workspace_id 也要跟著換，
      // 那是另一件事（等同「複製到另一個工作區」），這裡一律擋下。
      throw new AppError('INVALID_OPERATION', '不能把區塊搬到另一個工作區');
    }

    /*
     * 只留「最上層」的選取：使用者同時選了父與子時，子會跟著父一起走，
     * 再單獨搬一次會變成把它從自己的父底下拔出來丟到根層。
     */
    const requested: BlockRow[] = [];
    for (const id of blockIds) {
      const row = await findBlock(id, tx);
      if (!row || row.page_id !== sourcePageId) {
        throw new AppError('BLOCK_NOT_FOUND', undefined, { blockId: id });
      }
      requested.push(row);
    }
    const selected = new Set(requested.map((r) => r.id));
    const roots = requested.filter((r) => !(r.parent_id && selected.has(r.parent_id)));

    // 展開子樹（順序 = insert 的順序）
    const flat: Flattened[] = [];
    let prevRoot: string | null = input.afterId ?? null;
    for (const root of roots) {
      await flatten(tx, root.id, null, prevRoot, flat);
      prevRoot = root.id;
    }

    /*
     * ① 來源頁：刪除（block.delete 會連子孫一起軟刪除，並從 parent 的 children 拔掉）
     * ② 目標頁：插入（同一批 id 在 insertBlock 的 ON CONFLICT 分支被「復活」成新頁的 block）
     * 順序不能反：先插會撞到「同一個 id 還活著」而丟錯。
     */
    const deleteOps: Operation[] = roots.map((r) => ({ type: 'block.delete', blockId: r.id }));
    const sourceResult = await applyTransaction(
      { pageId: sourcePageId, userId },
      { txId: randomUUID(), pageId: sourcePageId, originSessionId, ops: deleteOps },
      tx,
    );

    const insertOps: Operation[] = flat.map((f) => ({
      type: 'block.insert',
      blockId: f.id,
      parentId: f.parentId,
      afterId: f.afterId,
      blockType: f.row.type,
      props: (f.row.props ?? {}) as Record<string, unknown>,
      content: (f.row.content ?? []) as RichText,
    }));
    const targetResult = await applyTransaction(
      { pageId: targetPageId, userId },
      { txId: randomUUID(), pageId: targetPageId, originSessionId, ops: insertOps },
      tx,
    );

    /*
     * 附件跟著搬（第九輪 O-5 / 第十輪 §3-1 的 `/rebind` 是同一條紅線的手動版）。
     * `page_id IS NOT DISTINCT FROM 來源頁` ——
     * 只改「本來就綁在來源頁」的那些；別人引用同一個附件時（複製頁面）不動它，
     * 因為那筆的 page_id 已經指向別頁，改了會把別頁的權限一起換掉。
     */
    const fileIds = fileIdsOf(flat);
    let rebasedFiles = 0;
    if (fileIds.length > 0) {
      const updated = await tx.query<{ id: string }>(sql`
        UPDATE files SET page_id = ${targetPageId}
         WHERE id = ANY(${fileIds}::uuid[])
           AND workspace_id = ${source.workspace_id}
           AND page_id IS NOT DISTINCT FROM ${sourcePageId}
        RETURNING id
      `);
      rebasedFiles = updated.length;
    }

    return {
      movedBlockIds: roots.map((r) => r.id),
      totalBlocks: flat.length,
      rebasedFiles,
      source: sourceResult,
      target: targetResult,
    } satisfies MoveBlocksToPageResult;
  });

  // 廣播一律在 commit 之後（03 §9.3）。兩頁各一筆，兩邊的編輯器都會動。
  broadcastResult(outcome.source, originSessionId);
  broadcastResult(outcome.target, originSessionId);
  return outcome;
}
