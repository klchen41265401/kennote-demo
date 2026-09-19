/**
 * 右側留言面板（02 §3.6 CommentsPanel、04 §8 M5-9）。
 *
 * - 未解決的討論串置頂，已解決的可切換顯示
 * - hover 討論串 → 高亮對應的 block（由宿主提供 onHighlightBlock）
 * - 有留言權限（含 guest）就能回覆與解決；唯讀的人只能看
 */
import { useMemo, useState } from 'react';
import type { Comment, Discussion, PublicUser } from '@kennote/shared-types';
import { richTextToPlainText } from '@kennote/shared-types';
import {
  addComment,
  deleteComment,
  plainToBody,
  setDiscussionResolved,
  usePageDiscussions,
  type MentionCandidate,
} from './api';
import { useWorkspaceMembers } from '../../lib/queries';
import { useWorkspace } from '../../stores/workspace';
import styles from './CommentsPanel.module.css';

export interface CommentsPanelProps {
  pageId: string;
  /** 我在這一頁能不能留言（guest 可以，reader 不行） */
  canComment?: boolean;
  /** 目前登入者 id（決定能不能刪自己的留言） */
  currentUserId?: string | null;
  /** hover / 點擊討論串時高亮對應 block（宿主用 scrollIntoView + 暫時外框） */
  onHighlightBlock?(blockId: string | null): void;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '剛剛';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  return date.toLocaleDateString('zh-TW');
}

function CommentRow({
  comment,
  author,
  canDelete,
  onDelete,
}: {
  comment: Comment;
  author: PublicUser | undefined;
  canDelete: boolean;
  onDelete(): void;
}): JSX.Element {
  return (
    <li className={styles.comment}>
      <div className={styles.commentHead}>
        <span className={styles.author}>{author?.name ?? '已離開的成員'}</span>
        <time className={styles.time} dateTime={comment.createdAt}>
          {formatTime(comment.createdAt)}
        </time>
        {canDelete ? (
          <button type="button" className={styles.linkButton} onClick={onDelete}>
            刪除
          </button>
        ) : null}
      </div>
      <p className={styles.body}>
        {comment.deletedAt ? (
          <em className={styles.deleted}>這則留言已刪除</em>
        ) : (
          richTextToPlainText(comment.body)
        )}
      </p>
    </li>
  );
}

function Thread({
  pageId,
  discussion,
  users,
  canComment,
  currentUserId,
  members,
  onHighlightBlock,
}: {
  pageId: string;
  discussion: Discussion;
  users: Record<string, PublicUser>;
  canComment: boolean;
  currentUserId: string | null;
  /** BUG-30：`@某人` 要變成 mention atom 才會產生通知 */
  members: readonly MentionCandidate[];
  onHighlightBlock?(blockId: string | null): void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const quote = discussion.anchor.kind === 'inline' ? discussion.anchor.quote : '';

  const reply = async (): Promise<void> => {
    const body = plainToBody(draft, members);
    if (body.length === 0) return;
    setBusy(true);
    try {
      await addComment(pageId, discussion.id, body);
      setDraft('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={`${styles.thread} ${discussion.resolvedAt ? styles.resolved : ''}`}
      onMouseEnter={() => onHighlightBlock?.(discussion.blockId)}
      onMouseLeave={() => onHighlightBlock?.(null)}
    >
      {quote ? <blockquote className={styles.quote}>{quote}</blockquote> : null}
      {discussion.blockId === null ? <span className={styles.pageTag}>頁面討論</span> : null}

      <ul className={styles.comments}>
        {discussion.comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            author={comment.authorId ? users[comment.authorId] : undefined}
            canDelete={Boolean(currentUserId && comment.authorId === currentUserId && !comment.deletedAt)}
            onDelete={() => void deleteComment(pageId, comment.id)}
          />
        ))}
      </ul>

      {canComment ? (
        <div className={styles.replyRow}>
          <input
            className={styles.input}
            value={draft}
            placeholder="回覆…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void reply();
            }}
            aria-label="回覆留言"
          />
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy || draft.trim().length === 0}
            onClick={() => void reply()}
          >
            送出
          </button>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() =>
              void setDiscussionResolved(pageId, discussion.id, !discussion.resolvedAt)
            }
          >
            {discussion.resolvedAt ? '重新開啟' : '解決'}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function CommentsPanel({
  pageId,
  canComment = true,
  currentUserId = null,
  onHighlightBlock,
}: CommentsPanelProps): JSX.Element {
  const [showResolved, setShowResolved] = useState(false);
  const { data, isLoading, isError } = usePageDiscussions(pageId);
  // BUG-30：留言框的 `@某人` 要比對得到人，才生得出 mention atom → 通知
  const workspace = useWorkspace();
  const membersQuery = useWorkspaceMembers(workspace?.id ?? null);
  const members = useMemo(
    () => (membersQuery.data ?? []) as MentionCandidate[],
    [membersQuery.data],
  );
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const discussions = useMemo(() => {
    const all = data?.discussions ?? [];
    const visible = showResolved ? all : all.filter((d) => !d.resolvedAt);
    // 未解決置頂，其餘依建立時間
    return [...visible].sort((a, b) => {
      if (Boolean(a.resolvedAt) !== Boolean(b.resolvedAt)) return a.resolvedAt ? 1 : -1;
      return a.createdAt < b.createdAt ? -1 : 1;
    });
  }, [data, showResolved]);

  const openCount = (data?.discussions ?? []).filter((d) => !d.resolvedAt).length;

  const startThread = async (): Promise<void> => {
    const body = plainToBody(draft, members);
    if (body.length === 0) return;
    setBusy(true);
    try {
      const { createDiscussion } = await import('./api');
      await createDiscussion(pageId, { body, anchor: { kind: 'page' } });
      setDraft('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className={styles.panel} aria-label="留言">
      <header className={styles.header}>
        <h2 className={styles.title}>留言{openCount > 0 ? `（${openCount}）` : ''}</h2>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          顯示已解決
        </label>
      </header>

      {isLoading ? <p className={styles.hint}>載入留言中…</p> : null}
      {isError ? <p className={styles.hint}>載入留言失敗，稍後再試。</p> : null}

      <ul className={styles.threads}>
        {discussions.map((discussion) => (
          <Thread
            key={discussion.id}
            pageId={pageId}
            discussion={discussion}
            users={data?.users ?? {}}
            canComment={canComment}
            currentUserId={currentUserId}
            members={members}
            {...(onHighlightBlock ? { onHighlightBlock } : {})}
          />
        ))}
      </ul>

      {discussions.length === 0 && !isLoading ? (
        <p className={styles.hint}>還沒有留言。選取文字按「留言」可以針對段落討論。</p>
      ) : null}

      {canComment ? (
        <footer className={styles.footer}>
          <input
            className={styles.input}
            value={draft}
            placeholder="對整頁留言…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void startThread();
            }}
            aria-label="新增頁面留言"
          />
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy || draft.trim().length === 0}
            onClick={() => void startThread()}
          >
            留言
          </button>
        </footer>
      ) : (
        <p className={styles.hint}>你對這個頁面沒有留言權限。</p>
      )}
    </aside>
  );
}
