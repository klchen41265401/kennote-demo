/** 收件匣頁（09b-inbox-*.png）：整頁包住 <InboxPanel/>。 */
import { useNavigate } from 'react-router-dom';
import { InboxPanel } from '../features/notifications/InboxPanel';
import { TopBar } from '../features/shell/TopBar';
import { useFavorites, useWorkspaceTree } from '../lib/queries';
import { useWorkspace } from '../stores/workspace';
import { useBreakpoint, useUi } from '../stores/ui';
import shell from '../features/shell/Shell.module.css';

export function InboxRoute(): JSX.Element {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const ui = useUi();
  const bp = useBreakpoint();
  const tree = useWorkspaceTree(workspace?.id ?? null);
  const favorites = useFavorites(workspace?.id ?? null);

  return (
    <>
      <TopBar
        workspaceId={workspace?.id ?? ''}
        pageId={null}
        chain={[]}
        updatedAt={null}
        favorite={false}
        onFavoriteChanged={() => void favorites.refetch()}
        onTreeChanged={() => void tree.refetch()}
        showSidebarToggle={ui.sidebarCollapsed || bp !== 'desktop'}
      />
      <div className={shell.content}>
        <InboxPanel onOpenPage={(pageId) => navigate(`/page/${pageId}`)} />
      </div>
    </>
  );
}
