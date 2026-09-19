import type { CellProps } from '../types';
import { plainTextOf } from '../_shared/ops';
import styles from '../_shared/fields.module.css';

export function Cell({ value }: CellProps) {
  const text = plainTextOf(value);
  if (text === '') return <span className={styles.empty} />;
  return (
    <a
      className={styles.link}
      href={text.startsWith('http') ? text : 'https://' + text}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      title={text}
    >
      {text}
    </a>
  );
}
