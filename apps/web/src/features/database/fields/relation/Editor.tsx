import { useEffect, useState } from 'react';
import { richTextToPlainText } from '@kennote/shared-types';
import type { EditorProps } from '../types';
import { fetchRows } from '../../api';
import { UiIcon } from '../../_fallback';
import { idsOf } from '../_shared/ops';
import { rememberTitles, relatedTitle } from './titles';
import styles from '../_shared/fields.module.css';

interface Candidate {
  id: string;
  title: string;
}

export function Editor({ value, def, onChange, onClose }: EditorProps) {
  const config = def as { collectionId?: string | null; allowMultiple?: boolean };
  const selected = idsOf(value);
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config.collectionId) {
      setError('這個關聯欄位還沒有指定目標資料庫');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchRows({ collectionId: config.collectionId as string, limit: 25, search })
        .then((result) => {
          if (cancelled) return;
          const rows = result.rows.map((row) => ({
            id: row.id,
            title: richTextToPlainText(row.title) || '未命名',
          }));
          rememberTitles(rows);
          setCandidates(rows);
          setError(null);
        })
        .catch(() => {
          if (!cancelled) setError('讀不到目標資料庫');
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config.collectionId, search]);

  function toggle(id: string) {
    const allowMultiple = config.allowMultiple ?? true;
    if (!allowMultiple) {
      onChange(selected.includes(id) ? [] : [id]);
      onClose();
      return;
    }
    onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  }

  return (
    <div className={styles.picker}>
      <input
        className={styles.pickerSearch}
        value={search}
        placeholder="搜尋要關聯的列"
        autoFocus
        data-autofocus
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      />
      {selected.length > 0 ? (
        <div className={styles.chipRow}>
          {selected.map((id) => (
            <button
              key={id}
              type="button"
              className={styles.relationChip}
              onClick={() => toggle(id)}
              title="移除關聯"
            >
              {relatedTitle(id)} <UiIcon name="close" size={10} />
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.pickerList} role="listbox">
        {candidates.map((row) => (
          <button
            key={row.id}
            type="button"
            role="option"
            aria-selected={selected.includes(row.id)}
            className={styles.pickerItem}
            onClick={() => toggle(row.id)}
          >
            <span className={styles.pickerItemLabel}>{row.title}</span>
            {selected.includes(row.id) ? <UiIcon name="check" size={14} /> : null}
          </button>
        ))}
        {error ? <p className={styles.pickerEmpty}>{error}</p> : null}
      </div>
    </div>
  );
}
