/**
 * 選取文字後的「留言」彈出框（04 §8 M5-9、01 §6 M5.2.2）。
 *
 * 錨點策略（**重要，給編輯器宿主**）：
 *   1. 這裡先產生 discussionId（UUID v7）
 *   2. 送出後呼叫 onCreated(discussionId)
 *   3. 宿主把 `{ t:'comment', id: discussionId }` mark 套在選取範圍上，
 *      走 sync.submit([block.update]) 送出 —— 錨點因此跟著文字一起被編輯、
 *      不會像字元位移那樣漂掉（03 §4.9 的警告）
 */
import { useEffect, useRef, useState } from 'react';
import { createId } from '../../lib/sync-client';
import { createDiscussion, plainToBody } from './api';
import styles from './CommentPopover.module.css';

export interface CommentPopoverProps {
  pageId: string;
  /** 選取範圍所在的 block */
  blockId: string;
  /** 被選取的文字（存成 anchor.quote，討論串被孤立時用來顯示） */
  quote: string;
  /** 相對於視窗的位置（宿主用 selection rect 算好） */
  anchorRect?: { top: number; left: number } | null;
  onCreated(discussionId: string): void;
  onClose(): void;
}

export function CommentPopover({
  pageId,
  blockId,
  quote,
  anchorRect = null,
  onCreated,
  onClose,
}: CommentPopoverProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (): Promise<void> => {
    const body = plainToBody(draft);
    if (body.length === 0) return;
    setBusy(true);
    setError(null);
    const discussionId = createId();
    try {
      await createDiscussion(pageId, {
        discussionId,
        blockId,
        anchor: { kind: 'inline', quote: quote.slice(0, 500) },
        body,
      });
      onCreated(discussionId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '留言失敗，請稍後再試');
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.popover}
      style={anchorRect ? { top: anchorRect.top, left: anchorRect.left } : undefined}
      role="dialog"
      aria-label="新增留言"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
      }}
    >
      {quote ? <blockquote className={styles.quote}>{quote}</blockquote> : null}
      <textarea
        ref={inputRef}
        className={styles.input}
        rows={3}
        value={draft}
        placeholder="留言…（⌘/Ctrl + Enter 送出）"
        onChange={(e) => setDraft(e.target.value)}
        aria-label="留言內容"
      />
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.ghostButton} onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={busy || draft.trim().length === 0}
          onClick={() => void submit()}
        >
          留言
        </button>
      </div>
    </div>
  );
}
