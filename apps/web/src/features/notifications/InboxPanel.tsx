/**
 * 收件匣（04 §8 M5-10）。
 * 未讀數 badge 由 useUnreadCount() 提供給側邊欄用（見 InboxBadge）。
 */
import { useEffect } from 'react';
import type { Notification } from '@kennote/shared-types';
import {
  loadInbox,
  markAllNotificationsRead,
  markNotificationRead,
  useNotifications,
  useUnreadCount,
} from '../../stores/notifications';
import styles from './InboxPanel.module.css';

const TYPE_LABEL: Record<Notification['type'], string> = {
  mention: '提到你',
  comment_reply: '回覆了討論串',
  comment_resolved: '解決了你的留言',
  page_shared: '分享了頁面給你',
  invite: '邀請你加入工作區',
  permission_changed: '調整了你的權限',
  page_updated: '更新了你追蹤的頁面',
};

export interface InboxPanelProps {
  /** 點通知 → 開啟對應頁面（宿主決定用 router 還是開新分頁） */
  onOpenPage?(pageId: string, discussionId: string | null): void;
}

export function InboxPanel({ onOpenPage }: InboxPanelProps): JSX.Element {
  const { items, users, loading, loaded, nextCursor, error } = useNotifications();

  useEffect(() => {
    if (!loaded) void loadInbox();
  }, [loaded]);

  return (
    <aside className={styles.panel} aria-label="通知">
      <header className={styles.header}>
        <h2 className={styles.title}>通知</h2>
        <button type="button" className={styles.linkButton} onClick={() => void markAllNotificationsRead()}>
          全部標為已讀
        </button>
      </header>

      {loading && items.length === 0 ? <p className={styles.hint}>載入中…</p> : null}
      {error ? <p className={styles.hint}>{error}</p> : null}
      {!loading && items.length === 0 ? <p className={styles.hint}>目前沒有通知。</p> : null}

      <ul className={styles.list}>
        {items.map((n) => {
          const actor = n.actorId ? users[n.actorId] : undefined;
          return (
            <li key={n.id}>
              <button
                type="button"
                className={`${styles.item} ${n.readAt ? '' : styles.unread}`}
                onClick={() => {
                  void markNotificationRead(n.id);
                  if (n.pageId) onOpenPage?.(n.pageId, n.discussionId);
                }}
              >
                <span className={styles.line}>
                  <strong>{actor?.name ?? '有人'}</strong> {TYPE_LABEL[n.type]}
                  {n.payload.pageTitle ? `《${n.payload.pageTitle}》` : ''}
                </span>
                {n.payload.snippet ? (
                  <span className={styles.snippet}>{n.payload.snippet}</span>
                ) : null}
                <time className={styles.time} dateTime={n.createdAt}>
                  {new Date(n.createdAt).toLocaleString('zh-TW')}
                </time>
              </button>
            </li>
          );
        })}
      </ul>

      {nextCursor ? (
        <button
          type="button"
          className={styles.more}
          disabled={loading}
          onClick={() => void loadInbox({ append: true })}
        >
          載入更多
        </button>
      ) : null}
    </aside>
  );
}

/** 側邊欄用的未讀 badge（沒有未讀就不渲染） */
export function InboxBadge(): JSX.Element | null {
  const unread = useUnreadCount();
  if (unread <= 0) return null;
  return (
    <span className={styles.badge} aria-label={`${unread} 則未讀通知`}>
      {unread > 99 ? '99+' : unread}
    </span>
  );
}
