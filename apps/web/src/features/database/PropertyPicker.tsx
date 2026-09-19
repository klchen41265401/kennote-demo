/**
 * 「選一個屬性」的浮層（`07k-db-filter-light.png` / `07l-db-sort-light.png`）。
 *
 * Notion 的「篩選」與「排序」按鈕第一次點開時**不是**條件編輯器，
 * 而是一張屬性清單：上面一個搜尋框、中間是帶型別圖示的屬性列、
 * 底部（只有篩選有）一列「＋ 新增進階篩選」。選了之後才會變成條件列。
 *
 * 逐像素量自 `07k-db-filter-light.png`（318×236 的裁切）：
 *   搜尋框 y29..58（高 30、內距 12、底色 rgb(249,248,247)、聚焦時 2px 藍框）
 *   屬性列 y70..97 / 98..125 / …（高 **28**，第一列 hover 底 rgb(244,243,243)）
 *   分隔線 y189，底部動作列 y190..225（高 36）
 */
import { useMemo, useState } from 'react';
import type { CollectionSchema } from '@kennote/shared-types';
import { FieldIcon, UiIcon } from './_fallback';
import styles from './Builders.module.css';

export interface PropertyPickerProps {
  schema: CollectionSchema;
  /** 可以選的屬性 id（呼叫端決定「可篩選」還是「可排序」） */
  properties: string[];
  placeholder: string;
  onSelect: (property: string) => void;
  /** 底部動作列（篩選才有：「＋ 新增進階篩選」） */
  footerLabel?: string;
  onFooter?: () => void;
  ariaLabel: string;
}

export function PropertyPicker({
  schema,
  properties,
  placeholder,
  onSelect,
  footerLabel,
  onFooter,
  ariaLabel,
}: PropertyPickerProps) {
  const [search, setSearch] = useState('');
  /* Notion 這張清單一打開就把第一列標成「作用中」（07k/07l 參考圖的第一列底是 rgb(244,243,243)），
     上下鍵會移動這個標記、Enter 選它。 */
  const [active, setActive] = useState(0);

  const matched = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return properties;
    return properties.filter((id) => (schema[id]?.name ?? '').toLowerCase().includes(keyword));
  }, [properties, schema, search]);

  const index = matched.length === 0 ? 0 : Math.min(active, matched.length - 1);

  return (
    <div className={styles.picker} role="listbox" aria-label={ariaLabel}>
      <input
        className={styles.pickerSearch}
        value={search}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus
        onChange={(e) => {
          setSearch(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, Math.max(matched.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && matched[index]) {
            onSelect(matched[index]);
          }
        }}
      />

      <div className={styles.pickerList}>
        {matched.length === 0 ? (
          <p className={styles.pickerEmpty}>沒有符合的屬性</p>
        ) : (
          matched.map((id, i) => {
            const def = schema[id];
            if (!def) return null;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={i === index}
                className={i === index ? `${styles.pickerItem} ${styles.pickerItemActive}` : styles.pickerItem}
                onMouseEnter={() => setActive(i)}
                onClick={() => onSelect(id)}
              >
                <FieldIcon type={def.type} />
                <span>{def.name}</span>
              </button>
            );
          })
        )}
      </div>

      {footerLabel ? (
        <div className={styles.pickerFooter}>
          <button type="button" className={styles.pickerItem} onClick={onFooter}>
            <UiIcon name="plus" size={14} />
            <span>{footerLabel}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
