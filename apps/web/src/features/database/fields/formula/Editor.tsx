import type { EditorProps } from '../types';
import styles from '../_shared/fields.module.css';

/** 唯讀欄位：點擊只說明為什麼不能編輯（02 §3.5 的對照表） */
export function Editor({ onClose }: EditorProps) {
  return (
    <div className={styles.configBody} onClick={onClose}>
      <p className={styles.configHint}>公式值由運算式算出來，不能直接編輯；要改請改公式或來源欄位。</p>
    </div>
  );
}
