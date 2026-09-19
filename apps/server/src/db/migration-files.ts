/**
 * migration 檔案的純讀取工具。
 * 拆出來的原因：metrics/health 也要讀 migrations 狀態，但 migrate.ts 有「當作入口時執行並 process.exit」的邏輯，
 * esbuild 打包後 import.meta.url 會變成 index.js，讓入口判斷誤判 → server 啟動後自行退出（重啟迴圈）。
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checksum, isMigrationFileName, type MigrationFile } from './migrations-util.js';

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

