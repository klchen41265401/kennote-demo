/**
 * 設定 Dialog（UI-SPEC §7）：左側導覽 + 右側內容，Ctrl+, 開啟。
 *
 * 分頁：我的帳號 / 我的設定 / 通知 / 成員 / 工作區 / 匯入匯出。
 * 「改密碼 / 登出所有裝置」需要 `apps/server/src/modules/auth/**` 的新端點，
 * 那個模組不在本代理的可改範圍，所以先做成停用狀態並標註 TODO（見 features/shell/README.md 決策 #7）。
 */
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceMember, WorkspaceSummary } from '@kennote/shared-types';
import { COLLAB_API_ROUTES } from '@kennote/shared-types';
import { Avatar, Button, Dialog, Icon, Input, Select, Switch, toast } from '@kennote/ui';
import { api } from '../../lib/api-client';
import { deleteWorkspace, patchWorkspace, useWorkspaceMembers } from '../../lib/queries';
import { logout, reloadMe, useAuth } from '../../stores/auth';
import { setSettingsTab, useUi } from '../../stores/ui';
import { applyTheme, getTheme, type Theme } from '../../lib/theme';
import { exportPage } from '../shell/export';
import styles from './SettingsDialog.module.css';

export interface SettingsDialogProps {
  open: boolean;
  workspace: WorkspaceSummary;
  onClose(): void;
}

const NAV: { group: string; items: { id: string; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] }[] = [
  {
    group: '帳號',
    items: [
      { id: 'account', label: '我的帳號', icon: 'user' },
      { id: 'preferences', label: '我的設定', icon: 'settings' },
      { id: 'notifications', label: '通知', icon: 'bell' },
    ],
  },
  {
    group: '工作區',
    items: [
      { id: 'members', label: '成員', icon: 'users' },
      { id: 'workspace', label: '一般', icon: 'home' },
      { id: 'importExport', label: '匯入 / 匯出', icon: 'import' },
    ],
  },
];

export function SettingsDialog({ open, workspace, onClose }: SettingsDialogProps): JSX.Element {
  const ui = useUi();
  const [navQuery, setNavQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const tab = ui.settingsTab;

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !navQuery || i.label.includes(navQuery)),
  })).filter((g) => g.items.length > 0);

  return (
    // Notion 的設定是「沒有標題列」的全螢幕對話框（08-settings-*.png）：
    // 左導覽直接貼齊頂端，關閉 X 浮在右上角。
    <Dialog
      open={open}
      onClose={onClose}
      size="full"
      flush
      showClose={false}
      initialFocus={searchRef}
      className={styles.dialog}
    >
      <h2 className="kn-sr-only">設定</h2>
      <button type="button" className={styles.close} aria-label="關閉" onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
      <div className={styles.wrap}>
        <nav className={styles.nav} aria-label="設定導覽">
          <div className={styles.navSearch}>
            <Input
              ref={searchRef}
              size="sm"
              placeholder="搜尋設定"
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              startAdornment={<Icon name="search" size={14} />}
            />
          </div>
          {groups.map((g) => (
            <div key={g.group}>
              <div className={styles.navGroup}>{g.group}</div>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.navItem} ${tab === item.id ? styles.navItemActive : ''}`}
                  onClick={() => setSettingsTab(item.id)}
                >
                  <Icon name={item.icon} size={16} />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.panel}>
          {tab === 'account' && <AccountPanel />}
          {tab === 'preferences' && <PreferencesPanel />}
          {tab === 'notifications' && <NotificationsPanel />}
          {tab === 'members' && <MembersPanel workspace={workspace} />}
          {tab === 'workspace' && <WorkspacePanel workspace={workspace} onClose={onClose} />}
          {tab === 'importExport' && <ImportExportPanel />}
        </div>
      </div>
    </Dialog>
  );
}

function AccountPanel(): JSX.Element {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? '');

  useEffect(() => setName(user?.name ?? ''), [user?.name]);

  return (
    <>
      <h2 className={styles.panelTitle}>我的帳號</h2>
      <p className={styles.panelSubtitle}>你的個人資料，工作區裡的成員都看得到。</p>

      <div className={styles.avatarRow}>
        <Avatar name={user?.name ?? user?.email ?? '?'} src={user?.avatarUrl ?? undefined} size={64} />
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.show({ title: '頭像上傳尚未開放', description: '需要 auth 模組的 PATCH /api/auth/me。' })}
          >
            上傳頭像
          </Button>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>顯示名稱</div>
          <div className={styles.rowHint}>出現在頁面協作者與留言中。</div>
        </div>
        <div className={styles.rowControl}>
          <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>電子郵件</div>
          <div className={styles.rowHint}>{user?.email}</div>
        </div>
      </div>

      <h3 className={styles.sectionTitle}>安全性</h3>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>變更密碼</div>
          <div className={styles.rowHint}>尚未開放（需要 auth 模組的新端點）。</div>
        </div>
        <div className={styles.rowControl}>
          <Button variant="outline" size="sm" disabled>
            變更密碼
          </Button>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>登出</div>
          <div className={styles.rowHint}>結束這一台裝置上的工作階段。</div>
        </div>
        <div className={styles.rowControl}>
          <Button variant="danger" size="sm" onClick={() => void logout()}>
            登出
          </Button>
        </div>
      </div>
    </>
  );
}

function PreferencesPanel(): JSX.Element {
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [startPage, setStartPage] = useState<string>(() => {
    try {
      return localStorage.getItem('kennote:start-page') ?? 'home';
    } catch {
      return 'home';
    }
  });

  return (
    <>
      <h2 className={styles.panelTitle}>我的設定</h2>
      <p className={styles.panelSubtitle}>選擇你想要的 kennote 外觀和行為。</p>

      <h3 className={styles.sectionTitle}>外觀</h3>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>主題</div>
          <div className={styles.rowHint}>選擇此裝置的 kennote 主題（Ctrl+Shift+L 可快速切換）。</div>
        </div>
        <div className={styles.rowControl}>
          <Select
            size="sm"
            value={theme}
            options={[
              { value: 'light', label: '淺色' },
              { value: 'dark', label: '深色' },
              { value: 'system', label: '使用系統設定' },
            ]}
            onChange={(v) => {
              setTheme(v as Theme);
              applyTheme(v as Theme);
            }}
          />
        </div>
      </div>

      <h3 className={styles.sectionTitle}>語言與時間</h3>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>語言</div>
          <div className={styles.rowHint}>目前只提供繁體中文。</div>
        </div>
        <div className={styles.rowControl}>
          <Select size="sm" value="zh-TW" options={[{ value: 'zh-TW', label: '繁體中文' }]} onChange={() => {}} />
        </div>
      </div>

      <h3 className={styles.sectionTitle}>開啟 kennote 時</h3>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>起始頁面</div>
          <div className={styles.rowHint}>登入後要落在哪裡。</div>
        </div>
        <div className={styles.rowControl}>
          <Select
            size="sm"
            value={startPage}
            options={[
              { value: 'home', label: '首頁' },
              { value: 'last', label: '上次造訪的頁面' },
            ]}
            onChange={(v) => {
              setStartPage(v);
              try {
                localStorage.setItem('kennote:start-page', v);
              } catch {
                /* 無痕模式 */
              }
            }}
          />
        </div>
      </div>
    </>
  );
}

function NotificationsPanel(): JSX.Element {
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(false);
  return (
    <>
      <h2 className={styles.panelTitle}>通知</h2>
      <p className={styles.panelSubtitle}>決定什麼時候要打擾你。</p>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>站內通知</div>
          <div className={styles.rowHint}>有人提到你或回覆你的留言時，在收件匣顯示。</div>
        </div>
        <div className={styles.rowControl}>
          <Switch checked={inApp} onChange={(e) => setInApp(e.target.checked)} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>電子郵件通知</div>
          <div className={styles.rowHint}>尚未開放（需要寄信服務）。</div>
        </div>
        <div className={styles.rowControl}>
          <Switch checked={email} disabled onChange={(e) => setEmail(e.target.checked)} />
        </div>
      </div>
    </>
  );
}

function MembersPanel({ workspace }: { workspace: WorkspaceSummary }): JSX.Element {
  const members = useWorkspaceMembers(workspace.id);
  const [invite, setInvite] = useState('');
  const list = (members.data ?? []) as WorkspaceMember[];

  async function sendInvite(): Promise<void> {
    if (!invite.trim()) return;
    try {
      await api.post(COLLAB_API_ROUTES.workspaceInvites(workspace.id), {
        email: invite.trim(),
        role: 'member',
      });
      setInvite('');
      toast.success('已送出邀請');
      await members.refetch();
    } catch {
      toast.error('邀請失敗');
    }
  }

  async function changeRole(userId: string, role: string): Promise<void> {
    try {
      await api.patch(COLLAB_API_ROUTES.workspaceMember(workspace.id, userId), { role });
      await members.refetch();
    } catch {
      toast.error('無法變更角色');
    }
  }

  async function remove(userId: string): Promise<void> {
    if (!window.confirm('確定要把這位成員移出工作區嗎？')) return;
    try {
      await api.delete(COLLAB_API_ROUTES.workspaceMember(workspace.id, userId));
      await members.refetch();
    } catch {
      toast.error('無法移除成員');
    }
  }

  return (
    <>
      <h2 className={styles.panelTitle}>成員</h2>
      <p className={styles.panelSubtitle}>管理可以存取「{workspace.name}」的人。</p>

      <div className={styles.inline} style={{ paddingTop: 16 }}>
        <Input
          size="sm"
          placeholder="以電子郵件邀請"
          value={invite}
          onChange={(e) => setInvite(e.target.value)}
        />
        <Button variant="primary" size="sm" onClick={() => void sendInvite()}>
          邀請
        </Button>
      </div>

      <h3 className={styles.sectionTitle}>目前成員（{list.length}）</h3>
      {list.map((m) => (
        <div key={m.userId} className={styles.memberRow}>
          <Avatar name={m.user.name} src={m.user.avatarUrl ?? undefined} size={28} />
          <span className={styles.memberName}>
            {m.user.name}
            <span className={styles.memberEmail}> {m.user.email}</span>
          </span>
          <Select
            size="sm"
            value={m.role}
            options={[
              { value: 'owner', label: '擁有者' },
              { value: 'admin', label: '管理員' },
              { value: 'member', label: '成員' },
              { value: 'guest', label: '訪客' },
            ]}
            onChange={(v) => void changeRole(m.userId, v)}
          />
          <Button variant="ghost" size="sm" onClick={() => void remove(m.userId)}>
            移除
          </Button>
        </div>
      ))}
      {list.length === 0 && <p className={styles.rowHint}>載入中…</p>}
    </>
  );
}

function WorkspacePanel({
  workspace,
  onClose,
}: {
  workspace: WorkspaceSummary;
  onClose(): void;
}): JSX.Element {
  const [name, setName] = useState(workspace.name);
  const [icon, setIcon] = useState(workspace.icon ?? '');
  const [slug, setSlug] = useState(workspace.slug);

  useEffect(() => {
    setName(workspace.name);
    setIcon(workspace.icon ?? '');
    setSlug(workspace.slug);
  }, [workspace.id, workspace.name, workspace.icon, workspace.slug]);

  async function save(): Promise<void> {
    try {
      await patchWorkspace(workspace.id, { name, icon: icon || null, slug });
      await reloadMe();
      toast.success('已儲存');
    } catch {
      toast.error('儲存失敗（可能沒有權限或網址已被使用）');
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`確定要刪除「${workspace.name}」嗎？這個動作無法復原。`)) return;
    try {
      await deleteWorkspace(workspace.id);
      await reloadMe();
      onClose();
      toast.show({ title: '已刪除工作區' });
    } catch {
      toast.error('刪除失敗（只有擁有者可以刪除）');
    }
  }

  return (
    <>
      <h2 className={styles.panelTitle}>工作區設定</h2>
      <p className={styles.panelSubtitle}>名稱、圖示與網址。</p>

      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>名稱</div>
        </div>
        <div className={styles.rowControl}>
          <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>圖示</div>
          <div className={styles.rowHint}>一個 emoji。</div>
        </div>
        <div className={styles.rowControl}>
          <Input size="sm" value={icon} maxLength={4} onChange={(e) => setIcon(e.target.value)} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>網址代稱（slug）</div>
          <div className={styles.rowHint}>只能用小寫英數字與連字號。</div>
        </div>
        <div className={styles.rowControl}>
          <Input size="sm" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </div>
      </div>

      <div className={styles.inline} style={{ paddingTop: 16 }}>
        <Button variant="primary" size="sm" onClick={() => void save()}>
          儲存
        </Button>
      </div>

      <h3 className={styles.sectionTitle}>危險區域</h3>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={`${styles.rowLabel} ${styles.danger}`}>刪除工作區</div>
          <div className={styles.rowHint}>所有頁面都會被刪除，無法復原。</div>
        </div>
        <div className={styles.rowControl}>
          <Button variant="danger" size="sm" onClick={() => void remove()}>
            刪除工作區
          </Button>
        </div>
      </div>
    </>
  );
}

function ImportExportPanel(): JSX.Element {
  return (
    <>
      <h2 className={styles.panelTitle}>匯入 / 匯出</h2>
      <p className={styles.panelSubtitle}>把內容搬進來或帶出去。</p>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>匯入 Markdown / CSV</div>
          <div className={styles.rowHint}>尚未開放（排在 M6）。</div>
        </div>
        <div className={styles.rowControl}>
          <Button variant="outline" size="sm" disabled>
            選擇檔案
          </Button>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>匯出目前頁面</div>
          <div className={styles.rowHint}>以 Markdown 下載。</div>
        </div>
        <div className={styles.rowControl}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const id = window.location.pathname.startsWith('/page/')
                ? window.location.pathname.slice('/page/'.length)
                : null;
              if (id) void exportPage(id);
              else toast.error('請先開啟一個頁面');
            }}
          >
            匯出
          </Button>
        </div>
      </div>
    </>
  );
}
