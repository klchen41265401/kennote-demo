import type { CellProps } from '../types';
import { useMemberLookup } from '../../context';
import { Avatar } from '../_shared/parts';
import { idsOf } from '../_shared/ops';
import styles from '../_shared/fields.module.css';

export function Cell({ value }: CellProps) {
  const lookup = useMemberLookup();
  const id = idsOf(value)[0];
  if (!id) return <span className={styles.empty} />;
  const member = lookup(id);
  return (
    <span className={styles.personRow}>
      <Avatar name={member?.user.name ?? '?'} url={member?.user.avatarUrl} />
      <span className={styles.personName}>{member?.user.name ?? id}</span>
    </span>
  );
}
