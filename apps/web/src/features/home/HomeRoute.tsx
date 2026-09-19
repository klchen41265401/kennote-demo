/** 首頁（01-home-*.png）：問候語、最近造訪、即將到來（佔位）、精選範本。 */
import { useNavigate } from 'react-router-dom';
import { Icon, Skeleton, toast } from '@kennote/ui';
import { TopBar } from '../shell/TopBar';
import { createFromTemplate, TEMPLATES } from '../templates/templates';
import { useFavorites, useRecentPages, useWorkspaceTree } from '../../lib/queries';
import { useWorkspace } from '../../stores/workspace';
import { useAuth } from '../../stores/auth';
import { greeting, relativeTime } from '../../stores/pages';
import { useBreakpoint, useUi } from '../../stores/ui';
import { displayTitle } from '../page-tree/tree';
import shell from '../shell/Shell.module.css';
import styles from './HomeRoute.module.css';

export function HomeRoute(): JSX.Element {
  const workspace = useWorkspace();
  const { user } = useAuth();
  const navigate = useNavigate();
  const ui = useUi();
  const bp = useBreakpoint();
  const recent = useRecentPages(workspace?.id ?? null);
  const tree = useWorkspaceTree(workspace?.id ?? null);
  const favorites = useFavorites(workspace?.id ?? null);

  if (!workspace) return <div className={shell.stateScreen}>沒有工作區</div>;

  return (
    <>
      <TopBar
        workspaceId={workspace.id}
        pageId={null}
        chain={[]}
        updatedAt={null}
        favorite={false}
        onFavoriteChanged={() => void favorites.refetch()}
        onTreeChanged={() => void tree.refetch()}
        showSidebarToggle={ui.sidebarCollapsed || bp !== 'desktop'}
      />
      <div className={`${shell.content} ${styles.scroll}`}>
        <div className={styles.inner}>
          <h1 className={styles.greeting}>{greeting(user?.name ?? '')}</h1>

          <div className={styles.sectionHeader}>
            <Icon name="history" size={16} />
            最近造訪
          </div>
          <div className={styles.cards}>
            {recent.isLoading &&
              [0, 1, 2, 3].map((i) => <Skeleton key={i} shape="rect" width={168} height={130} />)}
            {!recent.isLoading && (recent.data?.length ?? 0) === 0 && (
              <p className={styles.empty}>還沒有頁面。用左邊的「新增頁面」開始吧。</p>
            )}
            {(recent.data ?? []).slice(0, 8).map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.card}
                onClick={() => navigate(`/page/${p.id}`)}
              >
                <span className={styles.cardIcon} aria-hidden="true">
                  {p.icon ?? <Icon name={p.isDatabase ? 'table' : 'page'} size={22} />}
                </span>
                <span className={styles.cardTitle}>{displayTitle(p.title)}</span>
                <span className={styles.cardMeta}>{relativeTime(p.updatedAt)}</span>
              </button>
            ))}
          </div>

          <div className={styles.sectionHeader}>
            <Icon name="calendar" size={16} />
            即將到來
          </div>
          <div className={styles.upcoming}>還沒有連接日曆。</div>

          <div className={styles.sectionHeader}>
            <Icon name="template" size={16} />
            精選範本
          </div>
          <div className={styles.templates}>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={styles.template}
                onClick={async () => {
                  try {
                    const id = await createFromTemplate(t, workspace.id);
                    await tree.refetch();
                    navigate(`/page/${id}`);
                  } catch {
                    toast.error('建立失敗');
                  }
                }}
              >
                <span className={styles.templateIcon} aria-hidden="true">
                  {t.icon}
                </span>
                <span>
                  <span className={styles.templateName}>{t.name}</span>
                  <br />
                  <span className={styles.templateDesc}>{t.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
