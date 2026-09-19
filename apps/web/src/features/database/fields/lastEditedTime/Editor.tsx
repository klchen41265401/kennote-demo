import type { EditorProps } from '../types';
import styles from '../_shared/fields.module.css';

/** 唯讀欄位：點擊只說明為什麼不能編輯（02 §3.5 的對照表） */
export function Editor({ onClose }: EditorProps) {
  return (
    <div className={styles.configBody} onClick={onClose}>
      <p className={styles.configHint}>最後編輯時間由系統維護，不能編輯。</p>
    </div>
  );
}
