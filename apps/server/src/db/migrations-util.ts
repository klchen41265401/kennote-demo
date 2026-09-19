/**
 * migration runner 的純邏輯部分。
 * 刻意與 env / pg 分開，才能在沒有資料庫的環境下單元測試（04 §9.2）。
 */
import { createHash } from 'node:crypto';

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
}

const MIGRATION_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export function isMigrationFileName(name: string): boolean {
  return MIGRATION_NAME.test(name);
}

export function checksum(sql: string): string {
  // 正規化換行，避免 Windows/Linux 的 CRLF 差異讓 checksum 對不起來
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * 依「檔名前綴數字」排序，數字相同時依完整檔名。
 * 直接用字串排序在 0009 → 0010 是對的，但我們仍顯式解析數字，
 * 避免哪天有人寫了 `10_xxx.sql`（沒有補零）而被排到 0002 前面。
 */
export function sortMigrations<T extends { name: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    const na = Number(a.name.slice(0, a.name.indexOf('_')));
    const nb = Number(b.name.slice(0, b.name.indexOf('_')));
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

export class MigrationDriftError extends Error {
  constructor(name: string) {
    super(
      `Migration ${name} 的內容在套用之後被修改過（sha256 不符）。\n` +
        '歷史 migration 不可更動；請改成新增一支 migration。',
    );
    this.name = 'MigrationDriftError';
  }
}

/**
 * 算出這次該跑哪些 migration，順便偵測歷史檔案被竄改。
 */
export function planMigrations(
  files: MigrationFile[],
  applied: AppliedMigration[],
): MigrationFile[] {
  const appliedMap = new Map(applied.map((a) => [a.name, a.checksum]));
  const sorted = sortMigrations(files);
  const pending: MigrationFile[] = [];
  for (const file of sorted) {
    const prev = appliedMap.get(file.name);
    if (prev === undefined) {
      pending.push(file);
      continue;
    }
    if (prev !== file.checksum) throw new MigrationDriftError(file.name);
  }
  return pending;
}

/**
 * 去掉檔尾的 `-- ROLLBACK:` 區段（那是給人看的手動回退腳本，不執行）。
 */
export function stripRollbackSection(sql: string): string {
  const idx = sql.indexOf('-- ROLLBACK:');
  return idx === -1 ? sql : sql.slice(0, idx);
}
