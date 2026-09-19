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
  RestoreVersionResponse,
} from '@kennote/shared-types';
import { COLLAB_API_ROUTES, richTextToPlainText } from '@kennote/shared-types';
import { invalidateQueries, useQuery } from '@kennote/ui';
import { api } from '../../lib/api-client';
import styles from './HistoryPanel.module.css';

export interface HistoryPanelProps {
  pageId: string;
  canRestore?: boolean;
  /** 進入 / 離開唯讀預覽（宿主要停用編輯與同步寫入） */
  onPreview?(seq: number | null, snapshot: HistorySnapshotResponse | null): void;
}

export function HistoryPanel({
  pageId,
  canRestore = true,
  onPreview,
}: HistoryPanelProps): JSX.Element {
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<HistorySnapshotResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      setSelected(seq);
      setPreview(snapshot);
      onPreview?.(seq, snapshot);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '載入這個版本失敗');
    } finally {
      setBusy(false);
    }
  };

  const exitPreview = (): void => {
    setSelected(null);
    setPreview(null);
    onPreview?.(null, null);
  };

  const restore = async (): Promise<void> => {
    if (selected === null) return;
    setBusy(true);
    try {
      const result = await api.post<RestoreVersionResponse>(
        COLLAB_API_ROUTES.pageHistoryRestore(pageId, selected),
      );
      setMessage(
        result.opCount === 0
          ? '這個版本與目前內容相同，不需要還原'
          : `已還原（送出 ${result.opCount} 個變更，新的版本序號 ${result.newSeq}）`,
      );
      // 還原是「再送一筆 transaction」，所以快照與歷史都要重抓
      invalidateQueries(['page', pageId]);
      exitPreview();
      await history.refetch();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '還原失敗');
    } finally {
      setBusy(false);
    }
  };

  const lines = preview
    ? Object.values(preview.snapshot.recordMap.block).map((b) => ({
        id: b.value.id,
        text: richTextToPlainText(b.value.content),
        type: b.value.type,
      }))
    : [];

  return (
    <aside className={styles.panel} aria-label="版本歷史">
      <header className={styles.header}>
        <h2 className={styles.title}>版本歷史</h2>
        <span className={styles.meta}>目前 seq {history.data?.currentSeq ?? 0}</span>
      </header>

      {selected !== null ? (
        <div className={styles.banner} role="status">
          正在檢視歷史版本（seq {selected}），編輯已停用。
          <div className={styles.actions}>
            <button type="button" className={styles.ghostButton} onClick={exitPreview}>
              退出預覽
            </button>
            {canRestore ? (
              <button
                type="button"
                className={styles.primaryButton}
                disabled={busy}
                onClick={() => void restore()}
              >
                還原成這個版本
              </button>
            ) : null}
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

      {preview ? (
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
