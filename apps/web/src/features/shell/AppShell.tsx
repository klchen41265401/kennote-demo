/**
 * App shell 的骨架層（02 §3.2 / §3.6）：
 *
 *   Sidebar（Resizable 200–420、Ctrl+\ 收合、收合後 hover 左緣浮出抽屜）
 * + 主欄（TopBar 由各 route 自己畫，因為麵包屑要依頁面而定）
 * + RightPanel（Tabs：留言 / 版本歷史，Resizable 300–520，預設收合）
 *
 * 全域浮層（搜尋 / 設定 / 快捷鍵 / 移動到）也掛在這裡，確保整個 App 只有一份。
 */
import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Resizable, Tooltip, Icon } from '@kennote/ui';
import { Sidebar } from '../page-tree/Sidebar';
import { CommentsPanel } from '../comments/CommentsPanel';
import { HistoryPanel } from '../history/HistoryPanel';
import { SearchDialog } from '../search/SearchDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { MoveToDialog } from './MoveToDialog';
import { useWorkspace } from '../../stores/workspace';
import { useAuth } from '../../stores/auth';
import {
  closeOverlay,
  isNarrow,
  openOverlay,
  rememberLastPage,
  setHistoryPreview,
  setMobileSidebarOpen,
  setRightPanel,
  setRightPanelWidth,
  setSidebarPeek,
  setSidebarWidth,
  uiStore,
  toggleSidebar,
  useBreakpoint,
  useUi,
} from '../../stores/ui';
import { recordVisit } from '../../stores/pages';
import { createPage, usePagePermission } from '../../lib/queries';
import { useGlobalShortcuts } from '../../lib/shortcuts';
import { applyTheme, getTheme } from '../../lib/theme';
import styles from './Shell.module.css';

export function AppShell(): JSX.Element {
  const workspace = useWorkspace();
  const { user } = useAuth();
  const ui = useUi();
  const bp = useBreakpoint();
  const navigate = useNavigate();
  const location = useLocation();
  const peekTimer = useRef<number | null>(null);

  /**
   * 目前這條路由對應的頁面 id。
   *
   * ⚠️ 原本只認 `/page/`，於是**整頁資料庫**（`/database/:pageId`，決策 6）
   * 一律拿到 `null` —— 頂欄的「留言 / 版本歷史」按得下去，右側面板卻只會寫
   * 「選一個頁面才能看留言與版本歷史」。資料庫本身也是一個頁面（row = page 的
   * 那個 collection 掛在它上面），Notion 在整頁資料庫上一樣有留言與更新。
   */
  const pageId =
    /^\/(?:page|database)\/([^/?#]+)/.exec(location.pathname)?.[1] ?? null;

  useEffect(() => {
    if (pageId) {
      rememberLastPage(pageId);
      recordVisit(pageId);
    }
  }, [pageId]);

  // 換頁時離開歷史預覽（02 §3.6）
  useEffect(() => setHistoryPreview(null), [pageId]);

  /**
   * 收合後：滑鼠移到視窗左緣 → 浮出抽屜；移開夠遠 → 收回去。
   *
   * 開與關都由**同一個 window mousemove** 判斷，不用 onMouseEnter / onMouseLeave：
   * 抽屜是在滑鼠已經停在左緣時才掛載的，那時候不會有 enter 事件，
   * 而剛掛載的元素又會立刻收到一個 mouseout → 抽屜會當場自己關掉。
   */
  useEffect(() => {
    if (!ui.sidebarCollapsed || isNarrow()) return;
    const onMove = (e: MouseEvent): void => {
      const clearPending = (): void => {
        if (peekTimer.current) {
          window.clearTimeout(peekTimer.current);
          peekTimer.current = null;
        }
      };
      if (e.clientX <= 12) {
        if (peekTimer.current === null) {
          peekTimer.current = window.setTimeout(() => setSidebarPeek(true), 120);
        }
        return;
      }
      clearPending();
      // 離開抽屜範圍才收回去（抽屜本身左緣 8px + 目前寬度 + 一點寬容值）
      if (e.clientX > uiStore.getState().sidebarWidth + 32) setSidebarPeek(false);
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (peekTimer.current) window.clearTimeout(peekTimer.current);
      peekTimer.current = null;
    };
  }, [ui.sidebarCollapsed]);

  useGlobalShortcuts({
    newPage: async () => {
      if (!workspace) return;
      const page = await createPage({ workspaceId: workspace.id, title: [] });
      navigate(`/page/${page.id}`);
    },
    search: () => openOverlay('search'),
    quickSwitch: () => openOverlay('quickSwitch'),
    toggleSidebar: () => toggleSidebar(),
    toggleTheme: () => {
      const current = getTheme();
      applyTheme(current === 'dark' ? 'light' : 'dark');
    },
    shortcutHelp: () => openOverlay('shortcuts'),
    settings: () => openOverlay('settings'),
    goBack: () => navigate(-1),
    goForward: () => navigate(1),
    newAiChat: () => openOverlay('search'),
  });

  if (!workspace) {
    return (
      <div className={styles.stateScreen}>
        <p className={styles.stateTitle}>這個帳號還沒有工作區</p>
        <p className={styles.stateHint}>重新登入一次，或聯絡管理員把你加進工作區。</p>
      </div>
    );
  }

  const narrow = bp !== 'desktop';
  const collapsed = ui.sidebarCollapsed || narrow;

  const sidebar = <Sidebar workspace={workspace} />;

  return (
    <div className={`${styles.shell} kn-shell`}>
      {!collapsed && (
        <Resizable
          className={styles.sidebarSlot}
          size={ui.sidebarWidth}
          min={200}
          max={420}
          side="right"
          resetSize={270}
          handleLabel="調整側邊欄寬度"
          onResize={setSidebarWidth}
          /* ⚠️ onResizeEnd 一定要給：@kennote/ui 的 Resizable 在鍵盤路徑寫的是
             `onResizeEnd?.(apply(...))`，optional chaining 會讓 apply() 整個不被求值，
             沒給這個 prop 的話「鍵盤調整寬度」與「雙擊重設」都會靜靜地沒反應。 */
          onResizeEnd={setSidebarWidth}
        >
          {sidebar}
        </Resizable>
      )}

      {/* 收合後：滑到左緣 → 浮出抽屜（感應由上面的 window mousemove 負責） */}
      {collapsed && !narrow && (
        <>
          {ui.sidebarPeek && (
            <div className={styles.peekDrawer} style={{ width: ui.sidebarWidth }}>
              {sidebar}
            </div>
          )}
        </>
      )}

      {/* 平板 / 手機：覆蓋式抽屜 */}
      {narrow && ui.mobileSidebarOpen && (
        <>
          <div className={styles.drawerBackdrop} onClick={() => setMobileSidebarOpen(false)} />
          <div className={styles.drawer}>{sidebar}</div>
        </>
      )}

      <div className={styles.main}>
        <Outlet />
      </div>

      {/*
        右側面板。
        ⚠️ 這裡原本寫的是 `ui.rightPanelOpen && !narrow` —— 也就是**視窗寬度只要
        小於 1280，整個面板就不掛載**。而頂欄 / 側邊欄的「留言」「更新」按鈕在
        768–1279 是看得見也按得下去的，按下去只會靜靜地翻一個 store flag，
        使用者看到的就是「右側欄打不開」。
        Notion 網頁版在窄螢幕不是拿掉面板，而是改成**覆蓋式抽屜**（內容不被推擠）。
        所以：桌機維持可拖曳的佔位欄，平板 / 手機改成覆蓋抽屜 + 遮罩。
      */}
      {ui.rightPanelOpen && !narrow && (
        <Resizable
          className={styles.rightSlot}
          size={ui.rightPanelWidth}
          min={300}
          max={520}
          side="left"
          resetSize={380}
          handleLabel="調整面板寬度"
          onResize={setRightPanelWidth}
          onResizeEnd={setRightPanelWidth}
        >
          <RightPanel pageId={pageId} userId={user?.id ?? null} />
        </Resizable>
      )}

      {ui.rightPanelOpen && narrow && (
        <>
          <div className={styles.rightBackdrop} onClick={() => setRightPanel(false)} />
          <div className={styles.rightDrawer}>
            <RightPanel pageId={pageId} userId={user?.id ?? null} />
          </div>
        </>
      )}

      {/* ── 全域浮層 ── */}
      <SearchDialog
        open={ui.overlay === 'search' || ui.overlay === 'quickSwitch'}
        compact={ui.overlay === 'quickSwitch'}
        workspaceId={workspace.id}
        onClose={closeOverlay}
        onOpenPage={(id) => {
          closeOverlay();
          navigate(`/page/${id}`);
        }}
      />
      <SettingsDialog open={ui.overlay === 'settings'} workspace={workspace} onClose={closeOverlay} />
      <ShortcutsDialog open={ui.overlay === 'shortcuts'} onClose={closeOverlay} />
      <MoveToDialog
        open={ui.overlay === 'moveTo'}
        workspaceId={workspace.id}
        pageId={ui.moveTargetId}
        onClose={closeOverlay}
      />
    </div>
  );
}

function RightPanel({ pageId, userId }: { pageId: string | null; userId: string | null }): JSX.Element {
  const ui = useUi();
  // 第六輪 BUG-32：留言框與「還原這個版本」都要看權限（見下面兩處用法）
  const commentPermission = usePagePermission(pageId);
  return (
    <aside className={styles.rightPanel} aria-label="側邊面板">
      <div className={styles.rightHeader}>
        <div className={styles.rightTabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={ui.rightPanelTab === 'comments'}
            className={`${styles.rightTab} ${ui.rightPanelTab === 'comments' ? styles.rightTabActive : ''}`}
            onClick={() => setRightPanel(true, 'comments')}
          >
            留言
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={ui.rightPanelTab === 'history'}
            className={`${styles.rightTab} ${ui.rightPanelTab === 'history' ? styles.rightTabActive : ''}`}
            onClick={() => setRightPanel(true, 'history')}
          >
            版本歷史
          </button>
        </div>
        <Tooltip content="關閉面板">
          <button
            type="button"
            className={styles.rightTab}
            aria-label="關閉面板"
            onClick={() => setRightPanel(false)}
          >
            <Icon name="close" size={16} />
          </button>
        </Tooltip>
      </div>
      <div className={styles.rightBody}>
        {!pageId && <p className={styles.stateHint}>選一個頁面才能看留言與版本歷史。</p>}
        {pageId && ui.rightPanelTab === 'comments' && (
          <CommentsPanel
            pageId={pageId}
            currentUserId={userId}
            /*
             * 第六輪 BUG-32：`canComment` 預設 `true`，所以只有 `read` 權限的人
             * 也看得到留言輸入框（送出才 403）。`comment` 以上才給。
             */
            canComment={commentPermission.permission !== 'read'}
            onHighlightBlock={(blockId) => {
              if (!blockId) return;
              document.querySelector(`[data-block-id="${blockId}"]`)?.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
              });
            }}
          />
        )}
        {pageId && ui.rightPanelTab === 'history' && (
          <HistoryPanel
            pageId={pageId}
            onPreview={(seq) => setHistoryPreview(seq)}
            /* 還原是寫入：只有 edit / full 能按 */
            canRestore={commentPermission.canEdit !== false}
          />
        )}
      </div>
    </aside>
  );
}
