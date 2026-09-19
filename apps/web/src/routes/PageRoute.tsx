/**
 * M1 的頁面畫面：可編輯標題 + 內容佔位區。
 *
 * ⚠️ 給接手 M2-B 的代理：
 *   `<div id="editor-host">` 就是 editor-core 的掛載點。
 *   宿主層（useEditorHost.ts）請掛在這裡，並且：
 *     - 初次資料從 usePageSnapshot() 拿（record_map 形狀，含 seq）
 *     - 變更一律打包成 Transaction 送 POST /api/pages/:id/transactions
 *     - **不要**在元件裡直接呼叫任何寫入 API（04 §7.3 / 00-README 風險二）
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { richTextToPlainText } from '@kennote/shared-types';
import { patchPageTitle, usePageSnapshot, useWorkspaceTree } from '../lib/queries';
import { useCurrentWorkspace } from '../stores/auth';
import styles from './PageRoute.module.css';

const TITLE_DEBOUNCE_MS = 500;

export function PageRoute() {
  const { pageId } = useParams<{ pageId: string }>();
  const workspace = useCurrentWorkspace();
  const tree = useWorkspaceTree(workspace?.id ?? null);

  // 沒指定 pageId 時，自動落在第一頁
  const effectivePageId = pageId ?? tree.data?.[0]?.id ?? null;
  const snapshot = usePageSnapshot(effectivePageId);

  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedPageRef = useRef<string | null>(null);

  const page = effectivePageId ? snapshot.data?.recordMap.page[effectivePageId]?.value : undefined;

  useEffect(() => {
    if (!page) return;
    // 只在換頁時同步一次，免得使用者打字打到一半被伺服器資料蓋掉
    if (loadedPageRef.current === page.id) return;
    loadedPageRef.current = page.id;
    setTitle(richTextToPlainText(page.title));
  }, [page]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!effectivePageId || !workspace) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSaving(true);
      void patchPageTitle(effectivePageId, workspace.id, value ? [{ text: value }] : [])
        .finally(() => setSaving(false));
    }, TITLE_DEBOUNCE_MS);
  }

  if (!effectivePageId) {
    return (
      <div className={styles.placeholderScreen}>
        <p>左邊還沒有頁面，按側邊欄的 <strong>+</strong> 建立第一頁。</p>
      </div>
    );
  }

  if (snapshot.isLoading) {
    return <div className={styles.placeholderScreen}>載入頁面中…</div>;
  }

  if (snapshot.isError || !page) {
    return <div className={styles.placeholderScreen}>找不到這個頁面，可能已被刪除。</div>;
  }

  const blockCount = Object.keys(snapshot.data?.recordMap.block ?? {}).length;

  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.icon} aria-hidden="true">
            {page.icon ?? '📄'}
          </span>
          <span className={styles.savedHint}>{saving ? '儲存中…' : '已儲存'}</span>
        </div>
        <input
          className={styles.title}
          value={title}
          placeholder="未命名"
          onChange={(e) => handleTitleChange(e.target.value)}
          aria-label="頁面標題"
        />
      </header>

      {/* ⭐ editor-core 的掛載點。M2-B 之前這裡只放佔位說明。 */}
      <div id="editor-host" className={styles.editorHost} data-page-id={page.id}>
        <div className={styles.placeholder}>
          <p className={styles.placeholderTitle}>編輯器尚未接上（M2-A / M2-B）</p>
          <ul className={styles.placeholderList}>
            <li>
              這一頁目前有 <strong>{blockCount}</strong> 個 block，sync seq 為{' '}
              <strong>{snapshot.data?.seq ?? 0}</strong>
            </li>
            <li>
              初次載入走 <code>GET /api/pages/{page.id}/snapshot</code>（record_map 形狀）
            </li>
            <li>
              所有變更走 <code>POST /api/pages/{page.id}/transactions</code>
            </li>
          </ul>
        </div>
      </div>
    </article>
  );
}
