/**
 * 右側面板的「分析」分頁。
 *
 * 真實 Notion 7.34 的右側面板是「更新 / 分析」兩個 role=tab
 * （`reference/shots/gap-review/notion/_A3-updates.json`）。
 * Notion 的分析是「檢視次數 / 檢視者」，那需要一張 page_views 表 ——
 * 這一輪先做**現有資料算得出來的**部分：字數、區塊數、編輯次數、參與編輯的人數。
 * 沒有捏造的數字，缺的那一格明寫「尚未記錄」而不是給 0。
 */
import type { HistoryListResponse, PageSnapshot } from '@kennote/shared-types';
import { COLLAB_API_ROUTES, richTextToPlainText } from '@kennote/shared-types';
import { useQuery } from '@kennote/ui';
import { api } from '../../lib/api-client';
import { usePageSnapshot } from '../../lib/queries';
import styles from './UpdatesFeed.module.css';

export interface PageAnalyticsProps {
  pageId: string;
}

/** CJK 沒有空白分詞：中日韓字元逐字算，其餘按空白切 */
export function countWords(text: string): number {
  const cjk = text.match(/[㐀-鿿豈-﫿぀-ヿ]/g)?.length ?? 0;
  const rest = text
    .replace(/[㐀-鿿豈-﫿぀-ヿ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + rest;
}

export function PageAnalytics({ pageId }: PageAnalyticsProps): JSX.Element {
  const snapshot = usePageSnapshot(pageId);
  const history = useQuery<HistoryListResponse>({
    key: ['page', pageId, 'history'],
    fetcher: () => api.get<HistoryListResponse>(COLLAB_API_ROUTES.pageHistory(pageId)),
    staleTime: 30_000,
  });

  const data = snapshot.data as PageSnapshot | undefined;
  const blocks = Object.values(data?.recordMap.block ?? {});
  const words = blocks.reduce(
    (sum, b) => sum + countWords(richTextToPlainText(b.value.content ?? [])),
    0,
  );
  const versions = history.data?.versions ?? [];
  const edits = versions.reduce((sum, v) => sum + v.txCount, 0);
  const editors = new Set(versions.flatMap((v) => v.actorIds)).size;

  const rows: Array<{ label: string; value: string }> = [
    { label: '區塊數', value: String(blocks.length) },
    { label: '字數', value: String(words) },
    { label: '編輯次數', value: String(edits) },
    { label: '編輯者', value: `${editors} 人` },
    { label: '檢視次數', value: '尚未記錄' },
  ];

  return (
    <div className={styles.feed} aria-label="分析">
      {snapshot.isLoading || history.isLoading ? (
        <p className={styles.hint}>統計中…</p>
      ) : (
        <dl className={styles.stats}>
          {rows.map((row) => (
            <div key={row.label} className={styles.stat}>
              <dt className={styles.statLabel}>{row.label}</dt>
              <dd className={styles.statValue}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className={styles.hint}>
        「檢視次數 / 檢視者」需要另外記錄瀏覽事件，這一輪還沒有做。
      </p>
    </div>
  );
}
