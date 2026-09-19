/**
 * 自製 migration runner（04 §5.2）。
 *
 * 1) 確保 schema_migrations 表存在
 * 2) 讀 migrations/ 下所有 .sql，依檔名排序
 * 3) 逐一在 transaction 內執行未套用過的，並記錄檔名 + sha256
 * 4) 已套用的檔案 sha256 變了 → 報錯（防止改動歷史 migration）
 *
 * 用法：pnpm --filter @kennote/server migrate
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './client.js';
import {
  checksum,
  isMigrationFileName,
  planMigrations,
  stripRollbackSection,
  type AppliedMigration,
  type MigrationFile,
} from './migrations-util.js';

/** 開發（tsx，src/db/）與正式（esbuild bundle，dist/）兩種佈局都要找得到 */
export function resolveMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../migrations'), // src/db/ → apps/server/migrations
    path.resolve(here, '../migrations'), // dist/    → apps/server/migrations
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(process.cwd(), 'apps/server/migrations'),
  ];
  for (const dir of candidates) if (existsSync(dir)) return dir;
  throw new Error(`找不到 migrations 目錄，已嘗試：\n${candidates.join('\n')}`);
}

export async function readMigrationFiles(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files: MigrationFile[] = [];
  for (const name of entries) {
    if (!name.endsWith('.sql')) continue;
    if (!isMigrationFileName(name)) {
      throw new Error(`migration 檔名不符合規範（應為 0001_snake_case.sql）：${name}`);
    }
    const sql = await readFile(path.join(dir, name), 'utf8');
    files.push({ name, sql, checksum: checksum(sql) });
  }
  return files;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name        text PRIMARY KEY,
  checksum    text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  duration_ms integer NOT NULL DEFAULT 0
);`;

export async function runMigrations(): Promise<{ applied: string[]; skipped: number }> {
  const pool = getPool();
  const dir = resolveMigrationsDir();
  const files = await readMigrationFiles(dir);

  await pool.query(CREATE_TABLE);
  const { rows } = await pool.query<AppliedMigration>('SELECT name, checksum FROM schema_migrations');
  const pending = planMigrations(files, rows);

  if (pending.length === 0) {
    console.log(`✅ 資料庫已是最新（共 ${files.length} 支 migration）`);
    return { applied: [], skipped: files.length };
  }

  const applied: string[] = [];
  for (const file of pending) {
    const client = await pool.connect();
    const started = Date.now();
    try {
      await client.query('BEGIN');
      await client.query(stripRollbackSection(file.sql));
      await client.query(
        'INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)',
        [file.name, file.checksum, Date.now() - started],
      );
      await client.query('COMMIT');
      applied.push(file.name);
      console.log(`  ✔ ${file.name}  (${Date.now() - started}ms)`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`  ✖ ${file.name} 失敗，已 rollback`);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log(`✅ 套用了 ${applied.length} 支 migration`);
  return { applied, skipped: files.length - applied.length };
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isEntry) {
  runMigrations()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('❌ Migration 失敗：', err instanceof Error ? err.message : err);
      await closePool().catch(() => {});
      process.exit(1);
    });
}
