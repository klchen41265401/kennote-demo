import { Outlet } from 'react-router-dom';
import { Sidebar } from '../features/page-tree/Sidebar';
import { useCurrentWorkspace } from '../stores/auth';
import styles from './WorkspaceRoute.module.css';

export function WorkspaceRoute() {
  const workspace = useCurrentWorkspace();

  if (!workspace) {
    return (
      <div className={styles.empty}>
        <p>這個帳號還沒有工作區。</p>
        <p className={styles.hint}>重新登入一次，或聯絡管理員把你加進工作區。</p>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <Sidebar workspace={workspace} />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
