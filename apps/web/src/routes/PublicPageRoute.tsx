/**
 * 公開分享頁 `/share/:token`（01 §7）。
 *
 * 匿名可讀：`GET /api/public/:token`（需要密碼時帶 `?password=`）。
 * 這條路線刻意**不進 ProtectedRoute**，也不掛側邊欄。
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PageSnapshot } from '@kennote/shared-types';
import { COLLAB_API_ROUTES } from '@kennote/shared-types';
import { Button, Input, Spinner } from '@kennote/ui';
import { Editor } from '../features/editor/Editor';
import { PageHeader } from '../features/editor/PageHeader';
import { api, ApiError } from '../lib/api-client';
import styles from './PublicPageRoute.module.css';

interface PublicResponse {
  permission: string;
  snapshot: PageSnapshot;
  featurePublicShare: boolean;
}

export function PublicPageRoute(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicResponse | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (pwd?: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<PublicResponse>(
          COLLAB_API_ROUTES.publicPage(token),
          pwd ? { password: pwd } : {},
        );
        setData(res);
        setNeedPassword(false);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.code === 'INVALID_CREDENTIALS')) {
          setNeedPassword(true);
          if (pwd) setError('密碼不正確');
        } else {
          setError('這個連結無效或已失效。');
        }
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data && !needPassword) {
    return (
      <div className={styles.center}>
        <Spinner size={24} label="載入中" />
      </div>
    );
  }

  if (needPassword) {
    return (
      <div className={styles.center}>
        <form
          className={styles.passwordCard}
          onSubmit={(e) => {
            e.preventDefault();
            void load(password);
          }}
        >
          <h1 className={styles.title}>這個頁面需要密碼</h1>
          <Input
            type="password"
            value={password}
            autoFocus
            placeholder="輸入密碼"
            onChange={(e) => setPassword(e.target.value)}
            {...(error ? { error } : {})}
          />
          <Button variant="primary" type="submit" fullWidth>
            開啟頁面
          </Button>
        </form>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.center}>
        <p>{error ?? '找不到這個頁面。'}</p>
      </div>
    );
  }

  const page = data.snapshot.recordMap.page[data.snapshot.pageId]?.value;
  if (!page) {
    return (
      <div className={styles.center}>
        <p>找不到這個頁面。</p>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <span className={styles.brand}>kennote</span>
        <span className={styles.badge}>公開頁面 · 唯讀</span>
      </header>
      <div className={`${styles.scroll} kn-page-layout`} data-font="default">
        <PageHeader page={page} workspaceId={page.workspaceId} readOnly />
        <Editor
          pageId={page.id}
          workspaceId={page.workspaceId}
          snapshot={data.snapshot}
          readOnly
          onNavigateToPage={() => undefined}
        />
      </div>
    </div>
  );
}
