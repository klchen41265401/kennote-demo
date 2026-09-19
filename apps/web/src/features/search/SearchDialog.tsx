/**
 * 搜尋（Ctrl+K）與快速切換（Ctrl+P）。
 * 同一個元件，`compact` 時把篩選 chips 收起來 —— 兩者差別只有這個（UI-SPEC §6.7）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageTreeNode } from '@kennote/shared-types';
import { Dialog, Icon } from '@kennote/ui';
import { searchPages, useRecentPages, type ShellSearchHit } from '../../lib/queries';
import { useAuth } from '../../stores/auth';
import { displayTitle } from '../page-tree/tree';
import styles from './SearchDialog.module.css';

export interface SearchDialogProps {
  open: boolean;
  compact?: boolean;
  workspaceId: string;
  onClose(): void;
  onOpenPage(pageId: string): void;
}

type FilterId = 'all' | 'title' | 'creator' | 'date';

/**
 * 第十一輪：三顆 chip 終於各自接到東西上。
 *
 * - **建立者 / 日期**接後端本來就有的 `createdBy` / `updatedAfter`
 *   （`search/routes.ts` 的 querySchema 從 M6 就宣告了，只是沒有呼叫端 ——
 *   第六輪 §「前端沒有呼叫端」那個型態的第 N 例）。
 * - **標題**沒有對應的後端參數：`type` 的 zod enum 只有 `page | database`，
 *   送 `type:'title'` 會 400（所以這顆 chip 以前一按結果就空）。
 *   這裡改成**前端過濾**：只留標題命中的那些（`blockId === null`
 *   或標題文字本身含關鍵字），不動後端契約。
 */
const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'title', label: '僅標題' },
  { id: 'creator', label: '我建立的' },
  { id: 'date', label: '最近 7 天' },
];

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function SearchDialog({
  open,
  compact = false,
  workspaceId,
  onClose,
  onOpenPage,
}: SearchDialogProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');
  const [hits, setHits] = useState<ShellSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const recent = useRecentPages(open ? workspaceId : null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHits([]);
      setActive(0);
    }
  }, [open]);

  // 300ms 去抖；空字串直接清掉結果（顯示「最近」）
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = window.setTimeout(() => {
      const options: Parameters<typeof searchPages>[2] = {};
      if (filter === 'creator' && userId) options.createdBy = userId;
      if (filter === 'date') options.updatedAfter = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
      searchPages(q, workspaceId, options)
        .then((res) => {
          setHits(filter === 'title' ? res.filter((hit) => titleMatches(hit, q)) : res);
          setActive(0);
        })
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => window.clearTimeout(id);
  }, [query, workspaceId, filter, open, userId]);

  const recentRows = useMemo<ShellSearchHit[]>(
    () =>
      (recent.data ?? []).slice(0, 8).map((n: PageTreeNode) => ({
        pageId: n.id,
        blockId: null,
        title: n.title,
        snippet: '',
        icon: n.icon,
        updatedAt: n.updatedAt,
      })),
    [recent.data],
  );

  const rows = query.trim() ? hits : recentRows;

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (rows.length === 0 ? 0 : (i + 1) % rows.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (rows.length === 0 ? 0 : (i - 1 + rows.length) % rows.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (row) onOpenPage(row.pageId);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="search"
      align="top"
      flush
      showClose={false}
      initialFocus={inputRef}
    >
      {/* Notion 的 Ctrl+K 浮層沒有標題列，所以標題只留給螢幕閱讀器 */}
      <h2 className="kn-sr-only">{compact ? '快速切換頁面' : '搜尋'}</h2>
      <div className={styles.wrap} onKeyDown={onKeyDown}>
        <div className={styles.inputRow}>
          <Icon name="search" size={20} />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder={compact ? '跳到頁面…' : '搜尋頁面與內容…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜尋"
          />
        </div>

        {!compact && (
          <div className={styles.chips}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`${styles.chip} ${filter === f.id ? styles.chipActive : ''}`}
                onClick={() => setFilter((cur) => (cur === f.id ? 'all' : f.id))}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        <div className={styles.results} role="listbox" aria-label="搜尋結果">
          <div className={styles.groupLabel}>{query.trim() ? '結果' : '最近'}</div>
          {loading && rows.length === 0 && <p className={styles.empty}>搜尋中…</p>}
          {!loading && rows.length === 0 && (
            <p className={styles.empty}>{query.trim() ? '找不到符合的頁面' : '還沒有最近造訪的頁面'}</p>
          )}
          {rows.map((hit, i) => (
            <div
              key={`${hit.pageId}:${hit.blockId ?? ''}:${i}`}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              className={`${styles.item} ${i === active ? styles.itemActive : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onOpenPage(hit.pageId)}
            >
              <span className={styles.itemIcon} aria-hidden="true">
                {hit.icon ?? <Icon name="page" size={18} />}
              </span>
              <span className={styles.itemBody}>
                <span className={styles.itemTitle}>
                  {highlight(displayTitle(hit.title), query)}
                  {hit.parentTitles && hit.parentTitles.length > 0 && (
                    <span className={styles.itemPath}>— {hit.parentTitles.join(' / ')}</span>
                  )}
                </span>
                {hit.blockId && hit.snippet && (
                  <span className={styles.itemSnippet}>{highlight(hit.snippet, query)}</span>
                )}
              </span>
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <span>↑↓ 選擇</span>
          <span>Enter 開啟</span>
          <span>Esc 關閉</span>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * 「僅標題」的前端過濾。
 * 後端回的每一筆要嘛是頁面本身（`blockId === null`）、要嘛是某個 block 的片段；
 * 這裡只留「標題文字真的含關鍵字」的那些 —— 標題沒中卻因為內文而上榜的就丟掉。
 */
export function titleMatches(hit: ShellSearchHit, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return displayTitle(hit.title).toLowerCase().includes(q);
}

/** 把命中的關鍵字包成 <mark>（不使用 innerHTML） */
export function highlight(text: string, query: string): JSX.Element[] {
  const q = query.trim();
  if (!q) return [<span key="0">{text}</span>];
  const out: JSX.Element[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  let key = 0;
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at < 0) {
      out.push(<span key={key++}>{text.slice(i)}</span>);
      break;
    }
    if (at > i) out.push(<span key={key++}>{text.slice(i, at)}</span>);
    out.push(
      <mark key={key++} className={styles.hl}>
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    i = at + needle.length;
  }
  return out;
}
