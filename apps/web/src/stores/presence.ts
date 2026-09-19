/**
 * Presence store（誰在這一頁、游標在哪個 block）。
 * 資料完全來自 WS 的 `presence` 訊息，**不落地、也不進 operation log**（03 §8.2）。
 */
import type { PeerPresence } from '@kennote/shared-types';
import { createStore, useStore } from '@kennote/ui';

export interface PresenceState {
  /** pageId → 該頁的線上名單（不含自己） */
  byPage: Record<string, PeerPresence[]>;
  /** 我自己的 sessionId，用來把自己從名單裡濾掉 */
  selfSessionId: string | null;
}

export const presenceStore = createStore<PresenceState>({ byPage: {}, selfSessionId: null });

export function setSelfSessionId(sessionId: string): void {
  presenceStore.setState((prev) =>
    prev.selfSessionId === sessionId ? prev : { ...prev, selfSessionId: sessionId },
  );
}

export function setPagePresence(pageId: string, peers: PeerPresence[]): void {
  presenceStore.setState((prev) => ({ ...prev, byPage: { ...prev.byPage, [pageId]: peers } }));
}

export function clearPagePresence(pageId: string): void {
  presenceStore.setState((prev) => {
    if (!(pageId in prev.byPage)) return prev;
    const byPage = { ...prev.byPage };
    delete byPage[pageId];
    return { ...prev, byPage };
  });
}

const EMPTY: PeerPresence[] = [];

/** 其他人的 presence（已排除自己這個分頁） */
export function usePagePeers(pageId: string | null): PeerPresence[] {
  const state = useStore(presenceStore);
  if (!pageId) return EMPTY;
  const peers = state.byPage[pageId] ?? EMPTY;
  if (!state.selfSessionId) return peers;
  const filtered = peers.filter((p) => p.sessionId !== state.selfSessionId);
  return filtered.length === peers.length ? peers : filtered;
}
