/**
 * 整頁資料庫：/w/:workspaceId/db/:collectionId
 *
 * 內嵌版本請用 `<InlineDatabase collectionId viewId />`（features/database）。
 */
import { useParams, useSearchParams } from 'react-router-dom';
import { DatabaseView } from '../features/database';
import styles from './DatabaseRoute.module.css';

export function DatabaseRoute() {
  const { collectionId } = useParams<{ workspaceId: string; collectionId: string }>();
  const [params] = useSearchParams();
  const viewId = params.get('view');

  if (!collectionId) {
    return <div className={styles.placeholder}>缺少資料庫 id。</div>;
  }

  return (
    <div className={styles.shell}>
      <DatabaseView collectionId={collectionId} {...(viewId ? { viewId } : {})} />
    </div>
  );
}
