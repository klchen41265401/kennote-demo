/**
 * 結構 / 進階 block 的 React renderer：
 * page（子頁面）、column（多欄）、table（簡易表格）、tableOfContents、equation、collectionView。
 *
 * 一樣的紀律：資料一律經 host.* → Operation；DOM 只讀不寫（唯一例外是
 * EquationBlock 把我們自己產生的 MathML 字串塞進容器，理由見 lib/mathml.ts）。
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { flattenDoc, toPlainText } from '@kennote/editor-core';
import type { Operation } from '@kennote/shared-types';
import { plainTextToRichText, richTextToPlainText } from '@kennote/shared-types';
import type { BlockRendererProps } from '../context';
import { latexToMathML } from '../lib/mathml';
import { getInlineDatabaseComponent } from '../blocks/externalRegistry';
import { Icon } from '../ui/icons';
import { Menu, MenuItem, MenuSeparator, useContextMenu } from '@kennote/ui';
import { useWorkspaceTree } from '../../../lib/queries';
import { usePeekNavigation } from '../../peek/peek-url';

/* ── 子頁面 ────────────────────────────────────────────── */

export function PageLinkBlock({ block, host }: BlockRendererProps) {
  const props = block.props as { pageId?: string | null };
  const tree = useWorkspaceTree(host.workspaceId);
  const node = props.pageId ? tree.data?.find((n) => n.id === props.pageId) : undefined;
  const fallbackTitle = toPlainText(block.content) || '未命名';
  /* B-4：頁面連結要能「以側邊預覽打開」（右鍵 / hover 的小按鈕都給一份）。
     Alt+Click 是 Notion 的捷徑，選單裡也寫著。 */
  const ctx = useContextMenu();
  const peekNav = usePeekNavigation();

  if (!props.pageId) {
    return (
      <button
        type="button"
        className="kn-page-link kn-page-link--empty"
        onClick={() => host.createSubPage(block.id)}
      >
        <Icon name="plus" />
        <span>建立子頁面</span>
      </button>
    );
  }

  const pageId = props.pageId;

  return (
    <span className="kn-page-link-wrap">
      <button
        type="button"
        className="kn-page-link"
        onClick={(e) => {
          // Alt+Click = 以側邊預覽打開（Notion 的捷徑）
          if (e.altKey) {
            e.preventDefault();
            peekNav.open(pageId, 'side');
            return;
          }
          host.navigateToPage(pageId);
        }}
        onContextMenu={ctx.onContextMenu}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="kn-page-link-icon">{node?.icon ?? '📄'}</span>
        <span className="kn-page-link-title">{node?.title || fallbackTitle}</span>
      </button>
      <button
        type="button"
        className="kn-page-link-peek"
        aria-label="以側邊預覽打開"
        title="以側邊預覽打開"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => peekNav.open(pageId, 'side')}
      >
        <Icon name="expand" />
      </button>
      {ctx.anchor && (
        <Menu anchor={ctx.anchor} open={ctx.open} onOpenChange={ctx.setOpen} placement="bottom-start">
          <MenuItem shortcut="alt+click" onSelect={() => peekNav.open(pageId, 'side')}>
            以側邊預覽打開
          </MenuItem>
          <MenuItem onSelect={() => peekNav.open(pageId, 'center')}>以置中預覽打開</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => host.navigateToPage(pageId)}>以完整頁面開啟</MenuItem>
        </Menu>
      )}
    </span>
  );
}

/* ── 多欄版面 ──────────────────────────────────────────── */

export function ColumnBlock({ block, host, container }: BlockRendererProps) {
  const ratio = typeof block.props.ratio === 'number' ? (block.props.ratio as number) : 0;
  const blockRoot = container.closest('[data-block-id]') as HTMLElement | null;

  // flex-basis 是純視覺，透過 CSS 變數掛在 block 根元素上（不影響 model）
  useEffect(() => {
    if (!blockRoot) return;
    if (ratio > 0) blockRoot.style.setProperty('--kn-column-ratio', String(ratio));
    else blockRoot.style.removeProperty('--kn-column-ratio');
  }, [blockRoot, ratio]);

  const startDrag = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    if (!blockRoot) return;
    const parent = blockRoot.parentElement;
    if (!parent) return;
    event.preventDefault();
    event.stopPropagation();

    const siblings = [...parent.children].filter((el) => el.hasAttribute('data-block-id')) as HTMLElement[];
    const index = siblings.indexOf(blockRoot);
    const nextEl = siblings[index + 1];
    if (!nextEl) return;

    const total = blockRoot.getBoundingClientRect().width + nextEl.getBoundingClientRect().width;
    const startX = event.clientX;
    const startWidth = blockRoot.getBoundingClientRect().width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);

    const nextId = nextEl.getAttribute('data-block-id');
    let ratioA = startWidth / total;

    const onMove = (e: PointerEvent): void => {
      const width = Math.max(total * 0.15, Math.min(total * 0.85, startWidth + (e.clientX - startX)));
      ratioA = width / total;
      blockRoot.style.setProperty('--kn-column-ratio', String(ratioA));
      nextEl.style.setProperty('--kn-column-ratio', String(1 - ratioA));
    };
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      const ops: Operation[] = [
        { type: 'block.update', blockId: block.id, patch: { props: { ratio: round3(ratioA) } } },
      ];
      if (nextId) ops.push({ type: 'block.update', blockId: nextId, patch: { props: { ratio: round3(1 - ratioA) } } });
      host.applyOps(ops);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  if (host.readOnly) return null;
  return <span className="kn-column-resizer" role="separator" aria-label="調整欄寬" onPointerDown={startDrag} />;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/* ── 簡易表格 ──────────────────────────────────────────── */

export function TableBlock({ block, host }: BlockRendererProps) {
  const props = block.props as {
    columnCount?: number;
    hasColumnHeader?: boolean;
    hasRowHeader?: boolean;
  };
  const columnCount = Math.max(1, props.columnCount ?? 2);
  const rows = block.children
    .map((id) => host.getBlock(id))
    .filter((b): b is NonNullable<typeof b> => !!b && b.type === 'tableRow');

  const addRow = (): void => {
    const cells = Array.from({ length: columnCount }, () => []);
    const last = rows[rows.length - 1];
    if (last) host.insertAfter(last.id, { type: 'tableRow', props: { cells } });
    else host.insertAfter(block.id, { type: 'tableRow', props: { cells }, asChild: true });
  };

  const addColumn = (): void => {
    const ops: Operation[] = [
      { type: 'block.update', blockId: block.id, patch: { props: { ...props, columnCount: columnCount + 1 } } },
    ];
    for (const row of rows) {
      const cells = normalizeCells(row.props.cells, columnCount);
      ops.push({ type: 'block.update', blockId: row.id, patch: { props: { ...row.props, cells: [...cells, []] } } });
    }
    host.applyOps(ops);
  };

  const removeColumn = (index: number): void => {
    if (columnCount <= 1) return;
    const ops: Operation[] = [
      { type: 'block.update', blockId: block.id, patch: { props: { ...props, columnCount: columnCount - 1 } } },
    ];
    for (const row of rows) {
      const cells = normalizeCells(row.props.cells, columnCount).filter((_, i) => i !== index);
      ops.push({ type: 'block.update', blockId: row.id, patch: { props: { ...row.props, cells } } });
    }
    host.applyOps(ops);
  };

  const setCell = (rowId: string, index: number, text: string): void => {
    const row = host.getBlock(rowId);
    if (!row) return;
    const cells = normalizeCells(row.props.cells, columnCount);
    const current = richTextToPlainText(cells[index] as never);
    if (current === text) return;
    cells[index] = plainTextToRichText(text) as never;
    host.updateProps(rowId, { ...row.props, cells });
  };

  if (rows.length === 0) {
    return (
      <div className="kn-table-empty">
        <button type="button" className="kn-btn" onClick={addRow}>
          <Icon name="plus" /> 建立表格列
        </button>
      </div>
    );
  }

  return (
    <div className="kn-table-wrap">
      <table className="kn-table" data-column-header={props.hasColumnHeader ? 'true' : undefined} data-row-header={props.hasRowHeader ? 'true' : undefined}>
        <tbody>
          {rows.map((row, rowIndex) => {
            const cells = normalizeCells(row.props.cells, columnCount);
            return (
              <tr key={row.id}>
                {cells.map((cell, colIndex) => (
                  <TableCell
                    key={colIndex}
                    text={richTextToPlainText(cell as never)}
                    header={(props.hasColumnHeader && rowIndex === 0) || (props.hasRowHeader && colIndex === 0)}
                    readOnly={host.readOnly}
                    onCommit={(text) => setCell(row.id, colIndex, text)}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {host.readOnly ? null : (
        <div className="kn-table-actions">
          <button type="button" onClick={addRow} title="新增一列">
            <Icon name="plus" /> 列
          </button>
          <button type="button" onClick={addColumn} title="新增一欄">
            <Icon name="plus" /> 欄
          </button>
          <button type="button" onClick={() => removeColumn(columnCount - 1)} title="移除最後一欄">
            <Icon name="close" /> 欄
          </button>
          <button
            type="button"
            data-active={props.hasColumnHeader ? 'true' : undefined}
            onClick={() => host.updateProps(block.id, { ...props, hasColumnHeader: !props.hasColumnHeader })}
          >
            標題列
          </button>
          <button
            type="button"
            data-active={props.hasRowHeader ? 'true' : undefined}
            onClick={() => host.updateProps(block.id, { ...props, hasRowHeader: !props.hasRowHeader })}
          >
            標題欄
          </button>
        </div>
      )}
    </div>
  );
}

function normalizeCells(raw: unknown, columnCount: number): unknown[] {
  const cells = Array.isArray(raw) ? [...(raw as unknown[])] : [];
  while (cells.length < columnCount) cells.push([]);
  return cells.slice(0, Math.max(columnCount, cells.length));
}

function TableCell({
  text,
  header,
  readOnly,
  onCommit,
}: {
  text: string;
  header?: boolean;
  readOnly: boolean;
  onCommit(text: string): void;
}) {
  const ref = useRef<HTMLTableCellElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused && ref.current && ref.current.textContent !== text) ref.current.textContent = text;
  }, [text, focused]);

  const Tag = header ? 'th' : 'td';
  return (
    <Tag
      ref={ref as never}
      className="kn-table-cell"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      onFocus={() => setFocused(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
      }}
      onBlur={(e) => {
        setFocused(false);
        onCommit(e.currentTarget.textContent ?? '');
      }}
    />
  );
}

/* ── 目錄 ──────────────────────────────────────────────── */

const HEADING_LEVEL: Record<string, number> = { heading1: 1, heading2: 2, heading3: 3 };

export function TableOfContentsBlock({ host }: BlockRendererProps) {
  const entries = useMemo(() => {
    const out: { id: string; level: number; text: string }[] = [];
    for (const id of flattenDoc(host.doc)) {
      const b = host.doc.blocks[id];
      if (!b) continue;
      const level = HEADING_LEVEL[b.type];
      if (!level) continue;
      out.push({ id, level, text: toPlainText(b.content) || '未命名標題' });
    }
    return out;
    // rev 變動代表 doc 有更新
  }, [host.doc, host.rev]);

  if (entries.length === 0) {
    return <div className="kn-toc kn-toc--empty">這一頁還沒有標題，加入標題後目錄會自動出現。</div>;
  }

  return (
    <nav className="kn-toc" aria-label="目錄">
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="kn-toc-item"
          data-level={entry.level}
          onClick={() => {
            const el = document.querySelector(`[data-block-id="${entry.id}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            host.focus(entry.id, 0);
          }}
        >
          {entry.text}
        </button>
      ))}
    </nav>
  );
}

/* ── 數學公式 ──────────────────────────────────────────── */

export function EquationBlock({ block, host }: BlockRendererProps) {
  const expression = String((block.props as { expression?: unknown }).expression ?? '');
  const [editing, setEditing] = useState(expression === '');
  const [draft, setDraft] = useState(expression);
  const mathRef = useRef<HTMLDivElement>(null);

  const mathml = useMemo(() => latexToMathML(expression, true), [expression]);

  useEffect(() => {
    const el = mathRef.current;
    if (!el) return;
    // 只塞我們自己產生（且已 escape）的 MathML 字串，沒有外部 HTML
    el.innerHTML = mathml ?? '';
  }, [mathml]);

  useEffect(() => {
    setDraft(expression);
  }, [expression]);

  if (editing && !host.readOnly) {
    return (
      <form
        className="kn-equation-editor"
        onSubmit={(e) => {
          e.preventDefault();
          host.updateProps(block.id, { expression: draft });
          setEditing(false);
        }}
      >
        <textarea
          className="kn-input kn-input--mono"
          value={draft}
          autoFocus
          rows={2}
          placeholder="輸入 LaTeX，例如 \\frac{a}{b} 或 E = mc^2"
          onChange={(e) => setDraft(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              host.updateProps(block.id, { expression: draft });
              setEditing(false);
            }
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <div className="kn-equation-hint">
          支援 LaTeX 子集（上下標、\\frac、\\sqrt、希臘字母、常見運算子）。不支援的語法會原樣顯示。
        </div>
      </form>
    );
  }

  return (
    <div
      className="kn-equation"
      role="button"
      tabIndex={0}
      onClick={() => !host.readOnly && setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') setEditing(true);
      }}
    >
      {mathml ? <div ref={mathRef} className="kn-equation-math" /> : <code className="kn-equation-raw">{`$${expression}$`}</code>}
    </div>
  );
}

/* ── 內嵌資料庫 ────────────────────────────────────────── */

export function CollectionViewBlock({ block, host }: BlockRendererProps) {
  const props = block.props as { collectionId?: string | null; viewIds?: string[] };
  const InlineDatabase = getInlineDatabaseComponent();

  if (InlineDatabase && props.collectionId) {
    return (
      <InlineDatabase
        collectionId={props.collectionId}
        viewIds={props.viewIds ?? []}
        blockId={block.id}
        onChange={(patch) => host.updateProps(block.id, { ...props, ...patch })}
      />
    );
  }

  return (
    <div className="kn-collection-placeholder">
      <Icon name="database" />
      <div>
        <p className="kn-collection-placeholder-title">內嵌資料庫</p>
        <p className="kn-collection-placeholder-desc">
          {props.collectionId
            ? '資料庫模組尚未載入（features/database 由另一位代理負責）。'
            : '尚未連結資料庫。'}
        </p>
      </div>
      {props.collectionId ? null : (
        <button type="button" className="kn-btn kn-btn--primary" onClick={() => void host.createInlineDatabase(block.id)}>
          建立資料庫
        </button>
      )}
    </div>
  );
}
