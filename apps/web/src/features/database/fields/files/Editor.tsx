import { useState } from 'react';
import type { FileRef } from '@kennote/shared-types';
import type { EditorProps } from '../types';
import { UiIcon } from '../../_fallback';
import styles from '../_shared/fields.module.css';

/**
 * M4 只做「外部連結附件」：上傳管線（POST /api/files/upload）由檔案模組提供，
 * 接上之後這裡換掉 add() 即可，registry 與其他視圖都不必動。
 */
export function Editor({ value, onChange, onClose }: EditorProps) {
  const files: FileRef[] = value && value.type === 'files' ? value.files : [];
  const [url, setUrl] = useState('');

  function add() {
    const trimmed = url.trim();
    if (trimmed === '') return;
    const name = trimmed.split('/').pop() || '附件';
    onChange([...files, { externalUrl: trimmed, name }]);
    setUrl('');
  }

  return (
    <div className={styles.configBody} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      {files.map((file, i) => (
        <div key={file.fileId ?? file.externalUrl ?? i} className={styles.configRow}>
          <span className={styles.personName}>{file.name}</span>
          <button
            type="button"
            className={styles.optionRemove}
            aria-label="移除附件"
            onClick={() => onChange(files.filter((_, index) => index !== i))}
          >
            <UiIcon name="close" size={12} />
          </button>
        </div>
      ))}
      <div className={styles.configRow}>
        <input
          value={url}
          placeholder="貼上檔案網址"
          autoFocus
          data-autofocus
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add}>
          新增
        </button>
      </div>
    </div>
  );
}
