/**
 * 右側留言面板（02 §3.6 CommentsPanel、04 §8 M5-9）。
 *
 * - 未解決的討論串置頂，已解決的可切換顯示
 * - hover 討論串 → 高亮對應的 block（由宿主提供 onHighlightBlock）
 * - 有留言權限（含 guest）就能回覆與解決；唯讀的人只能看
 */
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { CommentInput } from './CommentInput';
import {
  clearPendingDiscussion,
  discussionAtEvent,
  paintHighlights,
  resolvePending,
  scrollToBlock,
  setActiveDiscussion,
  setHoverDiscussion,
  useHighlight,
} from './highlight';
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
  active,
  onHighlightBlock,
}: {
  pageId: string;
  discussion: Discussion;
  users: Record<string, PublicUser>;
  canComment: boolean;
  currentUserId: string | null;
  /** BUG-30：`@某人` 要變成 mention atom 才會產生通知 */
  members: readonly MentionCandidate[];
  /** 這張卡片是不是「目前這一張」（從編輯器的標註跳過來，或被點過） */
  active: boolean;
  onHighlightBlock?(blockId: string | null): void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const quote = discussion.anchor.kind === 'inline' ? discussion.anchor.quote : '';

  // 編輯器點標註 → 面板捲到這張卡片（B-8 的反向那一半）
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

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
      ref={ref}
      data-discussion-id={discussion.id}
      className={`${styles.thread} ${discussion.resolvedAt ? styles.resolved : ''} ${
        active ? styles.threadActive : ''
      }`}
      onMouseEnter={() => {
        setHoverDiscussion(discussion.id);
        onHighlightBlock?.(discussion.blockId);
      }}
      onMouseLeave={() => {
        setHoverDiscussion(null);
        onHighlightBlock?.(null);
      }}
      onClick={() => {
        setActiveDiscussion(discussion.id);
        scrollToBlock(discussion.blockId);
      }}
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
          <CommentInput
            value={draft}
            placeholder="回覆…（輸入 @ 提及成員）"
            ariaLabel="回覆留言"
            members={members}
            onChange={setDraft}
            onSubmit={() => void reply()}
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
  /**
   * gap-review C-3：Notion 的留言側欄頂端是「未解決 ⌄ / 全部」下拉，
   * 以前 kennote 只有一個「顯示已解決」勾選框，看不出現在在看什麼。
   */
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const showResolved = filter === 'all';
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
  const allDiscussions = useMemo(() => data?.discussions ?? [], [data]);
  const highlight = useHighlight();

  /*
   * B-8 的兩個方向都在這裡接上：
   *   1. discussions / hover / active 一變 → 重畫頁面上的標註狀態
   *   2. 編輯器裡點 `.kn-comment` → 設 activeId（卡片那一側在 <Thread> 裡捲過去）
   * 監聽掛在 document 的**捕獲階段**：`.kn-comment` 在 contenteditable 裡面，
   * 冒泡途中可能被編輯器的 handler 攔下來。
   */
  useEffect(() => {
    paintHighlights(allDiscussions, highlight);
  }, [allDiscussions, highlight]);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const id = discussionAtEvent(e.target, allDiscussions);
      if (id) setActiveDiscussion(id);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [allDiscussions]);

  /*
   * 面板本來是關著的時候，編輯器只留下了 `pending`（blockId + 被點的文字）。
   * 討論串載好之後在這裡解析成 discussionId。
   */
  useEffect(() => {
    if (!highlight.pending || allDiscussions.length === 0) return;
    const id = resolvePending(highlight.pending, allDiscussions);
    clearPendingDiscussion();
    if (id) setActiveDiscussion(id);
  }, [highlight.pending, allDiscussions]);

  // 卸載時把標註狀態清掉，不要留在頁面上
  useEffect(
    () => () => {
      paintHighlights([], { activeId: null, hoverId: null, pending: null });
      setActiveDiscussion(null);
    },
    [],
  );

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
        <div className={styles.filter} role="group" aria-label="留言篩選">
          <button
            type="button"
            className={`${styles.filterButton} ${filter === 'open' ? styles.filterActive : ''}`}
            aria-pressed={filter === 'open'}
            onClick={() => setFilter('open')}
          >
            未解決
          </button>
          <button
            type="button"
            className={`${styles.filterButton} ${filter === 'all' ? styles.filterActive : ''}`}
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            全部
          </button>
        </div>
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
            active={highlight.activeId === discussion.id}
            {...(onHighlightBlock ? { onHighlightBlock } : {})}
          />
        ))}
      </ul>

      {discussions.length === 0 && !isLoading ? (
        <p className={styles.hint}>
          {filter === 'open' && (data?.discussions.length ?? 0) > 0
            ? '沒有未解決的留言。切到「全部」看已解決的討論串。'
            : '還沒有留言。選取文字按「留言」可以針對段落討論。'}
        </p>
      ) : null}

      {canComment ? (
        <footer className={styles.footer}>
          <CommentInput
            value={draft}
            placeholder="對整頁留言…（輸入 @ 提及成員）"
            ariaLabel="新增頁面留言"
            members={members}
            onChange={setDraft}
            onSubmit={() => void startThread()}
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
