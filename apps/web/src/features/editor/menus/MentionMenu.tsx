/**
 * `@` 提及選單（01 §4.3 M3.3.1–M3.3.3）與 `[[` 頁面連結。
 *
 * 選定後插入 inline atom（`mention` / `pageLink` / `date`），
 * 存的是 id 而不是文字 —— 標題改名時渲染端自然跟著變。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { InlineAtom } from '@kennote/editor-core';
import type { PageTreeNode, WorkspaceMember } from '@kennote/shared-types';
import { API_ROUTES } from '@kennote/shared-types';
import { useQuery } from '@kennote/ui';
import { api } from '../../../lib/api-client';
import { useWorkspaceTree } from '../../../lib/queries';
import { Popover } from '../ui/overlay';
import { Icon } from '../ui/icons';
import type { RectLike } from '../lib/floating';

export type MentionMode = 'mention' | 'page';

export interface MentionState {
  mode: MentionMode;
  blockId: string;
  triggerOffset: number;
  /** 觸發字串長度：`@` 是 1、`[[` 是 2、由 slash menu 開啟時是 0 */
  triggerLength: number;
  query: string;
  rect: RectLike | null;
}

interface MentionItem {
  id: string;
  group: string;
  label: string;
  icon: string;
  atom: InlineAtom;
}

function useMembers(workspaceId: string | null) {
  return useQuery<WorkspaceMember[]>({
    key: workspaceId ? ['workspace', workspaceId, 'members'] : ['workspace', 'none', 'members'],
    enabled: Boolean(workspaceId),
    fetcher: () => api.get<WorkspaceMember[]>(API_ROUTES.workspaceMembers(workspaceId as string)),
  });
}

/**
 * 本地時區的 `YYYY-MM-DD`。
 *
 * ⭐ BUG-13：不能用 `toISOString().slice(0, 10)` —— 那是 **UTC**。
 * 台北是 UTC+8，每天早上 08:00 以前「今天」都會變成昨天。
 */
export function localDateISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateItems(query: string): MentionItem[] {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const fmt = localDateISO;
  const candidates = [
    { label: `今天（${fmt(today)}）`, value: fmt(today), keywords: ['today', '今天', '今日'] },
    { label: `明天（${fmt(tomorrow)}）`, value: fmt(tomorrow), keywords: ['tomorrow', '明天', '明日'] },
  ];
  const q = query.trim().toLowerCase();
  return candidates
    .filter((c) => q === '' || c.keywords.some((k) => k.includes(q)) || c.value.includes(q))
    .map((c) => ({
      id: `date:${c.value}`,
      group: '日期',
      label: c.label,
      icon: '📅',
      atom: { atom: 'date', data: { date: c.value, text: c.value } } as InlineAtom,
    }));
}

export interface MentionMenuProps {
  state: MentionState | null;
  workspaceId: string | null;
  onClose(): void;
  onSelect(atom: InlineAtom): void;
}

export function MentionMenu({ state, workspaceId, onClose, onSelect }: MentionMenuProps) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const tree = useWorkspaceTree(state ? workspaceId : null);
  const members = useMembers(state && state.mode === 'mention' ? workspaceId : null);

  const items = useMemo<MentionItem[]>(() => {
    if (!state) return [];
    const q = state.query.trim().toLowerCase();
    const pages: MentionItem[] = (tree.data ?? [])
      .filter((n: PageTreeNode) => q === '' || n.title.toLowerCase().includes(q))
      .slice(0, 8)
      .map((n) => ({
        id: `page:${n.id}`,
        group: '頁面',
        label: n.title || '未命名',
        icon: n.icon ?? '📄',
        atom: { atom: 'pageLink', data: { pageId: n.id, title: n.title || '未命名' } } as InlineAtom,
      }));

    if (state.mode === 'page') return pages;

    const people: MentionItem[] = (members.data ?? [])
      .filter((m) => q === '' || m.user.name.toLowerCase().includes(q))
      .slice(0, 6)
      .map((m) => ({
        id: `user:${m.userId}`,
        group: '人員',
        label: m.user.name,
        icon: '👤',
        // ⭐ BUG-15：`text` 只放名字。`@` 由 editor-core 的 `defaultAtomText()`
        // 加（它對 mention 一律補 `@`），這邊再加一次就會渲染成「@@訪客」。
        atom: { atom: 'mention', data: { userId: m.userId, text: m.user.name } } as InlineAtom,
      }));

    return [...people, ...pages, ...dateItems(state.query)];
  }, [state, tree.data, members.data]);

  useEffect(() => {
    setIndex(0);
  }, [state?.query, state?.blockId]);

  useEffect(() => {
    if (!state) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (items.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setIndex((i) => (i + 1) % items.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setIndex((i) => (i - 1 + items.length) % items.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        const item = items[index];
        if (item) onSelect(item.atom);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [state, items, index, onSelect]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  let lastGroup = '';

  return (
    <Popover
      anchor={state?.rect ?? null}
      open={Boolean(state?.rect)}
      onClose={onClose}
      placement="bottom-start"
      className="kn-popover--slash"
      role="listbox"
      ariaLabel={state?.mode === 'page' ? '連結頁面' : '提及'}
      maxHeight={320}
      sheetOnMobile
    >
      <div className="kn-menu-scroll" ref={listRef}>
        {items.length === 0 ? (
          <div className="kn-menu-empty">
            {state?.mode === 'page' ? '找不到頁面' : '找不到符合的人員或頁面'}
          </div>
        ) : (
          items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header ? <div className="kn-menu-group-title">{header}</div> : null}
                <div
                  role="option"
                  aria-selected={i === index}
                  data-active={i === index ? 'true' : undefined}
                  className="kn-menu-item"
                  onMouseEnter={() => setIndex(i)}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => onSelect(item.atom)}
                >
                  <span className="kn-menu-item-icon">{item.icon}</span>
                  <span className="kn-menu-item-body">
                    <span className="kn-menu-item-label">{item.label}</span>
                  </span>
                </div>
              </div>
            );
          })
        )}
        {tree.isLoading || members.isLoading ? (
          <div className="kn-menu-empty">
            <Icon name="search" size={14} /> 載入中…
          </div>
        ) : null}
      </div>
    </Popover>
  );
}
