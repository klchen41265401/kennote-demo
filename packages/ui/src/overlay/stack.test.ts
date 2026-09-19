import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { overlayStack, OVERLAY_Z_INDEX, overlayZIndex } from './stack.js';
import { createFocusTrap, getFocusable } from './focus-trap.js';

function makeEntry(overrides: Partial<Parameters<typeof overlayStack.open>[0]> = {}) {
  return {
    level: 'dropdown' as const,
    closeOnOutside: true,
    closeOnEsc: true,
    trapFocus: false,
    lockScroll: false,
    onClose: vi.fn(),
    ...overrides,
  };
}

function pointerDown(target: Node): void {
  const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
}

function escape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

beforeEach(() => {
  overlayStack.reset();
  document.body.innerHTML = '';
});

afterEach(() => {
  overlayStack.reset();
});

describe('OverlayStack — z-index 層級', () => {
  it('依 §2.6 的層級表給值', () => {
    expect(OVERLAY_Z_INDEX).toEqual({
      dropdown: 300,
      toolbar: 400,
      modal: 500,
      toast: 600,
      tooltip: 700,
    });
    expect(overlayZIndex('tooltip')).toBe(700);
  });
});

describe('OverlayStack — 堆疊與關閉', () => {
  it('open 回傳 id 並成為 top', () => {
    const a = overlayStack.open(makeEntry());
    expect(overlayStack.isTop(a)).toBe(true);
    const b = overlayStack.open(makeEntry());
    expect(overlayStack.isTop(a)).toBe(false);
    expect(overlayStack.isTop(b)).toBe(true);
  });

  it('關閉某一層時，其上的所有層一併關閉（避免孤兒浮層）', () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    const onCloseC = vi.fn();
    const a = overlayStack.open(makeEntry({ onClose: onCloseA }));
    overlayStack.open(makeEntry({ onClose: onCloseB }));
    overlayStack.open(makeEntry({ onClose: onCloseC }));
    overlayStack.close(a);
    expect(onCloseA).toHaveBeenCalledTimes(1);
    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseC).toHaveBeenCalledTimes(1);
    expect(overlayStack.top).toBeNull();
  });

  it('remove 不呼叫 onClose（元件自行卸載）', () => {
    const onClose = vi.fn();
    const id = overlayStack.open(makeEntry({ onClose }));
    overlayStack.remove(id);
    expect(onClose).not.toHaveBeenCalled();
    expect(overlayStack.top).toBeNull();
  });
});

describe('OverlayStack — Escape 只關最上層', () => {
  it('Esc 只關 top，其下的層保留', () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    overlayStack.open(makeEntry({ onClose: onCloseA }));
    const b = overlayStack.open(makeEntry({ onClose: onCloseB }));
    escape();
    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseA).not.toHaveBeenCalled();
    expect(overlayStack.isTop(b)).toBe(false);
    expect(overlayStack.getSnapshot()).toHaveLength(1);
  });

  it('closeOnEsc: false 的最上層不吃 Esc', () => {
    const onClose = vi.fn();
    overlayStack.open(makeEntry({ closeOnEsc: false, onClose }));
    escape();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('OverlayStack — 外部點擊（含巢狀浮層）', () => {
  it('點完全外部時整串關閉', () => {
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const parentEl = document.createElement('div');
    document.body.appendChild(parentEl);
    const childEl = document.createElement('div');
    document.body.appendChild(childEl);

    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    const a = overlayStack.open(makeEntry({ onClose: onCloseA }));
    overlayStack.setElement(a, parentEl);
    const b = overlayStack.open(makeEntry({ onClose: onCloseB }));
    overlayStack.setElement(b, childEl);

    pointerDown(outside);
    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseA).toHaveBeenCalledTimes(1);
  });

  it('點父浮層時只關子浮層', () => {
    const parentEl = document.createElement('div');
    document.body.appendChild(parentEl);
    const childEl = document.createElement('div');
    document.body.appendChild(childEl);

    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    const a = overlayStack.open(makeEntry({ onClose: onCloseA }));
    overlayStack.setElement(a, parentEl);
    const b = overlayStack.open(makeEntry({ onClose: onCloseB }));
    overlayStack.setElement(b, childEl);

    pointerDown(parentEl);
    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseA).not.toHaveBeenCalled();
    expect(overlayStack.isTop(a)).toBe(true);
  });

  it('點子浮層內部時都不關', () => {
    const parentEl = document.createElement('div');
    const childEl = document.createElement('div');
    const inner = document.createElement('button');
    childEl.appendChild(inner);
    document.body.append(parentEl, childEl);

    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    const a = overlayStack.open(makeEntry({ onClose: onCloseA }));
    overlayStack.setElement(a, parentEl);
    const b = overlayStack.open(makeEntry({ onClose: onCloseB }));
    overlayStack.setElement(b, childEl);

    pointerDown(inner);
    expect(onCloseA).not.toHaveBeenCalled();
    expect(onCloseB).not.toHaveBeenCalled();
  });

  it('點錨點不算外部（否則按鈕一按就開了又關）', () => {
    const anchor = document.createElement('button');
    const floating = document.createElement('div');
    document.body.append(anchor, floating);
    const onClose = vi.fn();
    const id = overlayStack.open(makeEntry({ onClose, getAnchor: () => anchor }));
    overlayStack.setElement(id, floating);
    pointerDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closeOnOutside: false 會擋住其下各層被連帶關閉', () => {
    const outside = document.createElement('div');
    const modalEl = document.createElement('div');
    document.body.append(outside, modalEl);
    const onClose = vi.fn();
    const id = overlayStack.open(makeEntry({ closeOnOutside: false, onClose }));
    overlayStack.setElement(id, modalEl);
    pointerDown(outside);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('OverlayStack — 捲動鎖', () => {
  it('lockScroll 的浮層開啟時鎖 body，全關才解鎖', () => {
    const a = overlayStack.open(makeEntry({ lockScroll: true }));
    expect(document.body.style.overflow).toBe('hidden');
    const b = overlayStack.open(makeEntry({ lockScroll: true }));
    overlayStack.close(b);
    expect(document.body.style.overflow).toBe('hidden');
    overlayStack.close(a);
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});

describe('focus trap', () => {
  it('getFocusable 列出可聚焦元素並排除 disabled', () => {
    const box = document.createElement('div');
    box.innerHTML =
      '<button>a</button><button disabled>b</button><input /><div tabindex="-1"></div><a href="#">c</a>';
    document.body.appendChild(box);
    const list = getFocusable(box);
    expect(list.map((el) => el.tagName)).toEqual(['BUTTON', 'INPUT', 'A']);
  });

  it('Tab 在最後一個元素上會回到第一個；cleanup 還原焦點', () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();

    const box = document.createElement('div');
    box.innerHTML = '<button id="f">first</button><button id="l">last</button>';
    document.body.appendChild(box);

    const release = createFocusTrap(box);
    expect(document.activeElement?.id).toBe('f');

    const last = box.querySelector<HTMLElement>('#l')!;
    last.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(ev);
    expect(document.activeElement?.id).toBe('f');

    release();
    expect(document.activeElement).toBe(before);
  });

  it('Shift+Tab 在第一個元素上會跳到最後一個', () => {
    const box = document.createElement('div');
    box.innerHTML = '<button id="f">first</button><button id="l">last</button>';
    document.body.appendChild(box);
    const release = createFocusTrap(box);
    const first = box.querySelector<HTMLElement>('#f')!;
    first.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement?.id).toBe('l');
    release();
  });
});
