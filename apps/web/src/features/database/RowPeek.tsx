/**
 * Row = Page（04 §8 M4 交付物 11）。
 *
 * 點一列打開側邊預覽（Notion 預設 side peek）：標題、屬性表（可編輯）、
 * 以及 **編輯器掛載點**：
 *
 *     <div id="editor-host-row" data-page-id="...">
 *
 * ⭐ 給編輯器代理的約定（README 有完整版）：
 *   · 這個 div 一定存在且只有一個（同一時間只會開一個 peek）
 *   · data-page-id 就是這一列的 pageId，初次資料請走
 *     GET /api/pages/:id/snapshot，變更請走 POST /api/pages/:id/transactions
 *   · peek 關閉時這個 div 會被卸載，請在 cleanup 裡解除掛載
 *   · 「以整頁開啟」會導向 /page/:pageId，那裡是既有的 <div id="editor-host">
 */
import { useEffect, useState } from 'react';
import type { DatabaseRow } from '@kennote/shared-types';
import { richTextToPlainText } from '@kennote/shared-types';
import { Dialog, FieldIcon, Menu, MenuItem, Popover, UiIcon } from './_fallback';
import { EditableCell } from './EditableCell';
import { useDatabaseContext } from './context';
import { getFieldType } from './fields/types';
import styles from './RowPeek.module.css';

interface Props {
  row: DatabaseRow;
  open: boolean;
  variant?: 'side' | 'center';
  onClose: () => void;
  onSetCellValue: (propertyId: string, value: unknown) => void;
  onSetTitle: (title: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export function RowPeek({
  row,
  open,
  variant = 'side',
  onClose,
  onSetCellValue,
  onSetTitle,
  onDelete,
  onDuplicate,
}: Props) {
  const { schema, openRowPage, readOnly } = useDatabaseContext();
  const [title, setTitle] = useState(richTextToPlainText(row.title));
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTitle(richTextToPlainText(row.title));
  }, [row.id, row.title]);

  const properties = Object.entries(schema).filter(([id]) => id !== 'title');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant={variant}
      title={
        <div className={styles.headerBar}>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="關閉">
            <UiIcon name="close" size={16} />
          </button>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              onClose();
              openRowPage(row.id);
            }}
          >
            <UiIcon name="expand" size={14} />
            以整頁開啟
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="更多"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
          >
            <UiIcon name="more" size={16} />
          </button>
        </div>
      }
    >
      <input
        className={styles.title}
        value={title}
        placeholder="未命名"
        readOnly={readOnly}
        data-autofocus
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => onSetTitle(title)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />

      <dl className={styles.properties}>
        {properties.map(([propertyId, def]) => {
          if (!def) return null;
          const fieldType = getFieldType(def.type);
          return (
            <div key={propertyId} className={styles.propertyRow}>
              <dt className={styles.propertyName}>
                <FieldIcon type={def.type} />
                <span>{def.name}</span>
              </dt>
              <dd className={styles.propertyValue}>
                <EditableCell
                  propertyId={propertyId}
                  def={def}
                  row={row}
                  value={row.properties[propertyId]}
                  readOnly={readOnly || fieldType.computed}
                  onCommit={(value) => onSetCellValue(propertyId, value)}
                />
              </dd>
            </div>
          );
        })}
      </dl>

      {/* ⭐ 編輯器掛載點。編輯器代理把 editor-core 掛進來即可。 */}
      <div id="editor-host-row" className={styles.editorHost} data-page-id={row.id}>
        <p className={styles.editorPlaceholder}>
          這一列就是一個頁面。內容編輯器（editor-core）會掛在這個區塊，
          掛載點 id 為 <code>editor-host-row</code>，pageId 為 <code>{row.id}</code>。
        </p>
      </div>

      <Popover open={menuAnchor !== null} anchor={menuAnchor} onClose={() => setMenuAnchor(null)}>
        <Menu ariaLabel="列選單">
          <MenuItem
            onSelect={() => {
              setMenuAnchor(null);
              onDuplicate();
            }}
          >
            複製
          </MenuItem>
          <MenuItem
            danger
            onSelect={() => {
              setMenuAnchor(null);
              onDelete();
              onClose();
            }}
          >
            刪除
          </MenuItem>
        </Menu>
      </Popover>
    </Dialog>
  );
}
