import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VirtualList, type VirtualListHandle } from './VirtualList.js';

const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, label: `列 ${i}` }));

afterEach(() => {
  document.body.innerHTML = '';
});

function renderFixed(overscan = 4) {
  const ref = createRef<VirtualListHandle>();
  const utils = render(
    <VirtualList
      ref={ref}
      items={rows}
      itemSize={40}
      size={400}
      overscan={overscan}
      getKey={(r) => r.id}
    >
      {(row) => <div className="row">{row.label}</div>}
    </VirtualList>,
  );
  return { ref, ...utils };
}

describe('VirtualList — 固定高', () => {
  it('1000 筆資料時渲染的 DOM 節點 < 100', () => {
    const { container } = renderFixed();
    const rendered = container.querySelectorAll('.row');
    expect(rows).toHaveLength(1000);
    expect(rendered.length).toBeLessThan(100);
    expect(rendered.length).toBeGreaterThan(0);
  });

  it('只渲染 ceil(viewport / H) + overscan*2 附近的項目', () => {
    const { container } = renderFixed(2);
    // 400 / 40 = 10 列，加上前後 overscan 2 → 約 13 個
    const rendered = container.querySelectorAll('.row');
    expect(rendered.length).toBeLessThanOrEqual(16);
  });

  it('總高度 = 筆數 * 列高', () => {
    const { container } = renderFixed();
    const inner = container.querySelector('[data-kn-virtual] > div') as HTMLElement;
    expect(inner.style.height).toBe('40000px');
  });

  it('捲動後渲染的是後面的項目', () => {
    const { container } = renderFixed();
    const scroller = container.querySelector('[data-kn-virtual]') as HTMLElement;
    expect(screen.queryByText('列 0')).not.toBeNull();
    act(() => {
      scroller.scrollTop = 4000;
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(screen.queryByText('列 0')).toBeNull();
    expect(screen.queryByText('列 100')).not.toBeNull();
  });

  it('scrollToIndex 會把指定項目捲進視窗', () => {
    const { ref, container } = renderFixed();
    const scroller = container.querySelector('[data-kn-virtual]') as HTMLElement;
    act(() => {
      ref.current?.scrollToIndex(500, { align: 'start' });
    });
    expect(scroller.scrollTop).toBe(20000);
    expect(screen.queryByText('列 500')).not.toBeNull();
  });

  it('scrollToIndex 的 align: center', () => {
    const { ref, container } = renderFixed();
    const scroller = container.querySelector('[data-kn-virtual]') as HTMLElement;
    act(() => {
      ref.current?.scrollToIndex(500, { align: 'center' });
    });
    // 20000 - 200 + 20
    expect(scroller.scrollTop).toBe(19820);
  });

  it('項目以 transform 定位（合成層，捲動不觸發 layout）', () => {
    const { container } = renderFixed();
    const first = container.querySelector('[data-index="0"]') as HTMLElement;
    expect(first.style.transform).toBe('translate3d(0, 0px, 0)');
    const second = container.querySelector('[data-index="1"]') as HTMLElement;
    expect(second.style.transform).toBe('translate3d(0, 40px, 0)');
  });
});

describe('VirtualList — 不定高（measure cache）', () => {
  it('未量測時用估計值排版，且仍只渲染少量節點', () => {
    const { container } = render(
      <VirtualList items={rows} estimateSize={50} size={300} getKey={(r) => r.id}>
        {(row) => <div className="row">{row.label}</div>}
      </VirtualList>,
    );
    const inner = container.querySelector('[data-kn-virtual] > div') as HTMLElement;
    expect(inner.style.height).toBe('50000px');
    expect(container.querySelectorAll('.row').length).toBeLessThan(100);
  });

  it('量測後的高度會回填並修正後續 offset', () => {
    const measured = new Map<number, number>();
    // jsdom 沒有排版，手動偽造前三列高度。
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function fake(this: HTMLElement) {
      const idx = Number(this.dataset['index']);
      if (!Number.isNaN(idx) && measured.has(idx)) {
        return { width: 0, height: measured.get(idx)!, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      }
      return originalRect.call(this);
    };
    measured.set(0, 120);
    measured.set(1, 120);
    try {
      const { container } = render(
        <VirtualList items={rows.slice(0, 10)} estimateSize={50} size={300} getKey={(r) => r.id}>
          {(row) => <div className="row">{row.label}</div>}
        </VirtualList>,
      );
      const second = container.querySelector('[data-index="1"]') as HTMLElement;
      // 第 0 列量到 120 後，第 1 列的 start 應該從 50 修正為 120
      expect(second.style.transform).toBe('translate3d(0, 120px, 0)');
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });
});

describe('VirtualList — 橫向（資料庫表格欄）', () => {
  it('以 translate3d 的 x 軸定位，總寬 = 欄數 * 欄寬', () => {
    const cols = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}` }));
    const { container } = render(
      <VirtualList items={cols} itemSize={160} size={800} horizontal getKey={(c) => c.id}>
        {(c) => <div className="col">{c.id}</div>}
      </VirtualList>,
    );
    const inner = container.querySelector('[data-kn-virtual] > div') as HTMLElement;
    expect(inner.style.width).toBe('32000px');
    const first = container.querySelector('[data-index="1"]') as HTMLElement;
    expect(first.style.transform).toBe('translate3d(160px, 0, 0)');
    expect(container.querySelectorAll('.col').length).toBeLessThan(100);
  });
});

describe('VirtualList — 空狀態', () => {
  it('沒有資料時顯示 empty', () => {
    render(
      <VirtualList items={[]} itemSize={40} size={200} empty={<p>沒有資料</p>}>
        {() => null}
      </VirtualList>,
    );
    expect(screen.queryByText('沒有資料')).not.toBeNull();
  });
});
