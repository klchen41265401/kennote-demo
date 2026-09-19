/**
 * ⭐ 整個系統最重要的一支程式。
 *
 * 00-README §5 風險二的架構前置要求：
 *   「所有對 block 的變更必須經過**單一的 applyTransaction() 抽象層**」。
 * 禁止任何 route / service 直接 UPDATE blocks —— 否則 M6 的 OT 階段等於重寫編輯器。
 *
 * 套用流程（04 §5.4）：
 *   1. 驗證 JWT → userId（由 route 的 auth plugin 完成）
 *   2. 檢查 page 權限（非本 workspace 成員一律 404）
 *   3. 冪等檢查：txId 已存在 → 直接回傳上次結果
 *   4. BEGIN
 *        a. SELECT seq FROM pages WHERE id = $1 FOR UPDATE   ← 序列化的關鍵
 *        b. 逐一套用 ops（經 block type registry 驗證 props）
 *        c. pages.seq += 1
 *        d. INSERT INTO page_transactions
 *      COMMIT
 *   5. 廣播（M5 接 WS；目前 broadcast 是 no-op）
 *   6. 回傳 TransactionResult
 */
import type { Operation, Transaction, TransactionResult } from '@kennote/shared-types';
import type { Tx } from '../../db/client.js';
import { withTransaction } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { AppError, pageNotFound } from '../../lib/errors.js';
import {
  bumpPageSeq,
  findPageForUser,
  lockPageForUpdate,
  setPageChildren,
  updatePageMeta,
} from '../pages/repo.js';
import { getBlockType } from './block-types/index.js';
import {
  collectBlockDescendants,
  findBlock,
  insertBlock,
  isBlockDescendantOf,
  setBlockChildren,
  setBlockParent,
  softDeleteBlocks,
  updateBlockRow,
} from './repo.js';
import { parseTransaction, removeChild, spliceChildren } from './validate-ops.js';

export interface ApplyContext {
  pageId: string;
  userId: string;
}

/** 讀出 parent 的 children 陣列。parentId = null 代表頁面根層 */
async function readChildren(tx: Tx, pageId: string, parentId: string | null): Promise<string[]> {
  if (parentId === null) {
    const row = await tx.queryOne<{ children: string[] }>(
      sql`SELECT children FROM pages WHERE id = ${pageId}`,
    );
    return row?.children ?? [];
  }
  const row = await tx.queryOne<{ children: string[] }>(
    sql`SELECT children FROM blocks WHERE id = ${parentId} AND deleted_at IS NULL`,
  );
  if (!row) throw new AppError('BLOCK_NOT_FOUND', '找不到父區塊', { parentId });
  return row.children ?? [];
}

async function writeChildren(
  tx: Tx,
  pageId: string,
  parentId: string | null,
  children: string[],
): Promise<void> {
  if (parentId === null) await setPageChildren(tx, pageId, children);
  else await setBlockChildren(tx, parentId, children);
}

async function applyOne(
  tx: Tx,
  ctx: ApplyContext & { workspaceId: string },
  op: Operation,
  conflicts: string[],
): Promise<void> {
  switch (op.type) {
    case 'block.insert': {
      if (op.parentId !== null) {
        const parent = await findBlock(op.parentId, tx);
        if (!parent || parent.page_id !== ctx.pageId) {
          throw new AppError('BLOCK_NOT_FOUND', '找不到父區塊', { parentId: op.parentId });
        }
        if (!getBlockType(parent.type).canHaveChildren) {
          throw new AppError('INVALID_OPERATION', `${parent.type} 不能有子區塊`);
        }
      }
      const existing = await findBlock(op.blockId, tx);
      if (existing) {
        // 冪等：同一個 blockId 重複 insert（離線佇列重送）視為 no-op
        return;
      }
      await insertBlock(tx, {
        id: op.blockId,
        workspaceId: ctx.workspaceId,
        pageId: ctx.pageId,
        parentId: op.parentId,
        type: op.blockType,
        props: op.props,
        content: op.content,
        actorId: ctx.userId,
      });
      const children = await readChildren(tx, ctx.pageId, op.parentId);
      await writeChildren(tx, ctx.pageId, op.parentId, spliceChildren(children, op.blockId, op.afterId));
      return;
    }

    case 'block.update': {
      const block = await findBlock(op.blockId, tx);
      if (!block || block.page_id !== ctx.pageId) {
        throw new AppError('BLOCK_NOT_FOUND', undefined, { blockId: op.blockId });
      }
      // baseVersion 不符 → 標記衝突但仍套用（MVP 是 block 層級 LWW，03 §8.2）
      if (op.baseVersion !== undefined && op.baseVersion !== Number(block.version)) {
        conflicts.push(op.blockId);
      }
      const nextType = op.patch.blockType ?? block.type;
      const def = getBlockType(nextType);
      const patch: { type?: typeof nextType; props?: Record<string, unknown>; content?: typeof op.patch.content } =
        {};
      if (op.patch.blockType !== undefined) patch.type = nextType;
      if (op.patch.props !== undefined) {
        patch.props = def.validateProps({ ...def.defaultProps, ...op.patch.props });
      } else if (op.patch.blockType !== undefined) {
        // 換型別但沒帶 props → 用既有 props 過新型別的驗證，失敗就用預設值
        try {
          patch.props = def.validateProps({ ...def.defaultProps, ...block.props });
        } catch {
          patch.props = { ...def.defaultProps };
        }
      }
      if (op.patch.content !== undefined) {
        patch.content = def.hasInlineContent ? op.patch.content : [];
      }
      await updateBlockRow(tx, op.blockId, patch, ctx.userId);
      return;
    }

    case 'block.move': {
      const block = await findBlock(op.blockId, tx);
      if (!block || block.page_id !== ctx.pageId) {
        throw new AppError('BLOCK_NOT_FOUND', undefined, { blockId: op.blockId });
      }
      if (op.parentId !== null) {
        const parent = await findBlock(op.parentId, tx);
        if (!parent || parent.page_id !== ctx.pageId) {
          throw new AppError('BLOCK_NOT_FOUND', '找不到父區塊', { parentId: op.parentId });
        }
        if (await isBlockDescendantOf(tx, op.parentId, op.blockId)) {
          throw new AppError('INVALID_OPERATION', '無法把區塊搬移到自己的子區塊底下');
        }
        if (!getBlockType(parent.type).canHaveChildren) {
          throw new AppError('INVALID_OPERATION', `${parent.type} 不能有子區塊`);
        }
      }
      // 從舊 parent 的 children 移除
      const oldChildren = await readChildren(tx, ctx.pageId, block.parent_id);
      await writeChildren(tx, ctx.pageId, block.parent_id, removeChild(oldChildren, op.blockId));
      // 掛到新 parent
      await setBlockParent(tx, op.blockId, op.parentId, ctx.userId);
      const newChildren = await readChildren(tx, ctx.pageId, op.parentId);
      await writeChildren(
        tx,
        ctx.pageId,
        op.parentId,
        spliceChildren(newChildren, op.blockId, op.afterId),
      );
      return;
    }

    case 'block.delete': {
      const block = await findBlock(op.blockId, tx);
      if (!block || block.page_id !== ctx.pageId) {
        // 冪等：已刪除的 block 再刪一次 = no-op
        return;
      }
      const ids = await collectBlockDescendants(tx, op.blockId);
      await softDeleteBlocks(tx, ids, ctx.userId);
      const children = await readChildren(tx, ctx.pageId, block.parent_id);
      await writeChildren(tx, ctx.pageId, block.parent_id, removeChild(children, op.blockId));
      return;
    }

    case 'page.update': {
      await updatePageMeta(tx, ctx.pageId, op.patch, ctx.userId);
      return;
    }

    case 'text.delta':
      throw new AppError('NOT_IMPLEMENTED', 'text.delta 要等 M6 的自建 OT 才會啟用');
  }
}

/** 廣播掛勾。M5 接上 WS room manager；現在故意留成可替換的函式 */
export type BroadcastFn = (result: TransactionResult, originSessionId: string) => void;
let broadcast: BroadcastFn = () => {};
export function setBroadcaster(fn: BroadcastFn): void {
  broadcast = fn;
}

/**
 * 權限守門員掛勾（M5）。所有 block 寫入都必經這裡，
 * 因此「guest 只能留言不能編輯」在 HTTP 與 WS 兩條路徑上是同一道檢查。
 * 預設 no-op：M1–M4 只有 workspace 成員檢查（findPageForUser）。
 */
export type PermissionGuardFn = (ctx: ApplyContext, conn: Tx) => Promise<void>;
let permissionGuard: PermissionGuardFn = async () => {};
export function setPermissionGuard(fn: PermissionGuardFn): void {
  permissionGuard = fn;
}

async function applyWithin(
  tx: Tx,
  ctx: ApplyContext,
  transaction: Transaction,
): Promise<TransactionResult> {
  {
    // 權限：非本 workspace 成員一律當作頁面不存在
    const page = await findPageForUser(ctx.pageId, ctx.userId, tx);
    if (!page) throw pageNotFound();

    // 頁面層級權限（M5）：read / comment 權限的人在這裡就被擋下
    await permissionGuard(ctx, tx);

    // 冪等：重送同一 txId 不會重複套用
    const existing = await tx.queryOne<{ result: TransactionResult }>(sql`
      SELECT result FROM page_transactions WHERE tx_id = ${transaction.txId}
    `);
    if (existing && existing.result && Object.keys(existing.result).length > 0) {
      return existing.result;
    }

    // 序列化的關鍵：同一頁的 transaction 一次只能有一個在跑
    const locked = await lockPageForUpdate(tx, ctx.pageId);
    if (!locked) throw pageNotFound();

    const conflicts: string[] = [];
    for (const op of transaction.ops) {
      await applyOne(tx, { ...ctx, workspaceId: page.workspace_id }, op, conflicts);
    }

    const seq = await bumpPageSeq(tx, ctx.pageId, ctx.userId);
    const appliedAt = new Date().toISOString();
    const txResult: TransactionResult = {
      txId: transaction.txId,
      pageId: ctx.pageId,
      seq,
      ops: transaction.ops,
      appliedAt,
      actorId: ctx.userId,
      ...(conflicts.length > 0 ? { conflicts } : {}),
    };

    await tx.query(sql`
      INSERT INTO page_transactions (tx_id, page_id, seq, ops, result, actor_id, origin_session_id)
      VALUES (${transaction.txId}, ${ctx.pageId}, ${seq},
              ${JSON.stringify(transaction.ops)}::jsonb,
              ${JSON.stringify(txResult)}::jsonb,
              ${ctx.userId}, ${transaction.originSessionId})
      ON CONFLICT (tx_id) DO NOTHING
    `);

    return txResult;
  }
}

/**
 * @param existingTx 已經開好的資料庫交易。頁面建立時要在同一個交易裡插入
 *   「第一個空 paragraph」，藉此讓**所有** block 變更都真的只有這一條路徑。
 *   傳了 existingTx 就由呼叫端負責 commit 與廣播。
 */
export async function applyTransaction(
  ctx: ApplyContext,
  input: unknown,
  existingTx?: Tx,
): Promise<TransactionResult> {
  const transaction: Transaction = parseTransaction(input, ctx.pageId);

  if (existingTx) return applyWithin(existingTx, ctx, transaction);

  const result = await withTransaction((tx) => applyWithin(tx, ctx, transaction));
  // 廣播一律在 commit 之後（03 §9.3：不要在交易中廣播，否則 rollback 了還是送出去）
  broadcast(result, transaction.originSessionId);
  return result;
}

/** 斷線補傳 / 版本歷史：GET /api/pages/:id/transactions?since=N */
export async function listTransactionsSince(
  pageId: string,
  since: number,
  limit = 200,
): Promise<TransactionResult[]> {
  const { db } = await import('../../db/client.js');
  const rows = await db.query<{ result: TransactionResult }>(sql`
    SELECT result FROM page_transactions
     WHERE page_id = ${pageId} AND seq > ${since}
     ORDER BY seq ASC
     LIMIT ${limit}
  `);
  return rows.map((r) => r.result);
}
