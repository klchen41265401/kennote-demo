/**
 * `block_deltas` 的資料存取（04 §6.6.4、migration 0030）。
 *
 * 只被 `ot-service.ts` 使用；route / WS 都碰不到這一層。
 */
import type { OtDelta } from '@kennote/shared-types';
import type { RichText } from '@kennote/shared-types';
import type { Tx } from '../../db/client.js';
import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';

export interface BlockOtState {
  id: string;
  page_id: string;
  content: RichText;
  rev: number;
  version: number;
}

/**
 * `SELECT ... FOR UPDATE` —— 序列化的關鍵。
 * 同一個 block 的 delta 一次只能有一個在跑，否則兩個 transform 會基於同一個 rev。
 */
export async function lockBlockForDelta(tx: Tx, blockId: string): Promise<BlockOtState | null> {
  return tx.queryOne<BlockOtState>(sql`
    SELECT id, page_id, content, rev, version
      FROM blocks
     WHERE id = ${blockId} AND deleted_at IS NULL
     FOR UPDATE
  `);
}

/** 取出 client 沒看過的所有 delta（transform 的窗口），依 rev 由小到大。 */
export async function listDeltasSince(
  conn: Queryable,
  blockId: string,
  baseRev: number,
): Promise<Array<{ rev: number; delta: OtDelta }>> {
  const rows = await conn.query<{ rev: number; delta: OtDelta }>(sql`
    SELECT rev, delta FROM block_deltas
     WHERE block_id = ${blockId} AND rev > ${baseRev}
     ORDER BY rev ASC
  `);
  return rows.map((r) => ({ rev: Number(r.rev), delta: r.delta }));
}

/** 寫入一筆已 transform 的 delta。 */
export async function insertBlockDelta(
  tx: Tx,
  input: { blockId: string; rev: number; delta: OtDelta; actorId: string | null },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO block_deltas (block_id, rev, delta, actor_id)
    VALUES (${input.blockId}, ${input.rev}, ${JSON.stringify(input.delta)}::jsonb, ${input.actorId})
    ON CONFLICT (block_id, rev) DO NOTHING
  `);
}

/** 套用 delta 的結果：content + rev 一起寫回去（必須在同一個交易裡）。 */
export async function writeBlockContentAndRev(
  tx: Tx,
  input: { blockId: string; content: RichText; rev: number; actorId: string },
): Promise<void> {
  await tx.query(sql`
    UPDATE blocks
       SET content = ${JSON.stringify(input.content)}::jsonb,
           rev = ${input.rev},
           version = version + 1,
           updated_by = ${input.actorId}
     WHERE id = ${input.blockId} AND deleted_at IS NULL
  `);
}

/** `block.update{content}` 也要推進 rev，讓兩條通道的順序一致（見 ADR 0006 §2.6）。 */
export async function bumpBlockRev(tx: Tx, blockId: string, rev: number): Promise<void> {
  await tx.query(sql`UPDATE blocks SET rev = ${rev} WHERE id = ${blockId}`);
}

/** 保留期清理（04 §6.6、03 §8.3 的窗口思路）。腳本 / 排程呼叫。 */
export async function pruneBlockDeltas(olderThanDays = 7, conn: Queryable = db): Promise<number> {
  const rows = await conn.query<{ count: string }>(sql`
    WITH deleted AS (
      DELETE FROM block_deltas
       WHERE applied_at < now() - (${olderThanDays} || ' days')::interval
      RETURNING 1
    )
    SELECT count(*)::text AS count FROM deleted
  `);
  return Number(rows[0]?.count ?? 0);
}
