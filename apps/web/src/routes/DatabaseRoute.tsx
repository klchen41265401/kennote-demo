/**
 * 整頁資料庫（full-page database）。
 *
 * 一個頁面 `isDatabase === true` 時就走這裡：TopBar 與一般頁面完全一致
 * （麵包屑 / 星號 / ⋯ 都在），內容換成 `<DatabaseView inline={false}>`。
 * `features/database` 由另一位代理維護，這裡只 import 它的公開介面。
 */
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Skeleton } from '@kennote/ui';
import { DatabaseView } from '../features/database';
import { TopBar } from '../features/shell/TopBar';
import { PageHeader } from '../features/editor/PageHeader';
import { ancestorChain } from '../features/page-tree/tree';
import { useFavorites, usePage, usePagePermission, useWorkspaceTree } from '../lib/queries';
import { useWorkspace } from '../stores/workspace';
import { useBreakpoint, useUi } from '../stores/ui';
import shell from '../features/shell/Shell.module.css';
import styles from './PageRoute.module.css';

export function DatabaseRoute(): JSX.Element {
  const { pageId } = useParams<{ pageId: string }>();
  const workspace = useWorkspace();
  const ui = useUi();
  const bp = useBreakpoint();
  const tree = useWorkspaceTree(workspace?.id ?? null);
  const favorites = useFavorites(workspace?.id ?? null);
  const page = usePage(pageId ?? null);
  /*
   * 第六輪 BUG-32：整頁資料庫**完全沒有問過權限** —— `DatabaseView` 的
   * `readOnly` 一直是預設的 `false`，所以 guest / 只有 read・comment 權限的人
   * 會看到完整的編輯 UI（新增列、改儲存格、改屬性、刪列…）。
   * 後端每一筆都會 403，但使用者是「按下去才發現不行」。
   * `PageRoute.tsx` 的算法一樣：`canEdit === false` 才鎖，`null`（還在載入）不鎖，
   * 免得閃一下唯讀。
   */
  const permission = usePagePermission(pageId ?? null);
  const readOnly = ui.historyPreviewSeq !== null || permission.canEdit === false;

  const nodes = useMemo(() => tree.data ?? [], [tree.data]);
  const chain = useMemo(() => (pageId ? ancestorChain(nodes, pageId) : []), [nodes, pageId]);
  const favorite = (favorites.data ?? []).some((f) => f.id === pageId);

  return (
    <>
      <TopBar
        workspaceId={workspace?.id ?? ''}
        pageId={pageId ?? null}
        chain={chain}
        updatedAt={page.data?.updatedAt ?? null}
        favorite={favorite}
        onFavoriteChanged={() => void favorites.refetch()}
        onTreeChanged={() => void tree.refetch()}
        showSidebarToggle={ui.sidebarCollapsed || bp !== 'desktop'}
      />
      <div className={shell.content}>
        <article className={`${styles.page} kn-page-layout`} data-full-width="true">
          {page.isLoading && (
            <div className={shell.skeletonPage}>
              <Skeleton shape="rect" height={40} width="50%" />
              <Skeleton shape="rect" height={280} />
            </div>
          )}
          {page.data && (
            <>
              <PageHeader page={page.data} workspaceId={workspace?.id ?? null} readOnly={readOnly} />
              {page.data.collectionId ? (
                <DatabaseView collectionId={page.data.collectionId} readOnly={readOnly} />
              ) : (
                <p className={shell.stateHint}>這個頁面還沒有資料庫。</p>
              )}
            </>
          )}
        </article>
      </div>
    </>
  );
}
