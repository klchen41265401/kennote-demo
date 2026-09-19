/**
 * Row = Page（04 §8 M4 交付物 11）。
 *
 * 點一列打開側邊預覽（Notion 預設 side peek）：標題、屬性表（可編輯），
 * 底下是**真正的內容編輯器**。
 *
 * ⭐ 「列 = 頁面」：`row.id` 就是 pageId，所以這裡掛的是與整頁開啟
 * （`routes/PageRoute.tsx`）**完全同一支** `<Editor>`：
 *   · 初次資料走 `usePageSnapshot(rowId)` → `GET /api/pages/:id/snapshot`
 *   · 變更走同一套同步層（sync-client / transport），peek 與整頁改同一份資料
 *   · peek 關掉時整個 `<Editor>` 連同 `#editor-host-row` 一起卸載，
 *     `useEditorHost` 的 cleanup 會把 editor-core 銷毀（不會留下孤兒監聽器）
 *   · `key={row.id}` 保證換一列就重建編輯器，不會把上一列的內容帶過去
 *   · 「以整頁開啟」導向 `/page/:rowId`（App.tsx 的路由），那裡是 `#editor-host`
 *
 * 外框仍然保留 `id="editor-host-row"`，維持 README §4 對外的掛載點約定。
 */
import { useEffect, useState } from 'react';
import type { DatabaseRow } from '@kennote/shared-types';
import { richTextToPlainText } from '@kennote/shared-types';
import { Editor } from '../editor/Editor';
import { usePageSnapshot } from '../../lib/queries';
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
  const { schema, workspaceId, openRowPage, readOnly } = useDatabaseContext();
  const [title, setTitle] = useState(richTextToPlainText(row.title));
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  /** peek 開著才抓 snapshot；關掉就不再維持這個查詢 */
  const snapshot = usePageSnapshot(open ? row.id : null);

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

      {/* ⭐ 編輯器：與整頁開啟共用同一支 <Editor> 與同一條同步層 */}
      <div id="editor-host-row" className={styles.editorHost} data-page-id={row.id}>
        {snapshot.isLoading && !snapshot.data ? (
          <p className={styles.editorPlaceholder}>載入內容中…</p>
        ) : (
          <Editor
            key={row.id}
            pageId={row.id}
            workspaceId={workspaceId || null}
            snapshot={snapshot.data}
            readOnly={readOnly}
            onNavigateToPage={(pageId) => {
              // peek 裡點到頁面連結：關掉 peek、改開那一頁（不要在對話框裡疊第二層）
              onClose();
              openRowPage(pageId);
            }}
          />
        )}
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
