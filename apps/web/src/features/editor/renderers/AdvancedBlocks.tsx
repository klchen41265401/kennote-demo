/**
 * 進階 block 的 React renderer：audio / pdf / breadcrumb / button / syncedBlock。
 *
 * 一樣的紀律（README §2 兩條紅線）：
 *   - 資料一律經 `host.*` → Operation，renderer 不直接改 DOM、不直接打寫入 API
 *   - 上傳只能走 `host.upload()`
 */
import { useEffect, useMemo, useState } from 'react';
import { toPlainText } from '@kennote/editor-core';
import type { Block as CoreBlock } from '@kennote/editor-core';
import type { PageSnapshot } from '@kennote/shared-types';
import type { Operation } from '@kennote/editor-core';
import type { BlockRendererProps } from '../context';
import { MediaPanel, Caption, useUpload } from './MediaBlocks';
import { Icon } from '../ui/icons';
import { toast } from '../ui/toast';
import { resolveMediaUrl, formatBytes } from '../../../lib/upload';
import { safeHref } from '../lib/embed';
import { usePageSnapshot, useWorkspaceTree } from '../../../lib/queries';

/* ── 音訊 ──────────────────────────────────────────────── */

export function AudioBlock({ block, host }: BlockRendererProps) {
  const props = block.props as { fileId?: string | null; externalUrl?: string | null; name?: string; size?: number };
  const src = resolveMediaUrl(props);
  const { progress, run } = useUpload(host, block.id);

  if (!src) {
    return (
      <MediaPanel
        icon={<Icon name="audio" />}
        label="新增音訊"
        accept="audio/*"
        urlPlaceholder="貼上音訊網址（.mp3 / .wav / .m4a）…"
        progress={progress}
        disabled={host.readOnly}
        onFile={(file) =>
          void run(file, (meta) =>
            host.updateProps(block.id, { fileId: meta.id, externalUrl: null, name: meta.name, size: meta.size }),
          )
        }
        onUrl={(url) =>
          host.updateProps(block.id, { externalUrl: url, fileId: null, name: url.split('/').pop() ?? url })
        }
      />
    );
  }

  return (
    <figure className="kn-audio">
      <div className="kn-audio-head">
        <Icon name="audio" />
        <span className="kn-audio-name">{props.name ?? '音訊'}</span>
        {typeof props.size === 'number' ? <span className="kn-audio-size">{formatBytes(props.size)}</span> : null}
      </div>
      {/* 說明文字由下面的 <Caption> 提供，不需要 <track> */}
      <audio src={src} controls preload="metadata" onPointerDown={(e) => e.stopPropagation()} />
      <Caption block={block} host={host} />
    </figure>
  );
}

/* ── PDF ───────────────────────────────────────────────── */

export function PdfBlock({ block, host }: BlockRendererProps) {
  const props = block.props as {
    fileId?: string | null;
    externalUrl?: string | null;
    name?: string;
    size?: number;
    height?: number;
  };
  const src = resolveMediaUrl(props);
  const { progress, run } = useUpload(host, block.id);

  if (!src) {
    return (
      <MediaPanel
        icon={<Icon name="pdf" />}
        label="新增 PDF"
        accept="application/pdf,.pdf"
        urlPlaceholder="貼上 PDF 網址…"
        progress={progress}
        disabled={host.readOnly}
        onFile={(file) =>
          void run(file, (meta) =>
            host.updateProps(block.id, { fileId: meta.id, externalUrl: null, name: meta.name, size: meta.size }),
          )
        }
        onUrl={(url) =>
          host.updateProps(block.id, { externalUrl: url, fileId: null, name: url.split('/').pop() ?? url })
        }
      />
    );
  }

  const href = safeHref(src) ?? src;
  return (
    <figure className="kn-pdf">
      <div className="kn-pdf-head">
        <Icon name="pdf" />
        <span className="kn-pdf-name">{props.name ?? 'PDF'}</span>
        <a className="kn-pdf-open" href={href} target="_blank" rel="noopener noreferrer">
          在新分頁開啟
        </a>
      </div>
      {/*
        PDF 用 <object> 而不是 <iframe>：瀏覽器內建的 PDF viewer 走的是
        plugin 通道，沒有 iframe 的 same-origin 疑慮；讀不到時 fallback 成下載連結。
      */}
      <object
        className="kn-pdf-frame"
        data={href}
        type="application/pdf"
        style={{ height: props.height ?? 480 }}
        aria-label={props.name ?? 'PDF 預覽'}
      >
        <a href={href} target="_blank" rel="noopener noreferrer">
          這個瀏覽器不支援內嵌 PDF，點此開啟
        </a>
      </object>
      <Caption block={block} host={host} />
    </figure>
  );
}

/* ── 頁面路徑（麵包屑）───────────────────────────────── */

export function BreadcrumbBlock({ host }: BlockRendererProps) {
  const tree = useWorkspaceTree(host.workspaceId);
  const trail = useMemo(() => {
    const nodes = tree.data ?? [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const out: { id: string; title: string; icon: string | null }[] = [];
    let current = byId.get(host.pageId);
    let guard = 0;
    while (current && guard < 32) {
      out.unshift({
        id: current.id,
        title: current.title || '未命名',
        icon: typeof current.icon === 'string' ? current.icon : null,
      });
      current = current.parentId ? byId.get(current.parentId) : undefined;
      guard += 1;
    }
    return out;
  }, [tree.data, host.pageId]);

  if (trail.length === 0) {
    return <div className="kn-breadcrumb kn-breadcrumb--empty">頁面路徑（載入中…）</div>;
  }

  return (
    <nav className="kn-breadcrumb" aria-label="頁面路徑">
      {trail.map((node, index) => (
        <span key={node.id} className="kn-breadcrumb-part">
          {index > 0 ? <span className="kn-breadcrumb-sep">/</span> : null}
          <button
            type="button"
            className="kn-breadcrumb-item"
            data-current={node.id === host.pageId ? 'true' : undefined}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => host.navigateToPage(node.id)}
          >
            {node.icon ? <span className="kn-breadcrumb-icon">{node.icon}</span> : null}
            {node.title}
          </button>
        </span>
      ))}
    </nav>
  );
}

/* ── 按鈕 ──────────────────────────────────────────────── */

interface TemplateBlock {
  type: string;
  props?: Record<string, unknown>;
  content?: { text: string }[];
  children?: TemplateBlock[];
}

type ButtonActionData =
  | { type: 'insertBlocks'; blocks: TemplateBlock[]; position?: 'after' | 'pageEnd' }
  | { type: 'openPage'; pageId: string | null };

/**
 * 樣板編輯器用「一行一個 block」的極簡語法，前綴照 markdown：
 *   `# 標題`、`## 標題 2`、`- 項目`、`1. 編號`、`[] 待辦`、`> 摺疊`、`" 引用`
 * 沒有前綴就是一般文字。這比做一個巢狀 block 編輯器便宜太多，而且看得懂。
 */
export function parseTemplate(text: string): TemplateBlock[] {
  const out: TemplateBlock[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') continue;
    const rules: [RegExp, string, Record<string, unknown>?][] = [
      [/^####\s+/, 'heading4'],
      [/^###\s+/, 'heading3'],
      [/^##\s+/, 'heading2'],
      [/^#\s+/, 'heading1'],
      [/^\[[ xX]?\]\s+/, 'todo', { checked: false }],
      [/^[-*+]\s+/, 'bulletedList'],
      [/^\d+[.)]\s+/, 'numberedList'],
      [/^>\s+/, 'toggle', { collapsed: false }],
      [/^"\s+/, 'quote'],
    ];
    let type = 'paragraph';
    let props: Record<string, unknown> | undefined;
    let body = line;
    for (const [pattern, blockType, blockProps] of rules) {
      if (pattern.test(line)) {
        type = blockType;
        props = blockProps;
        body = line.replace(pattern, '');
        break;
      }
    }
    const checked = /^\[[xX]\]\s+/.test(line);
    if (type === 'todo') props = { checked };
    out.push({ type, ...(props ? { props } : {}), content: body ? [{ text: body }] : [] });
  }
  return out;
}

export function templateToText(blocks: TemplateBlock[]): string {
  const prefix: Record<string, string> = {
    heading1: '# ',
    heading2: '## ',
    heading3: '### ',
    heading4: '#### ',
    bulletedList: '- ',
    numberedList: '1. ',
    todo: '[] ',
    toggle: '> ',
    quote: '" ',
  };
  return blocks
    .map((b) => `${prefix[b.type] ?? ''}${(b.content ?? []).map((s) => s.text).join('')}`)
    .join('\n');
}

const DEFAULT_TEMPLATE: TemplateBlock[] = [{ type: 'todo', props: { checked: false }, content: [{ text: '新的待辦事項' }] }];

export function ButtonBlock({ block, host }: BlockRendererProps) {
  const props = block.props as { label?: string; actions?: ButtonActionData[] };
  const actions = props.actions ?? [];
  const [editing, setEditing] = useState(actions.length === 0 && !host.readOnly);
  const [label, setLabel] = useState(props.label ?? '按鈕');
  const insert = actions.find((a) => a.type === 'insertBlocks') as
    | { type: 'insertBlocks'; blocks: TemplateBlock[] }
    | undefined;
  const open = actions.find((a) => a.type === 'openPage') as
    | { type: 'openPage'; pageId: string | null }
    | undefined;
  const [template, setTemplate] = useState(() => templateToText(insert?.blocks ?? DEFAULT_TEMPLATE));
  const [mode, setMode] = useState<'insertBlocks' | 'openPage'>(open ? 'openPage' : 'insertBlocks');
  const [pageId, setPageId] = useState(open?.pageId ?? '');
  const tree = useWorkspaceTree(host.workspaceId);

  useEffect(() => {
    setLabel(props.label ?? '按鈕');
  }, [props.label]);

  const run = (): void => {
    for (const action of actions) {
      if (action.type === 'openPage' && action.pageId) {
        host.navigateToPage(action.pageId);
        continue;
      }
      if (action.type !== 'insertBlocks') continue;
      const ops: Operation[] = [];
      let after: string | null = block.id;
      const emit = (list: TemplateBlock[], parentId: string | null, afterId: string | null): string | null => {
        let cursor = afterId;
        for (const item of list) {
          const id = host.editor.newId();
          ops.push({
            type: 'block.insert',
            blockId: id,
            parentId,
            afterId: cursor,
            blockType: item.type as never,
            props: (item.props ?? {}) as never,
            content: (item.content ?? []) as never,
          });
          cursor = id;
          if (item.children?.length) emit(item.children, id, null);
        }
        return cursor;
      };
      after = emit(action.blocks ?? [], block.parentId, after);
      if (ops.length > 0) host.applyOps(ops);
    }
  };

  const save = (): void => {
    const nextActions: ButtonActionData[] =
      mode === 'openPage'
        ? [{ type: 'openPage', pageId: pageId || null }]
        : [{ type: 'insertBlocks', blocks: parseTemplate(template), position: 'after' }];
    host.updateProps(block.id, { label: label.trim() || '按鈕', actions: nextActions });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="kn-button-config" onPointerDown={(e) => e.stopPropagation()}>
        <label className="kn-field">
          <span className="kn-field-label">按鈕標籤</span>
          <input
            className="kn-input"
            value={label}
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>

        <div className="kn-field">
          <span className="kn-field-label">點擊後</span>
          <div className="kn-segmented" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'insertBlocks'}
              data-active={mode === 'insertBlocks' ? 'true' : undefined}
              onClick={() => setMode('insertBlocks')}
            >
              插入區塊
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'openPage'}
              data-active={mode === 'openPage' ? 'true' : undefined}
              onClick={() => setMode('openPage')}
            >
              開啟頁面
            </button>
          </div>
        </div>

        {mode === 'insertBlocks' ? (
          <label className="kn-field">
            <span className="kn-field-label">樣板（一行一個區塊，可用 # / - / [] / &gt; 前綴）</span>
            <textarea
              className="kn-input kn-input--mono"
              rows={4}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
        ) : (
          <label className="kn-field">
            <span className="kn-field-label">要開啟的頁面</span>
            <select
              className="kn-input"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <option value="">（選擇一頁）</option>
              {(tree.data ?? []).map((node) => (
                <option key={node.id} value={node.id}>
                  {node.title || '未命名'}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="kn-button-config-actions">
          <button type="button" className="kn-btn kn-btn--primary kn-btn--sm" onClick={save}>
            完成
          </button>
          {actions.length > 0 ? (
            <button type="button" className="kn-btn kn-btn--sm" onClick={() => setEditing(false)}>
              取消
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="kn-button-wrap">
      <button
        type="button"
        className="kn-block-button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={run}
      >
        {props.label ?? '按鈕'}
      </button>
      {host.readOnly ? null : (
        <button
          type="button"
          className="kn-button-settings"
          title="設定按鈕"
          aria-label="設定按鈕"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setEditing(true)}
        >
          <Icon name="grip" size={14} />
        </button>
      )}
    </div>
  );
}

/* ── 同步區塊 ──────────────────────────────────────────── */

const SYNC_PREFIX = 'kennote-synced:';

export function SyncedBlock({ block, host, container }: BlockRendererProps) {
  const props = block.props as { syncedFrom?: string | null; syncedFromPageId?: string | null };
  const [linkInput, setLinkInput] = useState('');
  const isReference = Boolean(props.syncedFrom);

  const copyLink = (): void => {
    const token = `${SYNC_PREFIX}${host.pageId}:${block.id}`;
    void navigator.clipboard
      ?.writeText(token)
      .then(() => toast('已複製同步連結，貼到別處的「同步區塊」即可引用', { kind: 'info' }))
      .catch(() => toast('複製失敗，請手動複製：' + token, { kind: 'error' }));
  };

  if (!isReference) {
    return (
      <div className="kn-synced-chrome">
        <span className="kn-synced-badge">
          <Icon name="synced" size={13} /> 同步區塊
        </span>
        {host.readOnly ? null : (
          <div className="kn-synced-tools">
            <button type="button" className="kn-btn kn-btn--sm" onPointerDown={(e) => e.stopPropagation()} onClick={copyLink}>
              複製同步連結
            </button>
            <form
              className="kn-synced-link-form"
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = parseSyncToken(linkInput);
                if (!parsed) {
                  toast('同步連結格式不正確', { kind: 'error' });
                  return;
                }
                host.updateProps(block.id, { syncedFrom: parsed.blockId, syncedFromPageId: parsed.pageId });
                setLinkInput('');
              }}
            >
              <input
                className="kn-input kn-input--sm"
                placeholder="或貼上同步連結以引用…"
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </form>
          </div>
        )}
      </div>
    );
  }

  return <SyncedReference block={block} host={host} container={container} />;
}

export function parseSyncToken(raw: string): { pageId: string; blockId: string } | null {
  const text = raw.trim();
  if (!text.startsWith(SYNC_PREFIX)) return null;
  const [pageId, blockId] = text.slice(SYNC_PREFIX.length).split(':');
  if (!pageId || !blockId) return null;
  return { pageId, blockId };
}

function SyncedReference({ block, host }: BlockRendererProps) {
  const props = block.props as { syncedFrom?: string | null; syncedFromPageId?: string | null };
  const sourceId = props.syncedFrom as string;
  const sourcePageId = props.syncedFromPageId ?? host.pageId;
  const samePage = sourcePageId === host.pageId;
  // 跨頁引用：抓對方的 snapshot 來唯讀渲染（同頁的話直接讀本地 doc，零請求）
  const remote = usePageSnapshot(samePage ? null : sourcePageId);

  const blocks = useMemo<Record<string, CoreBlock> | null>(() => {
    if (samePage) return host.doc.blocks;
    const snapshot = remote.data as PageSnapshot | undefined;
    if (!snapshot) return null;
    const out: Record<string, CoreBlock> = {};
    for (const [id, entry] of Object.entries(snapshot.recordMap.block)) {
      const value = entry?.value as unknown as CoreBlock | undefined;
      if (value) out[id] = value;
    }
    return out;
  }, [samePage, host.doc.blocks, host.rev, remote.data]);

  const source = blocks?.[sourceId];

  return (
    <div className="kn-synced-ref">
      <div className="kn-synced-chrome">
        <span className="kn-synced-badge">
          <Icon name="synced" size={13} /> 同步自其他區塊
        </span>
        <div className="kn-synced-tools">
          <button
            type="button"
            className="kn-btn kn-btn--sm"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => host.navigateToPage(sourcePageId)}
          >
            前往原始區塊
          </button>
          {host.readOnly ? null : (
            <button
              type="button"
              className="kn-btn kn-btn--sm"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => host.updateProps(block.id, { syncedFrom: null, syncedFromPageId: null })}
            >
              取消同步
            </button>
          )}
        </div>
      </div>
      {blocks === null ? (
        <p className="kn-synced-empty">載入原始內容中…</p>
      ) : !source ? (
        <p className="kn-synced-empty">找不到原始區塊（可能已被刪除）。</p>
      ) : (
        <ReadOnlyBlocks ids={source.children} blocks={blocks} />
      )}
    </div>
  );
}

/** 同步引用的唯讀投影：只畫文字類 block（要編輯請去原始區塊） */
function ReadOnlyBlocks({ ids, blocks }: { ids: string[]; blocks: Record<string, CoreBlock> }) {
  return (
    <div className="kn-synced-body">
      {ids.map((id) => {
        const child = blocks[id];
        if (!child) return null;
        const text = toPlainText(child.content);
        return (
          <div key={id} className={`kn-synced-line kn-synced-line--${child.type}`}>
            {child.type === 'todo' ? <span className="kn-synced-check">{child.props.checked ? '☑' : '☐'}</span> : null}
            {child.type === 'bulletedList' ? <span className="kn-synced-check">•</span> : null}
            <span>{text}</span>
            {child.children.length > 0 ? <ReadOnlyBlocks ids={child.children} blocks={blocks} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** 給測試用：同步連結的字串格式 */
export function syncToken(pageId: string, blockId: string): string {
  return `${SYNC_PREFIX}${pageId}:${blockId}`;
}
