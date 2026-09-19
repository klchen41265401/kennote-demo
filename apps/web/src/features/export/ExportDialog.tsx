/**
 * 匯出對話框（Notion 的「⋯ → 匯出」）。
 *
 * 格式：Markdown & CSV / HTML / PDF（列印）。
 * PDF 為什麼是「列印」：server 容器內沒有瀏覽器，不裝 Playwright（ADR 0005）。
 * 後端對 `format=pdf` 會回 501 並附說明；這裡不打那支 API，直接叫 `window.print()`
 * ——列印樣式表 `lib/print.css` 已經把側邊欄、選單、浮層都藏起來。
 */
import { useCallback, useState } from 'react';
import type { ApiErrorShape, ExportFormat } from '@kennote/shared-types';
import { API_ROUTES, EXPORT_FORMAT_META } from '@kennote/shared-types';
import { Button, Dialog, Select, Switch, toast } from '@kennote/ui';
import { ApiError, getAccessToken } from '../../lib/api-client';
import styles from './ExportDialog.module.css';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string; description: string }> = [
  { value: 'markdown', label: 'Markdown & CSV', description: EXPORT_FORMAT_META.markdown.description },
  { value: 'html', label: 'HTML', description: EXPORT_FORMAT_META.html.description },
  { value: 'pdf', label: 'PDF（用列印）', description: EXPORT_FORMAT_META.pdf.description },
];

const DATABASE_OPTION = {
  value: 'csv' as ExportFormat,
  label: 'CSV',
  description: EXPORT_FORMAT_META.csv.description,
};

export interface ExportDialogProps {
  pageId: string;
  /** 顯示在標題列，純裝飾；沒給就只顯示「匯出」 */
  pageTitle?: string;
  /** 這一頁是 database → 多一個 CSV 選項 */
  isDatabase?: boolean;
  /** 受控用法；預設開啟（讓呼叫端可以 `{open && <ExportDialog …/>}`） */
  open?: boolean;
  onClose?: () => void;
}

/** 從 Content-Disposition 取檔名（優先 filename*，它才有 UTF-8） */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* 壞掉就退回下面的 filename= */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? fallback;
}

export function ExportDialog({
  pageId,
  pageTitle,
  isDatabase = false,
  open = true,
  onClose,
}: ExportDialogProps): JSX.Element {
  const [format, setFormat] = useState<ExportFormat>(isDatabase ? 'csv' : 'markdown');
  const [includeSubpages, setIncludeSubpages] = useState(false);
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [busy, setBusy] = useState(false);

  const options = isDatabase ? [DATABASE_OPTION, ...FORMAT_OPTIONS] : FORMAT_OPTIONS;
  const meta = EXPORT_FORMAT_META[format];

  const download = useCallback(async () => {
    if (format === 'pdf') {
      onClose?.();
      // 等 dialog 關閉、focus trap 解除之後再叫列印，否則背景還是 inert
      setTimeout(() => window.print(), 120);
      return;
    }

    setBusy(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${BASE_URL}${API_ROUTES.pageExport(pageId)}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ format, includeSubpages, includeAttachments }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: ApiErrorShape } | null;
        throw new ApiError(
          res.status,
          body?.error ?? { code: 'INTERNAL_ERROR', message: '匯出失敗' },
        );
      }

      const blob = await res.blob();
      const filename = filenameFromDisposition(
        res.headers.get('content-disposition'),
        `${pageTitle ?? 'kennote'}.${meta.extension}`,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // 立刻 revoke 在 Safari 會讓下載中斷，延遲一輪比較安全
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      toast.success(`已匯出 ${filename}`);
      onClose?.();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '匯出失敗，請稍後再試';
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [format, includeAttachments, includeSubpages, meta.extension, onClose, pageId, pageTitle]);

  return (
    <Dialog
      open={open}
      onClose={() => onClose?.()}
      title="匯出"
      description={pageTitle ? `「${pageTitle}」與你選擇的內容` : undefined}
      size="sm"
      footer={
        <div className={styles['footer']}>
          <Button variant="subtle" onClick={() => onClose?.()}>
            取消
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void download()}>
            {format === 'pdf' ? '開啟列印' : '匯出'}
          </Button>
        </div>
      }
    >
      <div className={styles['body']}>
        <label className={styles['field']}>
          <span className={styles['label']}>匯出格式</span>
          <Select
            options={options}
            value={format}
            onChange={(next) => setFormat(next as ExportFormat)}
            aria-label="匯出格式"
          />
          <span className={styles['hint']}>{meta.description}</span>
        </label>

        {format !== 'pdf' ? (
          <>
            <div className={styles['toggleRow']}>
              <Switch
                checked={includeSubpages}
                onChange={(e) => setIncludeSubpages(e.currentTarget.checked)}
              >
                <span className={styles['toggleLabel']}>包含子頁面</span>
              </Switch>
              <span className={styles['hint']}>開啟後會輸出成 .zip，子頁面連結改成相對路徑</span>
            </div>

            <div className={styles['toggleRow']}>
              <Switch
                checked={includeAttachments}
                onChange={(e) => setIncludeAttachments(e.currentTarget.checked)}
              >
                <span className={styles['toggleLabel']}>包含圖片與附件</span>
              </Switch>
              <span className={styles['hint']}>附件會放在 zip 的 files/ 目錄</span>
            </div>
          </>
        ) : (
          <p className={styles['printNote']}>
            會開啟瀏覽器的列印視窗，在「目的地」選「另存為 PDF」。
            <br />
            這份列印樣式已經把側邊欄、選單與浮層都藏起來，版面與匯出的 HTML 一致。
          </p>
        )}
      </div>
    </Dialog>
  );
}
