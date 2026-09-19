/** 垃圾桶 Popover：清單 + 搜尋 + 還原 + 永久刪除（01 §9 資料生命週期）。 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, Popover, toast } from '@kennote/ui';
import { permanentlyDeletePage, restorePage, useTrash } from '../../lib/queries';
import { displayTitle } from '../page-tree/tree';
import { relativeTime } from '../../stores/pages';
import styles from './TrashPopover.module.css';

export interface TrashPopoverProps {
  workspaceId: string;
  trigger: JSX.Element;
  onRestored?(): void | Promise<void>;
}

export function TrashPopover({ workspaceId, trigger, onRestored }: TrashPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const trash = useTrash(open ? workspaceId : null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (trash.data ?? []).filter((p) => !q || displayTitle(p.title).toLowerCase().includes(q));
  }, [trash.data, query]);

  return (
    <Popover open={open} onOpenChange={setOpen} placement="right-start" padded={false} trigger={trigger}>
      <div className={styles.wrap}>
        <div className={styles.searchRow}>
          <Icon name="search" size={16} />
          <input
            className={styles.input}
            placeholder="搜尋垃圾桶裡的頁面"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜尋垃圾桶"
          />
        </div>
        <div className={styles.list}>
          {trash.isLoading && <p className={styles.empty}>載入中…</p>}
          {!trash.isLoading && items.length === 0 && <p className={styles.empty}>垃圾桶是空的</p>}
          {items.map((p) => (
            <div key={p.id} className={styles.item}>
              <button
                type="button"
                className={styles.itemMain}
                onClick={() => {
                  setOpen(false);
                  navigate(p.isDatabase ? `/database/${p.id}` : `/page/${p.id}`);
                }}
              >
                <span className={styles.itemIcon}>{p.icon ?? <Icon name="page" size={16} />}</span>
                <span className={styles.itemBody}>
                  <span className={styles.itemTitle}>{displayTitle(p.title)}</span>
                  <span className={styles.itemMeta}>
                    {/* 資料庫的列也會進垃圾桶，標示它原本屬於哪個資料庫 */}
                    {p.collectionId ? `${p.collectionTitle || '未命名資料庫'}・` : ''}
                    {relativeTime(p.deletedAt)}刪除
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={styles.action}
                aria-label="還原"
                title="還原"
                onClick={async () => {
                  await restorePage(p.id, workspaceId);
                  await trash.refetch();
                  await onRestored?.();
                  toast.success('已還原');
                }}
              >
                <Icon name="reload" size={16} />
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.danger}`}
                aria-label="永久刪除"
                title="永久刪除"
                onClick={async () => {
                  if (!window.confirm(`永久刪除「${displayTitle(p.title)}」？這個動作無法復原。`)) return;
                  await permanentlyDeletePage(p.id, workspaceId);
                  await trash.refetch();
                  toast.show({ title: '已永久刪除' });
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className={styles.footer}>垃圾桶裡的頁面 30 天後會自動清除。</div>
      </div>
    </Popover>
  );
}
