/**
 * 跨頁的「所有留言」（gap-review C-8 / 舊帳 O-38 旁支）。
 *
 * 側邊欄的「留言」以前不分頁面一律 `toggleRightPanel('comments')`，
 * 在首頁（`pageId === null`）打開的是一句「選一個頁面才能看留言與版本歷史」——
 * 按鈕亮著、按得下去、什麼都沒有。改成列出工作區裡我看得到的最近討論串，
 * 點一則就跳到那一頁並把它設成 active（面板那一側會捲過去、頁面標註會亮）。
 */
import { useNavigate } from 'react-router-dom';
import type { WorkspaceDiscussionsResponse } from '@kennote/shared-types';
import { COLLAB_API_ROUTES, richTextToPlainText } from '@kennote/shared-types';
import { useQuery } from '@kennote/ui';
import { api } from '../../lib/api-client';
import { setActiveDiscussion } from './highlight';
import styles from './CommentsPanel.module.css';

export interface WorkspaceCommentsProps {
  workspaceId: string | null;
}

export function WorkspaceComments({ workspaceId }: WorkspaceCommentsProps): JSX.Element {
  const navigate = useNavigate();
  const list = useQuery<WorkspaceDiscussionsResponse>({
    key: workspaceId
      ? ['workspace', workspaceId, 'discussions']
      : ['workspace', 'none', 'discussions'],
    enabled: Boolean(workspaceId),
    fetcher: () =>
      api.get<WorkspaceDiscussionsResponse>(
        COLLAB_API_ROUTES.workspaceDiscussions(workspaceId as string),
      ),
    staleTime: 20_000,
  });

  const items = list.data?.items ?? [];

  return (
    <aside className={styles.panel} aria-label="所有留言">
      <header className={styles.header}>
        <h2 className={styles.title}>所有留言</h2>
      </header>

      {list.isLoading ? <p className={styles.hint}>載入留言中…</p> : null}
      {list.isError ? <p className={styles.hint}>載入留言失敗，稍後再試。</p> : null}
      {!list.isLoading && items.length === 0 ? (
        <p className={styles.hint}>這個工作區還沒有任何留言。</p>
      ) : null}

      <ul className={styles.threads}>
        {items.map((item) => {
          const last = item.discussion.comments[item.discussion.comments.length - 1];
          return (
            <li key={item.discussion.id} className={styles.thread}>
              <button
                type="button"
                className={styles.crossPageItem}
                onClick={() => {
                  setActiveDiscussion(item.discussion.id);
                  navigate(`/page/${item.pageId}`);
                }}
              >
                <span className={styles.crossPageTitle}>
                  {item.pageIcon ? `${item.pageIcon} ` : ''}
                  {item.pageTitle}
                </span>
                <span className={styles.body}>
                  {last ? richTextToPlainText(last.body) : '（沒有內容）'}
                </span>
                <span className={styles.time}>
                  {new Date(item.lastActivityAt).toLocaleString('zh-TW')}
                  {item.discussion.resolvedAt ? '・已解決' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
