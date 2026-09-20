/**
 * 留言 ↔ 行內標註的雙向連動（gap-review B-8）。
 *
 * ⚠️ `editor-core` 只在標註上掛 `.kn-comment`，**沒有 discussionId**，
 * 所以對應規則是「block → 討論串」+ quote 比對。這支測試守住那條規則，
 * 免得下一輪有人以為 DOM 上有 id 而把比對拿掉。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { Discussion } from '@kennote/shared-types';
import {
  discussionAtEvent,
  highlightStore,
  paintHighlights,
  setActiveDiscussion,
} from '../highlight';

function discussion(over: Partial<Discussion> & { id: string }): Discussion {
  return {
    workspaceId: 'w',
    pageId: 'p',
    blockId: null,
    anchor: { kind: 'page' },
    resolvedAt: null,
    resolvedBy: null,
    createdBy: 'u',
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    comments: [],
    ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  highlightStore.setState({ activeId: null, hoverId: null, pending: null });
});

describe('discussionAtEvent', () => {
  it('點到 .kn-comment 之外回 null', () => {
    document.body.innerHTML = '<div data-block-id="b1"><span>一般文字</span></div>';
    const span = document.querySelector('span')!;
    expect(discussionAtEvent(span, [discussion({ id: 'd1', blockId: 'b1' })])).toBeNull();
  });

  it('block 上只有一個討論串就直接命中', () => {
    document.body.innerHTML =
      '<div data-block-id="b1"><span class="kn-comment">被標註</span></div>';
    const span = document.querySelector('.kn-comment')!;
    expect(discussionAtEvent(span, [discussion({ id: 'd1', blockId: 'b1' })])).toBe('d1');
  });

  it('同一個 block 有多個討論串時用 quote 挑', () => {
    document.body.innerHTML =
      '<div data-block-id="b1"><span class="kn-comment">第二段文字</span></div>';
    const span = document.querySelector('.kn-comment')!;
    const list = [
      discussion({ id: 'd1', blockId: 'b1', anchor: { kind: 'inline', quote: '第一段文字' } }),
      discussion({ id: 'd2', blockId: 'b1', anchor: { kind: 'inline', quote: '第二段文字' } }),
    ];
    expect(discussionAtEvent(span, list)).toBe('d2');
  });

  it('quote 比不到時退回第一個未解決的', () => {
    document.body.innerHTML = '<div data-block-id="b1"><span class="kn-comment">別的</span></div>';
    const span = document.querySelector('.kn-comment')!;
    const list = [
      discussion({
        id: 'd1',
        blockId: 'b1',
        resolvedAt: '2026-09-20T01:00:00.000Z',
        anchor: { kind: 'inline', quote: 'x' },
      }),
      discussion({ id: 'd2', blockId: 'b1', anchor: { kind: 'inline', quote: 'y' } }),
    ];
    expect(discussionAtEvent(span, list)).toBe('d2');
  });

  it('block 上沒有討論串回 null（孤兒標註）', () => {
    document.body.innerHTML = '<div data-block-id="b9"><span class="kn-comment">孤兒</span></div>';
    const span = document.querySelector('.kn-comment')!;
    expect(discussionAtEvent(span, [discussion({ id: 'd1', blockId: 'b1' })])).toBeNull();
  });
});

describe('paintHighlights', () => {
  it('active 的 block 標 active、已解決的標 resolved', () => {
    document.body.innerHTML =
      '<div data-block-id="b1"></div><div data-block-id="b2"></div>';
    const list = [
      discussion({ id: 'd1', blockId: 'b1' }),
      discussion({ id: 'd2', blockId: 'b2', resolvedAt: '2026-09-20T01:00:00.000Z' }),
    ];
    setActiveDiscussion('d1');
    paintHighlights(list, highlightStore.getState());
    expect(document.querySelector('[data-block-id="b1"]')!.getAttribute('data-kn-comment-state'))
      .toBe('active');
    expect(document.querySelector('[data-block-id="b2"]')!.getAttribute('data-kn-comment-state'))
      .toBe('resolved');
  });

  it('hover 蓋過 active', () => {
    document.body.innerHTML = '<div data-block-id="b1"></div><div data-block-id="b2"></div>';
    const list = [
      discussion({ id: 'd1', blockId: 'b1' }),
      discussion({ id: 'd2', blockId: 'b2' }),
    ];
    highlightStore.setState({ activeId: 'd1', hoverId: 'd2', pending: null });
    paintHighlights(list, highlightStore.getState());
    expect(document.querySelector('[data-block-id="b1"]')!.hasAttribute('data-kn-comment-state'))
      .toBe(false);
    expect(document.querySelector('[data-block-id="b2"]')!.getAttribute('data-kn-comment-state'))
      .toBe('active');
  });

  it('重畫會把上一次的狀態清乾淨（解決 → 重新開啟不留殘影）', () => {
    document.body.innerHTML = '<div data-block-id="b1"></div>';
    const el = document.querySelector('[data-block-id="b1"]')!;
    paintHighlights([discussion({ id: 'd1', blockId: 'b1', resolvedAt: '2026-09-20T01:00:00.000Z' })],
      { activeId: null, hoverId: null, pending: null });
    expect(el.getAttribute('data-kn-comment-state')).toBe('resolved');
    paintHighlights([discussion({ id: 'd1', blockId: 'b1' })], { activeId: null, hoverId: null, pending: null });
    expect(el.hasAttribute('data-kn-comment-state')).toBe(false);
  });
});

describe('paintHighlights：解決後一律淡化', () => {
  it('已解決的討論串即使是 active 也是 resolved（不留刺眼的黃底）', () => {
    document.body.innerHTML = '<div data-block-id="b1"></div>';
    const list = [discussion({ id: 'd1', blockId: 'b1', resolvedAt: '2026-09-20T01:00:00.000Z' })];
    setActiveDiscussion('d1');
    paintHighlights(list, highlightStore.getState());
    expect(document.querySelector('[data-block-id="b1"]')!.getAttribute('data-kn-comment-state'))
      .toBe('resolved');
  });
});
