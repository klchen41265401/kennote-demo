import { describe, expect, it } from 'vitest';
import {
  computeDropTarget,
  computeInsertIndex,
  type DropItemRect,
} from './computeDropTarget.js';

/** 四個 28px 高的節點，左緣 100、右緣 400。 */
const items: DropItemRect[] = [
  { id: 'a', top: 0, bottom: 28, left: 100, right: 400, depth: 0 },
  { id: 'b', top: 28, bottom: 56, left: 100, right: 400, depth: 0 },
  { id: 'c', top: 56, bottom: 84, left: 100, right: 400, depth: 1 },
  { id: 'd', top: 84, bottom: 112, left: 100, right: 400, depth: 0 },
];

describe('computeDropTarget — list 模式（兩段式）', () => {
  it('上半判 before、下半判 after', () => {
    const before = computeDropTarget({ x: 110, y: 5 }, items, { mode: 'list' });
    expect(before).toMatchObject({ id: 'a', position: 'before', index: 0 });
    const after = computeDropTarget({ x: 110, y: 24 }, items, { mode: 'list' });
    expect(after).toMatchObject({ id: 'a', position: 'after', index: 1 });
  });

  it('list 模式不會產生 inside，即使水平偏移很大', () => {
    const t = computeDropTarget({ x: 300, y: 40 }, items, { mode: 'list' });
    expect(t?.position).not.toBe('inside');
  });
});

describe('computeDropTarget — tree 模式（三段式）', () => {
  it('ratio < 0.25 判 before', () => {
    const t = computeDropTarget({ x: 105, y: 30 }, items);
    expect(t).toMatchObject({ id: 'b', position: 'before' });
  });

  it('ratio 落在中段（50%）判 inside —— 放進資料夾是最常見的意圖', () => {
    const t = computeDropTarget({ x: 105, y: 42 }, items);
    expect(t).toMatchObject({ id: 'b', position: 'inside' });
  });

  it('ratio >= 0.75 判 after', () => {
    const t = computeDropTarget({ x: 105, y: 54 }, items);
    expect(t).toMatchObject({ id: 'b', position: 'after' });
  });

  it('acceptsChildren: false 的項目不會出現 inside', () => {
    const leaf: DropItemRect[] = [
      { id: 'leaf', top: 0, bottom: 28, left: 100, right: 400, acceptsChildren: false },
    ];
    const t = computeDropTarget({ x: 200, y: 14 }, leaf);
    expect(t?.position).toBe('after');
  });
});

describe('computeDropTarget — 水平偏移 >= 24px 判「進裡面」', () => {
  it('偏移 23px 在上緣帶仍是 before', () => {
    const t = computeDropTarget({ x: 100 + 23, y: 29 }, items);
    expect(t?.position).toBe('before');
  });

  it('偏移剛好 24px 就升級為 inside', () => {
    const t = computeDropTarget({ x: 100 + 24, y: 29 }, items);
    expect(t).toMatchObject({ id: 'b', position: 'inside', depth: 1 });
  });

  it('insideThreshold 可調整', () => {
    const t = computeDropTarget({ x: 100 + 24, y: 29 }, items, { insideThreshold: 48 });
    expect(t?.position).toBe('before');
  });

  it('inside 的 depth 為目標 depth + 1，index 為 0（第一個子項）', () => {
    const t = computeDropTarget({ x: 100 + 30, y: 60 }, items);
    expect(t).toMatchObject({ id: 'c', position: 'inside', depth: 2, index: 0 });
  });
});

describe('computeDropTarget — depth 夾制與指示器幾何', () => {
  it('before / after 的 depth 依水平偏移換算，但不得超過目標 depth + 1', () => {
    const t = computeDropTarget({ x: 100 + 200, y: 84.5 }, items, { insideThreshold: 1e9 });
    expect(t?.id).toBe('d');
    expect(t?.depth).toBeLessThanOrEqual(1);
  });

  it('line 指示器依 depth 內縮並縮短', () => {
    const t = computeDropTarget({ x: 100, y: 1 }, items, { insideThreshold: 1e9 });
    expect(t?.indicator).toEqual({ type: 'line', x: 100, y: 0, width: 300, height: 2 });
  });

  it('inside 指示器是整列外框', () => {
    const t = computeDropTarget({ x: 130, y: 42 }, items);
    expect(t?.indicator).toEqual({ type: 'box', x: 100, y: 28, width: 300, height: 28 });
  });
});

describe('computeDropTarget — 邊界與無效落點', () => {
  it('指標在第一個項目之上 → before 第一個', () => {
    const t = computeDropTarget({ x: 110, y: -40 }, items);
    expect(t).toMatchObject({ id: 'a', position: 'before', index: 0 });
  });

  it('指標在最後一個項目之下 → after 最後一個', () => {
    const t = computeDropTarget({ x: 110, y: 400 }, items);
    expect(t).toMatchObject({ id: 'd', position: 'after', index: 4 });
  });

  it('disabledIds 命中時回傳 null（不能放到自己或子孫上）', () => {
    const t = computeDropTarget({ x: 110, y: 40 }, items, { disabledIds: ['b'] });
    expect(t).toBeNull();
  });

  it('空清單回傳 null', () => {
    expect(computeDropTarget({ x: 0, y: 0 }, [])).toBeNull();
  });

  it('maxDepth 夾制縮排層級', () => {
    const t = computeDropTarget({ x: 100 + 30, y: 60 }, items, { maxDepth: 1 });
    expect(t?.depth).toBe(1);
  });
});

describe('computeInsertIndex（看板）', () => {
  it('取第一個中心點在指標之下的卡片索引', () => {
    expect(computeInsertIndex({ x: 0, y: 0 }, items)).toBe(0);
    expect(computeInsertIndex({ x: 0, y: 40 }, items)).toBe(1); // b 的中心 42 > 40
    expect(computeInsertIndex({ x: 0, y: 999 }, items)).toBe(4);
  });

  it('支援橫向（表格欄）', () => {
    const cols: DropItemRect[] = [
      { id: 'c1', top: 0, bottom: 10, left: 0, right: 100 },
      { id: 'c2', top: 0, bottom: 10, left: 100, right: 200 },
    ];
    expect(computeInsertIndex({ x: 10, y: 5 }, cols, 'horizontal')).toBe(0);
    expect(computeInsertIndex({ x: 120, y: 5 }, cols, 'horizontal')).toBe(1);
  });
});
