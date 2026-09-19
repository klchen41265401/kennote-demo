/**
 * M1 的側邊欄：**扁平**頁面列表 + 新增 + 刪除。
 * M3 才換成真正的樹（展開/收合、自研拖曳），到時候只會動這個資料夾。
 */
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { PageTreeNode, WorkspaceSummary } from '@kennote/shared-types';
import { toggleTheme } from '../../lib/theme';
import { createPage, deletePage, useWorkspaceTree } from '../../lib/queries';
import { logout, useAuth } from '../../stores/auth';
import styles from './Sidebar.module.css';

export interface SidebarProps {
  workspace: WorkspaceSummary;
}

export function Sidebar({ workspace }: SidebarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: pages, isLoading, refetch } = useWorkspaceTree(workspace.id);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setBusy(true);
    try {
      const page = await createPage({ workspaceId: workspace.id, title: [] });
      await refetch();
      navigate(`/page/${page.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(node: PageTreeNode) {
    if (!window.confirm(`確定要把「${node.title || '未命名'}」移到垃圾桶嗎？子頁面會一起刪除。`)) {
      return;
    }
    setBusy(true);
    try {
      await deletePage(node.id, workspace.id);
      await refetch();
      navigate('/');
    } finally {
      setBusy(false);
    }
  }

  return (
    <nav className={styles.sidebar} aria-label="頁面導覽">
      <header className={styles.header}>
        <div className={styles.workspace}>
          <span className={styles.avatar} aria-hidden="true">
            {workspace.name.slice(0, 1)}
          </span>
          <div className={styles.workspaceMeta}>
            <span className={styles.workspaceName}>{workspace.name}</span>
            <span className={styles.userEmail}>{user?.email}</span>
          </div>
        </div>
      </header>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>頁面</span>
          <button
            className={styles.iconButton}
            onClick={handleCreate}
            disabled={busy}
            title="新增頁面"
            aria-label="新增頁面"
          >
            +
          </button>
        </div>

        {isLoading && <p className={styles.empty}>載入中…</p>}
        {!isLoading && (pages?.length ?? 0) === 0 && (
          <p className={styles.empty}>還沒有頁面，按上面的 + 建立第一頁</p>
        )}

        <ul className={styles.list}>
          {(pages ?? []).map((node) => (
            <li key={node.id} className={styles.item}>
              <NavLink
                to={`/page/${node.id}`}
                className={({ isActive }) =>
                  isActive ? `${styles.link} ${styles.linkActive}` : styles.link
                }
                style={{ paddingLeft: `${8 + depthOf(node, pages ?? []) * 14}px` }}
              >
                <span className={styles.icon} aria-hidden="true">
                  {node.icon ?? (node.isDatabase ? '🗃️' : '📄')}
                </span>
                <span className={styles.label}>{node.title || '未命名'}</span>
              </NavLink>
              <button
                className={styles.deleteButton}
                onClick={() => void handleDelete(node)}
                disabled={busy}
                title="移到垃圾桶"
                aria-label={`刪除 ${node.title || '未命名'}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>

      <footer className={styles.footer}>
        <button className={styles.footerButton} onClick={() => toggleTheme()}>
          切換主題
        </button>
        <button className={styles.footerButton} onClick={() => void logout()}>
          登出
        </button>
      </footer>
    </nav>
  );
}

/** M1 用縮排暗示層級；真正的樹狀展開留給 M3 */
function depthOf(node: PageTreeNode, all: PageTreeNode[]): number {
  let depth = 0;
  let current = node;
  const byId = new Map(all.map((n) => [n.id, n]));
  while (current.parentId && depth < 10) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
    depth += 1;
  }
  return depth;
}
