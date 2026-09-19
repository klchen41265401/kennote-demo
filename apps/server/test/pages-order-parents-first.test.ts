import { describe, expect, it } from 'vitest';
import { orderParentsFirst } from '../src/modules/pages/service.js';

type Row = { id: string; parent_id: string | null };
const row = (id: string, parent: string | null = null): Row => ({ id, parent_id: parent });

/** 父一定要排在子之前 —— 否則 duplicatePage 的 INSERT 會撞 self-referencing FK（500）。 */
function assertParentsFirst(rows: Row[]): void {
  const seen = new Set<string>();
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    if (r.parent_id !== null && ids.has(r.parent_id)) {
      expect(seen.has(r.parent_id)).toBe(true);
    }
    seen.add(r.id);
  }
}

describe('orderParentsFirst', () => {
  it('把子節點排到父節點之後（原本依 sort_key 排會反過來）', () => {
    // 實際重現：父頁 sort_key='zV'、子頁 sort_key='z' → 查詢排序會讓子在前
    const input = [row('child', 'root'), row('root')];
    const out = orderParentsFirst(input);
    expect(out.map((r) => r.id)).toEqual(['root', 'child']);
    assertParentsFirst(out);
  });

  it('多層樹全部保持前序，且不重不漏', () => {
    const input = [
      row('grandchild', 'child'),
      row('child', 'root'),
      row('sibling', 'root'),
      row('root'),
    ];
    const out = orderParentsFirst(input);
    expect(out).toHaveLength(4);
    expect(new Set(out.map((r) => r.id)).size).toBe(4);
    assertParentsFirst(out);
  });

  it('parent 不在這一批裡時視為根', () => {
    const out = orderParentsFirst([row('a', 'outside'), row('b', 'a')]);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('資料成環也不掉列', () => {
    const out = orderParentsFirst([row('a', 'b'), row('b', 'a')]);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((r) => r.id))).toEqual(new Set(['a', 'b']));
  });
});
