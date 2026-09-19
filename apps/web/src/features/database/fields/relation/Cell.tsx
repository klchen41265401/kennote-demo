import type { CellProps } from '../types';
import { idsOf } from '../_shared/ops';
import { relatedTitle } from './titles';
import styles from '../_shared/fields.module.css';

export function Cell({ value, compact }: CellProps) {
  const ids = idsOf(value);
  if (ids.length === 0) return <span className={styles.empty} />;
  const max = compact ? 2 : 3;
  return (
    <span className={styles.chipRow}>
      {ids.slice(0, max).map((id) => (
        <span key={id} className={styles.relationChip}>
          {relatedTitle(id)}
        </span>
      ))}
      {ids.length > max ? <span className={styles.chipMore}>+{ids.length - max}</span> : null}
    </span>
  );
}
