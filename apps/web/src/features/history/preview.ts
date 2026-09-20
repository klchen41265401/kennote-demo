/**
 * 版本預覽狀態（gap-review B-7 / 舊帳 O-8）。
 *
 * ⚠️ 這是「**會誤導的錯**」而不只是缺功能：以前 `AppShell` 把
 * `onPreview(seq, snapshot)` 的第二個參數整個丟掉，只把 seq 寫進 `ui.historyPreviewSeq`，
 * 於是編輯器渲染的**還是現在的內容**，橫幅卻寫「編輯已停用」。
 * 使用者看到的是「按了舊版本，內容一模一樣，而且不能改」。
 *
 * 修法：snapshot 要跟著走。`PageRoute` 在預覽中改用這份 snapshot 重建
 * **唯讀且不連同步層**的編輯器（`readOnly` + `syncDisabled`），
 * 所以預覽期間不會送出任何 transaction，遠端 ops 也不會打進這份舊文件。
 *
 * 為什麼不放 `stores/ui.ts`：那支檔案這一輪由 RWD 代理在改（斷點），
 * 而 snapshot 是協作面板自己的狀態，放在 feature 內部更不容易撞車。
 * `ui.historyPreviewSeq` 仍然保留 —— 它是「整頁唯讀」的全域開關，
 * `DatabaseRoute` 也在看它。
 */
import type { HistorySnapshotResponse, RestoreVersionResponse } from '@kennote/shared-types';
import { COLLAB_API_ROUTES } from '@kennote/shared-types';
import { createStore, invalidateQueries, useStore } from '@kennote/ui';
import { api } from '../../lib/api-client';
import { setHistoryPreview } from '../../stores/ui';

export interface HistoryPreviewState {
  pageId: string | null;
  seq: number | null;
  /** 這個版本的最後一次變更時間（橫幅要寫「正在預覽 <時間> 的版本」） */
  at: string | null;
  snapshot: HistorySnapshotResponse['snapshot'] | null;
}

const EMPTY: HistoryPreviewState = { pageId: null, seq: null, at: null, snapshot: null };

export const historyPreviewStore = createStore<HistoryPreviewState>(EMPTY);

export function useHistoryPreview(): HistoryPreviewState {
  return useStore(historyPreviewStore);
}

/** 進入預覽：snapshot 一定要給，否則就是 B-7 那個「顯示現況」的錯 */
export function enterHistoryPreview(pageId: string, res: HistorySnapshotResponse): void {
  historyPreviewStore.setState({
    pageId,
    seq: res.seq,
    at: res.at,
    snapshot: res.snapshot,
  });
  setHistoryPreview(res.seq);
}

export function exitHistoryPreview(): void {
  if (historyPreviewStore.getState().seq === null) {
    setHistoryPreview(null);
    return;
  }
  historyPreviewStore.setState(EMPTY);
  setHistoryPreview(null);
}

/** 只有「同一頁」的預覽才算數（換頁時 AppShell 會呼叫 setHistoryPreview(null)） */
export function previewSnapshotFor(
  pageId: string | null,
): HistoryPreviewState & { active: boolean } {
  const s = historyPreviewStore.getState();
  return { ...s, active: Boolean(pageId && s.pageId === pageId && s.snapshot) };
}

/**
 * 還原目前預覽中的版本。
 *
 * 兩個地方都會用到（`HistoryPanel` 的橫幅、`PageRoute` 頁面頂端的橫幅），
 * 所以邏輯放這裡而不是複製兩份 —— 兩顆「還原此版本」按下去**必須做同一件事**，
 * 不然又是一個「按鈕按得下去、什麼都沒發生」。
 *
 * 還原是「再送一筆 transaction」（歷史 append-only），所以還原後要：
 *   1. 讓 snapshot 快取失效
 *   2. 離開預覽 → `PageRoute` 的 <Editor> key 換回 `pageId` → 用新 snapshot 重建
 */
export async function restorePreviewedVersion(): Promise<RestoreVersionResponse | null> {
  const { pageId, seq } = historyPreviewStore.getState();
  if (!pageId || seq === null) return null;
  const result = await api.post<RestoreVersionResponse>(
    COLLAB_API_ROUTES.pageHistoryRestore(pageId, seq),
  );
  invalidateQueries(['page', pageId]);
  exitHistoryPreview();
  return result;
}

/** 人看得懂的版本時間（橫幅用） */
export function formatVersionTime(at: string | null, seq: number | null): string {
  if (!at) return seq === null ? '較早的版本' : `seq ${seq}`;
  return new Date(at).toLocaleString('zh-TW', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
