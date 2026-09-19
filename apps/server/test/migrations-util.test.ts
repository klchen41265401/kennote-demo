import { describe, expect, it } from 'vitest';
import {
  MigrationDriftError,
  checksum,
  isMigrationFileName,
  planMigrations,
  sortMigrations,
  stripRollbackSection,
} from '../src/db/migrations-util.js';

const f = (name: string, sql = `-- ${name}`) => ({ name, sql, checksum: checksum(sql) });

describe('migration runner 的純邏輯', () => {
  it('依檔名前綴數字排序（0009 排在 0010 前面）', () => {
    const files = [f('0010_j.sql'), f('0002_b.sql'), f('0009_i.sql'), f('0001_a.sql')];
    expect(sortMigrations(files).map((x) => x.name)).toEqual([
      '0001_a.sql',
      '0002_b.sql',
      '0009_i.sql',
      '0010_j.sql',
    ]);
  });

  it('沒補零的檔名也排得對', () => {
    const files = [{ name: '10_x.sql' }, { name: '2_y.sql' }];
    expect(sortMigrations(files).map((x) => x.name)).toEqual(['2_y.sql', '10_x.sql']);
  });

  it('只回傳尚未套用的 migration', () => {
    const files = [f('0001_a.sql'), f('0002_b.sql'), f('0003_c.sql')];
    const applied = [
      { name: '0001_a.sql', checksum: files[0]!.checksum },
      { name: '0002_b.sql', checksum: files[1]!.checksum },
    ];
    expect(planMigrations(files, applied).map((x) => x.name)).toEqual(['0003_c.sql']);
  });

  it('已套用的檔案被改過就報錯', () => {
    const files = [f('0001_a.sql', 'SELECT 2')];
    const applied = [{ name: '0001_a.sql', checksum: checksum('SELECT 1') }];
    expect(() => planMigrations(files, applied)).toThrow(MigrationDriftError);
  });

  it('checksum 不受 CRLF 影響（Windows 與 Linux 一致）', () => {
    expect(checksum('a\r\nb')).toBe(checksum('a\nb'));
  });

  it('檔名規範檢查', () => {
    expect(isMigrationFileName('0001_init.sql')).toBe(true);
    expect(isMigrationFileName('0002_pages_blocks.sql')).toBe(true);
    expect(isMigrationFileName('init.sql')).toBe(false);
    expect(isMigrationFileName('0001-init.sql')).toBe(false);
    expect(isMigrationFileName('0001_Init.sql')).toBe(false);
  });

  it('ROLLBACK 區段不會被執行', () => {
    const sql = 'CREATE TABLE x();\n-- ROLLBACK:\n-- DROP TABLE x;\n';
    expect(stripRollbackSection(sql)).toBe('CREATE TABLE x();\n');
  });
});
