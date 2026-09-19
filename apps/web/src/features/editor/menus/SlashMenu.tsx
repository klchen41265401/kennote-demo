/**
 * `/` 斜線選單（02 §4.1.1 / UI-SPEC §6.1）。
 *
 * editor-core 只負責偵測觸發與提供 query + caret rect；選單本身在這裡畫。
 * 版面照 Notion 7.34：寬 330px、最高 370px、分組標題 sticky、底部固定
 * 「關閉選單 esc」、右側灰字顯示 markdown 縮寫，**不顯示說明文字**。
 *
 * 鍵盤：↑↓ 循環、PageUp/PageDown 跳 5 筆、Home/End、Enter/Tab 確認、
 * Esc 關閉（由 overlay stack 處理，會保留已經打好的字）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MenuTriggerPayload } from '@kennote/editor-core';
import { Popover } from '../ui/overlay';
import { Icon } from '../ui/icons';
import { rectFromDOMRect, type RectLike } from '../lib/floating';
import {
  COMMAND_GROUP_LABELS,
  groupCommands,
  searchCommands,
  type SlashCommand,
} from './slashCommands';

const RECENT_KEY = 'kennote.slash.recent';
const RECENT_MAX = 8;
/** 沒有結果之後再多打幾個字就自動關閉（Notion 的行為，UI-SPEC §6.1） */
const CLOSE_AFTER_EMPTY_CHARS = 2;

export function readRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberCommand(id: string): void {
  try {
    const next = [id, ...readRecentCommands().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 隱私模式 / 關閉 storage：記不住就算了，不能因此壞掉 */
  }
}

export interface SlashMenuProps {
  state: MenuTriggerPayload | null;
  /** 目前 block 有沒有內容：決定要不要顯示「轉換成」分組 */
  blockHasContent?: boolean;
  onClose(): void;
  onSelect(command: SlashCommand): void;
}

export function SlashMenu({ state, blockHasContent = false, onClose, onSelect }: SlashMenuProps) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [recent, setRecent] = useState<string[]>([]);
  /** 第一次變成「沒有結果」時的 query 長度 */
  const emptyAt = useRef<number | null>(null);

  useEffect(() => {
    if (state) setRecent(readRecentCommands());
  }, [state?.blockId]);

  const items = useMemo(
    () => (state ? searchCommands(state.query, undefined, { blockHasContent, recentIds: recent }) : []),
    [state, blockHasContent, recent],
  );
  const groups = useMemo(() => groupCommands(items), [items]);
  const filtering = (state?.query ?? '').trim() !== '';
  /**
   * 過濾時 Notion 只在「同名項目不只一個」的時候補上「· 分組」
   * （例如「標題 1」同時出現在 基本區塊 與 轉換成）。
   */
  const ambiguous = useMemo(() => {
    const count = new Map<string, number>();
    for (const item of items) count.set(item.label, (count.get(item.label) ?? 0) + 1);
    return new Set([...count].filter(([, n]) => n > 1).map(([label]) => label));
  }, [items]);

  useEffect(() => {
    setIndex(0);
  }, [state?.query, state?.blockId]);

  /* 連續打到沒有結果就自動關閉（Notion：「網頁書籤」4 個字會關掉，「書籤」不會） */
  useEffect(() => {
    if (!state) {
      emptyAt.current = null;
      return;
    }
    const length = [...state.query].length;
    if (items.length > 0) {
      emptyAt.current = null;
      return;
    }
    if (emptyAt.current === null) {
      emptyAt.current = length;
      return;
    }
    if (length - emptyAt.current >= CLOSE_AFTER_EMPTY_CHARS) onClose();
  }, [state, items.length, onClose]);

  useEffect(() => {
    if (!state) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (items.length === 0) return;
      const move = (delta: number): void => {
        event.preventDefault();
        event.stopPropagation();
        setIndex((i) => {
          const next = i + delta;
          if (next < 0) return delta === -1 ? items.length - 1 : 0;
          if (next >= items.length) return delta === 1 ? 0 : items.length - 1;
          return next;
        });
      };
      switch (event.key) {
        case 'ArrowDown':
          return move(1);
        case 'ArrowUp':
          return move(-1);
        case 'PageDown':
          return move(5);
        case 'PageUp':
          return move(-5);
        case 'Home':
          event.preventDefault();
          event.stopPropagation();
          return setIndex(0);
        case 'End':
          event.preventDefault();
          event.stopPropagation();
          return setIndex(items.length - 1);
        case 'Enter':
        case 'Tab': {
          event.preventDefault();
          event.stopPropagation();
          const item = items[index];
          if (item) {
            rememberCommand(item.id);
            onSelect(item);
          }
          return;
        }
        default:
          return;
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [state, items, index, onSelect]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const anchor: RectLike | null = state?.rect ? rectFromDOMRect(state.rect) : null;

  return (
    <Popover
      anchor={anchor}
      open={Boolean(state) && anchor !== null}
      onClose={onClose}
      placement="bottom-start"
      className="kn-popover--slash"
      ariaLabel="區塊指令"
      role="listbox"
      maxHeight={370}
    >
      <div className="kn-slash-scroll" ref={listRef}>
        {items.length === 0 ? (
          <div className="kn-menu-empty">沒有結果</div>
        ) : filtering ? (
          /* 過濾中：Notion 會攤平成一張依相關度排序的清單，不分組 */
          items.map((item, i) => (
            <SlashItem
              key={item.id}
              item={item}
              active={i === index}
              showGroup={ambiguous.has(item.label)}
              onHover={() => setIndex(i)}
              onSelect={() => {
                rememberCommand(item.id);
                onSelect(item);
              }}
            />
          ))
        ) : (
          groups.map((group) => (
            <div className="kn-menu-group" key={group.group}>
              <div className="kn-menu-group-title">{COMMAND_GROUP_LABELS[group.group]}</div>
              {group.items.map((item) => {
                const itemIndex = items.indexOf(item);
                return (
                  <SlashItem
                    key={item.id}
                    item={item}
                    active={itemIndex === index}
                    showGroup={false}
                    onHover={() => setIndex(itemIndex)}
                    onSelect={() => {
                      rememberCommand(item.id);
                      onSelect(item);
                    }}
                  />
                );
              })}
            </div>
          ))
        )}
      </div>
      <div className="kn-slash-footer">
        <span>關閉選單</span>
        <kbd>esc</kbd>
      </div>
    </Popover>
  );
}

function SlashItem({
  item,
  active,
  showGroup,
  onHover,
  onSelect,
}: {
  item: SlashCommand;
  active: boolean;
  showGroup: boolean;
  onHover(): void;
  onSelect(): void;
}) {
  const disabled = item.badge === '即將推出';
  return (
    <div
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      data-active={active ? 'true' : undefined}
      data-soon={disabled ? 'true' : undefined}
      className="kn-slash-item"
      title={item.description}
      onMouseEnter={onHover}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={onSelect}
    >
      <span className="kn-slash-item-icon">
        {item.swatchVar !== undefined ? (
          item.group === 'color' ? (
            <span className="kn-swatch-letter" style={item.swatchVar ? { color: `var(${item.swatchVar})` } : undefined}>
              A
            </span>
          ) : (
            <span
              className={`kn-swatch${item.swatchVar ? '' : ' kn-swatch--default'}`}
              style={item.swatchVar ? { background: `var(${item.swatchVar})` } : undefined}
            />
          )
        ) : item.glyph ? (
          <span className="kn-slash-monogram">{item.glyph}</span>
        ) : (
          <Icon name={item.icon} />
        )}
      </span>
      <span className="kn-slash-item-label">
        {item.label}
        {item.groupLabel ?? (showGroup ? COMMAND_GROUP_LABELS[item.group] : null) ? (
          <span className="kn-slash-item-group">
            {' · '}
            {item.groupLabel ?? COMMAND_GROUP_LABELS[item.group]}
          </span>
        ) : null}
      </span>
      {item.badge ? (
        <span className="kn-slash-badge" data-tone={item.badge === '新' ? 'new' : 'soon'}>
          {item.badge}
        </span>
      ) : null}
      {item.hint ? <span className="kn-slash-item-hint">{item.hint}</span> : null}
    </div>
  );
}
