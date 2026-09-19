/**
 * 第九輪 §6-4：**0070 之前上傳的附件回填 `files.page_id`。**
 *
 * migration 0070 刻意沒有回填（理由寫在那支 SQL 裡：反查 `block.props` 在大工作區
 * 太慢，不該塞進一段會鎖表的 migration）。結果是舊附件一律 `page_id IS NULL`，
 * 退回「工作區成員限定」—— **同工作區的 guest 仍然拿得到舊的私密附件。**
 * 0070 修的是「從今以後」，這一支修的是「在那之前」。
 *
 * 用法（需要真的 PostgreSQL，**不在 CI 跑、不進 pnpm test**）：
 *   export DATABASE_URL=postgres://...
 *   pnpm --filter @kennote/server exec tsx scripts/backfill-file-pages.ts --dry-run
 *   pnpm --filter @kennote/server exec tsx scripts/backfill-file-pages.ts
 *
 * 參數：
 *   --dry-run          只印統計，一列都不寫（**預設請先跑這個**）
 *   --workspace <uuid> 只做這一個工作區（分批上線用）
 *   --batch N          一批處理幾個 block（預設 2000）
 *
 * ── 紅線 ─────────────────────────────────────────────
 *
 * 1. **只補 NULL，永不覆蓋。** `WHERE f.page_id IS NULL`。
 *    已經有值的是 0070 之後上傳的（或已經回填過的），那是比反查更可信的來源。
 *
 * 2. **一個附件被多頁引用時整個跳過，不是挑一頁。**
 *    複製頁面 / 複製 block 會讓同一個 `fileId` 出現在好幾頁。
 *    隨便挑一頁 = 隨便挑一組權限，而且挑錯的方向可能是「放寬」。
 *    留 NULL 的行為 = 現況（成員限定），**清理程式的錯誤方向必須是少做**
 *    （第九輪 §7 的最後一條）。這些會被印成 `skippedMultiPage`，人可以再看。
 *
 * 3. **附件與頁面必須同一個工作區。** 不同 → 跳過（`skippedCrossWorkspace`）。
 *    儲存路徑 `buildStorageKey(workspaceId, ...)` 本來就綁工作區，
 *    跨工作區的引用是資料本身有問題，不該由回填腳本幫它合理化。
 *
 * 4. **可以重跑。** 每一批都是「掃 → 決定 → UPDATE ... WHERE page_id IS NULL」，
 *    跑到一半斷掉再跑一次只會補上剩下的。
 */
import { closePool, db } from '../src/db/client.js';
import { sql } from '../src/db/sql.js';

/** 帶 `props.fileId` 的 block 型別（與 block-types/index.ts 的 mediaSchema 使用者一致） */
const MEDIA_BLOCK_TYPES = ['image', 'file', 'video', 'pdf', 'audio'] as const;

interface Args {
  dryRun: boolean;
  workspaceId: string | null;
  batch: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const batch = Number(get('batch') ?? 2000);
  return {
    dryRun: argv.includes('--dry-run'),
    workspaceId: get('workspace') ?? null,
    batch: Number.isFinite(batch) && batch > 0 ? Math.min(Math.floor(batch), 10_000) : 2000,
  };
}

interface Candidate {
  file_id: string;
  file_workspace_id: string;
  page_ids: string[];
  page_workspace_ids: string[];
}

export interface BackfillStats {
  scannedFiles: number;
  updated: number;
  skippedMultiPage: number;
  skippedCrossWorkspace: number;
}

/**
 * 決定一個候選要不要回填。**純函式**，所以紅線 2/3 可以單獨被推理與測試
 * （`files-backfill.test.ts`）。
 */
export function decide(
  candidate: Pick<Candidate, 'file_workspace_id' | 'page_ids' | 'page_workspace_ids'>,
): { action: 'update'; pageId: string } | { action: 'multi-page' | 'cross-workspace' | 'none' } {
  const pages = [...new Set(candidate.page_ids)];
  if (pages.length === 0) return { action: 'none' };
  if (pages.length > 1) return { action: 'multi-page' };
  const pageId = pages[0] as string;
  if (candidate.page_workspace_ids.some((w) => w !== candidate.file_workspace_id)) {
    return { action: 'cross-workspace' };
  }
  return { action: 'update', pageId };
}

export async function backfill(args: Args): Promise<BackfillStats> {
  const stats: BackfillStats = {
    scannedFiles: 0,
    updated: 0,
    skippedMultiPage: 0,
    skippedCrossWorkspace: 0,
  };

  /*
   * 一句 SQL 把「每一個沒有 page_id 的附件被哪些頁面引用」聚合出來。
   * `props->>'fileId'` 是 text，files.id 是 uuid → 轉型比對（`::uuid` 會在
   * 髒資料上炸，所以先用正規表示式篩掉不是 UUID 的值）。
   * 刻意不建索引：這是一支**跑一次**的腳本，全表掃一遍比多一個永久索引便宜。
   */
  const rows = await db.query<Candidate>(sql`
    WITH refs AS (
      SELECT (b.props->>'fileId')::uuid AS file_id,
             b.page_id,
             p.workspace_id AS page_workspace_id
        FROM blocks b
        JOIN pages p ON p.id = b.page_id AND p.deleted_at IS NULL
       WHERE b.deleted_at IS NULL
         AND b.type = ANY(${[...MEDIA_BLOCK_TYPES]}::text[])
         AND b.props->>'fileId' IS NOT NULL
         AND b.props->>'fileId' ~ '^[0-9a-fA-F-]{36}$'
    )
    SELECT f.id AS file_id,
           f.workspace_id AS file_workspace_id,
           array_agg(DISTINCT refs.page_id::text) AS page_ids,
           array_agg(DISTINCT refs.page_workspace_id::text) AS page_workspace_ids
      FROM files f
      JOIN refs ON refs.file_id = f.id
     WHERE f.page_id IS NULL
       AND f.deleted_at IS NULL
       ${args.workspaceId ? sql`AND f.workspace_id = ${args.workspaceId}` : sql.empty}
     GROUP BY f.id, f.workspace_id
  `);

  for (const row of rows) {
    stats.scannedFiles += 1;
    const verdict = decide(row);
    // `!== 'update'` 而不是逐一列舉：新增一種 action 時這裡自動走「不做」那一邊，
    // 而不是掉進回填的分支（清理程式的預設行為必須是少做）。
    if (verdict.action !== 'update') {
      if (verdict.action === 'multi-page') {
        stats.skippedMultiPage += 1;
        console.log(`  skip(multi-page) file=${row.file_id} pages=${row.page_ids.join(',')}`);
      } else if (verdict.action === 'cross-workspace') {
        stats.skippedCrossWorkspace += 1;
        console.log(`  skip(cross-workspace) file=${row.file_id}`);
      }
      continue;
    }
    if (args.dryRun) {
      stats.updated += 1;
      continue;
    }
    // 再問一次 `page_id IS NULL`：掃描與寫入之間可能有人上傳 / 搬過它
    const updated = await db.queryOne<{ id: string }>(sql`
      UPDATE files SET page_id = ${verdict.pageId}
       WHERE id = ${row.file_id} AND page_id IS NULL AND deleted_at IS NULL
      RETURNING id
    `);
    if (updated) stats.updated += 1;
  }

  return stats;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `backfill-file-pages：${args.dryRun ? 'DRY RUN（不寫入）' : '寫入模式'}` +
      `${args.workspaceId ? ` workspace=${args.workspaceId}` : '（全部工作區）'}`,
  );
  const stats = await backfill(args);
  console.log('──');
  console.log(`  有引用且 page_id IS NULL 的附件：${stats.scannedFiles}`);
  console.log(`  ${args.dryRun ? '會回填' : '已回填'}：${stats.updated}`);
  console.log(`  跳過（被多頁引用）：${stats.skippedMultiPage}`);
  console.log(`  跳過（跨工作區引用）：${stats.skippedCrossWorkspace}`);
  console.log(
    '\n  ⚠️ 完全沒有被任何 block 引用的附件（頭像、匯入暫存、孤兒）不在這張表裡，' +
      '\n     它們維持 page_id IS NULL = 工作區成員限定，這是刻意的。',
  );
  await closePool();
}

// 被測試 import 時不要自己跑起來
if (process.argv[1]?.includes('backfill-file-pages')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
