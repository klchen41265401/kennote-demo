/**
 * 留言 ↔ 行內標註的**雙向**連動（gap-review B-8 / 舊帳 O-8 旁支）。
 *
 * 以前只有單向：`CommentsPanel` hover → `scrollIntoView` 捲到那個 block。
 * Notion 是兩邊都會動：
 *   1. 面板 hover / 點卡片 → 頁面上對應的標註亮起來並捲到
 *   2. 編輯器點 `.kn-comment` 標註 → 面板打開、捲到那張卡片、高亮
 *   3. 討論串解決後 → 標註淡化（不再是刺眼的黃底）
 *
 * ⚠️ 實作限制：`packages/editor-core` 這一輪不得改動，而
 * `dom-view.ts` 只給標註加了 `.kn-comment` class，**沒有把 discussionId 放進 DOM**。
 * 所以這裡的對應是「**block → 討論串**」而不是「span → 討論串」：
 *   - 高亮：在 `[data-block-id]` 上掛 `data-kn-comment-state`，CSS 再往下選 `.kn-comment`
 *   - 反向：點到的 `.kn-comment` 先找最近的 `[data-block-id]`，
 *     再用「那個 block 上的討論串」+ 被點文字與 `anchor.quote` 的比對挑一個
 * 同一個 block 上有多個討論串時，quote 比對不到就取第一個未解決的 —— 保守但不會爆。
 */
import { createStore, useStore } from '@kennote/ui';
import type { Discussion } from '@kennote/shared-types';

export interface HighlightState {
  /** 面板裡「目前這一張」討論串卡片（點選 / 從編輯器跳過來） */
  activeId: string | null;
  /** 滑過（hover）的討論串 —— 只是暫時亮一下，不改變 activeId */
  hoverId: string | null;
  /**
   * 編輯器點了標註、但面板還沒掛載時的「待解析」請求。
   *
   * 討論串清單只有 `CommentsPanel` 手上有，而面板關著的時候它根本不存在 ——
   * 所以編輯器只負責記下「點到哪個 block 的哪段文字」並把面板打開，
   * 由面板掛載後自己把它解析成 discussionId。
   */
  pending: { blockId: string; text: string } | null;
}

export const highlightStore = createStore<HighlightState>({
  activeId: null,
  hoverId: null,
  pending: null,
});

export function useHighlight(): HighlightState {
  return useStore(highlightStore);
}

export function setActiveDiscussion(id: string | null): void {
  highlightStore.setState((s) => (s.activeId === id ? s : { ...s, activeId: id }));
}

export function setHoverDiscussion(id: string | null): void {
  highlightStore.setState((s) => (s.hoverId === id ? s : { ...s, hoverId: id }));
}

/** 編輯器點到 `.kn-comment` 時呼叫：記下待解析的位置（面板掛載後解析） */
export function requestDiscussionForBlock(blockId: string, text: string): void {
  highlightStore.setState((s) => ({ ...s, pending: { blockId, text } }));
}

/** 面板解析完 pending 後清掉 */
export function clearPendingDiscussion(): void {
  highlightStore.setState((s) => (s.pending === null ? s : { ...s, pending: null }));
}

/**
 * `.kn-comment` 的點擊 → `{ blockId, text }`。
 * 給編輯器用（它沒有討論串清單，只能給座標）。
 */
export function commentMarkAt(target: EventTarget | null): { blockId: string; text: string } | null {
  const el = target instanceof Element ? target.closest('.kn-comment') : null;
  if (!el) return null;
  const blockId = el.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
  if (!blockId) return null;
  return { blockId, text: (el.textContent ?? '').trim() };
}

const STATE_ATTR = 'data-kn-comment-state';

/**
 * `CSS.escape` 在 happy-dom / 舊瀏覽器不一定存在（本地 vitest 環境就沒有），
 * 而 block id 是 UUID，只要把引號與反斜線擋掉就夠了。
 */
function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, (m) => `\\${m}`);
}

function blockEl(blockId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-block-id="${escapeAttr(blockId)}"]`);
}

/** 捲到某個 block（面板 → 頁面） */
export function scrollToBlock(blockId: string | null): void {
  if (!blockId) return;
  blockEl(blockId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * 把「哪些 block 該亮 / 該淡」寫進 DOM。
 *
 * 每次都先清乾淨再重畫（討論串很少，這個成本可以忽略），
 * 避免解決 / 重新開啟之後殘留舊狀態。
 */
export function paintHighlights(
  discussions: readonly Discussion[],
  state: HighlightState,
): void {
  if (typeof document === 'undefined') return;
  for (const el of document.querySelectorAll<HTMLElement>(`[${STATE_ATTR}]`)) {
    el.removeAttribute(STATE_ATTR);
  }
  const focusId = state.hoverId ?? state.activeId;
  for (const d of discussions) {
    if (!d.blockId) continue;
    const el = blockEl(d.blockId);
    if (!el) continue;
    /*
     * **已解決一律淡化**，即使它剛好是目前選中的那一張卡片。
     * 「解決之後標註還是刺眼的黃底」才是使用者會抱怨的那一種錯：
     * 解決的意思就是「這一段不用再看了」。
     */
    if (d.resolvedAt) {
      if (el.getAttribute(STATE_ATTR) !== 'active') el.setAttribute(STATE_ATTR, 'resolved');
      continue;
    }
    if (d.id === focusId) el.setAttribute(STATE_ATTR, 'active');
  }
}

/** 把 pending（blockId + 文字）解析成 discussionId，規則與 discussionAtEvent 相同 */
export function resolvePending(
  pending: { blockId: string; text: string } | null,
  discussions: readonly Discussion[],
): string | null {
  if (!pending) return null;
  const onBlock = discussions.filter((d) => d.blockId === pending.blockId);
  if (onBlock.length === 0) return null;
  if (onBlock.length === 1) return onBlock[0]!.id;
  const byQuote = onBlock.find(
    (d) =>
      d.anchor.kind === 'inline' &&
      pending.text.length > 0 &&
      (d.anchor.quote.includes(pending.text) || pending.text.includes(d.anchor.quote)),
  );
  return (byQuote ?? onBlock.find((d) => !d.resolvedAt) ?? onBlock[0]!).id;
}

/**
 * 編輯器點 `.kn-comment` → 找出對應的討論串 id。
 * 找不到就回 null（例如標註是孤兒，討論串已被刪）。
 */
export function discussionAtEvent(
  target: EventTarget | null,
  discussions: readonly Discussion[],
): string | null {
  const el = target instanceof Element ? target.closest('.kn-comment') : null;
  if (!el) return null;
  const block = el.closest<HTMLElement>('[data-block-id]');
  const blockId = block?.dataset.blockId ?? null;
  if (!blockId) return null;

  const onBlock = discussions.filter((d) => d.blockId === blockId);
  if (onBlock.length === 0) return null;
  if (onBlock.length === 1) return onBlock[0]!.id;

  const text = (el.textContent ?? '').trim();
  const byQuote = onBlock.find(
    (d) =>
      d.anchor.kind === 'inline' &&
      text.length > 0 &&
      (d.anchor.quote.includes(text) || text.includes(d.anchor.quote)),
  );
  return (byQuote ?? onBlock.find((d) => !d.resolvedAt) ?? onBlock[0]!).id;
}
