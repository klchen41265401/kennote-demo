/**
 * 選取文字後浮現的格式工具列（02 §4.1.4 / M2-B 交付物 9）。
 *
 * 出現時機：選取非空、非 IME 組字中，selectionChange 後 delay 150ms
 * （避免拖曳選取過程中閃爍）。定位用 editor.getSelectionRect()。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor, Mark } from '@kennote/editor-core';
import type { BlockType } from '@kennote/shared-types';
import { Popover, MenuItem } from '../ui/overlay';
import { Icon } from '../ui/icons';
import { rectFromDOMRect, type RectLike } from '../lib/floating';
import { convertibleSpecs, getSpec } from '../blocks/registry';
import { BLOCK_BACKGROUNDS, BLOCK_COLORS } from './slashCommands';
import { toast } from '../ui/toast';

const SHOW_DELAY_MS = 150;

export interface BubbleMenuProps {
  editor: Editor;
  rev: number;
  readOnly: boolean;
  /** 外部（Ctrl+K）要求開啟連結輸入 */
  linkRequest: number;
  onConvert(type: BlockType): void;
  onColor(color: string): void;
  /**
   * 第十一輪：行內留言。宿主（Editor）負責在**當下**把選取範圍記起來
   *（`{blockId, start, end}`），因為輸入框一拿到焦點，DOM 選取就沒了。
   * 沒給這個 prop 時按鈕不顯示 —— 不要留一顆按了會說「還沒開放」的按鈕。
   */
  onComment?(): void;
}

type SubMenu = 'type' | 'color' | null;

export function BubbleMenu({ editor, rev, readOnly, linkRequest, onConvert, onColor, onComment }: BubbleMenuProps) {
  const [anchor, setAnchor] = useState<RectLike | null>(null);
  const [sub, setSub] = useState<SubMenu>(null);
  const [subAnchor, setSubAnchor] = useState<RectLike | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const marks = useMemo(() => (anchor ? editor.getActiveMarks() : []), [editor, anchor, rev]);
  const has = useCallback((t: Mark['t']) => marks.some((m) => m.t === t), [marks]);

  const refresh = useCallback(() => {
    if (readOnly) return;
    const sel = editor.getSelection();
    if (sel.type !== 'text' || editor.isComposing) {
      setAnchor(null);
      setSub(null);
      return;
    }
    if (sel.anchor.offset === sel.focus.offset && sel.anchor.blockId === sel.focus.blockId) {
      setAnchor(null);
      setSub(null);
      return;
    }
    const rect = editor.getSelectionRect();
    setAnchor(rect ? rectFromDOMRect(rect) : null);
  }, [editor, readOnly]);

  useEffect(() => {
    const off = editor.on('selectionChange', () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(refresh, SHOW_DELAY_MS);
    });
    return () => {
      off();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [editor, refresh]);

  // Ctrl+K：直接開連結輸入
  useEffect(() => {
    if (linkRequest === 0) return;
    const sel = editor.getSelection();
    if (sel.type !== 'text') return;
    const rect = editor.getSelectionRect();
    setAnchor(rect ? rectFromDOMRect(rect) : null);
    const existing = editor.getActiveMarks().find((m) => m.t === 'link');
    setLinkValue(existing && existing.t === 'link' ? existing.href : '');
    setLinkOpen(true);
    requestAnimationFrame(() => linkInputRef.current?.focus());
  }, [linkRequest, editor]);

  const currentType = useMemo<BlockType | null>(() => {
    const sel = editor.getSelection();
    if (sel.type !== 'text') return null;
    return editor.getBlock(sel.focus.blockId)?.type ?? null;
  }, [editor, rev, anchor]);

  if (readOnly) return null;

  const applyLink = (): void => {
    const raw = linkValue.trim();
    const existing = editor.getActiveMarks().find((m) => m.t === 'link');
    if (existing) editor.toggleMark(existing);
    if (raw) {
      const href = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
      if (!/^(https?|mailto|tel):/i.test(href)) {
        toast('只接受 http / https / mailto / tel 連結', { kind: 'error' });
        return;
      }
      editor.toggleMark({ t: 'link', href });
    }
    setLinkOpen(false);
    setLinkValue('');
  };

  return (
    <>
      <Popover
        anchor={anchor}
        open={anchor !== null && !linkOpen}
        onClose={() => setAnchor(null)}
        placement="top"
        offset={8}
        className="kn-popover--bubble"
        ariaLabel="文字格式"
        closeOnOutside={false}
        /* 行動版：虛擬鍵盤打開時吸在鍵盤上緣，不然工具列會被鍵盤蓋掉（第五輪） */
        keyboardAware
      >
        <button
          type="button"
          className="kn-bubble-btn kn-bubble-btn--wide"
          onClick={(e) => {
            setSubAnchor(rectFromDOMRect(e.currentTarget.getBoundingClientRect()));
            setSub(sub === 'type' ? null : 'type');
          }}
        >
          {currentType ? (getSpec(currentType)?.label ?? '文字') : '文字'}
          <Icon name="chevron-down" size={12} />
        </button>
        <span className="kn-bubble-sep" />
        <FormatButton icon="bold" title="粗體 Ctrl+B" active={has('b')} onClick={() => editor.toggleMark({ t: 'b' })} />
        <FormatButton icon="italic" title="斜體 Ctrl+I" active={has('i')} onClick={() => editor.toggleMark({ t: 'i' })} />
        <FormatButton
          icon="underline"
          title="底線 Ctrl+U"
          active={has('u')}
          onClick={() => editor.toggleMark({ t: 'u' })}
        />
        <FormatButton
          icon="strike"
          title="刪除線 Ctrl+Shift+S"
          active={has('s')}
          onClick={() => editor.toggleMark({ t: 's' })}
        />
        <FormatButton
          icon="code"
          title="行內程式碼 Ctrl+E"
          active={has('code')}
          onClick={() => editor.toggleMark({ t: 'code' })}
        />
        <FormatButton
          icon="link"
          title="連結 Ctrl+K"
          active={has('link')}
          onClick={() => {
            const existing = editor.getActiveMarks().find((m) => m.t === 'link');
            setLinkValue(existing && existing.t === 'link' ? existing.href : '');
            setLinkOpen(true);
            requestAnimationFrame(() => linkInputRef.current?.focus());
          }}
        />
        <span className="kn-bubble-sep" />
        <button
          type="button"
          className="kn-bubble-btn"
          title="顏色"
          onClick={(e) => {
            setSubAnchor(rectFromDOMRect(e.currentTarget.getBoundingClientRect()));
            setSub(sub === 'color' ? null : 'color');
          }}
        >
          <Icon name="palette" />
          <Icon name="chevron-down" size={10} />
        </button>
        {onComment ? (
          <FormatButton
            icon="comment"
            title="留言 Ctrl+Shift+M"
            onClick={() => {
              onComment();
              setAnchor(null);
            }}
          />
        ) : null}
        <FormatButton icon="sparkle" title="AI（尚未實作）" onClick={() => toast('AI 動作尚未整合', { kind: 'info' })} />
      </Popover>

      {/* 型別轉換 */}
      <Popover
        anchor={subAnchor}
        open={sub === 'type'}
        onClose={() => setSub(null)}
        placement="bottom-start"
        className="kn-popover--list"
        ariaLabel="轉換成"
      >
        <div className="kn-menu-scroll">
          {convertibleSpecs().map((spec) => (
            <MenuItem
              key={spec.type}
              icon={<Icon name={spec.icon} />}
              label={spec.label}
              hint={spec.shortcut}
              active={spec.type === currentType}
              onSelect={() => {
                onConvert(spec.type);
                setSub(null);
              }}
            />
          ))}
        </div>
      </Popover>

      {/* 顏色 */}
      <Popover
        anchor={subAnchor}
        open={sub === 'color'}
        onClose={() => setSub(null)}
        placement="bottom-start"
        className="kn-popover--list"
        ariaLabel="顏色"
      >
        <div className="kn-menu-scroll">
          <div className="kn-menu-group-title">文字顏色</div>
          {BLOCK_COLORS.map((c) => (
            <MenuItem
              key={c.id}
              icon={<span className="kn-swatch" style={c.cssVar ? { background: `var(${c.cssVar})` } : undefined} />}
              label={c.label}
              onSelect={() => {
                if (c.cssVar) editor.toggleMark({ t: 'color', fg: `var(${c.cssVar})` });
                else {
                  const existing = editor.getActiveMarks().find((m) => m.t === 'color');
                  if (existing) editor.toggleMark(existing);
                }
                setSub(null);
              }}
            />
          ))}
          <div className="kn-menu-group-title">區塊背景色</div>
          {BLOCK_BACKGROUNDS.map((c) => (
            <MenuItem
              key={c.id}
              icon={<span className="kn-swatch" style={c.cssVar ? { background: `var(${c.cssVar})` } : undefined} />}
              label={c.label}
              onSelect={() => {
                onColor(c.id);
                setSub(null);
              }}
            />
          ))}
        </div>
      </Popover>

      {/* 連結輸入 */}
      <Popover
        anchor={anchor}
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        placement="top"
        offset={8}
        className="kn-popover--link"
        role="dialog"
        allowFocus
        ariaLabel="編輯連結"
      >
        <form
          className="kn-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <Icon name="link" size={14} />
          <input
            ref={linkInputRef}
            className="kn-menu-search-input"
            value={linkValue}
            placeholder="貼上連結，或輸入網址"
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setLinkOpen(false);
            }}
          />
          <button type="submit" className="kn-btn kn-btn--primary kn-btn--sm">
            套用
          </button>
        </form>
      </Popover>
    </>
  );
}

function FormatButton({
  icon,
  title,
  active,
  onClick,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  title: string;
  active?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className="kn-bubble-btn"
      title={title}
      aria-pressed={active}
      data-active={active ? 'true' : undefined}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}
