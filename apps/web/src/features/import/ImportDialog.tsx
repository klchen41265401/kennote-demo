/**
 * 匯入對話框（Notion 的「⋯ → 匯入」）。
 *
 * 來源卡片：Markdown / HTML / Notion 匯出 zip / CSV。
 * 選了哪一張只是改 `accept` 與說明文字 —— **真正的判斷在後端**
 * （`detectSource()` 看副檔名與內容），使用者拖錯卡片也不會壞。
 */
import { useCallback, useRef, useState } from 'react';
import type { ImportResult, ImportSource } from '@kennote/shared-types';
import { API_ROUTES, IMPORT_SOURCE_META, IMPORT_SOURCES } from '@kennote/shared-types';
import { Button, Dialog, Spinner, toast } from '@kennote/ui';
import { ApiError, api } from '../../lib/api-client';
import styles from './ImportDialog.module.css';

const SOURCE_ICON: Record<ImportSource, string> = {
  markdown: 'M↓',
  html: '</>',
  notionZip: 'N',
  csv: '⊞',
  text: 'T',
};

/** 卡片只列這四種；.txt 走 Markdown 卡片（後端一樣認得） */
const CARD_SOURCES: ImportSource[] = IMPORT_SOURCES.filter((s) => s !== 'text');

export interface ImportDialogProps {
  workspaceId: string;
  /** 匯入到哪一頁底下；不給就放在工作區頂層 */
  parentId?: string | null;
  /** 受控用法；預設開啟 */
  open?: boolean;
  onClose?: () => void;
  /** 匯入成功後通知外層（重新整理側邊欄、跳到新頁面…） */
  onImported?: (result: ImportResult) => void;
}

type Phase = 'idle' | 'uploading' | 'done';

export function ImportDialog({
  workspaceId,
  parentId = null,
  open = true,
  onClose,
  onImported,
}: ImportDialogProps): JSX.Element {
  const [source, setSource] = useState<ImportSource>('markdown');
  const [phase, setPhase] = useState<Phase>('idle');
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setPhase('uploading');
      setFileName(file.name);
      setResult(null);
      try {
        const form = new FormData();
        form.append('workspaceId', workspaceId);
        if (parentId) form.append('parentId', parentId);
        form.append('file', file, file.name);

        const imported = await api.upload<ImportResult>(API_ROUTES.import, form);
        setResult(imported);
        setPhase('done');
        toast.success(
          `匯入完成：${imported.createdPages} 個頁面、${imported.createdDatabases} 個資料庫`,
        );
        onImported?.(imported);
      } catch (err) {
        setPhase('idle');
        toast.error(err instanceof ApiError ? err.message : '匯入失敗，請稍後再試');
      }
    },
    [onImported, parentId, workspaceId],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void upload(file);
    },
    [upload],
  );

  const accept = IMPORT_SOURCE_META[source].accept;

  return (
    <Dialog
      open={open}
      onClose={() => onClose?.()}
      title="匯入"
      description="把既有的筆記搬進 kennote —— 原始檔不會被修改"
      size="md"
      footer={
        <div className={styles['footer']}>
          <Button variant="subtle" onClick={() => onClose?.()}>
            {phase === 'done' ? '完成' : '取消'}
          </Button>
          <Button
            variant="primary"
            disabled={phase === 'uploading'}
            onClick={() => inputRef.current?.click()}
          >
            選擇檔案
          </Button>
        </div>
      }
    >
      <div className={styles['body']}>
        <div className={styles['cards']} role="radiogroup" aria-label="匯入來源">
          {CARD_SOURCES.map((key) => {
            const meta = IMPORT_SOURCE_META[key];
            const selected = key === source;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                className={styles['card']}
                data-selected={selected || undefined}
                onClick={() => setSource(key)}
              >
                <span className={styles['cardIcon']} aria-hidden>
                  {SOURCE_ICON[key]}
                </span>
                <span className={styles['cardTitle']}>{meta.label}</span>
                <span className={styles['cardDescription']}>{meta.description}</span>
              </button>
            );
          })}
        </div>

        <div
          className={styles['dropZone']}
          data-dragging={dragging || undefined}
          data-busy={phase === 'uploading' || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => phase !== 'uploading' && inputRef.current?.click()}
        >
          {phase === 'uploading' ? (
            <>
              <Spinner size={20} />
              <span className={styles['dropText']}>正在匯入 {fileName}…</span>
              <span className={styles['dropHint']}>大檔案會需要一點時間，請不要關閉視窗</span>
            </>
          ) : (
            <>
              <span className={styles['dropText']}>把檔案拖到這裡，或點一下選擇</span>
              <span className={styles['dropHint']}>接受 {accept}（上限 50MB）</span>
            </>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className={styles['hiddenInput']}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) void upload(file);
          }}
        />

        {result ? <ImportSummary result={result} /> : null}
      </div>
    </Dialog>
  );
}

function ImportSummary({ result }: { result: ImportResult }): JSX.Element {
  return (
    <div className={styles['summary']}>
      <div className={styles['summaryRow']}>
        <strong>{result.createdPages}</strong> 個頁面
        <span className={styles['dot']}>·</span>
        <strong>{result.createdDatabases}</strong> 個資料庫
      </div>
      {result.pages.length > 0 ? (
        <ul className={styles['pageList']}>
          {result.pages.slice(0, 8).map((page) => (
            <li key={page.pageId}>
              {page.isDatabase ? '⊞ ' : '📄 '}
              {page.title}
            </li>
          ))}
          {result.pages.length > 8 ? <li>…還有 {result.pages.length - 8} 個</li> : null}
        </ul>
      ) : null}
      {result.warnings.length > 0 ? (
        <details className={styles['warnings']}>
          <summary>{result.warnings.length} 個提醒</summary>
          <ul>
            {result.warnings.slice(0, 20).map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
