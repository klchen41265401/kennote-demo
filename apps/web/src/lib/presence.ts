/**
 * Presence 的宿主 API（04 §8 M5-7：他人所在 block 的淡色外框 + 名牌）。
 *
 * 編輯器宿主只要做兩件事：
 *   const { peers, peersByBlock, decorate } = usePresence(pageId);
 *   useEffect(() => decorate(editorHostElement), [peers]);
 *
 * decorate() 會找出 `[data-block-id]` 的元素，加上 class 與 --kn-presence-color，
 * 因此 editor-core 完全不需要知道 presence 的存在（04 §7.1：編輯器不依賴 React）。
 */
import { useCallback, useMemo } from 'react';
import type { PeerPresence } from '@kennote/shared-types';
import { usePagePeers } from '../stores/presence';
import './presence.css';

export const PRESENCE_CLASS = {
  /** 他人所在的 block：淡色外框 */
  block: 'kn-presence-block',
  /** block 右上角的名牌 */
  label: 'kn-presence-label',
  caret: 'kn-presence-caret',
} as const;

/** 給 editor-core 的 block 元素用的屬性名（宿主渲染時要加上） */
export const BLOCK_ID_ATTR = 'data-block-id';

export function groupPeersByBlock(peers: PeerPresence[]): Map<string, PeerPresence[]> {
  const map = new Map<string, PeerPresence[]>();
  for (const peer of peers) {
    if (!peer.blockId) continue;
    const list = map.get(peer.blockId) ?? [];
    list.push(peer);
    map.set(peer.blockId, list);
  }
  return map;
}

/** 把 presence 畫到 DOM 上。回傳清除函式（換頁或 peers 變動時呼叫） */
export function decoratePresence(
  root: HTMLElement | null,
  peers: PeerPresence[],
): () => void {
  if (!root) return () => {};
  const byBlock = groupPeersByBlock(peers);

  // 先清掉上一輪的裝飾（presence 變動頻繁，直接重畫比 diff 划算）
  const cleanup = (): void => {
    for (const el of root.querySelectorAll(`.${PRESENCE_CLASS.block}`)) {
      el.classList.remove(PRESENCE_CLASS.block);
      (el as HTMLElement).style.removeProperty('--kn-presence-color');
    }
    for (const label of root.querySelectorAll(`.${PRESENCE_CLASS.label}`)) label.remove();
  };
  cleanup();

  for (const [blockId, blockPeers] of byBlock) {
    const el = root.querySelector<HTMLElement>(`[${BLOCK_ID_ATTR}="${CSS.escape(blockId)}"]`);
    if (!el) continue;
    const first = blockPeers[0];
    if (!first) continue;
    el.classList.add(PRESENCE_CLASS.block);
    el.style.setProperty('--kn-presence-color', first.color);

    for (const peer of blockPeers.slice(0, 2)) {
      const label = document.createElement('span');
      label.className = PRESENCE_CLASS.label;
      label.textContent = peer.name;
      label.style.setProperty('--kn-presence-color', peer.color);
      label.setAttribute('aria-hidden', 'true');
      el.appendChild(label);
    }
  }

  return cleanup;
}

export interface PresenceApi {
  peers: PeerPresence[];
  peersByBlock: Map<string, PeerPresence[]>;
  /** 把外框與名牌畫到 editor host 的 DOM 上；回傳清除函式 */
  decorate(root: HTMLElement | null): () => void;
}

export function usePresence(pageId: string | null): PresenceApi {
  const peers = usePagePeers(pageId);
  const peersByBlock = useMemo(() => groupPeersByBlock(peers), [peers]);
  const decorate = useCallback((root: HTMLElement | null) => decoratePresence(root, peers), [peers]);
  return { peers, peersByBlock, decorate };
}
