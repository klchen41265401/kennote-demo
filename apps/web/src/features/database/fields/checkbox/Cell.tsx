import type { CellProps } from '../types';
import styles from '../_shared/fields.module.css';

/** 顯示態也是可互動的：Notion 的 checkbox 不需要先進編輯態 */
export function Cell({ value }: CellProps) {
  const checked = Boolean(value && value.type === 'checkbox' && value.checkbox);
  return <input className={styles.checkbox} type="checkbox" checked={checked} readOnly tabIndex={-1} />;
}
