/**
 * 頁面畫面：PageHeader（封面 / 圖示 / 標題）+ Editor（block 編輯區）。
 *
 * ⚠️ 給 App shell 代理：
 *   - `<PageHeader>` 已經自給自足（只需要 page + workspaceId），可以直接搬到 shell 裡。
 *   - `<Editor>` 的 props 見 features/editor/README.md 的「對外介面」。
 *   - 所有 block 變更都走 `POST /api/pages/:id/transactions`（debounce 300ms），
 *     **不要**在元件裡直接呼叫任何 block 寫入 API（04 §7.3 / 00-README 風險二）。
 */
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Editor } from '../features/editor/Editor';
import { PageHeader } from '../features/editor/PageHeader';
import type { TransportState } from '../features/editor/transport';
import { usePageSnapshot, useWorkspaceTree } from '../lib/queries';
import { useCurrentWorkspace } from '../stores/auth';
import styles from './PageRoute.module.css';

const SAVE_LABEL: Record<TransportState['status'], string> = {
  idle: '已儲存',
  pending: '編輯中…',
  saving: '儲存中…',
  error: '儲存失敗',
  offline: '離線，稍後重試',
};

export function PageRoute() {
  const { pageId } = useParams<{ pageId: string }>();
  const navigate = useNavigate();
  const workspace = useCurrentWorkspace();
  const tree = useWorkspaceTree(workspace?.id ?? null);

  // 沒指定 pageId 時，自動落在第一頁
  const effectivePageId = pageId ?? tree.data?.[0]?.id ?? null;
  const snapshot = usePageSnapshot(effectivePageId);
  const [transport, setTransport] = useState<TransportState | null>(null);

  const page = effectivePageId ? snapshot.data?.recordMap.page[effectivePageId]?.value : undefined;

  const goToPage = useCallback(
    (id: string) => {
      navigate(`/page/${id}`);
    },
    [navigate],
  );

  const focusFirstBlock = useCallback(() => {
    const first = document.querySelector<HTMLElement>('.kn-editor .kn-block-content[contenteditable="true"]');
    first?.focus();
  }, []);

  if (!effectivePageId) {
    return (
      <div className={styles.placeholderScreen}>
        <p>
          左邊還沒有頁面，按側邊欄的 <strong>+</strong> 建立第一頁。
        </p>
      </div>
    );
  }

  if (snapshot.isLoading && !snapshot.data) {
    return <div className={styles.placeholderScreen}>載入頁面中…</div>;
  }

  if (snapshot.isError || !page) {
    return <div className={styles.placeholderScreen}>找不到這個頁面，可能已被刪除。</div>;
  }

  return (
    <article className={styles.page}>
      <div className={styles.savedHint} aria-live="polite">
        {SAVE_LABEL[transport?.status ?? 'idle']}
      </div>

      <PageHeader page={page} workspaceId={workspace?.id ?? null} onLeaveTitle={focusFirstBlock} />

      {/* ⭐ editor-core 的掛載點就在 <Editor> 裡面（features/editor/Editor.tsx） */}
      <Editor
        key={page.id}
        pageId={page.id}
        workspaceId={workspace?.id ?? null}
        snapshot={snapshot.data}
        onNavigateToPage={goToPage}
        onTransportState={setTransport}
      />
    </article>
  );
}
