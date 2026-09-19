/** 「移動到…」（Ctrl+Shift+P）：搜尋頁面、選目標；循環一律擋下（tree.ts 的 canMove）。 */
import { useMemo, useState } from 'react';
import { Dialog, Icon, toast } from '@kennote/ui';
import { movePage, useWorkspaceTree } from '../../lib/queries';
import { ancestorChain, canMove, displayTitle } from '../page-tree/tree';
import styles from './MoveToDialog.module.css';

export interface MoveToDialogProps {
  open: boolean;
  workspaceId: string;
  pageId: string | null;
  onClose(): void;
}

export function MoveToDialog({ open, workspaceId, pageId, onClose }: MoveToDialogProps): JSX.Element {
  const tree = useWorkspaceTree(open ? workspaceId : null);
  const [query, setQuery] = useState('');
  const nodes = useMemo(() => tree.data ?? [], [tree.data]);

  const candidates = useMemo(() => {
    if (!pageId) return [];
    const q = query.trim().toLowerCase();
    return nodes
      .filter((n) => n.id !== pageId && canMove(nodes, pageId, n.id))
      .filter((n) => !q || displayTitle(n.title).toLowerCase().includes(q))
      .slice(0, 50);
  }, [nodes, pageId, query]);

  async function move(parentId: string | null): Promise<void> {
    if (!pageId) return;
    try {
      await movePage(pageId, workspaceId, { parentId });
      await tree.refetch();
      toast.success('已搬移');
      onClose();
    } catch {
      toast.error('搬移失敗');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm" align="top" title="移動到" flush>
      <div className={styles.wrap}>
        <div className={styles.inputRow}>
          <Icon name="search" size={18} />
          <input
            className={styles.input}
            autoFocus
            placeholder="搜尋要移到哪一頁…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜尋目標頁面"
          />
        </div>
        <div className={styles.list}>
          <button type="button" className={styles.item} onClick={() => void move(null)}>
            <span className={styles.itemIcon}>
              <Icon name="home" size={18} />
            </span>
            工作區最上層
          </button>
          {candidates.map((n) => {
            const chain = ancestorChain(nodes, n.id).slice(0, -1);
            return (
              <button key={n.id} type="button" className={styles.item} onClick={() => void move(n.id)}>
                <span className={styles.itemIcon}>{n.icon ?? <Icon name="page" size={18} />}</span>
                <span className={styles.itemBody}>
                  {displayTitle(n.title)}
                  {chain.length > 0 && (
                    <span className={styles.itemPath}>
                      {' '}
                      — {chain.map((c) => displayTitle(c.title)).join(' / ')}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {candidates.length === 0 && <p className={styles.empty}>沒有可以移到的頁面</p>}
        </div>
      </div>
    </Dialog>
  );
}
