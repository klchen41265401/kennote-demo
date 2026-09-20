/**
 * O-17（第十三輪）：拖曳排序的鍵盤替代路徑。
 *
 * 只驗**按鍵 → 目標位置**這段純邏輯 —— 也就是 `PropertyList` / `SortBuilder` /
 * 看板卡片 / 側邊欄四處共用的那一顆判斷。DOM 那一層留給 e2e（R13-2～R13-4）。
 *
 * 三條紅線：
 *   1. **不帶 Alt 的方向鍵一定要放行**（面板裡的 ↑/↓ 是選單巡覽，吃掉就換成選單壞了）
 *   2. 撞到頭 / 尾要回傳 `'first'` / `'last'` 而不是 `null` ——
 *      `null` 的意思是「不歸我管」，會讓事件冒泡出去；
 *      兩者在畫面上都是「沒有移動」，但一個要出聲、一個不能吃掉事件。
 *   3. 看板是左右軸：上下鍵在看板上不該有作用（那是欄內捲動）
 */
import { describe, expect, it } from 'vitest';
import { reorderKeyTarget } from './keyboard-reorder';

const alt = (key: string) => ({ key, altKey: true });

describe('reorderKeyTarget', () => {
  it('Alt+↑ / Alt+↓ 各移動一格', () => {
    expect(reorderKeyTarget(alt('ArrowDown'), { index: 1, count: 4 })).toBe(2);
    expect(reorderKeyTarget(alt('ArrowUp'), { index: 1, count: 4 })).toBe(0);
  });

  it('Alt+Home / Alt+End 移到頭 / 尾', () => {
    expect(reorderKeyTarget(alt('Home'), { index: 2, count: 4 })).toBe(0);
    expect(reorderKeyTarget(alt('End'), { index: 2, count: 4 })).toBe(3);
  });

  it('沒有 Alt 的方向鍵一律放行（選單巡覽要用）', () => {
    expect(reorderKeyTarget({ key: 'ArrowDown', altKey: false }, { index: 0, count: 4 })).toBeNull();
    expect(reorderKeyTarget({ key: 'ArrowUp', altKey: false }, { index: 1, count: 4 })).toBeNull();
  });

  it('Ctrl / Meta 一起按也放行（那是別的快捷鍵）', () => {
    expect(
      reorderKeyTarget({ key: 'ArrowDown', altKey: true, ctrlKey: true }, { index: 0, count: 4 }),
    ).toBeNull();
    expect(
      reorderKeyTarget({ key: 'ArrowUp', altKey: true, metaKey: true }, { index: 1, count: 4 }),
    ).toBeNull();
  });

  it('撞到頭 / 尾回傳 first / last（要出聲，但不移動）', () => {
    expect(reorderKeyTarget(alt('ArrowUp'), { index: 0, count: 4 })).toBe('first');
    expect(reorderKeyTarget(alt('ArrowDown'), { index: 3, count: 4 })).toBe('last');
    // 已經在第一個時按 Alt+Home：原地不動，也算撞邊界
    expect(reorderKeyTarget(alt('Home'), { index: 0, count: 4 })).toBe('first');
    expect(reorderKeyTarget(alt('End'), { index: 3, count: 4 })).toBe('last');
  });

  it('只有一項時怎麼按都不動', () => {
    expect(reorderKeyTarget(alt('ArrowUp'), { index: 0, count: 1 })).toBe('first');
    expect(reorderKeyTarget(alt('ArrowDown'), { index: 0, count: 1 })).toBe('last');
  });

  it('看板（horizontal）吃左右鍵、放行上下鍵', () => {
    const opts = { index: 1, count: 3, axis: 'horizontal' as const };
    expect(reorderKeyTarget(alt('ArrowRight'), opts)).toBe(2);
    expect(reorderKeyTarget(alt('ArrowLeft'), opts)).toBe(0);
    expect(reorderKeyTarget(alt('ArrowDown'), opts)).toBeNull();
    expect(reorderKeyTarget(alt('ArrowUp'), opts)).toBeNull();
  });

  it('不認得的鍵回傳 null', () => {
    expect(reorderKeyTarget(alt('Enter'), { index: 1, count: 4 })).toBeNull();
    expect(reorderKeyTarget(alt('a'), { index: 1, count: 4 })).toBeNull();
  });
});
