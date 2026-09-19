/**
 * 「連結到頁面」「資料來源的連結瀏覽模式」共用的選擇器。
 *
 * Notion 這兩個項目選下去都會再開一層「搜尋頁面」的小面板，
 * 這支就是那一層：搜尋框 + 結果清單 + 鍵盤導覽。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageTreeNode } from '@kennote/shared-types';
import { Popover } from '../ui/overlay';
import { Icon } from '../ui/icons';
import type { RectLike } from '../lib/floating';

export interface PickerPopoverProps {
  anchor: RectLike | null;
  open: boolean;
  title: string;
  placeholder: string;
  /** 只列資料庫頁 */
  databasesOnly?: boolean;
  nodes: PageTreeNode[];
  loading?: boolean;
  onClose(): void;
  onSelect(node: PageTreeNode): void;
}

export function PickerPopover({
  anchor,
  open,
  title,
  placeholder,
  databasesOnly = false,
  nodes,
  loading = false,
  onClose,
  onSelect,
}: PickerPopoverProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setIndex(0);
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nodes
      .filter((n) => (databasesOnly ? n.isDatabase : true))
      .filter((n) => (q === '' ? true : (n.title || '未命名').toLowerCase().includes(q)))
      .slice(0, 50);
  }, [nodes, query, databasesOnly]);

  return (
    <Popover
      anchor={anchor}
      open={open}
      onClose={onClose}
      className="kn-popover--list"
      role="dialog"
      allowFocus
      ariaLabel={title}
      maxHeight={360}
    >
      <div className="kn-menu-search">
        <Icon name="search" size={14} />
        <input
          ref={inputRef}
          className="kn-menu-search-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const item = items[index];
              if (item) onSelect(item);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
      </div>
      <div className="kn-menu-scroll">
        {loading ? (
          <div className="kn-menu-empty">載入中…</div>
        ) : items.length === 0 ? (
          <div className="kn-menu-empty">{databasesOnly ? '這個工作區還沒有資料庫' : '沒有結果'}</div>
        ) : (
          items.map((node, i) => (
            <div
              key={node.id}
              role="option"
              aria-selected={i === index}
              data-active={i === index ? 'true' : undefined}
              className="kn-menu-item"
              onMouseEnter={() => setIndex(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onSelect(node)}
            >
              <span className="kn-menu-item-icon">
                {typeof node.icon === 'string' && node.icon ? (
                  node.icon
                ) : (
                  <Icon name={node.isDatabase ? 'database' : 'page'} />
                )}
              </span>
              <span className="kn-menu-item-body">
                <span className="kn-menu-item-label">{node.title || '未命名'}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </Popover>
  );
}
