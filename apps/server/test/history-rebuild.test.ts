/**
 * 版本歷史的重播與 diff（純邏輯，不需要資料庫）。
 * 這是 `page_transactions` 作為關鍵資產的驗證：任何時間點都重建得回來。
 */
import { describe, expect, it } from 'vitest';
import type { Operation } from '@kennote/shared-types';
import {
  applyOpsToDoc,
  bucketVersions,
  createEmptyDoc,
  diffDocs,
  rebuildAt,
} from '../src/modules/history/rebuild.js';

const insert = (id: string, afterId: string | null, text: string, parentId: string | null = null): Operation => ({
  type: 'block.insert',
  blockId: id,
  parentId,
  afterId,
  blockType: 'paragraph',
  props: {},
  content: [{ text }],
});

const log: Array<{ seq: number; ops: Operation[] }> = [
  { seq: 1, ops: [insert('b1', null, '第一段')] },
  { seq: 2, ops: [insert('b2', 'b1', '第二段')] },
  { seq: 3, ops: [{ type: 'block.update', blockId: 'b1', patch: { content: [{ text: '改過的第一段' }] } }] },
  { seq: 4, ops: [{ type: 'page.update', patch: { title: [{ text: '標題' }], icon: '📄' } }] },
  { seq: 5, ops: [{ type: 'block.delete', blockId: 'b2' }] },
];

describe('rebuildAt', () => {
  it('seq = 0 是空文件', () => {
    const doc = rebuildAt(log, 0);
    expect(doc.blocks.size).toBe(0);
    expect(doc.children).toEqual([]);
  });

  it('重播到任意 seq 都拿得到當時的狀態', () => {
    const at2 = rebuildAt(log, 2);
    expect(at2.children).toEqual(['b1', 'b2']);
    expect(at2.blocks.get('b1')?.content).toEqual([{ text: '第一段' }]);

    const at3 = rebuildAt(log, 3);
    expect(at3.blocks.get('b1')?.content).toEqual([{ text: '改過的第一段' }]);

    const at5 = rebuildAt(log, 5);
    expect(at5.children).toEqual(['b1']);
    expect(at5.blocks.has('b2')).toBe(false);
    expect(at5.title).toEqual([{ text: '標題' }]);
    expect(at5.icon).toBe('📄');
  });

  it('block.insert 冪等（離線佇列重送同一筆不會長出兩個 block）', () => {
    const doc = createEmptyDoc();
    applyOpsToDoc(doc, [insert('b1', null, 'x'), insert('b1', null, 'x')]);
    expect(doc.children).toEqual(['b1']);
    expect(doc.blocks.size).toBe(1);
  });

  it('刪除父節點會連同子孫一起消失', () => {
    const doc = createEmptyDoc();
    applyOpsToDoc(doc, [
      insert('parent', null, '父'),
      insert('child', null, '子', 'parent'),
      insert('grand', null, '孫', 'child'),
    ]);
    expect(doc.blocks.size).toBe(3);
    applyOpsToDoc(doc, [{ type: 'block.delete', blockId: 'parent' }]);
    expect(doc.blocks.size).toBe(0);
    expect(doc.children).toEqual([]);
  });

  it('block.move 會同時更新兩邊的 children 陣列', () => {
    const doc = createEmptyDoc();
    applyOpsToDoc(doc, [insert('a', null, 'a'), insert('b', 'a', 'b'), insert('c', 'b', 'c')]);
    applyOpsToDoc(doc, [{ type: 'block.move', blockId: 'c', parentId: null, afterId: null }]);
    expect(doc.children).toEqual(['c', 'a', 'b']);
  });

  it('text.delta（M6）與未知 op 在重播時被忽略，不讓歷史壞掉', () => {
    const doc = createEmptyDoc();
    applyOpsToDoc(doc, [
      insert('a', null, 'a'),
      { type: 'text.delta', blockId: 'a', delta: { ops: [] }, baseRev: 0 },
    ]);
    expect(doc.blocks.size).toBe(1);
  });
});

describe('diffDocs（還原時要送出的 ops）', () => {
  it('還原到舊版本：補回被刪的 block、還原內容', () => {
    const current = rebuildAt(log, 5);
    const target = rebuildAt(log, 2);
    const ops = diffDocs(current, target);

    // 把 ops 套回 current，應該完全等於 target
    const replayed = applyOpsToDoc(rebuildAt(log, 5), ops);
    expect(replayed.children).toEqual(target.children);
    expect(replayed.blocks.get('b1')?.content).toEqual([{ text: '第一段' }]);
    expect(replayed.blocks.get('b2')?.content).toEqual([{ text: '第二段' }]);
    expect(replayed.title).toEqual(target.title);
    expect(replayed.icon).toBe(target.icon);
  });

  it('狀態相同時不產生任何 op', () => {
    expect(diffDocs(rebuildAt(log, 3), rebuildAt(log, 3))).toEqual([]);
  });

  it('還原巢狀結構（父子順序正確：先插父再插子）', () => {
    const target = createEmptyDoc();
    applyOpsToDoc(target, [
      insert('p', null, '父'),
      insert('c1', null, '子1', 'p'),
      insert('c2', 'c1', '子2', 'p'),
    ]);
    const ops = diffDocs(createEmptyDoc(), target);
    const replayed = applyOpsToDoc(createEmptyDoc(), ops);
    expect(replayed.children).toEqual(['p']);
    expect(replayed.blocks.get('p')?.children).toEqual(['c1', 'c2']);
  });

  it('只有順序不同時只送 move', () => {
    const current = createEmptyDoc();
    applyOpsToDoc(current, [insert('a', null, 'a'), insert('b', 'a', 'b')]);
    const target = createEmptyDoc();
    applyOpsToDoc(target, [insert('b', null, 'b'), insert('a', 'b', 'a')]);

    const ops = diffDocs(current, target);
    expect(ops.every((o) => o.type === 'block.move')).toBe(true);
    expect(applyOpsToDoc(current, ops).children).toEqual(['b', 'a']);
  });
});

describe('bucketVersions', () => {
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const tx = (seq: number, minutesLater: number, actorId = 'u1') => ({
    seq,
    appliedAt: new Date(base + minutesLater * 60_000).toISOString(),
    actorId,
  });

  it('每 20 筆切一個版本點', () => {
    const rows = Array.from({ length: 45 }, (_, i) => tx(i + 1, 0));
    const versions = bucketVersions(rows);
    expect(versions).toHaveLength(3);
    // 最新的排最前面
    expect(versions[0]!.seq).toBe(45);
    expect(versions[0]!.txCount).toBe(5);
    expect(versions[2]!.txCount).toBe(20);
  });

  it('跨過一小時也切一個版本點', () => {
    const versions = bucketVersions([tx(1, 0), tx(2, 10), tx(3, 61), tx(4, 62)]);
    expect(versions).toHaveLength(2);
    expect(versions[0]!.seq).toBe(4);
    expect(versions[1]!.seq).toBe(2);
  });

  it('記錄這段期間編輯過的人（不重複）', () => {
    const versions = bucketVersions([tx(1, 0, 'a'), tx(2, 1, 'b'), tx(3, 2, 'a')]);
    expect(versions[0]!.actorIds).toEqual(['a', 'b']);
  });

  it('沒有 transaction 時回空陣列', () => {
    expect(bucketVersions([])).toEqual([]);
  });
});
