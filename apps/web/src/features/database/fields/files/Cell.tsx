import type { CellProps } from '../types';
import styles from '../_shared/fields.module.css';

export function Cell({ value }: CellProps) {
  const files = value && value.type === 'files' ? value.files : [];
  if (files.length === 0) return <span className={styles.empty} />;
  return (
    <span className={styles.chipRow}>
      {files.slice(0, 3).map((file, i) => (
        <span key={file.fileId ?? file.externalUrl ?? i} className={styles.fileChip}>
          {file.name}
        </span>
      ))}
      {files.length > 3 ? <span className={styles.chipMore}>+{files.length - 3}</span> : null}
    </span>
  );
}
