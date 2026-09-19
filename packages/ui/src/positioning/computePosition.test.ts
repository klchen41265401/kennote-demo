import { describe, expect, it } from 'vitest';
import { computePosition } from './computePosition.js';
import { makeRect } from './rect.js';
import type { RectLike } from './types.js';

/** 1000x800 的假 viewport，讓測試完全不依賴真實視窗尺寸。 */
const VIEWPORT: RectLike = makeRect(0, 0, 1000, 800);
const FLOATING = { width: 200, height: 100 };

describe('computePosition — 步驟 1/2 主軸與次軸', () => {
  const anchor = makeRect(400, 300, 100, 40); // left 400, top 300, right 500, bottom 340

  it('bottom-start 貼齊錨點左緣與下緣', () => {
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom-start',
      boundary: VIEWPORT,
    });
    expect(p.x).toBe(400);
    expect(p.y).toBe(346); // 340 + offset 6
    expect(p.placement).toBe('bottom-start');
  });

  it('bottom-end 貼齊錨點右緣', () => {
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom-end',
      boundary: VIEWPORT,
    });
    expect(p.x).toBe(300); // 500 - 200
  });

  it('無後綴時次軸置中', () => {
    const p = computePosition({ anchor, floating: FLOATING, placement: 'bottom', boundary: VIEWPORT });
    expect(p.x).toBe(350); // 400 + (100 - 200) / 2
  });

  it('top 主軸在錨點上方', () => {
    const p = computePosition({ anchor, floating: FLOATING, placement: 'top', boundary: VIEWPORT });
    expect(p.y).toBe(194); // 300 - 100 - 6
  });

  it('right / left 主軸在錨點左右', () => {
    const r = computePosition({ anchor, floating: FLOATING, placement: 'right', boundary: VIEWPORT });
    expect(r.x).toBe(506); // 500 + 6
    expect(r.y).toBe(270); // 300 + (40 - 100) / 2
    const l = computePosition({ anchor, floating: FLOATING, placement: 'left', boundary: VIEWPORT });
    expect(l.x).toBe(194); // 400 - 200 - 6
  });

  it('right-start / right-end 次軸貼齊錨點上下緣', () => {
    const s = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'right-start',
      boundary: VIEWPORT,
    });
    expect(s.y).toBe(300);
    const e = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'right-end',
      boundary: VIEWPORT,
    });
    expect(e.y).toBe(240); // 340 - 100
  });

  it('offset 可調整', () => {
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom',
      offset: 20,
      boundary: VIEWPORT,
    });
    expect(p.y).toBe(360);
  });
});

describe('computePosition — 步驟 3 flip', () => {
  it('下方空間不足且上方較大時翻到 top', () => {
    const anchor = makeRect(400, 740, 100, 40); // bottom 780，下方只剩 20
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom-start',
      boundary: VIEWPORT,
    });
    expect(p.side).toBe('top');
    expect(p.placement).toBe('top-start');
    expect(p.y).toBe(634); // 740 - 100 - 6
  });

  it('flip: false 時不翻轉', () => {
    const anchor = makeRect(400, 740, 100, 40);
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom-start',
      flip: false,
      boundary: VIEWPORT,
    });
    expect(p.side).toBe('bottom');
  });

  it('兩側都不夠時留在原方向，改由 maxHeight 壓縮', () => {
    const tiny = makeRect(0, 0, 400, 120);
    const anchor = makeRect(10, 50, 50, 20); // 上方 50、下方 50，皆小於 100
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom-start',
      boundary: tiny,
    });
    expect(p.side).toBe('bottom');
    expect(p.maxHeight).toBe(36); // 120 - 70 - 6 - 8
  });

  it('left 空間不足時翻到 right', () => {
    const anchor = makeRect(20, 300, 40, 40);
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'left',
      boundary: VIEWPORT,
    });
    expect(p.side).toBe('right');
  });
});

describe('computePosition — 步驟 4 shift', () => {
  it('次軸超出右邊界時推回，並保留 padding', () => {
    const anchor = makeRect(950, 300, 40, 40);
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom-start',
      boundary: VIEWPORT,
    });
    expect(p.x).toBe(792); // 1000 - 200 - 8
  });

  it('次軸超出左邊界時推回', () => {
    const anchor = makeRect(4, 300, 40, 40);
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom-end',
      boundary: VIEWPORT,
    });
    expect(p.x).toBe(8);
  });

  it('shift: false 時不推回', () => {
    const anchor = makeRect(950, 300, 40, 40);
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom-start',
      shift: false,
      boundary: VIEWPORT,
    });
    expect(p.x).toBe(950);
  });

  it('shift 只動次軸，不動主軸', () => {
    const anchor = makeRect(400, 300, 100, 40);
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'right',
      boundary: VIEWPORT,
    });
    // 垂直方向（次軸）被 clamp，水平方向（主軸）維持 right 的計算值
    expect(p.x).toBe(506);
  });

  it('padding 可調整', () => {
    const anchor = makeRect(950, 300, 40, 40);
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom-start',
      padding: 24,
      boundary: VIEWPORT,
    });
    expect(p.x).toBe(776); // 1000 - 200 - 24
  });
});

describe('computePosition — 步驟 5 maxHeight / matchWidth', () => {
  it('maxHeight 為主軸可用空間', () => {
    const anchor = makeRect(400, 300, 100, 40);
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom',
      boundary: VIEWPORT,
    });
    expect(p.maxHeight).toBe(446); // 800 - 340 - 6 - 8
  });

  it('matchWidth 讓浮層寬度等於錨點寬度', () => {
    const anchor = makeRect(100, 100, 260, 32);
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom-start',
      matchWidth: true,
      boundary: VIEWPORT,
    });
    expect(p.width).toBe(260);
    expect(p.x).toBe(100);
  });
});

describe('computePosition — 步驟 6 arrow', () => {
  it('箭頭沿次軸對準錨點中心', () => {
    const anchor = makeRect(400, 300, 100, 40);
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom-start',
      arrow: true,
      boundary: VIEWPORT,
    });
    // 錨點中心 450，浮層左緣 400 → 50 - 4 = 46
    expect(p.arrow).toEqual({ x: 46, y: -8, side: 'top' });
  });

  it('箭頭被夾在浮層圓角之內', () => {
    const anchor = makeRect(950, 300, 40, 40);
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'bottom-start',
      arrow: { size: 8, radius: 6, padding: 4 },
      boundary: VIEWPORT,
    });
    // shift 後浮層左緣 792，錨點中心 970 → 174 應被夾到 max = 200-6-8-4 = 182
    expect(p.arrow?.x).toBeLessThanOrEqual(182);
    expect(p.arrow?.x).toBeGreaterThanOrEqual(10);
  });

  it('左右方向的箭頭在水平軸上', () => {
    const anchor = makeRect(400, 300, 100, 40);
    const p = computePosition({
      anchor,
      floating: FLOATING,
      placement: 'right',
      arrow: true,
      boundary: VIEWPORT,
    });
    expect(p.arrow?.x).toBe(-8);
    expect(p.arrow?.side).toBe('left');
  });
});

describe('computePosition — 座標與錨點來源', () => {
  it('座標一律取整（避免中文字渲染模糊）', () => {
    const anchor = makeRect(400.4, 300.7, 101, 41);
    const p = computePosition({
      anchor,
      floating: { width: 200, height: 101 },
      placement: 'bottom',
      boundary: VIEWPORT,
    });
    expect(Number.isInteger(p.x)).toBe(true);
    expect(Number.isInteger(p.y)).toBe(true);
  });

  it('anchor 可以是 DOM 元素（jsdom 手動覆寫 rect）', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => makeRect(200, 100, 80, 24) as DOMRect;
    document.body.appendChild(el);
    const p = computePosition({
      anchor: el,
      floating: FLOATING,
      placement: 'bottom-start',
      boundary: VIEWPORT,
    });
    expect(p.x).toBe(200);
    expect(p.y).toBe(130);
    el.remove();
  });

  it('floating 可以是 DOM 元素（rect 為 0 時退回 offset 尺寸）', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => makeRect(0, 0, 320, 240) as DOMRect;
    const p = computePosition({
      anchor: makeRect(400, 300, 100, 40),
      floating: el,
      placement: 'bottom-end',
      boundary: VIEWPORT,
    });
    expect(p.x).toBe(180); // 500 - 320
  });

  it('回傳的 anchorRect 是純物件快照', () => {
    const anchor = makeRect(1, 2, 3, 4);
    const p = computePosition({ anchor, floating: FLOATING, boundary: VIEWPORT });
    expect(p.anchorRect).toEqual(anchor);
    expect(p.anchorRect).not.toBe(anchor);
  });
});
