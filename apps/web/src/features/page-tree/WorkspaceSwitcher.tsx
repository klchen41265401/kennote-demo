/**
 * 工作區切換器。Notion 2026 把它收進「首頁」選單裡，
 * 但 kennote 一個帳號可以有多個工作區，做成獨立一列比較直覺（見 features/shell/README.md 決策 #2）。
 */
import { useState } from 'react';
import type { WorkspaceSummary } from '@kennote/shared-types';
import { Icon, Menu, MenuGroup, MenuItem, MenuSeparator, toast } from '@kennote/ui';
import { createWorkspace } from '../../lib/queries';
import { logout, reloadMe, useAuth } from '../../stores/auth';
import { openOverlay, setSettingsTab } from '../../stores/ui';
import { setActiveWorkspace } from '../../stores/workspace';
import styles from './Sidebar.module.css';

export interface WorkspaceSwitcherProps {
  workspace: WorkspaceSummary;
  userName: string;
}

export function WorkspaceSwitcher({ workspace, userName }: WorkspaceSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { workspaces, user } = useAuth();

  async function handleCreate(): Promise<void> {
    const name = window.prompt('新工作區名稱', '我的工作區');
    if (!name) return;
    try {
      const created = await createWorkspace(name);
      await reloadMe();
      setActiveWorkspace(created.id);
      toast.success('已建立工作區');
    } catch {
      toast.error('建立工作區失敗');
    }
  }

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      trigger={
        <button type="button" className={styles.workspaceRow} aria-label="切換工作區">
          <span className={styles.workspaceAvatar} aria-hidden="true">
            {workspace.icon ?? workspace.name.slice(0, 1).toUpperCase()}
          </span>
          <span className={styles.workspaceName}>{workspace.name}</span>
          <Icon name="chevron-down" size={14} className={styles.workspaceChevron} />
        </button>
      }
    >
      <MenuGroup label={user?.email ?? userName}>
        {workspaces.map((ws) => (
          <MenuItem
            key={ws.id}
            icon={<span className={styles.workspaceAvatar}>{ws.icon ?? ws.name.slice(0, 1).toUpperCase()}</span>}
            checked={ws.id === workspace.id}
            textValue={ws.name}
            onSelect={() => setActiveWorkspace(ws.id)}
          >
            {ws.name}
          </MenuItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem icon={<Icon name="plus" size={16} />} onSelect={() => void handleCreate()}>
        建立工作區
      </MenuItem>
      <MenuItem
        icon={<Icon name="settings" size={16} />}
        onSelect={() => {
          setSettingsTab('workspace');
          openOverlay('settings');
        }}
      >
        工作區設定
      </MenuItem>
      <MenuItem
        icon={<Icon name="user" size={16} />}
        onSelect={() => {
          setSettingsTab('account');
          openOverlay('settings');
        }}
      >
        我的帳號
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Icon name="close" size={16} />} onSelect={() => void logout()}>
        登出
      </MenuItem>
    </Menu>
  );
}
