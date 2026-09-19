/**
 * 頁面標頭：封面 / 圖示 / 標題（Notion 式）。
 *
 * 這一塊之後會被 App shell 代理沿用，所以刻意做成**自給自足的元件**：
 * 只要給 page 與 workspaceId，其餘（儲存、浮層）它自己處理。
 *
 * 決策：
 *  - 標題走 `PATCH /api/pages/:id`（去抖 500ms），不走 block transaction。
 *    page.update op 是給協作同步用的；M2-B 還沒有 WS，先用 REST 保持單純。
 *  - cover 只有一個字串欄位，所以「重新定位」把位置寫成 URL fragment：
 *    `https://…/cover.jpg#y=42`（內建漸層則是 `gradient:sunset#y=50`）。
 */
import { useEffect, useRef, useState } from 'react';
import type { Page, RichText } from '@kennote/shared-types';
import { API_ROUTES, plainTextToRichText, richTextToPlainText } from '@kennote/shared-types';
import { invalidateQueries } from '@kennote/ui';
import { api } from '../../lib/api-client';
import { fileUrl, uploadFile } from '../../lib/upload';
import { queryKeys } from '../../lib/queries';
import { setRightPanel } from '../../stores/ui';
import { EmojiPicker } from '../../components/EmojiPicker';
import { Popover } from './ui/overlay';
import { Icon } from './ui/icons';
import { toast } from './ui/toast';
import { rectFromDOMRect, type RectLike } from './lib/floating';

const TITLE_DEBOUNCE_MS = 500;

/** 內建封面：8 張 CSS 漸層（不佔流量、深淺色都好看） */
export const COVER_GRADIENTS: { id: string; label: string; css: string }[] = [
  { id: 'sunset', label: '日落', css: 'linear-gradient(120deg, #f6d365 0%, #fda085 100%)' },
  { id: 'ocean', label: '海洋', css: 'linear-gradient(120deg, #4facfe 0%, #00f2fe 100%)' },
  { id: 'forest', label: '森林', css: 'linear-gradient(120deg, #43e97b 0%, #38f9d7 100%)' },
  { id: 'lavender', label: '薰衣草', css: 'linear-gradient(120deg, #a18cd1 0%, #fbc2eb 100%)' },
  { id: 'ember', label: '餘燼', css: 'linear-gradient(120deg, #ff9a9e 0%, #fecfef 100%)' },
  { id: 'slate', label: '石板', css: 'linear-gradient(120deg, #30cfd0 0%, #330867 100%)' },
  { id: 'dawn', label: '破曉', css: 'linear-gradient(120deg, #fddb92 0%, #d1fdff 100%)' },
  { id: 'ink', label: '墨色', css: 'linear-gradient(120deg, #434343 0%, #000000 100%)' },
];

export function parseCover(cover: string | null): { kind: 'gradient' | 'image'; value: string; y: number } | null {
  if (!cover) return null;
  const [base, hash] = cover.split('#');
  const y = Number(/y=(\d+(?:\.\d+)?)/.exec(hash ?? '')?.[1] ?? 50);
  if ((base ?? '').startsWith('gradient:')) {
    const id = (base as string).slice('gradient:'.length);
    const gradient = COVER_GRADIENTS.find((g) => g.id === id) ?? COVER_GRADIENTS[0];
    return { kind: 'gradient', value: gradient?.css ?? '', y };
  }
  return { kind: 'image', value: base ?? '', y };
}

export function withCoverPosition(cover: string, y: number): string {
  const base = cover.split('#')[0] ?? cover;
  return `${base}#y=${Math.round(y)}`;
}

export interface PageHeaderProps {
  page: Page;
  workspaceId: string | null;
  readOnly?: boolean;
  /** 在標題按 Enter / ↓ 時，把游標交給第一個 block */
  onLeaveTitle?(): void;
}

export function PageHeader({ page, workspaceId, readOnly = false, onLeaveTitle }: PageHeaderProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef<string | null>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [iconAnchor, setIconAnchor] = useState<RectLike | null>(null);
  const [coverAnchor, setCoverAnchor] = useState<RectLike | null>(null);
  const [repositioning, setRepositioning] = useState(false);
  const [localY, setLocalY] = useState<number | null>(null);

  const cover = parseCover(page.cover);
  const coverY = localY ?? cover?.y ?? 50;

  // 只在換頁時把伺服器的標題寫進 DOM，避免打字打到一半被蓋掉
  useEffect(() => {
    if (loadedRef.current === page.id) return;
    loadedRef.current = page.id;
    if (titleRef.current) titleRef.current.textContent = richTextToPlainText(page.title);
  }, [page.id, page.title]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const patch = async (body: { title?: RichText; icon?: string | null; cover?: string | null }): Promise<void> => {
    try {
      await api.patch(API_ROUTES.page(page.id), body);
      invalidateQueries(queryKeys.page(page.id));
      invalidateQueries(queryKeys.snapshot(page.id));
      if (workspaceId) invalidateQueries(['workspace', workspaceId]);
    } catch {
      toast('儲存頁面資訊失敗', { kind: 'error' });
    }
  };

  const onTitleInput = (): void => {
    if (readOnly) return;
    const text = titleRef.current?.textContent ?? '';
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void patch({ title: plainTextToRichText(text) });
    }, TITLE_DEBOUNCE_MS);
  };

  const pickCoverFile = async (file: File): Promise<void> => {
    if (!workspaceId) return;
    try {
      // 封面也是這一頁的附件（0070）：帶 pageId，權限才跟著頁面走
      const meta = await uploadFile(workspaceId, file, { pageId: page.id }).promise;
      await patch({ cover: withCoverPosition(fileUrl(meta), 50) });
    } catch {
      toast('封面上傳失敗', { kind: 'error' });
    }
  };

  const startReposition = (): void => {
    setRepositioning(true);
  };

  useEffect(() => {
    if (!repositioning) return;
    const el = coverRef.current;
    if (!el) return;
    let dragging = false;
    let startY = 0;
    let startValue = coverY;

    const onDown = (e: PointerEvent): void => {
      dragging = true;
      startY = e.clientY;
      startValue = localY ?? cover?.y ?? 50;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return;
      const height = el.getBoundingClientRect().height || 1;
      const next = Math.max(0, Math.min(100, startValue - ((e.clientY - startY) / height) * 100));
      setLocalY(next);
    };
    const onUp = (): void => {
      dragging = false;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
  }, [repositioning, coverY, localY, cover?.y]);

  return (
    <header className="kn-page-header" data-has-cover={cover ? 'true' : undefined}>
      {cover ? (
        <div
          className="kn-cover"
          ref={coverRef}
          data-repositioning={repositioning ? 'true' : undefined}
          style={
            cover.kind === 'gradient'
              ? { background: cover.value }
              : { backgroundImage: `url(${cover.value})`, backgroundPosition: `center ${coverY}%` }
          }
        >
          {readOnly ? null : (
            <div className="kn-cover-actions">
              {repositioning ? (
                <>
                  <button
                    type="button"
                    className="kn-btn kn-btn--sm kn-btn--primary"
                    onClick={() => {
                      setRepositioning(false);
                      if (page.cover && localY !== null) void patch({ cover: withCoverPosition(page.cover, localY) });
                      setLocalY(null);
                    }}
                  >
                    儲存位置
                  </button>
                  <button
                    type="button"
                    className="kn-btn kn-btn--sm"
                    onClick={() => {
                      setRepositioning(false);
                      setLocalY(null);
                    }}
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="kn-btn kn-btn--sm"
                    onClick={(e) => setCoverAnchor(rectFromDOMRect(e.currentTarget.getBoundingClientRect()))}
                  >
                    更換封面
                  </button>
                  {cover.kind === 'image' ? (
                    <button type="button" className="kn-btn kn-btn--sm" onClick={startReposition}>
                      重新定位
                    </button>
                  ) : null}
                  <button type="button" className="kn-btn kn-btn--sm" onClick={() => void patch({ cover: null })}>
                    移除
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      <div className="kn-page-header-body">
        {page.icon ? (
          <button
            type="button"
            className="kn-page-icon"
            disabled={readOnly}
            onClick={(e) => setIconAnchor(rectFromDOMRect(e.currentTarget.getBoundingClientRect()))}
          >
            {page.icon}
          </button>
        ) : null}

        {readOnly ? null : (
          <div className="kn-page-header-tools">
            {page.icon ? null : (
              <button
                type="button"
                className="kn-header-tool"
                onClick={(e) => setIconAnchor(rectFromDOMRect(e.currentTarget.getBoundingClientRect()))}
              >
                <Icon name="sparkle" size={14} /> 新增圖示
              </button>
            )}
            {cover ? null : (
              <button
                type="button"
                className="kn-header-tool"
                onClick={(e) => setCoverAnchor(rectFromDOMRect(e.currentTarget.getBoundingClientRect()))}
              >
                <Icon name="image" size={14} /> 新增封面
              </button>
            )}
            <button
              type="button"
              className="kn-header-tool"
              /* 第十一輪：頁面層級討論串的輸入框本來就在右側面板（CommentsPanel
                 的 `anchor: {kind:'page'}` 那一條），這顆按鈕只要把面板打開就好。 */
              onClick={() => setRightPanel(true, 'comments')}
            >
              <Icon name="comment" size={14} /> 新增留言
            </button>
          </div>
        )}

        <h1
          ref={titleRef}
          className="kn-page-title"
          contentEditable={!readOnly}
          suppressContentEditableWarning
          role="textbox"
          aria-label="頁面標題"
          data-placeholder="未命名"
          spellCheck={false}
          onInput={onTitleInput}
          onBlur={() => {
            if (timerRef.current) clearTimeout(timerRef.current);
            if (!readOnly) void patch({ title: plainTextToRichText(titleRef.current?.textContent ?? '') });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
              e.preventDefault();
              onLeaveTitle?.();
            }
          }}
        />
      </div>

      {/* icon picker */}
      <Popover
        anchor={iconAnchor}
        open={iconAnchor !== null}
        onClose={() => setIconAnchor(null)}
        className="kn-popover--emoji"
        role="dialog"
        allowFocus
        ariaLabel="選擇頁面圖示"
      >
        <EmojiPicker
          onSelect={(emoji) => {
            void patch({ icon: emoji });
            setIconAnchor(null);
          }}
          onRemove={
            page.icon
              ? () => {
                  void patch({ icon: null });
                  setIconAnchor(null);
                }
              : undefined
          }
        />
      </Popover>

      {/* cover picker */}
      <Popover
        anchor={coverAnchor}
        open={coverAnchor !== null}
        onClose={() => setCoverAnchor(null)}
        className="kn-popover--cover"
        role="dialog"
        allowFocus
        ariaLabel="選擇封面"
      >
        <div className="kn-cover-picker">
          <div className="kn-cover-picker-head">
            <span>圖庫</span>
            <button type="button" className="kn-btn kn-btn--sm" onClick={() => fileInputRef.current?.click()}>
              <Icon name="upload" size={14} /> 上傳
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) {
                void pickCoverFile(file);
                setCoverAnchor(null);
              }
            }}
          />
          <div className="kn-cover-grid">
            {COVER_GRADIENTS.map((g) => (
              <button
                key={g.id}
                type="button"
                className="kn-cover-swatch"
                title={g.label}
                style={{ background: g.css }}
                onClick={() => {
                  void patch({ cover: `gradient:${g.id}#y=50` });
                  setCoverAnchor(null);
                }}
              />
            ))}
          </div>
        </div>
      </Popover>
    </header>
  );
}
