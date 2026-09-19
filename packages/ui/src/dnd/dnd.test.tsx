import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DndProvider } from './DndProvider.js';
import { DragController, POINTER_THRESHOLD, TOUCH_HOLD_MS } from './controller.js';
import { useDraggable } from './useDraggable.js';
import { useDroppable } from './useDroppable.js';
import { dragController, type DropResult } from './controller.js';

/** jsdom 沒有 PointerEvent，也不讓 MouseEvent 的 clientX 被覆寫，手動造。 */
function pointerEvent(
  type: string,
  props: { pointerId?: number; clientX?: number; clientY?: number; pointerType?: string } = {},
): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: props.pointerId ?? 1 },
    pointerType: { value: props.pointerType ?? 'mouse' },
    clientX: { value: props.clientX ?? 0 },
    clientY: { value: props.clientY ?? 0 },
    button: { value: 0 },
  });
  return event;
}

/** jsdom 沒有排版，直接餵 rect。 */
function stubRect(el: Element, rect: { top: number; left: number; width: number; height: number }): void {
  el.getBoundingClientRect = () =>
    ({
      x: rect.left,
      y: rect.top,
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => ({}),
    }) as DOMRect;
}

let rafCallbacks: FrameRequestCallback[] = [];

beforeEach(() => {
  // 單例 controller 會跨測試殘留狀態（例如 dropping 動畫期），先歸零。
  dragController.reset();
  rafCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  dragController.reset();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('kn-dragging');
});

/** 手動推進 rAF 迴圈一幀。 */
function tick(): void {
  const pending = rafCallbacks;
  rafCallbacks = [];
  act(() => {
    for (const cb of pending) cb(0);
  });
}

function List({ onDrop }: { onDrop: (r: DropResult) => void }): JSX.Element {
  const zone = useDroppable({ id: 'tree', accepts: ['tree-node'], onDrop, dropOptions: { mode: 'tree' } });
  return (
    <div ref={zone.setNodeRef} data-testid="zone">
      <Row id="a" depth={0} />
      <Row id="b" depth={0} />
      <Row id="c" depth={0} />
    </div>
  );
}

function Row({ id, depth }: { id: string; depth: number }): JSX.Element {
  const drag = useDraggable({ id, kind: 'tree-node', data: { id } });
  return (
    <div
      ref={(node) => {
        if (node) {
          node.dataset['knDndItem'] = '';
          node.dataset['id'] = id;
          node.dataset['depth'] = String(depth);
        }
        drag.setNodeRef(node);
      }}
      data-testid={`row-${id}`}
      data-dragging={drag.isDragging || undefined}
      {...drag.handleProps}
    >
      節點 {id}
    </div>
  );
}

function setupRects(): void {
  stubRect(screen.getByTestId('zone'), { top: 0, left: 100, width: 300, height: 84 });
  stubRect(screen.getByTestId('row-a'), { top: 0, left: 100, width: 300, height: 28 });
  stubRect(screen.getByTestId('row-b'), { top: 28, left: 100, width: 300, height: 28 });
  stubRect(screen.getByTestId('row-c'), { top: 56, left: 100, width: 300, height: 28 });
}

describe('useDraggable / useDroppable', () => {
  it('滑鼠移動超過門檻才進入 dragging，並加上禁止選取的 class', () => {
    const onDrop = vi.fn();
    render(
      <DndProvider>
        <List onDrop={onDrop} />
      </DndProvider>,
    );
    setupRects();
    const row = screen.getByTestId('row-a');

    fireEvent(row, pointerEvent('pointerdown', { clientX: 110, clientY: 10 }));
    expect(document.documentElement.classList.contains('kn-dragging')).toBe(false);

    // 小於門檻：還在 pending
    fireEvent(window, pointerEvent('pointermove', { clientX: 110 + POINTER_THRESHOLD - 1, clientY: 10 }));
    expect(document.documentElement.classList.contains('kn-dragging')).toBe(false);

    fireEvent(window, pointerEvent('pointermove', { clientX: 130, clientY: 10 }));
    expect(document.documentElement.classList.contains('kn-dragging')).toBe(true);

    fireEvent(window, pointerEvent('pointerup', { clientX: 130, clientY: 10 }));
    expect(document.documentElement.classList.contains('kn-dragging')).toBe(false);
  });

  it('放開時以 computeDropTarget 的結果呼叫 onDrop', () => {
    const onDrop = vi.fn();
    render(
      <DndProvider>
        <List onDrop={onDrop} />
      </DndProvider>,
    );
    setupRects();
    const row = screen.getByTestId('row-a');

    fireEvent(row, pointerEvent('pointerdown', { clientX: 110, clientY: 10 }));
    fireEvent(window, pointerEvent('pointermove', { clientX: 110, clientY: 20 }));
    // 移到 row-c 的下緣帶
    fireEvent(window, pointerEvent('pointermove', { clientX: 105, clientY: 82 }));
    tick();
    fireEvent(window, pointerEvent('pointerup', { clientX: 105, clientY: 82 }));

    expect(onDrop).toHaveBeenCalledTimes(1);
    const result = onDrop.mock.calls[0]![0] as DropResult;
    expect(result.sourceId).toBe('a');
    expect(result.kind).toBe('tree-node');
    expect(result.target).toMatchObject({ id: 'c', position: 'after' });
  });

  it('水平偏移 >= 24px 時落點變成「進裡面」', () => {
    const onDrop = vi.fn();
    render(
      <DndProvider>
        <List onDrop={onDrop} />
      </DndProvider>,
    );
    setupRects();
    const row = screen.getByTestId('row-a');
    fireEvent(row, pointerEvent('pointerdown', { clientX: 110, clientY: 10 }));
    fireEvent(window, pointerEvent('pointermove', { clientX: 110, clientY: 20 }));
    fireEvent(window, pointerEvent('pointermove', { clientX: 100 + 30, clientY: 58 }));
    tick();
    fireEvent(window, pointerEvent('pointerup', { clientX: 130, clientY: 58 }));

    const result = onDrop.mock.calls[0]![0] as DropResult;
    expect(result.target).toMatchObject({ id: 'c', position: 'inside', depth: 1 });
  });

  it('不接受的 kind 不會成為落點', () => {
    const onDrop = vi.fn();
    function Other(): JSX.Element {
      const zone = useDroppable({ id: 'board', accepts: ['board-card'], onDrop });
      return <div ref={zone.setNodeRef} data-testid="board" />;
    }
    render(
      <DndProvider>
        <Other />
        <List onDrop={vi.fn()} />
      </DndProvider>,
    );
    setupRects();
    stubRect(screen.getByTestId('board'), { top: 200, left: 0, width: 300, height: 100 });
    const row = screen.getByTestId('row-a');
    fireEvent(row, pointerEvent('pointerdown', { clientX: 110, clientY: 10 }));
    fireEvent(window, pointerEvent('pointermove', { clientX: 110, clientY: 20 }));
    fireEvent(window, pointerEvent('pointermove', { clientX: 50, clientY: 250 }));
    tick();
    fireEvent(window, pointerEvent('pointerup', { clientX: 50, clientY: 250 }));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('DndProvider 在浮層根掛上唯一的拖曳層', () => {
    render(
      <DndProvider>
        <List onDrop={vi.fn()} />
      </DndProvider>,
    );
    expect(document.querySelectorAll('.kn-drag-layer')).toHaveLength(1);
  });
});

describe('DragController — 觸控長按', () => {
  it('觸控需長按 400ms 才啟動；期間移動則取消', () => {
    vi.useFakeTimers();
    try {
      const controller = new DragController();
      const el = document.createElement('div');
      document.body.appendChild(el);
      stubRect(el, { top: 0, left: 0, width: 100, height: 28 });
      controller.registerSource(el, { id: 's', kind: 'block', getPayload: () => null });

      controller.handlePointerDown('s', pointerEvent('pointerdown', {
        pointerType: 'touch',
        clientX: 10,
        clientY: 10,
      }) as unknown as PointerEvent);
      expect(controller.getSnapshot().phase).toBe('pending');

      vi.advanceTimersByTime(TOUCH_HOLD_MS + 10);
      expect(controller.getSnapshot().phase).toBe('dragging');
      controller.cancel();

      // 期間移動 → 取消
      controller.handlePointerDown('s', pointerEvent('pointerdown', {
        pointerType: 'touch',
        clientX: 10,
        clientY: 10,
        pointerId: 2,
      }) as unknown as PointerEvent);
      window.dispatchEvent(pointerEvent('pointermove', { pointerId: 2, clientX: 40, clientY: 10 }));
      expect(controller.getSnapshot().phase).toBe('idle');
      vi.advanceTimersByTime(TOUCH_HOLD_MS + 10);
      expect(controller.getSnapshot().phase).toBe('idle');
      el.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});
