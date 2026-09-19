/**
 * 程式碼區塊的 chrome：語言選單、複製鍵、行號、語法高亮層。
 *
 * 高亮做法（不動 editor-core 的 inline 渲染）：
 *   在 contenteditable 的 <pre> **底下**疊一層 aria-hidden 的高亮副本，
 *   兩層共用同一組字型 / 行高 / padding / white-space，所以字元位置完全對齊；
 *   上層的文字設成透明，caret 與 ::selection 仍由瀏覽器正常繪製。
 *   這樣 editor-core 對 DOM 的唯一真相不受影響（高亮層沒有 data-block-content）。
 */
import { useMemo, useRef, useState } from 'react';
import { toPlainText } from '@kennote/editor-core';
import type { BlockRendererProps } from '../context';
import { CODE_LANGUAGES, countLines, languageLabel, normalizeLanguage, tokenize } from '../lib/highlight';
import { Icon } from '../ui/icons';
import { MenuItem, Popover } from '../ui/overlay';
import { rectFromDOMRect, type RectLike } from '../lib/floating';
import { toast } from '../ui/toast';

export function CodeChrome({ block, host }: BlockRendererProps) {
  const props = block.props as { language?: string; wrap?: boolean; lineNumbers?: boolean };
  const language = normalizeLanguage(props.language);
  const code = toPlainText(block.content);
  const [menuAnchor, setMenuAnchor] = useState<RectLike | null>(null);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const tokens = useMemo(() => tokenize(code, language), [code, language]);
  const lineCount = useMemo(() => countLines(code), [code]);

  const languages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CODE_LANGUAGES;
    return CODE_LANGUAGES.filter((l) => l.id.includes(q) || l.label.toLowerCase().includes(q));
  }, [query]);

  return (
    <>
      {/* 高亮層：純視覺，aria-hidden，不接受指標事件 */}
      <pre className="kn-code-highlight" aria-hidden="true" data-wrap={props.wrap ? 'true' : undefined}>
        <code>
          {tokens.map((token, i) => (
            <span key={i} className={`kn-tok kn-tok--${token.type}`}>
              {token.text}
            </span>
          ))}
          {'\n'}
        </code>
      </pre>

      {props.lineNumbers ? (
        <div className="kn-code-gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
      ) : null}

      <div className="kn-code-toolbar" contentEditable={false}>
        <button
          type="button"
          className="kn-code-lang"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            setQuery('');
            setMenuAnchor(rectFromDOMRect(e.currentTarget.getBoundingClientRect()));
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
        >
          {languageLabel(language)}
          <Icon name="chevron-down" size={12} />
        </button>
        <button
          type="button"
          title="顯示行號"
          data-active={props.lineNumbers ? 'true' : undefined}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => host.updateProps(block.id, { ...props, lineNumbers: !props.lineNumbers })}
        >
          <Icon name="list-numbered" size={14} />
        </button>
        <button
          type="button"
          title="自動換行"
          data-active={props.wrap ? 'true' : undefined}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => host.updateProps(block.id, { ...props, wrap: !props.wrap })}
        >
          <Icon name="text" size={14} />
        </button>
        <button
          type="button"
          title="複製程式碼"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(code)
              .then(() => toast('已複製程式碼', { kind: 'success' }))
              .catch(() => toast('複製失敗', { kind: 'error' }));
          }}
        >
          <Icon name="copy" size={14} />
        </button>
      </div>

      <Popover
        anchor={menuAnchor}
        open={menuAnchor !== null}
        onClose={() => setMenuAnchor(null)}
        placement="bottom-end"
        className="kn-popover--list"
        allowFocus
        ariaLabel="選擇語言"
      >
        <div className="kn-menu-search">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            className="kn-menu-search-input"
            value={query}
            placeholder="搜尋語言…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && languages[0]) {
                host.updateProps(block.id, { ...props, language: languages[0].id });
                setMenuAnchor(null);
              }
            }}
          />
        </div>
        <div className="kn-menu-scroll">
          {languages.map((l) => (
            <MenuItem
              key={l.id}
              label={l.label}
              active={l.id === language}
              hint={l.id === language ? <Icon name="check" size={13} /> : undefined}
              onSelect={() => {
                host.updateProps(block.id, { ...props, language: l.id });
                setMenuAnchor(null);
              }}
            />
          ))}
          {languages.length === 0 ? <div className="kn-menu-empty">找不到語言</div> : null}
        </div>
      </Popover>
    </>
  );
}
