/**
 * 「更新」feed（gap-review B-5 / 舊帳 O-38）。
 *
 * 這是右側面板預設的分頁。**它不是版本歷史** —— 側邊欄的「更新」按鈕
 * 以前直接 `toggleRightPanel('history')`，打開的是快照清單，名不符實。
 *
 * 依據 `reference/shots/gap-review/notion/_A3-updates.json`：
 *   - role=tab「更新」/「分析」，預設「更新」
 *   - 每一則更新右側有 aria-label「查看本次更新後的版本」的 24×24 按鈕
 *     → 按下去進版本預覽（走 features/history/preview.ts，B-7 那條路）
 */
import { useCallback, useState } from 'react';
import type {
  HistorySnapshotResponse,
  PageUpdateEntry,
  PageUpdatesResponse,
} from '@kennote/shared-types';
import { COLLAB_API_ROUTES } from '@kennote/shared-types';
import { useQuery } from '@kennote/ui';
import { api } from '../../lib/api-client';
import { enterHistoryPreview } from './preview';
import { setActiveDiscussion } from '../comments/highlight';
import styles from './UpdatesFeed.module.css';

export interface UpdatesFeedProps {
  pageId: string;
  /** 點留言類的更新 → 切到留言檢視並定位 */
  onOpenDiscussion?(discussionId: string): void;
}

const ICON: Record<PageUpdateEntry['kind'], string> = {
  edit: '✎',
  property: '⚙',
  comment: '💬',
  comment_resolved: '✓',
};

function when(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '剛剛';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  return date.toLocaleDateString('zh-TW');
}

export function UpdatesFeed({ pageId, onOpenDiscussion }: UpdatesFeedProps): JSX.Element {
  const [cursor, setCursor] = useState<string | null>(null);
  const [extra, setExtra] = useState<PageUpdateEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const feed = useQuery<PageUpdatesResponse>({
    key: ['page', pageId, 'updates'],
    fetcher: () => api.get<PageUpdatesResponse>(COLLAB_API_ROUTES.pageUpdates(pageId)),
    staleTime: 15_000,
  });

  const preview = useCallback(
    async (seq: number): Promise<void> => {
      const snapshot = await api.get<HistorySnapshotResponse>(
        COLLAB_API_ROUTES.pageHistoryAt(pageId, seq),
      );
      enterHistoryPreview(pageId, snapshot);
    },
    [pageId],
  );

  const loadMore = async (): Promise<void> => {
    const next = cursor ?? feed.data?.nextCursor ?? null;
    if (!next) return;
    setBusy(true);
    try {
      const page = await api.get<PageUpdatesResponse>(
        COLLAB_API_ROUTES.pageUpdates(pageId, next),
      );
      setExtra((prev) => [...prev, ...page.entries]);
      setCursor(page.nextCursor);
    } finally {
      setBusy(false);
    }
  };

  const entries = [...(feed.data?.entries ?? []), ...extra];
  const users = feed.data?.users ?? {};
  const more = cursor ?? feed.data?.nextCursor ?? null;

  return (
    <div className={styles.feed} aria-label="更新">
      {feed.isLoading ? <p className={styles.hint}>載入更新中…</p> : null}
      {feed.isError ? <p className={styles.hint}>載入更新失敗，稍後再試。</p> : null}
      {!feed.isLoading && entries.length === 0 ? (
        <p className={styles.hint}>這一頁還沒有任何活動。</p>
      ) : null}

      <ol className={styles.list}>
        {entries.map((entry) => (
          <li key={entry.id} className={styles.entry} data-kind={entry.kind}>
            <span className={styles.icon} aria-hidden="true">
              {ICON[entry.kind]}
            </span>
            <div className={styles.entryBody}>
              <p className={styles.entryHead}>
                <span className={styles.actor}>
                  {entry.actorId ? (users[entry.actorId]?.name ?? '已離開的成員') : '系統'}
                </span>
                <span className={styles.summary}>{entry.summary}</span>
                <time className={styles.time} dateTime={entry.at}>
                  {when(entry.at)}
                </time>
              </p>
              {entry.snippet ? <p className={styles.snippet}>{entry.snippet}</p> : null}
              {entry.kind === 'comment' && entry.discussionId ? (
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => {
                    setActiveDiscussion(entry.discussionId);
                    onOpenDiscussion?.(entry.discussionId as string);
                  }}
                >
                  查看討論串
                </button>
              ) : null}
            </div>
            {entry.seq !== null ? (
              <button
                type="button"
                className={styles.seqButton}
                aria-label="查看本次更新後的版本"
                title="查看本次更新後的版本"
                onClick={() => void preview(entry.seq as number)}
              >
                ⟲
              </button>
            ) : null}
          </li>
        ))}
      </ol>

      {more ? (
        <button
          type="button"
          className={styles.moreButton}
          disabled={busy}
          onClick={() => void loadMore()}
        >
          {busy ? '載入中…' : '載入更早的更新'}
        </button>
      ) : null}
    </div>
  );
}
