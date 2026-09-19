/**
 * 搜尋壓測（04 §8 M6 驗收標準：**10,000 個 block 下搜尋回應 < 500ms**）。
 *
 * 需要一個真的 PostgreSQL：
 *   export DATABASE_URL=postgres://kennote:kennote@localhost:5432/kennote_bench
 *   pnpm --filter @kennote/server migrate
 *   pnpm --filter @kennote/server exec tsx scripts/bench-search.ts --blocks 10000
 *
 * 參數：
 *   --blocks N   要塞幾個 block（預設 10000）
 *   --keep       跑完不要清資料（想自己用 EXPLAIN 看計畫時加這個）
 *   --skip-seed  資料已經在了，只跑查詢
 *
 * 這支腳本**不會**在 CI 跑，也不進 pnpm test —— 它需要 DB，而且會寫入資料。
 */
import { closePool, db, withTransaction } from '../src/db/client.js';
import { sql } from '../src/db/sql.js';
import { uuidv7 } from '../src/lib/uuidv7.js';
import { parseQuery } from '../src/modules/search/segment.js';
import { search } from '../src/modules/search/service.js';

interface Args {
  blocks: number;
  keep: boolean;
  skipSeed: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    blocks: Number(get('blocks') ?? 10_000),
    keep: argv.includes('--keep'),
    skipSeed: argv.includes('--skip-seed'),
  };
}

const WORDS = [
  '專案', '筆記', '資料庫', '設計', '規格', '文件', '搜尋', '斷詞', '匯出', '匯入',
  '協作', '編輯器', '區塊', '頁面', '工作區', '權限', '備份', '還原', '監控', '效能',
];
const ENGLISH = ['kennote', 'postgres', 'fastify', 'vitest', 'typescript', 'notion', 'export'];

function sentence(seed: number): string {
  const pick = (list: string[], offset: number) => list[(seed * 7 + offset * 13) % list.length]!;
  return (
    `${pick(WORDS, 1)}${pick(WORDS, 2)}的${pick(WORDS, 3)}，` +
    `使用 ${pick(ENGLISH, 4)} 實作 ${pick(WORDS, 5)}${pick(WORDS, 6)}。`
  );
}

async function seed(): Promise<{ workspaceId: string; userId: string }> {
  const existing = await db.queryOne<{ id: string; user_id: string }>(sql`
    SELECT w.id, m.user_id
      FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
     WHERE w.name = 'bench' AND m.deleted_at IS NULL
     LIMIT 1
  `);
  if (existing) return { workspaceId: existing.id, userId: existing.user_id };

  const user = await db.queryOne<{ id: string }>(sql`
    INSERT INTO users (email, name, password_hash)
    VALUES (${`bench+${Date.now()}@kennote.local`}, 'bench', 'x')
    RETURNING id
  `);
  const userId = user!.id;
  const workspace = await db.queryOne<{ id: string }>(sql`
    INSERT INTO workspaces (name, owner_id) VALUES ('bench', ${userId}) RETURNING id
  `);
  const workspaceId = workspace!.id;
  await db.query(sql`
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${workspaceId}, ${userId}, 'owner')
  `);
  return { workspaceId, userId };
}

async function fill(workspaceId: string, userId: string, total: number): Promise<void> {
  const blocksPerPage = 20;
  const pages = Math.ceil(total / blocksPerPage);
  console.log(`  產生 ${pages} 頁 × ${blocksPerPage} block = ${pages * blocksPerPage} 個 block…`);

  for (let p = 0; p < pages; p++) {
    await withTransaction(async (tx) => {
      const pageId = uuidv7();
      await tx.query(sql`
        INSERT INTO pages (id, workspace_id, parent_id, title, sort_key, created_by, updated_by)
        VALUES (${pageId}, ${workspaceId}, NULL,
                ${JSON.stringify([{ text: `${sentence(p)} #${p}` }])}::jsonb,
                ${`a${String(p).padStart(6, '0')}`}, ${userId}, ${userId})
      `);
      const values = [];
      for (let b = 0; b < blocksPerPage; b++) {
        values.push(
          sql`(${uuidv7()}, ${workspaceId}, ${pageId}, NULL, 'paragraph', '{}'::jsonb,
               ${JSON.stringify([{ text: sentence(p * blocksPerPage + b) }])}::jsonb,
               ${userId}, ${userId})`,
        );
      }
      await tx.query(sql`
        INSERT INTO blocks (id, workspace_id, page_id, parent_id, type, props, content, created_by, updated_by)
        VALUES ${sql.join(values, ', ')}
      `);
    });
    if ((p + 1) % 50 === 0) console.log(`    …${(p + 1) * blocksPerPage} blocks`);
  }
  await db.query(sql`ANALYZE blocks`);
  await db.query(sql`ANALYZE pages`);
}

async function bench(workspaceId: string, userId: string): Promise<boolean> {
  const queries = ['資料庫', '資料庫設計', 'kennote', '搜尋斷詞', 'postgres 效能', '匯出'];
  let worst = 0;
  console.log('\n  查詢                     斷詞                        命中   耗時');
  console.log('  ' + '─'.repeat(72));

  for (const q of queries) {
    // 暖機一次（第一次會把索引頁讀進 shared_buffers）
    await search({ q, workspaceId, limit: 20 }, userId);
    const runs: number[] = [];
    let hits = 0;
    for (let i = 0; i < 5; i++) {
      const started = process.hrtime.bigint();
      const result = await search({ q, workspaceId, limit: 20 }, userId);
      runs.push(Number(process.hrtime.bigint() - started) / 1e6);
      hits = result.hits.length;
    }
    runs.sort((a, b) => a - b);
    const p95 = runs[Math.min(runs.length - 1, Math.floor(runs.length * 0.95))]!;
    worst = Math.max(worst, p95);
    const tokens = parseQuery(q).tokens.join(' ');
    console.log(
      `  ${q.padEnd(22)} ${tokens.padEnd(26)} ${String(hits).padStart(4)}   ${p95.toFixed(1)}ms`,
    );
  }

  const counts = await db.queryOne<{ blocks: number; pages: number }>(sql`
    SELECT (SELECT count(*)::int FROM blocks WHERE workspace_id = ${workspaceId}) AS blocks,
           (SELECT count(*)::int FROM pages  WHERE workspace_id = ${workspaceId}) AS pages
  `);
  console.log(`\n  資料量：${counts?.blocks ?? 0} blocks / ${counts?.pages ?? 0} pages`);
  console.log(`  最差 p95：${worst.toFixed(1)}ms（驗收門檻 500ms）`);
  return worst < 500;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log('kennote 搜尋壓測');
  const { workspaceId, userId } = await seed();
  if (!args.skipSeed) await fill(workspaceId, userId, args.blocks);

  const ok = await bench(workspaceId, userId);

  if (!args.keep) {
    console.log('\n  清理 bench 資料（下次請加 --keep 保留）…');
    await db.query(sql`DELETE FROM workspaces WHERE id = ${workspaceId}`);
  }
  await closePool();
  console.log(ok ? '\n✅ 通過' : '\n❌ 超過 500ms 門檻');
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('壓測失敗：', err);
  await closePool().catch(() => {});
  process.exit(1);
});
