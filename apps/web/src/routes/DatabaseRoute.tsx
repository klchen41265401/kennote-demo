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
import { useFavorites, usePage, useWorkspaceTree } from '../lib/queries';
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
              <PageHeader page={page.data} workspaceId={workspace?.id ?? null} />
              {page.data.collectionId ? (
                <DatabaseView collectionId={page.data.collectionId} />
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
