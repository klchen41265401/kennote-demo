/**
 * 媒體類 block 的 React renderer：image / video / file / embed / bookmark。
 *
 * 全部透過 `host.updateProps()`（→ block.update op）改資料，
 * 不直接改 DOM、不直接打寫入 API（上傳走 host.upload）。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { plainTextToRichText, richTextToPlainText } from '@kennote/shared-types';
import type { BlockRendererProps } from '../context';
import { formatBytes, resolveMediaUrl } from '../../../lib/upload';
import { domainOf, EMBED_SANDBOX, isDirectVideo, normalizeUrlInput, resolveEmbed, safeHref } from '../lib/embed';
import { embedPlaceholder, getEmbedService } from '../lib/embed-services';
import { Icon } from '../ui/icons';
import { toast } from '../ui/toast';
import { useUploadProgress } from '../blocks/uploadStatus';

/* ── 共用：空狀態 / 上傳面板 ───────────────────────────── */

export interface MediaPanelProps {
  icon: ReactNode;
  label: string;
  accept?: string;
  urlPlaceholder: string;
  allowUpload?: boolean;
  onFile(file: File): void;
  onUrl(url: string): void;
  progress: number | null;
  disabled?: boolean;
  /** 「上傳」分頁的按鈕文字（預設「選擇檔案」） */
  uploadLabel?: string;
  /** 「嵌入連結」分頁的送出按鈕文字（預設「嵌入」） */
  submitLabel?: string;
}

export function MediaPanel({
  icon,
  label,
  accept,
  urlPlaceholder,
  allowUpload = true,
  onFile,
  onUrl,
  progress,
  disabled,
  uploadLabel = '選擇檔案',
  submitLabel = '嵌入',
}: MediaPanelProps) {
  const [tab, setTab] = useState<'upload' | 'url'>(allowUpload ? 'upload' : 'url');
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  if (progress !== null) {
    return (
      <div className="kn-media-panel kn-media-panel--busy">
        <div className="kn-media-progress">
          <div className="kn-media-progress-bar" style={{ width: `${progress}%` }} />
        </div>
        <span className="kn-media-progress-text">上傳中… {progress}%</span>
      </div>
    );
  }

  return (
    <div
      className="kn-media-panel"
      data-drag-over={dragOver ? 'true' : undefined}
      onDragOver={(e) => {
        if (!allowUpload) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!allowUpload) return;
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
    >
      <div className="kn-media-panel-head">
        <span className="kn-media-panel-icon">{icon}</span>
        <span className="kn-media-panel-label">{label}</span>
      </div>
      <div className="kn-media-panel-tabs" role="tablist">
        {allowUpload ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'upload'}
            data-active={tab === 'upload' ? 'true' : undefined}
            onClick={() => setTab('upload')}
          >
            上傳
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'url'}
          data-active={tab === 'url' ? 'true' : undefined}
          onClick={() => setTab('url')}
        >
          嵌入連結
        </button>
      </div>

      {tab === 'upload' ? (
        <div className="kn-media-panel-body">
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="kn-btn kn-btn--primary"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {uploadLabel}
          </button>
          <p className="kn-media-panel-hint">或把檔案拖進這個區塊</p>
        </div>
      ) : (
        <form
          className="kn-media-panel-body"
          onSubmit={(e) => {
            e.preventDefault();
            const value = normalizeUrlInput(url);
            if (!value) return;
            if (!safeHref(value)) {
              toast('網址格式不正確（只接受 http / https）', { kind: 'error' });
              return;
            }
            onUrl(value);
            setUrl('');
          }}
        >
          <input
            className="kn-input"
            value={url}
            placeholder={urlPlaceholder}
            onChange={(e) => setUrl(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
          />
          <button type="submit" className="kn-btn kn-btn--primary">
            {submitLabel}
          </button>
        </form>
      )}
    </div>
  );
}

/* ── 共用：說明文字 ────────────────────────────────────── */

export function Caption({ block, host }: Pick<BlockRendererProps, 'block' | 'host'>) {
  const raw = (block.props as { caption?: unknown }).caption;
  const text = richTextToPlainText(Array.isArray(raw) ? (raw as never) : []);
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing && ref.current && ref.current.textContent !== text) {
      ref.current.textContent = text;
    }
  }, [text, editing]);

  if (!text && !editing) {
    return (
      <button
        type="button"
        className="kn-caption-add"
        onClick={() => {
          setEditing(true);
          requestAnimationFrame(() => ref.current?.focus());
        }}
      >
        新增說明文字
      </button>
    );
  }

  return (
    <div
      ref={ref}
      className="kn-caption"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="說明文字"
      data-placeholder="輸入說明文字"
      onFocus={() => setEditing(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        setEditing(false);
        host.updateProps(block.id, { caption: plainTextToRichText(e.currentTarget.textContent ?? '') });
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/* ── 共用：上傳 hook ───────────────────────────────────── */

export function useUpload(host: BlockRendererProps['host'], blockId: string) {
  const [progress, setProgress] = useState<number | null>(null);
  // 貼上 / 拖放的上傳是在 Editor 層啟動的，進度從共用 store 來
  const external = useUploadProgress(blockId);
  const run = useCallback(
    async (file: File, apply: (meta: { id: string; url: string; name: string; size: number }) => void) => {
      setProgress(0);
      try {
        const meta = await host.upload(file, setProgress);
        apply(meta);
      } catch (error) {
        toast(error instanceof Error ? error.message : '上傳失敗', { kind: 'error' });
      } finally {
        setProgress(null);
      }
    },
    [host],
  );
  return { progress: progress ?? external, run };
}

/* ── image ─────────────────────────────────────────────── */

const MIN_IMAGE_WIDTH = 120;

export function ImageBlock({ block, host }: BlockRendererProps) {
  const props = block.props as {
    fileId?: string | null;
    externalUrl?: string | null;
    width?: number;
    alignment?: 'left' | 'center' | 'right';
    altText?: string;
  };
  const src = resolveMediaUrl(props);
  const { progress, run } = useUpload(host, block.id);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const startResize = (event: ReactPointerEvent, side: 'left' | 'right'): void => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = wrapRef.current?.querySelector('img')?.getBoundingClientRect().width ?? 400;
    const maxWidth = wrapRef.current?.getBoundingClientRect().width ?? 700;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const onMove = (e: PointerEvent): void => {
      const delta = side === 'right' ? e.clientX - startX : startX - e.clientX;
      const next = Math.max(MIN_IMAGE_WIDTH, Math.min(maxWidth, startWidth + delta * (props.alignment === 'center' ? 2 : 1)));
      setDragWidth(Math.round(next));
    };
    const onUp = (): void => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      setDragWidth((current) => {
        if (current !== null) host.updateProps(block.id, { width: current });
        return null;
      });
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  if (!src) {
    return (
      <MediaPanel
        icon={<Icon name="image" />}
        label="新增圖片"
        accept="image/*"
        urlPlaceholder="貼上圖片網址…"
        progress={progress}
        disabled={host.readOnly}
        onFile={(file) => void run(file, (meta) => host.updateProps(block.id, { fileId: meta.id, externalUrl: null }))}
        onUrl={(url) => host.updateProps(block.id, { externalUrl: url, fileId: null })}
      />
    );
  }

  const width = dragWidth ?? props.width;

  return (
    <figure className="kn-image" data-align={props.alignment ?? 'left'} ref={wrapRef}>
      <div className="kn-image-frame" style={width ? { width } : undefined}>
        <img src={src} alt={props.altText ?? ''} loading="lazy" draggable={false} />
        {host.readOnly ? null : (
          <>
            <span
              className="kn-resize-handle kn-resize-handle--left"
              role="separator"
              aria-label="調整寬度"
              onPointerDown={(e) => startResize(e, 'left')}
            />
            <span
              className="kn-resize-handle kn-resize-handle--right"
              role="separator"
              aria-label="調整寬度"
              onPointerDown={(e) => startResize(e, 'right')}
            />
            <div className="kn-media-toolbar">
              {(['left', 'center', 'right'] as const).map((align) => (
                <button
                  key={align}
                  type="button"
                  title={align === 'left' ? '靠左' : align === 'center' ? '置中' : '靠右'}
                  data-active={(props.alignment ?? 'left') === align ? 'true' : undefined}
                  onClick={() => host.updateProps(block.id, { alignment: align })}
                >
                  <Icon name={`align-${align}`} />
                </button>
              ))}
              <button type="button" title="移除圖片" onClick={() => host.updateProps(block.id, { fileId: null, externalUrl: null })}>
                <Icon name="close" />
              </button>
            </div>
          </>
        )}
      </div>
      <Caption block={block} host={host} />
    </figure>
  );
}

/* ── video ─────────────────────────────────────────────── */

export function VideoBlock({ block, host }: BlockRendererProps) {
  const props = block.props as { fileId?: string | null; externalUrl?: string | null };
  const src = resolveMediaUrl(props);
  const { progress, run } = useUpload(host, block.id);

  if (!src) {
    return (
      <MediaPanel
        icon={<Icon name="video" />}
        label="新增影片"
        accept="video/*"
        urlPlaceholder="貼上 YouTube / Vimeo 網址…"
        progress={progress}
        disabled={host.readOnly}
        onFile={(file) => void run(file, (meta) => host.updateProps(block.id, { fileId: meta.id, externalUrl: null }))}
        onUrl={(url) => host.updateProps(block.id, { externalUrl: url, fileId: null })}
      />
    );
  }

  const embed = props.externalUrl ? resolveEmbed(props.externalUrl) : null;
  return (
    <figure className="kn-video">
      {embed ? (
        <div className="kn-embed-frame" style={{ aspectRatio: String(embed.aspectRatio ?? 16 / 9) }}>
          <iframe src={embed.src} title={embed.provider} sandbox={EMBED_SANDBOX} allow={embed.allow} loading="lazy" />
        </div>
      ) : isDirectVideo(src) || props.fileId ? (
        <video src={src} controls preload="metadata" />
      ) : (
        <UnsupportedCard url={props.externalUrl ?? src} />
      )}
      <Caption block={block} host={host} />
    </figure>
  );
}

/* ── file ──────────────────────────────────────────────── */

export function FileBlock({ block, host }: BlockRendererProps) {
  const props = block.props as {
    fileId?: string | null;
    externalUrl?: string | null;
    name?: string;
    size?: number;
  };
  const src = resolveMediaUrl(props);
  const { progress, run } = useUpload(host, block.id);

  if (!src) {
    return (
      <MediaPanel
        icon={<Icon name="file" />}
        label="新增檔案"
        urlPlaceholder="貼上檔案網址…"
        progress={progress}
        disabled={host.readOnly}
        onFile={(file) =>
          void run(file, (meta) =>
            host.updateProps(block.id, { fileId: meta.id, externalUrl: null, name: meta.name, size: meta.size }),
          )
        }
        onUrl={(url) => host.updateProps(block.id, { externalUrl: url, fileId: null, name: url.split('/').pop() ?? url })}
      />
    );
  }

  return (
    <div className="kn-file">
      <span className="kn-file-icon">
        <Icon name="file" />
      </span>
      <span className="kn-file-meta">
        <span className="kn-file-name">{props.name ?? '未命名檔案'}</span>
        {typeof props.size === 'number' ? <span className="kn-file-size">{formatBytes(props.size)}</span> : null}
      </span>
      <a className="kn-file-download" href={src} download={props.name ?? ''} title="下載">
        <Icon name="download" />
      </a>
    </div>
  );
}

/* ── embed ─────────────────────────────────────────────── */

export function EmbedBlock({ block, host }: BlockRendererProps) {
  const props = block.props as { url?: string; height?: number; service?: string };
  const service = getEmbedService(props.service);
  if (!props.url) {
    return (
      <MediaPanel
        icon={service?.icon ? <Icon name={service.icon} /> : <Icon name="embed" />}
        label={service ? `嵌入 ${service.label}` : '嵌入內容'}
        urlPlaceholder={embedPlaceholder(service)}
        allowUpload={false}
        progress={null}
        disabled={host.readOnly}
        onFile={() => undefined}
        onUrl={(url) => host.updateProps(block.id, { url })}
      />
    );
  }
  const embed = resolveEmbed(props.url);
  if (!embed) return <UnsupportedCard url={props.url} />;

  return (
    <figure className="kn-embed">
      <div
        className="kn-embed-frame"
        style={props.height ? { height: props.height } : { aspectRatio: String(embed.aspectRatio ?? 16 / 9) }}
      >
        <iframe src={embed.src} title={embed.provider} sandbox={EMBED_SANDBOX} allow={embed.allow} loading="lazy" />
      </div>
      <Caption block={block} host={host} />
    </figure>
  );
}

export function UnsupportedCard({ url }: { url: string }) {
  const href = safeHref(url);
  return (
    <div className="kn-embed-unsupported">
      <Icon name="embed" />
      <div>
        <p>這個網域不在嵌入白名單內，已改為顯示連結。</p>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {url}
          </a>
        ) : (
          <span>{url}</span>
        )}
      </div>
    </div>
  );
}

/* ── bookmark ──────────────────────────────────────────── */

export function BookmarkBlock({ block, host }: BlockRendererProps) {
  const props = block.props as {
    url?: string;
    meta?: { title?: string; description?: string; faviconUrl?: string; coverUrl?: string; status?: string };
  };
  if (!props.url) {
    return (
      <MediaPanel
        icon={<Icon name="bookmark" />}
        label="建立書籤"
        urlPlaceholder="貼上網址…"
        allowUpload={false}
        progress={null}
        disabled={host.readOnly}
        onFile={() => undefined}
        onUrl={(url) => host.updateProps(block.id, { url })}
      />
    );
  }

  const href = safeHref(props.url);
  const domain = domainOf(props.url);
  const meta = props.meta ?? {};

  return (
    <a
      className="kn-bookmark"
      href={href ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Notion 的順序是：favicon（自成一行）→ 標題 → 描述 → 網址
          （05-20-bookmark-light.png）；原本把 favicon 塞在網址前面。 */}
      <span className="kn-bookmark-body">
        <span className="kn-bookmark-favicon" aria-hidden="true">
          {meta.faviconUrl ? (
            <img src={meta.faviconUrl} alt="" width={20} height={20} loading="lazy" />
          ) : (
            <Icon name="link" size={16} />
          )}
        </span>
        <span className="kn-bookmark-title">{meta.title ?? domain ?? props.url}</span>
        {meta.description ? <span className="kn-bookmark-desc">{meta.description}</span> : null}
        <span className="kn-bookmark-url">{props.url}</span>
      </span>
      {meta.coverUrl ? (
        <span className="kn-bookmark-cover">
          <img src={meta.coverUrl} alt="" loading="lazy" />
        </span>
      ) : null}
    </a>
  );
}
