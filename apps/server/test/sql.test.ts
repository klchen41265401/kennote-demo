import { describe, expect, it } from 'vitest';
import { UnsafeIdentifierError, isSql, sql } from '../src/db/sql.js';

describe('sql tagged template', () => {
  it('把內插值變成參數，值不會出現在 SQL 文字裡', () => {
    const evil = "'; DROP TABLE users; --";
    const q = sql`SELECT * FROM pages WHERE title = ${evil}`;
    expect(q.text).toBe('SELECT * FROM pages WHERE title = $1');
    expect(q.values).toEqual([evil]);
    expect(q.text).not.toContain('DROP TABLE');
  });

  it('巢狀片段會展平並重新編號參數', () => {
    const cond = sql`workspace_id = ${'ws-1'} AND deleted_at IS NULL`;
    const q = sql`SELECT * FROM pages WHERE id = ${'p-1'} AND ${cond} AND seq > ${5}`;
    expect(q.text).toBe(
      'SELECT * FROM pages WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL AND seq > $3',
    );
    expect(q.values).toEqual(['p-1', 'ws-1', 5]);
  });

  it('join 會重新編號每個片段的參數', () => {
    const parts = [sql`a = ${1}`, sql`b = ${2}`, sql`c = ${3}`];
    const q = sql`WHERE ${sql.join(parts, ' AND ')}`;
    expect(q.text).toBe('WHERE a = $1 AND b = $2 AND c = $3');
    expect(q.values).toEqual([1, 2, 3]);
  });

  it('join 會略過空片段', () => {
    const q = sql.join([sql`a = ${1}`, sql.empty, sql`b = ${2}`], ' AND ');
    expect(q.text).toBe('a = $1 AND b = $2');
  });

  it('raw 接受合法識別字與欄位清單', () => {
    expect(sql.raw('sort_key').text).toBe('sort_key');
    expect(sql.raw('p.title').text).toBe('p.title');
    expect(sql.raw('email::text AS email').text).toBe('email::text AS email');
    expect(sql.raw('id, workspace_id , parent_id').text).toBe('id, workspace_id, parent_id');
    expect(sql.raw('DESC NULLS LAST').text).toBe('DESC NULLS LAST');
  });

  it('raw 拒絕任何不是識別字的東西（這是防注入的關鍵）', () => {
    for (const bad of [
      'id; DROP TABLE users',
      "id') OR 1=1 --",
      'id FROM users',
      '(SELECT 1)',
      '',
      'id--',
      "'x'",
    ]) {
      expect(() => sql.raw(bad)).toThrow(UnsafeIdentifierError);
    }
  });

  it('values 會把陣列展開成參數列', () => {
    const q = sql`IN (${sql.values(['a', 'b', 'c'])})`;
    expect(q.text).toBe('IN ($1, $2, $3)');
    expect(q.values).toEqual(['a', 'b', 'c']);
  });

  it('isSql 能辨識片段', () => {
    expect(isSql(sql`x`)).toBe(true);
    expect(isSql({ text: 'x', values: [] })).toBe(false);
  });
});
