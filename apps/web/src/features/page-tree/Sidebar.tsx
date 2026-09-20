/**
 * 側邊欄（M3）。版面照 reference/notion-capture/03*-sidebar-*.png：
 *
 *   ┌ 44px 圖示列：首頁 pill / 留言 / 收件匣 / 更新 ………… 搜尋
 *   ├ 工作區切換器（kennote 的加法，Notion 2026 把它收進首頁選單）
 *   ├ 收藏 / 最近 / 私人 / 共用（每區可收合、超過 N 筆顯示「… 更多」）
 *   └ 底部：範本 / 垃圾桶 / 說明 / 設定 ＋「新對話 Ctrl+O」pill ＋ 新頁圓鈕
 *
 * 拖曳搬移用 @kennote/ui 的 computeDropTarget（tree 模式：之間 vs 進裡面），
 * 循環（拖進自己的子孫）一律擋下並跳 toast。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { PageTreeNode, WorkspaceSummary } from '@kennote/shared-types';
import { plainTextToRichText } from '@kennote/shared-types';
import { Icon, Tooltip, toast, useDroppable } from '@kennote/ui';
import { DemoBadge } from '../../demo/DemoBadge';
import { InboxBadge } from '../notifications/InboxPanel';
import { useReorderAnnouncer } from '../../lib/keyboard-reorder';
import {
  createPage,
  deletePage,
  duplicatePage,
  movePage,
  patchPageTitle,
  setFavorite,
  useFavorites,
  useRecentPages,
  useSharedWithMe,
  useWorkspaceTree,
} from '../../lib/queries';
import {
  openOverlay,
  setMobileSidebarOpen,
  toggleExpanded,
  toggleRightPanel,
  toggleSection,
  toggleSidebar,
  useCollapsedSections,
  useExpanded,
} from '../../stores/ui';
import { useAuth } from '../../stores/auth';
import { createDatabase } from '../database';
import { TrashPopover } from '../trash/TrashPopover';
import { TemplatesMenu } from '../templates/TemplatesMenu';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { TreeRow, type TreeRowActions } from './TreeRow';
import {
  buildTree,
  descendantIds,
  displayTitle,
  flattenVisible,
  isDescendant,
  limitWithMore,
  type TreeNode,
} from './tree';
import styles from './Sidebar.module.css';

const SECTION_LIMIT = 10;
const DRAG_KIND = 'kn-page-tree';

export interface SidebarProps {
  workspace: WorkspaceSummary;
}

export function Sidebar({ workspace }: SidebarProps): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const tree = useWorkspaceTree(workspace.id);
  const favorites = useFavorites(workspace.id);
  const recent = useRecentPages(workspace.id);
  /*
   * 第六輪：「與我共用」。頁面層級授權現在對**工作區外的人**也有效
   * （`resolvePermission()` 只認直接指名的 user 條目，封頂 edit），
   * 但 tree / search / trash 都是成員限定 —— 沒有這一區，被分享的人
   * 在側邊欄上完全看不到那一頁，只能靠別人把網址貼給他。
   */
  const shared = useSharedWithMe(true);
  const expanded = useExpanded();
  const collapsedSections = useCollapsedSections();
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});

  const nodes = useMemo<PageTreeNode[]>(() => tree.data ?? [], [tree.data]);
  const roots = useMemo(() => buildTree(nodes), [nodes]);
  const favoriteIds = useMemo(
    () => new Set((favorites.data ?? []).map((f) => f.id)),
    [favorites.data],
  );

  const activeId = location.pathname.startsWith('/page/')
    ? location.pathname.slice('/page/'.length)
    : null;

  const refresh = useCallback(async () => {
    await tree.refetch();
  }, [tree]);

  /**
   * O-17（第十三輪）：側邊欄「上移 / 下移」的實作。
   *
   * 走的是拖放的同一個出口（`movePage({ parentId, afterId })`），
   * 只是 `afterId` 由**目前的兄弟順序**算出來而不是由落點算出來。
   * 播報放在這一層：搬完之後那一列會被重新排序，訊息若掛在列上會跟著卸載。
   */
  const announcer = useReorderAnnouncer();
  const reorderSibling = useCallback(
    async (id: string, direction: -1 | 1) => {
      const self = nodes.find((n) => n.id === id);
      if (!self) return;
      const siblings = nodes
        .filter((n) => n.parentId === self.parentId)
        .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : 1));
      const index = siblings.findIndex((n) => n.id === id);
      const to = index + direction;
      const title = displayTitle(self.title);
      if (index < 0) return;
      if (to < 0 || to >= siblings.length) {
        // 撞到頭 / 尾也要出聲，否則使用者分不出「按鍵沒收到」與「已經到底了」
        announcer.announce(`「${title}」已經在${direction < 0 ? '第一個' : '最後一個'}`);
        return;
      }
      /*
       * `afterId` 是「排在誰的後面」：往下搬要接在目標的後面（目標會往上補一格），
       * 往上搬則要接在目標的**前一個**後面（往上第 2 格）。
       * 這個 ±1 就是拖放 `before` / `after` 那段算的同一件事。
       */
      const afterId =
        direction > 0 ? (siblings[to]?.id ?? null) : (siblings[to - 1]?.id ?? null);
      try {
        await movePage(id, workspace.id, { parentId: self.parentId, afterId });
        await refresh();
        announcer.announce(`「${title}」已移到第 ${to + 1} 項，共 ${siblings.length} 項`);
      } catch {
        toast.error('搬移失敗');
      }
    },
    [nodes, workspace.id, refresh, announcer],
  );

  const actions = useMemo<TreeRowActions>(
    () => ({
      navigate: (id) => {
        navigate(`/page/${id}`);
        setMobileSidebarOpen(false);
      },
      toggle: (id) => toggleExpanded(id),
      createChild: async (parentId) => {
        const page = await createPage({ workspaceId: workspace.id, parentId, title: [] });
        await refresh();
        navigate(`/page/${page.id}`);
      },
      rename: async (id, title) => {
        await patchPageTitle(id, workspace.id, plainTextToRichText(title));
        await refresh();
      },
      duplicate: async (id) => {
        const page = await duplicatePage(id, workspace.id);
        await refresh();
        toast.success('已建立複本');
        navigate(`/page/${page.id}`);
      },
      trash: async (id) => {
        await deletePage(id, workspace.id);
        await refresh();
        toast.show({ title: '已移至垃圾桶' });
        if (activeId === id) navigate('/');
      },
      copyLink: (id) => {
        void navigator.clipboard
          ?.writeText(`${window.location.origin}/page/${id}`)
          .then(() => toast.success('已複製連結'))
          .catch(() => toast.error('無法複製連結'));
      },
      toggleFavorite: async (id, next) => {
        await setFavorite(id, workspace.id, next);
        await favorites.refetch();
      },
      moveTo: (id) => openOverlay('moveTo', { moveTargetId: id }),
      reorder: (id, direction) => void reorderSibling(id, direction),
      openInNewTab: (id) => window.open(`/page/${id}`, '_blank', 'noopener'),
    }),
    [navigate, workspace.id, refresh, activeId, favorites, reorderSibling],
  );

  /* ── 拖曳落點 ───────────────────────────────────────── */
  const privateRows = useMemo(() => flattenVisible(roots, expanded), [roots, expanded]);

  const onDrop = useCallback(
    async (result: { sourceId: string; target: { id: string; position: string } }) => {
      const { target } = result;
      // sourceId 在非私人區會帶區段前綴（見 TreeRow 的 dragId），這裡取回真正的 pageId
      const sourceId = result.sourceId.includes(':')
        ? (result.sourceId.split(':').pop() ?? result.sourceId)
        : result.sourceId;
      if (!target || sourceId === target.id) return;
      const targetNode = nodes.find((n) => n.id === target.id);
      if (!targetNode) return;

      const parentId = target.position === 'inside' ? targetNode.id : targetNode.parentId;
      if (parentId && isDescendant(nodes, sourceId, parentId)) {
        toast.error('不能把頁面移到自己的子頁面底下');
        return;
      }

      // 之間：排在目標之後（before 時排在目標的前一個兄弟之後）
      let afterId: string | null = null;
      if (target.position === 'after') afterId = targetNode.id;
      else if (target.position === 'before') {
        const siblings = nodes
          .filter((n) => n.parentId === targetNode.parentId)
          .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
        const idx = siblings.findIndex((n) => n.id === targetNode.id);
        afterId = idx > 0 ? (siblings[idx - 1]?.id ?? null) : null;
      }

      try {
        await movePage(sourceId, workspace.id, { parentId, afterId });
        await refresh();
      } catch {
        toast.error('搬移失敗');
      }
    },
    [nodes, workspace.id, refresh],
  );

  const { setNodeRef: setZoneRef } = useDroppable({
    id: 'sidebar-private',
    accepts: [DRAG_KIND],
    dropOptions: { mode: 'tree', indentUnit: 18, insideThreshold: 20 },
    onDrop: (r) => {
      if (!r.target) return;
      void onDrop({ sourceId: r.sourceId, target: r.target });
    },
  });

  /**
   * 同 TreeRow 的理由：StrictMode 會讓 useDroppable 自我註銷，這裡補註冊回去。
   * ⚠️ 相依只能放**穩定**的 `setNodeRef`，不能放 `useDroppable()` 回傳的整個物件 ——
   * 那個物件每次 render 都是新的，effect 會跟著每次 render 重跑，
   * 而重新註冊會把 zone 的 rect / items 快取清空；拖曳中一旦發生，落點就永遠算不出來。
   */
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const attachZone = useCallback(
    (el: HTMLDivElement | null) => {
      zoneRef.current = el;
      setZoneRef(el);
    },
    [setZoneRef],
  );
  useEffect(() => {
    if (zoneRef.current) setZoneRef(zoneRef.current);
  }, [setZoneRef]);

  /* ── 分區 ──────────────────────────────────────────── */
  const sectionOpen = (id: string): boolean => !collapsedSections.has(id);

  function renderFlatList(items: readonly PageTreeNode[], sectionId: string): JSX.Element[] {
    const visible = limitWithMore(items, SECTION_LIMIT, showAll[sectionId] ?? false);
    const rows = visible.map((n) => (
      <TreeRow
        key={`${sectionId}:${n.id}`}
        node={{ ...n, depth: 0, children: [] } as TreeNode}
        depth={0}
        expanded={false}
        hasChildren={false}
        active={activeId === n.id}
        favorite={favoriteIds.has(n.id)}
        actions={actions}
        dragKind={`${DRAG_KIND}:${sectionId}`}
        dragId={`${sectionId}:${n.id}`}
        draggable={false}
      />
    ));
    if (items.length > SECTION_LIMIT) {
      rows.push(
        <button
          key={`${sectionId}:more`}
          type="button"
          className={styles.more}
          onClick={() => setShowAll((s) => ({ ...s, [sectionId]: !s[sectionId] }))}
        >
          <Icon name="more-horizontal" size={16} />
          {showAll[sectionId] ? '收起' : '更多'}
        </button>,
      );
    }
    return rows;
  }

  return (
    <nav className={styles.sidebar} aria-label="側邊欄">
      {/* O-17：上移 / 下移的播報（整個側邊欄共用一個，見 reorderSibling） */}
      {announcer.live}
      <div className={styles.topRow}>
        <button
          type="button"
          className={`${styles.homePill} ${location.pathname === '/' ? '' : styles.homePillQuiet}`}
          onClick={() => navigate('/')}
        >
          <Icon name="home" size={18} />
          首頁
        </button>
        <Tooltip content="留言">
          <button
            type="button"
            className={styles.topIcon}
            aria-label="留言"
            onClick={() => toggleRightPanel('comments')}
          >
            <Icon name="comment" size={20} />
          </button>
        </Tooltip>
        <Tooltip content="收件匣">
          <button
            type="button"
            className={styles.topIcon}
            aria-label="收件匣"
            onClick={() => navigate('/inbox')}
          >
            <Icon name="inbox" size={20} />
            <InboxBadge />
          </button>
        </Tooltip>
        <Tooltip content="更新">
          <button
            type="button"
            className={styles.topIcon}
            aria-label="更新"
            /*
             * gap-review B-5：這顆按鈕叫「更新」，以前卻打開版本歷史。
             * Notion 的「更新」是活動 feed（誰改了什麼 / 誰留了言），
             * 版本紀錄是另一個獨立檢視。
             */
            onClick={() => toggleRightPanel('updates')}
          >
            <Icon name="history" size={20} />
          </button>
        </Tooltip>
        <span className={styles.spacer} />
        <Tooltip content="收合側邊欄" shortcut="mod+\\">
          <button
            type="button"
            className={`${styles.topIcon} ${styles.collapseButton}`}
            aria-label="收合側邊欄"
            onClick={() => toggleSidebar()}
          >
            <Icon name="sidebar-toggle" size={20} />
          </button>
        </Tooltip>
        <Tooltip content="搜尋" shortcut="mod+k">
          <button
            type="button"
            className={styles.topIcon}
            aria-label="搜尋"
            onClick={() => openOverlay('search')}
          >
            <Icon name="search" size={20} />
          </button>
        </Tooltip>
      </div>

      <WorkspaceSwitcher workspace={workspace} userName={user?.name ?? user?.email ?? ''} />

      <div className={styles.scroll}>
        {(favorites.data?.length ?? 0) > 0 && (
          <Section
            id="favorites"
            title="收藏"
            open={sectionOpen('favorites')}
            onToggle={() => toggleSection('favorites')}
          >
            {renderFlatList(favorites.data ?? [], 'favorites')}
          </Section>
        )}

        {(shared.data?.length ?? 0) > 0 && (
          <Section
            id="shared"
            title="與我共用"
            open={sectionOpen('shared')}
            onToggle={() => toggleSection('shared')}
          >
            {renderFlatList(shared.data ?? [], 'shared')}
          </Section>
        )}

        <Section
          id="recent"
          title="最近"
          open={sectionOpen('recent')}
          onToggle={() => toggleSection('recent')}
        >
          {renderFlatList(recent.data ?? [], 'recent')}
        </Section>

        <Section
          id="private"
          title="私人"
          open={sectionOpen('private')}
          onToggle={() => toggleSection('private')}
          actions={
            <Tooltip content="新增頁面">
              <button
                type="button"
                className={styles.rowAction}
                aria-label="新增頁面"
                onClick={async () => {
                  const page = await createPage({ workspaceId: workspace.id, title: [] });
                  await refresh();
                  navigate(`/page/${page.id}`);
                }}
              >
                <Icon name="plus" size={16} />
              </button>
            </Tooltip>
          }
        >
          <div ref={attachZone} role="tree" aria-label="私人頁面">
            {tree.isLoading && <p className={styles.emptyHint}>載入中…</p>}
            {!tree.isLoading && privateRows.length === 0 && (
              <p className={styles.emptyHint}>還沒有頁面，按上面的 ＋ 建立第一頁</p>
            )}
            {privateRows.map((row) => (
              <TreeRow
                key={row.node.id}
                node={row.node}
                depth={row.depth}
                expanded={expanded.has(row.node.id)}
                hasChildren={row.hasChildren}
                active={activeId === row.node.id}
                favorite={favoriteIds.has(row.node.id)}
                actions={actions}
                dragKind={DRAG_KIND}
                draggable
              />
            ))}
          </div>
        </Section>

        <button
          type="button"
          className={styles.more}
          onClick={async () => {
            const page = await createPage({ workspaceId: workspace.id, title: [] });
            await refresh();
            navigate(`/page/${page.id}`);
          }}
        >
          <Icon name="plus" size={16} />
          新增頁面
        </button>

        {/**
         * 功能 QA 第三輪 §1.1 的缺口：側邊欄沒有建立資料庫的入口，
         * 唯一路徑是「新增頁面 → `/資料庫 - 整頁`」。這裡補一個整頁資料庫的入口。
         */}
        <button
          type="button"
          className={styles.more}
          onClick={async () => {
            const snapshot = await createDatabase({
              workspaceId: workspace.id,
              title: '未命名資料庫',
              inline: false,
            });
            await refresh();
            navigate(`/database/${snapshot.collection.pageId}`);
          }}
        >
          <Icon name="table" size={16} />
          新增資料庫
        </button>
      </div>

      <div className={styles.footer}>
        {/* Demo 模式（VITE_DEMO=1）才會出現；正式站回 null */}
        <DemoBadge />
        <TemplatesMenu
          workspaceId={workspace.id}
          onCreated={async (id) => {
            await refresh();
            navigate(`/page/${id}`);
          }}
          trigger={
            <button type="button" className={styles.footerRow}>
              <Icon name="template" size={18} />
              範本
            </button>
          }
        />
        <TrashPopover
          workspaceId={workspace.id}
          onRestored={refresh}
          trigger={
            <button type="button" className={styles.footerRow}>
              <Icon name="trash" size={18} />
              垃圾桶
            </button>
          }
        />
        <button
          type="button"
          className={styles.footerRow}
          onClick={() => openOverlay('shortcuts')}
        >
          <Icon name="help" size={18} />
          說明與快捷鍵
        </button>
        <button
          type="button"
          className={styles.footerRow}
          onClick={() => openOverlay('settings')}
        >
          <Icon name="settings" size={18} />
          設定
        </button>

        <div className={styles.aiRow}>
          <button
            type="button"
            className={styles.aiPill}
            onClick={() => toast.show({ title: 'kennote AI 尚未開放', description: '這是 P2 的功能。' })}
          >
            {/* Notion 這顆是 AI 星芒，不是同步箭頭（03e-sidebar-bottom-light.png） */}
            <Icon name="sparkle" size={16} />
            新對話
            <span className={styles.aiKbd}>Ctrl+O</span>
          </button>
          <Tooltip content="新增頁面" shortcut="mod+n">
            <button
              type="button"
              className={styles.newPageCircle}
              aria-label="新增頁面"
              onClick={async () => {
                const page = await createPage({ workspaceId: workspace.id, title: [] });
                await refresh();
                navigate(`/page/${page.id}`);
              }}
            >
              <Icon name="text" size={18} />
            </button>
          </Tooltip>
        </div>
      </div>
    </nav>
  );
}

interface SectionProps {
  id: string;
  title: string;
  open: boolean;
  onToggle(): void;
  actions?: JSX.Element;
  children: React.ReactNode;
}

function Section({ title, open, onToggle, actions, children }: SectionProps): JSX.Element {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <button type="button" className={styles.sectionHeaderButton} onClick={onToggle} aria-expanded={open}>
          {title}
        </button>
        {actions && <span className={styles.sectionActions}>{actions}</span>}
      </div>
      {open && children}
    </section>
  );
}

export { descendantIds };
