import type { EditorProps } from '../types';
import styles from '../_shared/fields.module.css';

export function Editor({ value, onChange, onClose }: EditorProps) {
  const checked = Boolean(value && value.type === 'checkbox' && value.checkbox);
  return (
    <input
      className={styles.checkbox}
      type="checkbox"
      checked={checked}
      autoFocus
      data-autofocus
      onChange={(e) => {
        onChange(e.target.checked);
        onClose();
      }}
    />
  );
}
