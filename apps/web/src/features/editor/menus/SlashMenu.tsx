/**
 * Slash menu（02 §4.1.1 / M2-B 交付物 8）。
 *
 * editor-core 只負責偵測觸發與提供 query + caret rect；選單本身在這裡畫。
 * 鍵盤：↑↓ 循環、Enter/Tab 確認、Esc 由 editor-core 關閉。
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

export interface SlashMenuProps {
  state: MenuTriggerPayload | null;
  onClose(): void;
  onSelect(command: SlashCommand): void;
}

export function SlashMenu({ state, onClose, onSelect }: SlashMenuProps) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => (state ? searchCommands(state.query) : []), [state]);
  const groups = useMemo(() => groupCommands(items), [items]);

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
        if (item) onSelect(item);
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
      maxHeight={320}
    >
      <div className="kn-menu-scroll" ref={listRef}>
        {items.length === 0 ? (
          <div className="kn-menu-empty">找不到符合的區塊</div>
        ) : (
          groups.map((group) => (
            <div className="kn-menu-group" key={group.group}>
              <div className="kn-menu-group-title">{COMMAND_GROUP_LABELS[group.group]}</div>
              {group.items.map((item) => {
                const itemIndex = items.indexOf(item);
                return (
                  <div
                    key={item.id}
                    role="option"
                    aria-selected={itemIndex === index}
                    data-active={itemIndex === index ? 'true' : undefined}
                    className="kn-menu-item"
                    onMouseEnter={() => setIndex(itemIndex)}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => onSelect(item)}
                  >
                    <span className="kn-menu-item-icon">
                      {item.swatchVar ? (
                        <span className="kn-swatch" style={{ background: `var(${item.swatchVar})` }} />
                      ) : item.swatchVar === null && (item.group === 'color' || item.group === 'background') ? (
                        <span className="kn-swatch kn-swatch--default" />
                      ) : (
                        <Icon name={item.icon} />
                      )}
                    </span>
                    <span className="kn-menu-item-body">
                      <span className="kn-menu-item-label">{item.label}</span>
                      {item.description ? <span className="kn-menu-item-desc">{item.description}</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </Popover>
  );
}
