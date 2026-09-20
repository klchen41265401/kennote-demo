/**
 * 頁面畫面：TopBar + PageHeader（封面 / 圖示 / 標題）+ Editor（block 編輯區）。
 *
 * ⚠️ `<PageHeader>` 與 `<Editor>` 的用法保持原樣（features/editor/README.md）。
 * 兩者都用 `max-width: var(--kn-editor-content-width)` + `margin: 0 auto`，
 * 變數已提到 `:root`（styles/tokens.css），所以標題與 block 的左緣天生對齊。
 * 版面（全寬 / 小字 / 字型）由外層 `.kn-page-layout` 的 data-* 屬性驅動（styles/shell.css）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Skeleton } from '@kennote/ui';
import { Editor } from '../features/editor/Editor';
import { PageHeader } from '../features/editor/PageHeader';
import type { TransportState } from '../features/editor/transport';
import { TopBar } from '../features/shell/TopBar';
import { ancestorChain } from '../features/page-tree/tree';
import {
  usePageSnapshot,
  usePagePermission,
  useFavorites,
  useWorkspaceTree,
} from '../lib/queries';
import { useWorkspace } from '../stores/workspace';
import { usePageLayout } from '../stores/pages';
import { expandAncestors, useBreakpoint, useUi } from '../stores/ui';
import {
  exitHistoryPreview,
  formatVersionTime,
  restorePreviewedVersion,
  useHistoryPreview,
} from '../features/history/preview';
import shell from '../features/shell/Shell.module.css';
import styles from './PageRoute.module.css';

const SAVE_LABEL: Record<TransportState['status'], string> = {
  idle: '',
  pending: '編輯中…',
  saving: '儲存中…',
  error: '儲存失敗',
  offline: '離線，稍後重試',
};

export function PageRoute(): JSX.Element {
  const { pageId } = useParams<{ pageId: string }>();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const ui = useUi();
  const bp = useBreakpoint();
  const tree = useWorkspaceTree(workspace?.id ?? null);
  const favorites = useFavorites(workspace?.id ?? null);

  // 沒指定 pageId 時，自動落在第一頁
  const effectivePageId = pageId ?? tree.data?.[0]?.id ?? null;
  const snapshot = usePageSnapshot(effectivePageId);
  const [transport, setTransport] = useState<TransportState | null>(null);
  const layout = usePageLayout(effectivePageId);
  const permission = usePagePermission(effectivePageId);
  /**
   * gap-review B-7：版本預覽必須**真的顯示那個版本**。
   * 以前這裡只看 `ui.historyPreviewSeq`（純數字），編輯器吃的仍然是現況 snapshot，
   * 橫幅卻寫「編輯已停用」—— 會誤導。現在 snapshot 跟著 store 一起過來。
   */
  const preview = useHistoryPreview();
  const previewing =
    preview.snapshot !== null && preview.pageId === effectivePageId && preview.seq !== null;

  const page = effectivePageId ? snapshot.data?.recordMap.page[effectivePageId]?.value : undefined;

  const nodes = useMemo(() => tree.data ?? [], [tree.data]);
  const chain = useMemo(
    () => (effectivePageId ? ancestorChain(nodes, effectivePageId) : []),
    [nodes, effectivePageId],
  );

  // 進到一個頁面時，把側邊欄的祖先鏈展開（01 §8 搜尋導覽）
  useEffect(() => {
    if (chain.length > 1) expandAncestors(chain.slice(0, -1).map((n) => n.id));
  }, [chain]);

  const goToPage = useCallback((id: string) => navigate(`/page/${id}`), [navigate]);

  const focusFirstBlock = useCallback(() => {
    document
      .querySelector<HTMLElement>('.kn-editor .kn-block-content[contenteditable="true"]')
      ?.focus();
  }, []);

  const favorite = (favorites.data ?? []).some((f) => f.id === effectivePageId);
  const readOnly = layout.locked || ui.historyPreviewSeq !== null || permission.canEdit === false;

  const topbar = (
    <TopBar
      workspaceId={workspace?.id ?? ''}
      pageId={effectivePageId}
      chain={chain}
      updatedAt={page?.updatedAt ?? null}
      favorite={favorite}
      onFavoriteChanged={() => void favorites.refetch()}
      onTreeChanged={() => void tree.refetch()}
      {...(transport && SAVE_LABEL[transport.status] ? { saveLabel: SAVE_LABEL[transport.status] } : {})}
      showSidebarToggle={ui.sidebarCollapsed || bp !== 'desktop'}
    />
  );

  if (!effectivePageId) {
    return (
      <>
        {topbar}
        <div className={shell.stateScreen}>
          <p className={shell.stateTitle}>還沒有頁面</p>
          <p className={shell.stateHint}>
            按側邊欄的 <strong>＋</strong> 建立第一頁。
          </p>
        </div>
      </>
    );
  }

  if (snapshot.isLoading && !snapshot.data) {
    return (
      <>
        {topbar}
        <div className={shell.content}>
          <div className={shell.skeletonPage} aria-busy="true" aria-live="polite">
            <Skeleton shape="rect" height={40} width="60%" />
            <Skeleton shape="text" lines={3} />
            <Skeleton shape="text" lines={4} />
          </div>
        </div>
      </>
    );
  }

  if (snapshot.isError || !page) {
    return (
      <>
        {topbar}
        <div className={shell.stateScreen}>
          <p className={shell.stateTitle}>找不到這個頁面</p>
          <p className={shell.stateHint}>它可能已被刪除，或你沒有存取權限。</p>
        </div>
      </>
    );
  }

  // 整頁資料庫走 DatabaseRoute（避免 PageRoute 直接 import features/database）
  if (page.isDatabase) return <Navigate to={`/database/${page.id}`} replace />;

  return (
    <>
      {topbar}
      <div className={shell.content}>
        <article
          className={`${styles.page} kn-page-layout`}
          data-full-width={layout.fullWidth ? 'true' : 'false'}
          data-small-text={layout.smallText ? 'true' : 'false'}
          data-font={layout.font}
        >
          {previewing && (
            <div className={styles.previewBanner} role="status">
              <span>正在預覽 {formatVersionTime(preview.at, preview.seq)} 的版本</span>
              <span className={styles.previewActions}>
                <button
                  type="button"
                  className={styles.previewAction}
                  onClick={() => void restorePreviewedVersion()}
                >
                  還原此版本
                </button>
                <button
                  type="button"
                  className={styles.previewAction}
                  onClick={() => exitHistoryPreview()}
                >
                  離開預覽
                </button>
              </span>
            </div>
          )}

          <PageHeader
            page={previewing ? (preview.snapshot?.recordMap.page[page.id]?.value ?? page) : page}
            workspaceId={workspace?.id ?? null}
            readOnly={readOnly}
            onLeaveTitle={focusFirstBlock}
          />

          {/* ⭐ editor-core 的掛載點就在 <Editor> 裡面（features/editor/Editor.tsx） */}
          {/*
            ⭐ key 帶上預覽的 seq：切進 / 切出預覽時整個編輯器重建，
            吃的是那個版本的 snapshot（`useEditorHost` 的 doc 以 pageId 為 key 只建一次，
            不換 key 的話預覽 snapshot 根本不會被讀）。
            `syncDisabled` 讓預覽期間不送 tx、也不收遠端 ops。
          */}
          <Editor
            key={previewing ? `${page.id}:v${preview.seq}` : page.id}
            pageId={page.id}
            workspaceId={workspace?.id ?? null}
            snapshot={previewing ? (preview.snapshot ?? undefined) : snapshot.data}
            readOnly={readOnly}
            syncDisabled={previewing}
            onNavigateToPage={goToPage}
            onTransportState={setTransport}
          />
        </article>
      </div>
    </>
  );
}
