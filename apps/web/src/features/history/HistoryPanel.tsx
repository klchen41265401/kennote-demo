/**
 * 版本歷史面板（02 §3.6 HistoryPanel、04 §8 M5-13）。
 *
 * 02 §3.6 的注意事項照做：**預覽版本期間必須停用編輯與即時同步寫入**，
 * 並顯示明確的「檢視歷史版本」狀態列與退出鈕 —— 由 onPreview(seq|null) 通知宿主。
 */
import { useState } from 'react';
import type {
  HistoryListResponse,
  HistorySnapshotResponse,
  } from '@kennote/shared-types';
import { COLLAB_API_ROUTES, richTextToPlainText } from '@kennote/shared-types';
import { useQuery } from '@kennote/ui';
import { api } from '../../lib/api-client';
import {
  enterHistoryPreview,
  exitHistoryPreview,
  formatVersionTime,
  restorePreviewedVersion,
  useHistoryPreview,
} from './preview';
import styles from './HistoryPanel.module.css';

export interface HistoryPanelProps {
  pageId: string;
  canRestore?: boolean;
  /** 進入 / 離開唯讀預覽（宿主要停用編輯與同步寫入） */
  onPreview?(seq: number | null, snapshot: HistorySnapshotResponse | null): void;
  /** 「版本紀錄」是佔滿面板的獨立檢視（Notion 的 ⋯ 選單項目），左上角要有返回鈕 */
  onBack?(): void;
}

export function HistoryPanel({
  pageId,
  canRestore = true,
  onPreview,
  onBack,
}: HistoryPanelProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * ⭐ gap-review B-7：預覽狀態**不再留在這個元件裡**。
   * 以前 snapshot 只存在 `useState`，`AppShell` 又把 `onPreview` 的第二個參數丟掉，
   * 於是編輯器渲染的是現況、橫幅卻寫「編輯已停用」——**會誤導**。
   * 現在 snapshot 進 `historyPreviewStore`，`PageRoute` 用它重建唯讀編輯器。
   */
  const preview = useHistoryPreview();
  const selected = preview.pageId === pageId ? preview.seq : null;

  const history = useQuery<HistoryListResponse>({
    key: ['page', pageId, 'history'],
    fetcher: () => api.get<HistoryListResponse>(COLLAB_API_ROUTES.pageHistory(pageId)),
    staleTime: 10_000,
  });

  const open = async (seq: number): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const snapshot = await api.get<HistorySnapshotResponse>(
        COLLAB_API_ROUTES.pageHistoryAt(pageId, seq),
      );
      enterHistoryPreview(pageId, snapshot);
      onPreview?.(seq, snapshot);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '載入這個版本失敗');
    } finally {
      setBusy(false);
    }
  };

  const exitPreview = (): void => {
    exitHistoryPreview();
    onPreview?.(null, null);
  };

  const restore = async (): Promise<void> => {
    if (selected === null) return;
    setBusy(true);
    try {
      const result = await restorePreviewedVersion();
      if (!result) return;
      setMessage(
        result.opCount === 0
          ? '這個版本與目前內容相同，不需要還原'
          : `已還原（送出 ${result.opCount} 個變更，新的版本序號 ${result.newSeq}）`,
      );
      // 還原是「再送一筆 transaction」，所以快照與歷史都要重抓
      /*
       * 還原之後畫面一定要刷新到「還原後的現況」：
       * `restorePreviewedVersion()` 已經 invalidate 了 snapshot 並離開預覽
       * → `PageRoute` 的 <Editor> key 從 `pageId:vN` 變回 `pageId` → 用新 snapshot 重建。
       */
      onPreview?.(null, null);
      await history.refetch();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '還原失敗');
    } finally {
      setBusy(false);
    }
  };

  const lines = preview.snapshot
    ? Object.values(preview.snapshot.recordMap.block).map((b) => ({
        id: b.value.id,
        text: richTextToPlainText(b.value.content),
        type: b.value.type,
      }))
    : [];

  return (
    <aside className={styles.panel} aria-label="版本紀錄">
      <header className={styles.header}>
        {onBack ? (
          <button type="button" className={styles.backButton} aria-label="返回面板" onClick={onBack}>
            ‹
          </button>
        ) : null}
        <h2 className={styles.title}>版本紀錄</h2>
        <span className={styles.meta}>目前 seq {history.data?.currentSeq ?? 0}</span>
      </header>

      {selected !== null ? (
        <div className={styles.banner} role="status">
          正在預覽 {formatVersionTime(preview.at, selected)} 的版本
          <div className={styles.actions}>
            {canRestore ? (
              <button
                type="button"
                className={styles.primaryButton}
                disabled={busy}
                onClick={() => void restore()}
              >
                還原此版本
              </button>
            ) : null}
            <button type="button" className={styles.ghostButton} onClick={exitPreview}>
              離開預覽
            </button>
          </div>
        </div>
      ) : null}

      {message ? <p className={styles.hint}>{message}</p> : null}
      {history.isLoading ? <p className={styles.hint}>載入版本清單中…</p> : null}
      {!history.isLoading && (history.data?.versions.length ?? 0) === 0 ? (
        <p className={styles.hint}>這一頁還沒有可回溯的版本。</p>
      ) : null}

      <ul className={styles.list}>
        {(history.data?.versions ?? []).map((version) => (
          <li key={version.seq}>
            <button
              type="button"
              className={`${styles.item} ${selected === version.seq ? styles.selected : ''}`}
              disabled={busy}
              onClick={() => void open(version.seq)}
            >
              <span className={styles.when}>
                {new Date(version.at).toLocaleString('zh-TW')}
              </span>
              <span className={styles.meta}>
                seq {version.seq}・{version.txCount} 次變更・{version.actorIds.length} 人編輯
              </span>
            </button>
          </li>
        ))}
      </ul>

      {preview.snapshot && selected !== null ? (
        <div className={styles.preview}>
          {lines.length === 0 ? (
            <p className={styles.hint}>這個版本沒有內容。</p>
          ) : (
            lines.map((line) => (
              <p key={line.id} className={styles.previewLine}>
                {line.text || `（${line.type}）`}
              </p>
            ))
          )}
        </div>
      ) : null}
    </aside>
  );
}
