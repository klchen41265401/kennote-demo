/**
 * 垃圾桶 GC 與孤兒檔案回收（01 §9 M8.1.3、03 §11.2）。
 *
 * 設計重點：
 *   1. **分批**刪除（03 §11.2 的 `LIMIT 5000`）：一次刪光會開一個超長交易，
 *      卡住 autovacuum 也卡住線上寫入（03 §9.5：單一交易不得超過 200ms）。
 *   2. 檔案先標記 deleted_at，再由同一輪的第二段刪實體檔案 —— 先刪實體檔案
 *      再刪資料列的話，中途掛掉就會留下「資料庫說有、磁碟上沒有」的壞連結。
 *   3. 排程用 server 內的 setInterval（單一實例部署）。多實例時要換成
 *      「只有 leader 跑」或外部 cron 打 POST /api/admin/gc，見 docs/ops.md。
 */
import { db, withTransaction } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { logger } from '../../lib/logger.js';
import { createStorage } from '../files/storage/index.js';

export const DEFAULT_RETENTION_DAYS = 30;
/** 上傳後這麼久還沒有人引用 = 孤兒（使用者上傳到一半關掉分頁） */
const ORPHAN_FILE_HOURS = 24;
const PAGE_BATCH = 500;
const FILE_BATCH = 500;
const VISIT_RETENTION_DAYS = 180;

export interface GcResult {
  deletedPages: number;
  deletedBlocks: number;
  deletedFiles: number;
  prunedVisits: number;
  /** 第九輪：同一頁重複的空種子段落（見 pruneDuplicateSeedParagraphs） */
  prunedSeedParagraphs: number;
  retentionDays: number;
  durationMs: number;
}

export interface GcOptions {
  retentionDays?: number;
  /** true = 只統計不刪除（演練用） */
  dryRun?: boolean;
}

export async function runGarbageCollection(options: GcOptions = {}): Promise<GcResult> {
  const started = Date.now();
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const dryRun = options.dryRun ?? false;

  const result: GcResult = {
    deletedPages: 0,
    deletedBlocks: 0,
    deletedFiles: 0,
    prunedVisits: 0,
    prunedSeedParagraphs: 0,
    retentionDays,
    durationMs: 0,
  };

  // ── 1. 超過保留期的頁面（連同子孫；pages.parent_id 是 ON DELETE CASCADE）──
  for (;;) {
    const victims = await db.query<{ id: string }>(sql`
      SELECT id FROM pages
       WHERE deleted_at IS NOT NULL
         AND deleted_at < now() - (${retentionDays} || ' days')::interval
         -- 只挑「刪除動作的根」，子孫交給 CASCADE，不必自己遞迴
         AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM pages WHERE deleted_at IS NOT NULL))
       LIMIT ${PAGE_BATCH}
    `);
    if (victims.length === 0) break;
    result.deletedPages += victims.length;
    if (dryRun) break;

    const ids = victims.map((v) => v.id);
    await withTransaction(async (tx) => {
      const blocks = await tx.query<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM blocks WHERE page_id = ANY(${ids}::uuid[])
      `);
      result.deletedBlocks += blocks[0]?.count ?? 0;
      await tx.query(sql`DELETE FROM pages WHERE id = ANY(${ids}::uuid[])`);
    });
    if (victims.length < PAGE_BATCH) break;
  }

  // ── 2. 被軟刪除的 block（頁面還在，只是 block 被刪）──
  if (!dryRun) {
    for (;;) {
      const removed = await db.query<{ id: string }>(sql`
        DELETE FROM blocks
         WHERE id IN (
           SELECT id FROM blocks
            WHERE deleted_at IS NOT NULL
              AND deleted_at < now() - (${retentionDays} || ' days')::interval
            LIMIT 5000
         )
        RETURNING id
      `);
      result.deletedBlocks += removed.length;
      if (removed.length < 5000) break;
    }
  }

  // ── 3. 沒人引用的檔案 ────────────────────────────────
  const orphans = await db.query<{ id: string; storage_key: string }>(sql`
    SELECT f.id, f.storage_key
      FROM files f
     WHERE f.deleted_at IS NULL
       AND f.created_at < now() - (${ORPHAN_FILE_HOURS} || ' hours')::interval
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
          WHERE b.deleted_at IS NULL AND b.props ->> 'fileId' = f.id::text
       )
       AND NOT EXISTS (
         SELECT 1 FROM pages p
          WHERE p.deleted_at IS NULL
            AND (p.cover = f.id::text OR p.icon = f.id::text
                 OR p.properties::text LIKE '%' || f.id::text || '%')
       )
     LIMIT ${FILE_BATCH}
  `);
  result.deletedFiles = orphans.length;

  if (!dryRun && orphans.length > 0) {
    const ids = orphans.map((o) => o.id);
    await db.query(sql`
      UPDATE files SET deleted_at = now() WHERE id = ANY(${ids}::uuid[])
    `);
    const storage = createStorage();
    for (const orphan of orphans) {
      try {
        await storage.delete(orphan.storage_key);
      } catch (err) {
        logger.warn({ err, key: orphan.storage_key }, 'GC：刪除實體檔案失敗');
      }
    }
    await db.query(sql`DELETE FROM files WHERE id = ANY(${ids}::uuid[])`);
  }

  // ── 4. 太舊的瀏覽紀錄 ───────────────────────────────
  if (!dryRun) {
    const pruned = await db.query<{ page_id: string }>(sql`
      DELETE FROM page_visits
       WHERE visited_at < now() - (${VISIT_RETENTION_DAYS} || ' days')::interval
      RETURNING page_id
    `);
    result.prunedVisits = pruned.length;
  }

  // ── 5. 重複的空種子段落（第九輪）────────────────────
  result.prunedSeedParagraphs = await pruneDuplicateSeedParagraphs(dryRun);

  result.durationMs = Date.now() - started;
  return result;
}

const SEED_BATCH = 200;

/**
 * ⭐ 一次性清理：**同一頁多於一個、而且全部都是空內容的根層 paragraph**，只留第一個。
 *
 * 來源（第一輪分診 §8-5）：`createRow()` 以前不建任何 block，
 * 「補一個空段落」落在每個讀 snapshot 的客戶端身上 —— 多人同時開同一列
 * 就各補一個，伺服器上留下 2 個以上的空段落。第九輪已經改成後端種，
 * 但**既有資料**還躺在那裡，所以這裡順手掃掉。
 *
 * 紅線（誤刪一次就是使用者的內容不見）：
 *   1. **只在這一頁沒有任何非空 block 時才動手**。只要有一個有內容的 block，
 *      整頁跳過 —— 空段落在有內容的頁面裡是使用者刻意留的空行。
 *   2. 「空」定義得很窄：根層（`parent_id IS NULL`）、`paragraph`、
 *      `content = []`、`children = {}`、`props = {}`。有 props（顏色 / 縮排）就不算空。
 *   3. 一定**留下第一個**（uuidv7 = 建立順序），頁面不會變成 0 個 block。
 *   4. 刪完要把 id 從 `pages.children` 拿掉 —— 排序真值在那個陣列上，
 *      留著會變成指向不存在 block 的孤兒（前端 `snapshotToDoc()` 雖有防禦，
 *      但那道防禦正是「以為這頁是空的 → 再補一個」的來源）。
 */
export async function pruneDuplicateSeedParagraphs(dryRun = false): Promise<number> {
  const pages = await db.query<{ page_id: string }>(sql`
    SELECT b.page_id
      FROM blocks b
     WHERE b.deleted_at IS NULL
     GROUP BY b.page_id
    HAVING count(*) > 1
       AND count(*) = count(*) FILTER (
             WHERE b.parent_id IS NULL
               AND b.type = 'paragraph'
               AND b.content = '[]'::jsonb
               AND b.props = '{}'::jsonb
               AND b.children = '{}'::uuid[]
           )
     LIMIT ${SEED_BATCH}
  `);
  if (pages.length === 0) return 0;

  const pageIds = pages.map((p) => p.page_id);
  if (dryRun) {
    const counted = await db.query<{ extra: number }>(sql`
      SELECT (count(*) - 1)::int AS extra FROM blocks
       WHERE deleted_at IS NULL AND page_id = ANY(${pageIds}::uuid[])
       GROUP BY page_id
    `);
    return counted.reduce((sum, r) => sum + r.extra, 0);
  }

  return withTransaction(async (tx) => {
    const removed = await tx.query<{ id: string; page_id: string }>(sql`
      WITH ranked AS (
        SELECT b.id, b.page_id,
               row_number() OVER (PARTITION BY b.page_id ORDER BY b.id) AS rn
          FROM blocks b
         WHERE b.deleted_at IS NULL AND b.page_id = ANY(${pageIds}::uuid[])
      )
      DELETE FROM blocks
       WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
      RETURNING id, page_id
    `);
    if (removed.length === 0) return 0;

    const ids = removed.map((r) => r.id);
    await tx.query(sql`
      UPDATE pages p
         SET children = ARRAY(
               SELECT c FROM unnest(p.children) AS c WHERE c <> ALL(${ids}::uuid[])
             )
       WHERE p.id = ANY(${pageIds}::uuid[])
    `);
    logger.info({ pages: pageIds.length, blocks: removed.length }, 'GC：清掉重複的空種子段落');
    return removed.length;
  });
}

/* ── 排程 ─────────────────────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let lastResult: GcResult | null = null;

export function getLastGcResult(): GcResult | null {
  return lastResult;
}

/**
 * 每日跑一次。第一次延遲 5 分鐘，避免部署後大家同時重啟就一起打資料庫。
 * `timer.unref()` 讓測試與 CLI 不會因為這個計時器而卡住不結束。
 */
export function startGcScheduler(intervalMs: number = DAY_MS): void {
  if (timer) return;
  const run = () => {
    void runGarbageCollection()
      .then((result) => {
        lastResult = result;
        if (
          result.deletedPages +
            result.deletedBlocks +
            result.deletedFiles +
            result.prunedSeedParagraphs >
          0
        ) {
          logger.info({ gc: result }, '垃圾桶 GC 完成');
        }
      })
      .catch((err) => logger.error({ err }, '垃圾桶 GC 失敗'));
  };
  const first = setTimeout(run, 5 * 60 * 1000);
  first.unref?.();
  timer = setInterval(run, intervalMs);
  timer.unref?.();
}

export function stopGcScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
