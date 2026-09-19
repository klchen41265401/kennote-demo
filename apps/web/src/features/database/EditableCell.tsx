/**
 * 「顯示／編輯」雙態的儲存格（02 §3.5）。
 *
 * 未聚焦時只渲染輕量的唯讀顯示；進入編輯態才掛上該型別的編輯器 ——
 * 1000 列 × 8 欄如果每一格都掛編輯器，光是建 DOM 就會卡住。
 *
 * Table / Board / Gallery / RowPeek 都用這一支，所以三處的編輯行為必然一致。
 */
import { useRef, useState } from 'react';
import type { DatabaseRow, FieldDefinition, FieldValue } from '@kennote/shared-types';
import { Popover } from './_fallback';
import { getFieldType } from './fields/types';
import styles from './EditableCell.module.css';

export interface EditableCellProps {
  propertyId: string;
  def: FieldDefinition;
  row: DatabaseRow;
  value: FieldValue | undefined;
  onCommit: (value: unknown) => void;
  compact?: boolean;
  readOnly?: boolean;
  /** 由外部控制編輯態（表格的鍵盤導航需要） */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  className?: string;
}

export function EditableCell(props: EditableCellProps) {
  const { propertyId, def, row, value, onCommit, compact, readOnly, className } = props;
  const fieldType = getFieldType(def.type);
  const [internalEditing, setInternalEditing] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const editing = props.editing ?? internalEditing;
  const setEditing = (next: boolean) => {
    if (props.onEditingChange) props.onEditingChange(next);
    else setInternalEditing(next);
  };

  const canEdit = !readOnly && !fieldType.computed && fieldType.Editor !== null;
  const Editor = fieldType.Editor;
  const Cell = fieldType.Cell;

  // checkbox / rating：點一下就切換，不進編輯態
  if (canEdit && fieldType.editInline && Editor) {
    return (
      <div ref={anchorRef} className={`${styles.cell} ${className ?? ''}`}>
        <Editor
          propertyId={propertyId}
          value={value}
          def={def}
          row={row}
          onChange={onCommit}
          onClose={() => {}}
          autoFocus={false}
        />
      </div>
    );
  }

  const inline = (fieldType.editorSurface ?? 'popover') === 'inline';

  if (editing && canEdit && Editor && inline) {
    return (
      <div ref={anchorRef} className={`${styles.cell} ${styles.editing} ${className ?? ''}`}>
        <Editor
          propertyId={propertyId}
          value={value}
          def={def}
          row={row}
          onChange={onCommit}
          onClose={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      ref={anchorRef}
      className={`${styles.cell} ${editing ? styles.editing : ''} ${className ?? ''}`}
      onDoubleClick={() => canEdit && setEditing(true)}
      onClick={() => {
        // popover 型別點一下就開（Notion 的行為）；inline 型別等雙擊或 Enter
        if (canEdit && !inline) setEditing(true);
      }}
    >
      <Cell propertyId={propertyId} value={value} def={def} row={row} compact={compact} />
      {editing && canEdit && Editor && !inline ? (
        <Popover
          open
          anchor={anchorRef.current}
          onClose={() => setEditing(false)}
          minWidth={Math.max(220, anchorRef.current?.offsetWidth ?? 0)}
        >
          <Editor
            propertyId={propertyId}
            value={value}
            def={def}
            row={row}
            onChange={onCommit}
            onClose={() => setEditing(false)}
          />
        </Popover>
      ) : null}
    </div>
  );
}
