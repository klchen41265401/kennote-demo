import type { CellProps } from '../types';
import { useMemberLookup } from '../../context';
import { Avatar } from '../_shared/parts';
import { idsOf } from '../_shared/ops';
import styles from '../_shared/fields.module.css';

export function Cell({ value, compact }: CellProps) {
  const lookup = useMemberLookup();
  const ids = idsOf(value);
  if (ids.length === 0) return <span className={styles.empty} />;
  return (
    <span className={styles.personRow}>
      {ids.slice(0, compact ? 3 : 5).map((id) => {
        const member = lookup(id);
        return (
          <span key={id} className={styles.personRow}>
            <Avatar name={member?.user.name ?? '?'} url={member?.user.avatarUrl} />
            {compact ? null : <span className={styles.personName}>{member?.user.name ?? id}</span>}
          </span>
        );
      })}
      {ids.length > (compact ? 3 : 5) ? (
        <span className={styles.chipMore}>+{ids.length - (compact ? 3 : 5)}</span>
      ) : null}
    </span>
  );
}
