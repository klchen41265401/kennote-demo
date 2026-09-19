import type { CellProps } from '../types';
import { Chip } from '../_shared/parts';
import { optionOf } from '../_shared/ops';
import styles from '../_shared/fields.module.css';

export function Cell({ value, def }: CellProps) {
  const option = value && value.type === 'select' ? optionOf(def, value.optionId) : undefined;
  if (!option) return <span className={styles.empty} />;
  return <Chip label={option.value} color={option.color} />;
}
