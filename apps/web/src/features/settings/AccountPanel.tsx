/**
 * 設定 →「我的帳號」。
 *
 * M3 時這一頁的頭像／改密碼／登出所有裝置是停用狀態，因為後端沒有端點；
 * 現在 auth 模組補上了 PATCH /me、POST /password、POST /claim、
 * GET/DELETE /sessions、POST /logout-all、DELETE /me，整頁改成可用。
 *
 * 版面沿用 SettingsDialog.module.css 的 row / rowBody / rowControl（Notion 風格）。
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { SessionInfo, WorkspaceSummary } from '@kennote/shared-types';
import { Avatar, Button, Icon, Input, toast } from '@kennote/ui';
import { ApiError } from '../../lib/api-client';
import { checkAvatarFile, revokeSession, uploadAvatar, useSessions } from '../../lib/queries';
import { describeDevice, formatSessionTime } from './device';
import {
  changePassword,
  claimAccount,
  deleteAccount,
  isGuestAccount,
  logout,
  logoutAll,
  updateProfile,
  useAuth,
} from '../../stores/auth';
import styles from './SettingsDialog.module.css';

/** 後端的錯誤訊息已經是繁體中文且面向使用者，直接用；其他例外才退回泛用句 */
function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function AccountPanel({ workspace }: { workspace: WorkspaceSummary }): JSX.Element {
  const { user } = useAuth();
  const isGuest = isGuestAccount(user);

  return (
    <>
      <h2 className={styles.panelTitle}>我的帳號</h2>
      <p className={styles.panelSubtitle}>你的個人資料，工作區裡的成員都看得到。</p>

      {isGuest && <GuestUpgradeCard />}

      <AvatarRow workspace={workspace} />
      <NameRow />

      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>電子郵件</div>
          <div className={styles.rowHint}>
            {isGuest ? '訪客帳號還沒有電子郵件。' : user?.email}
          </div>
        </div>
      </div>

      <PasswordSection isGuest={isGuest} />
      <SessionsSection />
      <DangerZone />
    </>
  );
}

/* ── 訪客升級 ──────────────────────────────────────────── */

function GuestUpgradeCard(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await claimAccount({
        email: email.trim(),
        password,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      setPassword('');
      toast.success('已設定完成，之後可以用這組帳號密碼登入');
    } catch (err) {
      setError(errorMessage(err, '設定失敗，請再試一次'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardIcon}>
        <Icon name="lock" size={18} />
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardTitle}>這是訪客帳號</div>
        <p className={styles.cardText}>
          設定 email 與密碼以保留資料。現在建立的頁面都會留在同一個帳號裡，
          不設定的話換一台裝置或清掉瀏覽器資料就進不來了。
        </p>
        <div className={styles.cardForm}>
          <Input
            size="sm"
            type="email"
            autoComplete="email"
            placeholder="電子郵件"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            size="sm"
            type="password"
            autoComplete="new-password"
            placeholder="設定密碼（至少 8 個字元）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Input
            size="sm"
            placeholder="顯示名稱（選填）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!email.trim() || password.length < 8}
            onClick={() => void submit()}
          >
            設定 email 與密碼
          </Button>
        </div>
        {error && <div className={styles.errorText}>{error}</div>}
      </div>
    </div>
  );
}

/* ── 頭像 ──────────────────────────────────────────────── */

function AvatarRow({ workspace }: { workspace: WorkspaceSummary }): JSX.Element {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** 上傳完成前先用 object URL 預覽，不讓使用者盯著沒變化的畫面 */
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function upload(file: File): Promise<void> {
    const problem = checkAvatarFile(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setBusy(true);
    try {
      const meta = await uploadAvatar(file, workspace.id);
      await updateProfile({ avatarUrl: meta.url });
      toast.success('已更新頭像');
    } catch (err) {
      toast.error(errorMessage(err, '頭像上傳失敗'));
    } finally {
      setBusy(false);
      setPreview(null);
      URL.revokeObjectURL(localUrl);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    try {
      await updateProfile({ avatarUrl: null });
      toast.show({ title: '已移除頭像' });
    } catch (err) {
      toast.error(errorMessage(err, '移除失敗'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.avatarRow}>
      <button
        type="button"
        className={`${styles.avatarDrop} ${dragging ? styles.avatarDropActive : ''}`}
        aria-label="上傳頭像"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
      >
        <Avatar
          name={user?.name ?? user?.email ?? '?'}
          src={preview ?? user?.avatarUrl ?? undefined}
          size={64}
        />
        <span className={styles.avatarOverlay}>
          <Icon name="image" size={16} />
        </span>
      </button>
      <div>
        <div className={styles.inline}>
          <Button variant="outline" size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
            上傳頭像
          </Button>
          {user?.avatarUrl && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
              移除
            </Button>
          )}
        </div>
        <div className={styles.rowHint}>把圖片拖進左邊的圓圈也可以，5 MB 以內。</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // 同一個檔案連選兩次也要觸發 change
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

/* ── 顯示名稱 ──────────────────────────────────────────── */

function NameRow(): JSX.Element {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => setName(user?.name ?? ''), [user?.name]);
  const dirty = name.trim() !== (user?.name ?? '') && name.trim() !== '';

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await updateProfile({ name: name.trim() });
      toast.success('已儲存');
    } catch (err) {
      toast.error(errorMessage(err, '儲存失敗'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowBody}>
        <div className={styles.rowLabel}>顯示名稱</div>
        <div className={styles.rowHint}>出現在頁面協作者與留言中。</div>
      </div>
      <div className={styles.rowControl}>
        <Input
          size="sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty) void save();
          }}
        />
        <Button variant="primary" size="sm" loading={busy} disabled={!dirty} onClick={() => void save()}>
          儲存
        </Button>
      </div>
    </div>
  );
}

/* ── 密碼 ──────────────────────────────────────────────── */

function PasswordSection({ isGuest }: { isGuest: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = next.length >= 8 && !mismatch && (isGuest || current.length > 0);

  function reset(): void {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const result = await changePassword({
        ...(isGuest ? {} : { currentPassword: current }),
        newPassword: next,
      });
      reset();
      setOpen(false);
      toast.success(
        result.revokedSessions > 0
          ? `密碼已更新，另外 ${result.revokedSessions} 個工作階段已登出`
          : '密碼已更新',
      );
    } catch (err) {
      setError(errorMessage(err, '變更密碼失敗'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3 className={styles.sectionTitle}>安全性</h3>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>{isGuest ? '設定密碼' : '變更密碼'}</div>
          <div className={styles.rowHint}>
            {isGuest
              ? '訪客帳號還沒有密碼，設定之後其他裝置會被登出。'
              : '變更後，除了這一台以外的裝置都會被登出。'}
          </div>
        </div>
        <div className={styles.rowControl}>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={open}
            aria-controls={formId}
            onClick={() => {
              setOpen((v) => !v);
              reset();
            }}
          >
            {open ? '取消' : isGuest ? '設定密碼' : '變更密碼'}
          </Button>
        </div>
      </div>

      {open && (
        <div className={styles.subForm} id={formId}>
          {!isGuest && (
            <Input
              size="sm"
              type="password"
              autoComplete="current-password"
              label="目前的密碼"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
          <Input
            size="sm"
            type="password"
            autoComplete="new-password"
            label="新密碼"
            hint="至少 8 個字元"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <Input
            size="sm"
            type="password"
            autoComplete="new-password"
            label="再輸入一次新密碼"
            {...(mismatch ? { error: '兩次輸入的密碼不一樣' } : {})}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error && <div className={styles.errorText}>{error}</div>}
          <div className={styles.inline}>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              確定變更
            </Button>
          </div>
        </div>
      )}

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

/* ── 裝置 ──────────────────────────────────────────────── */

function SessionsSection(): JSX.Element {
  const sessions = useSessions();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const list = (sessions.data ?? []) as SessionInfo[];

  async function revoke(session: SessionInfo): Promise<void> {
    setBusyId(session.id);
    try {
      await revokeSession(session.id);
      await sessions.refetch();
      toast.show({ title: '已登出該裝置' });
    } catch (err) {
      toast.error(errorMessage(err, '無法登出該裝置'));
    } finally {
      setBusyId(null);
    }
  }

  async function all(): Promise<void> {
    if (!window.confirm('登出所有裝置（包含這一台）？你需要重新登入。')) return;
    setLoggingOutAll(true);
    try {
      await logoutAll();
      // clearSession 之後 ProtectedRoute 會把人帶回登入頁，不需要自己導頁
    } catch (err) {
      toast.error(errorMessage(err, '登出失敗'));
      setLoggingOutAll(false);
    }
  }

  return (
    <>
      <h3 className={styles.sectionTitle}>登入中的裝置</h3>
      {sessions.isLoading && <p className={styles.rowHint}>載入中…</p>}
      {!sessions.isLoading && list.length === 0 && (
        <p className={styles.rowHint}>目前沒有其他工作階段。</p>
      )}
      {list.map((s) => (
        <div key={s.id} className={styles.row}>
          <div className={styles.rowBody}>
            <div className={styles.rowLabel}>
              {describeDevice(s.userAgent)}
              {s.current && <span className={styles.badge}>目前使用中</span>}
            </div>
            <div className={styles.rowHint}>
              {s.ip ?? '未知 IP'}・登入於 {formatSessionTime(s.createdAt)}・最後活動{' '}
              {formatSessionTime(s.lastUsedAt)}
            </div>
          </div>
          <div className={styles.rowControl}>
            <Button
              variant="ghost"
              size="sm"
              loading={busyId === s.id}
              disabled={s.current}
              onClick={() => void revoke(s)}
            >
              登出
            </Button>
          </div>
        </div>
      ))}
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={styles.rowLabel}>登出所有裝置</div>
          <div className={styles.rowHint}>包含這一台。懷疑密碼外洩時先做這件事。</div>
        </div>
        <div className={styles.rowControl}>
          <Button variant="danger" size="sm" loading={loggingOutAll} onClick={() => void all()}>
            登出所有裝置
          </Button>
        </div>
      </div>
    </>
  );
}

/* ── 刪除帳號 ──────────────────────────────────────────── */

function DangerZone(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function remove(): Promise<void> {
    setBusy(true);
    try {
      await deleteAccount();
      toast.show({ title: '帳號已刪除' });
    } catch (err) {
      toast.error(errorMessage(err, '刪除失敗'));
      setBusy(false);
    }
  }

  return (
    <>
      <h3 className={styles.sectionTitle}>危險區域</h3>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <div className={`${styles.rowLabel} ${styles.danger}`}>刪除帳號</div>
          <div className={styles.rowHint}>
            所有裝置都會被登出。只有你一個人的工作區會跟著刪除，還有其他成員的會把擁有者交接出去。
          </div>
        </div>
        <div className={styles.rowControl}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen((v) => !v);
              setConfirm('');
            }}
          >
            {open ? '取消' : '刪除帳號'}
          </Button>
        </div>
      </div>
      {open && (
        <div className={styles.subForm}>
          <Input
            size="sm"
            label="請輸入 DELETE 以確認"
            placeholder="DELETE"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <div className={styles.inline}>
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              disabled={confirm !== 'DELETE'}
              onClick={() => void remove()}
            >
              永久刪除我的帳號
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
