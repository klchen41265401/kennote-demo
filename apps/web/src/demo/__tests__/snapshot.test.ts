/**
 * snapshot / 種子資料的形狀必須與伺服器一致 ——
 * 這裡用 `@kennote/shared-types` 的型別當契約（編譯期），
 * 再用 runtime 斷言補上「欄位真的存在」。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSnapshot, PageSnapshot, QueryRowsResult } from '@kennote/shared-types';
import { BLOCK_TYPES, VIEW_TYPES } from '@kennote/shared-types';
import { buildSnapshot } from '../core';
import { rowsOf, viewsOf } from '../handlers/databases';
import { runQuery } from '../rows';
import { seedDemoData } from '../seed';
import { db, emptyState, replaceState } from '../store';
import { plain } from '../util';

describe('種子資料 + snapshot 形狀', () => {
  let seeded: ReturnType<typeof seedDemoData>;

  beforeEach(() => {
    replaceState(emptyState());
    seeded = seedDemoData();
  });

  it('snapshot 是 record_map 扁平形狀（pageId / seq / rootBlockIds / recordMap）', () => {
    const snapshot: PageSnapshot = buildSnapshot(seeded.pageId);
    expect(snapshot.pageId).toBe(seeded.pageId);
    expect(typeof snapshot.seq).toBe('number');
    expect(Array.isArray(snapshot.rootBlockIds)).toBe(true);
    expect(snapshot.recordMap.page[seeded.pageId]).toBeDefined();
    expect(snapshot.recordMap.page[seeded.pageId]!.role).toBe('owner');

    // 每個 recordMap.block 條目都是 { value, role }，value 有完整的 Block 欄位
    for (const id of snapshot.rootBlockIds) {
      const entry = snapshot.recordMap.block[id]!;
      expect(entry).toBeDefined();
      const block = entry.value;
      expect(block.id).toBe(id);
      expect(block.pageId).toBe(seeded.pageId);
      expect(BLOCK_TYPES).toContain(block.type);
      expect(Array.isArray(block.children)).toBe(true);
      expect(Array.isArray(block.content)).toBe(true);
      expect(typeof block.version).toBe('number');
      // 伺服器的 Block 不帶 deletedAt / workspaceId，demo 的內部欄位不可以外洩
      expect(block).not.toHaveProperty('deletedAt');
      expect(block).not.toHaveProperty('workspaceId');
    }
  });

  it('參考頁蓋到 21 種以上的 block 型別（對照 e2e/fixtures/reference-page.ts）', () => {
    const snapshot = buildSnapshot(seeded.pageId);
    const types = new Set(Object.values(snapshot.recordMap.block).map((b) => b.value.type));
    for (const expected of [
      'paragraph', 'heading1', 'heading2', 'heading3', 'todo', 'bulletedList', 'numberedList',
      'toggle', 'quote', 'divider', 'callout', 'code', 'table', 'tableRow', 'equation',
      'tableOfContents', 'syncedBlock', 'columnList', 'column', 'page', 'bookmark', 'image',
      'collectionView',
    ]) {
      expect(types.has(expected as never)).toBe(true);
    }
    expect(types.size).toBeGreaterThanOrEqual(21);
  });

  it('inline database 有 6 種視圖與 6 筆列', () => {
    const snapshot: DatabaseSnapshot = {
      collection: db().collections[seeded.collectionId]!,
      views: viewsOf(seeded.collectionId),
    };
    expect(snapshot.collection.isInline).toBe(true);
    expect(snapshot.views.map((v) => v.type).sort()).toEqual([...VIEW_TYPES].sort());
    expect(rowsOf(seeded.collectionId)).toHaveLength(6);
  });

  it('QueryRowsResult 的欄位齊全', () => {
    const collection = db().collections[seeded.collectionId]!;
    const table = viewsOf(seeded.collectionId).find((v) => v.type === 'table')!;
    const run = runQuery({
      schema: collection.schema,
      query: table.query,
      rows: rowsOf(seeded.collectionId),
      limit: 50,
      offset: 0,
    });
    const result: QueryRowsResult = {
      collectionId: seeded.collectionId,
      viewId: table.id,
      rows: run.rows,
      aggregations: run.aggregations,
      cursor: run.hasMore ? String(run.nextOffset) : null,
      hasMore: run.hasMore,
      total: run.total,
    };
    expect(result.total).toBe(6);
    expect(result.cursor).toBeNull();
    // 每一列都有 title + 系統欄位以外的 7 個欄位值
    for (const r of result.rows) {
      expect(r.properties.title?.type).toBe('title');
      expect(r.collectionId).toBe(seeded.collectionId);
    }
  });

  it('board 視圖的 groupBy 會分成三個泳道', () => {
    const collection = db().collections[seeded.collectionId]!;
    const board = viewsOf(seeded.collectionId).find((v) => v.type === 'board')!;
    const run = runQuery({
      schema: collection.schema,
      query: board.query,
      rows: rowsOf(seeded.collectionId),
      limit: 50,
      offset: 0,
    });
    expect(run.groups?.filter((g) => g.count > 0)).toHaveLength(3);
  });

  it('首頁「最近造訪」有內容，參考頁在我的最愛', () => {
    expect(db().visits.length).toBeGreaterThanOrEqual(4);
    expect(db().favorites.some((f) => f.pageId === seeded.pageId)).toBe(true);
  });

  it('工作區與子頁面都建好了', () => {
    expect(plain(db().pages[seeded.pageId]!.title)).toContain('參考用');
    expect(db().pages[seeded.subPageId]!.parentId).toBe(seeded.pageId);
    expect(Object.values(db().workspaces)[0]!.name).toBe('kennote Demo');
  });
});
