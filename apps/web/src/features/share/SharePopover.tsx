/**
 * 分享面板（04 §8 M5-12）：成員權限列表 + 公開連結開關 + 複製連結。
 *
 * 權限選項對應後端的 PagePermission：
 *   full（完全存取）/ edit（可編輯）/ comment（可留言）/ read（可檢視）/ none（移除）
 * guest 在後端會被封頂在 comment，即使這裡選了 edit（permissions/resolve.ts）。
 */
import { useEffect, useState } from 'react';
import type {
  PageAccessResponse,
  PagePermission,
  PublicLinkInfo,
  WorkspaceMember,
} from '@kennote/shared-types';
import { API_ROUTES, COLLAB_API_ROUTES } from '@kennote/shared-types';
import { useQuery } from '@kennote/ui';
import { api } from '../../lib/api-client';
import styles from './SharePopover.module.css';

const PERMISSION_LABEL: Record<PagePermission, string> = {
  full: '完全存取',
  edit: '可編輯',
  comment: '可留言',
  read: '可檢視',
  none: '移除',
};

export interface SharePopoverProps {
  pageId: string;
  workspaceId: string;
  onClose?(): void;
}

export function SharePopover({ pageId, workspaceId, onClose }: SharePopoverProps): JSX.Element {
  const access = useQuery<PageAccessResponse>({
    key: ['page', pageId, 'permissions'],
    fetcher: () => api.get<PageAccessResponse>(COLLAB_API_ROUTES.pageAccess(pageId)),
  });
  const members = useQuery<WorkspaceMember[]>({
    key: ['workspace', workspaceId, 'members'],
    fetcher: () => api.get<WorkspaceMember[]>(API_ROUTES.workspaceMembers(workspaceId)),
  });

  const [link, setLink] = useState<PublicLinkInfo | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');

  useEffect(() => {
    setLink(access.data?.publicLink ?? null);
  }, [access.data]);

  const setPermission = async (userId: string, permission: PagePermission): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post<PageAccessResponse>(COLLAB_API_ROUTES.pageAccess(pageId), {
        subjectType: 'user',
        subjectId: userId,
        permission,
      });
      await access.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新權限失敗');
    } finally {
      setBusy(false);
    }
  };

  const toggleLink = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const info = await api.post<PublicLinkInfo | null>(COLLAB_API_ROUTES.pageShare(pageId), {
        enabled,
        ...(password ? { password } : {}),
      });
      setLink(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : '公開連結設定失敗（可能未啟用此功能）');
    } finally {
      setBusy(false);
    }
  };

  const invite = async (): Promise<void> => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(COLLAB_API_ROUTES.workspaceInvites(workspaceId), {
        email: inviteEmail.trim(),
        role: 'member',
      });
      setInviteEmail('');
      members.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : '邀請失敗');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('無法複製，請手動選取連結');
    }
  };

  const entryPermission = (userId: string): PagePermission =>
    access.data?.entries.find((e) => e.subjectType === 'user' && e.subjectId === userId)
      ?.permission ?? 'edit';

  return (
    <div className={styles.popover} role="dialog" aria-label="分享">
      <header className={styles.header}>
        <h2 className={styles.title}>分享這一頁</h2>
        {onClose ? (
          <button type="button" className={styles.linkButton} onClick={onClose}>
            關閉
          </button>
        ) : null}
      </header>

      <div className={styles.inviteRow}>
        <input
          className={styles.input}
          value={inviteEmail}
          placeholder="用 email 邀請成員"
          onChange={(e) => setInviteEmail(e.target.value)}
          aria-label="邀請成員的 email"
        />
        <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void invite()}>
          邀請
        </button>
      </div>

      <ul className={styles.members}>
        {(members.data ?? []).map((member) => (
          <li key={member.userId} className={styles.member}>
            <span className={styles.memberName}>
              {member.user.name || member.user.email}
              <span className={styles.role}>{member.role}</span>
            </span>
            <select
              className={styles.select}
              value={entryPermission(member.userId)}
              disabled={busy}
              onChange={(e) => void setPermission(member.userId, e.target.value as PagePermission)}
              aria-label={`${member.user.name} 的權限`}
            >
              {(['full', 'edit', 'comment', 'read', 'none'] as PagePermission[]).map((p) => (
                <option key={p} value={p}>
                  {PERMISSION_LABEL[p]}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>

      <section className={styles.publicSection}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={link !== null}
            disabled={busy}
            onChange={(e) => void toggleLink(e.target.checked)}
          />
          公開連結（任何人都能檢視）
        </label>

        {link ? (
          <>
            <div className={styles.linkRow}>
              <input className={styles.input} value={link.url} readOnly aria-label="公開連結" />
              <button type="button" className={styles.primaryButton} onClick={() => void copy()}>
                {copied ? '已複製' : '複製'}
              </button>
            </div>
            <div className={styles.linkRow}>
              <input
                className={styles.input}
                type="password"
                value={password}
                placeholder={link.hasPassword ? '已設定密碼（輸入新密碼可更換）' : '設定密碼（選填）'}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="公開連結密碼"
              />
              <button
                type="button"
                className={styles.ghostButton}
                disabled={busy}
                onClick={() => void toggleLink(true)}
              >
                套用
              </button>
            </div>
          </>
        ) : null}
      </section>

      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
