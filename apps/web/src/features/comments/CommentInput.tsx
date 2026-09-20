/**
 * 留言輸入框 + `@` 提及選單（gap-review C-3）。
 *
 * 資料來源刻意**沿用 `MentionMenu` 的那一份**（`useWorkspaceMembers()` →
 * `['workspace', id, 'members']`，同一個 query key，所以兩邊共用快取），
 * 但不直接 render `MentionMenu`：那支元件綁在 editor-core 的
 * `blockId / triggerOffset / RectLike` 上，硬套到一個 `<input>` 只會讓
 * 兩邊都變難改。這裡只要「一個貼著輸入框的清單」。
 *
 * 選定之後仍然走 `plainToBody()` 把 `@名字` 轉成 mention atom
 * （第六輪 BUG-30：只有 atom 才會產生通知），所以手打的 `@名字`
 * 與從選單挑的結果完全一致。
 */
import { useMemo, useRef, useState } from 'react';
import type { MentionCandidate } from './api';
import styles from './CommentsPanel.module.css';

export interface CommentInputProps {
  value: string;
  placeholder: string;
  ariaLabel: string;
  members: readonly MentionCandidate[];
  disabled?: boolean;
  onChange(value: string): void;
  onSubmit(): void;
}

interface MentionQuery {
  /** `@` 在字串中的位置 */
  start: number;
  query: string;
}

/** 游標前最後一個沒有被空白打斷的 `@…` */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  const query = upto.slice(at + 1);
  if (/[\s@]/.test(query)) return null;
  if (query.length > 32) return null;
  return { start: at, query };
}

function labelOf(m: MentionCandidate): string {
  return m.user?.name?.trim() || (m.user?.email ?? '').split('@')[0] || '未命名成員';
}

export function CommentInput({
  value,
  placeholder,
  ariaLabel,
  members,
  disabled = false,
  onChange,
  onSubmit,
}: CommentInputProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return members
      .filter((m) => q === '' || labelOf(m).toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, members]);

  const open = mention !== null && matches.length > 0;

  const sync = (next: string, caret: number): void => {
    onChange(next);
    setMention(mentionQueryAt(next, caret));
    setActive(0);
  };

  const pick = (member: MentionCandidate): void => {
    if (!mention) return;
    const label = labelOf(member);
    const next = `${value.slice(0, mention.start)}@${label} ${value.slice(
      mention.start + 1 + mention.query.length,
    )}`;
    onChange(next);
    setMention(null);
    setActive(0);
    inputRef.current?.focus();
  };

  return (
    <div className={styles.inputWrap}>
      <input
        ref={inputRef}
        className={styles.input}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        disabled={disabled}
        onChange={(e) => sync(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onClick={(e) =>
          setMention(mentionQueryAt(value, e.currentTarget.selectionStart ?? value.length))
        }
        onBlur={() => window.setTimeout(() => setMention(null), 120)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (open) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => (i + 1) % matches.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => (i - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              pick(matches[active] as MentionCandidate);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setMention(null);
              return;
            }
          }
          if (e.key === 'Enter') onSubmit();
        }}
      />
      {open ? (
        <ul className={styles.mentionMenu} role="listbox" aria-label="提及成員">
          {matches.map((m, i) => (
            <li key={m.userId}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={`${styles.mentionItem} ${i === active ? styles.mentionItemActive : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(m)}
              >
                {labelOf(m)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
