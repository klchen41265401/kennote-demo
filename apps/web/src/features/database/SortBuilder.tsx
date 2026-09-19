/**
 * 排序面板（02 §4.3.3）：多欄排序，可拖曳調整優先順序。
 * 欄位清單只列 registry 裡 sortable = true 的型別。
 */
import type { CollectionSchema, SortSpec, ViewQuery } from '@kennote/shared-types';
import { FieldIcon, UiIcon, reorder, useDragHandle, useDropZone } from './_fallback';
import { getFieldType } from './fields/types';
import styles from './Builders.module.css';

interface Props {
  schema: CollectionSchema;
  query: ViewQuery;
  onChange: (query: ViewQuery) => void;
}

export function SortBuilder({ schema, query, onChange }: Props) {
  const sorts = query.sort ?? [];
  const sortable = Object.entries(schema).filter(([, def]) => def && getFieldType(def.type).sortable);
  const unused = sortable.filter(([id]) => !sorts.some((s) => s.property === id));

  function update(next: SortSpec[]) {
    onChange({ ...query, sort: next });
  }

  return (
    <div className={styles.panel}>
      {sorts.map((sort, index) => (
        <SortRow
          key={sort.property}
          sort={sort}
          index={index}
          schema={schema}
          sortable={sortable.map(([id]) => id)}
          onMove={(from, to) => update(reorder(sorts, from, to))}
          onChange={(next) => update(sorts.map((s, i) => (i === index ? next : s)))}
          onRemove={() => update(sorts.filter((_, i) => i !== index))}
        />
      ))}

      {sorts.length === 0 ? <p className={styles.hint}>還沒有排序條件。</p> : null}

      {unused.length > 0 ? (
        <select
          className={styles.select}
          value=""
          aria-label="新增排序"
          onChange={(e) => {
            if (!e.target.value) return;
            update([...sorts, { property: e.target.value, direction: 'ascending' }]);
          }}
        >
          <option value="">＋ 新增排序…</option>
          {unused.map(([id, def]) => (
            <option key={id} value={id}>
              {def?.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

interface SortRowProps {
  sort: SortSpec;
  index: number;
  schema: CollectionSchema;
  sortable: string[];
  onMove: (from: number, to: number) => void;
  onChange: (next: SortSpec) => void;
  onRemove: () => void;
}

function SortRow({ sort, index, schema, sortable, onMove, onChange, onRemove }: SortRowProps) {
  const def = schema[sort.property];
  const { dragging, handlers } = useDragHandle({ kind: 'sort', id: sort.property, index });
  const drop = useDropZone({
    accept: 'sort',
    onDrop: (payload) => {
      if (payload.index !== undefined) onMove(payload.index, index);
    },
  });

  if (!def) return null;

  return (
    <div
      className={`${styles.sortRow} ${dragging ? styles.rowDragging : ''} ${
        drop.over ? styles.rowOver : ''
      }`}
      {...drop.handlers}
    >
      <span className={styles.dragHandle} {...handlers} aria-hidden="true">
        <UiIcon name="drag" size={12} />
      </span>
      <span className={styles.fieldIcon}>
        <FieldIcon type={def.type} />
      </span>
      <select
        className={styles.select}
        value={sort.property}
        aria-label="排序欄位"
        onChange={(e) => onChange({ ...sort, property: e.target.value })}
      >
        {sortable.map((id) => (
          <option key={id} value={id}>
            {schema[id]?.name}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        value={sort.direction}
        aria-label="排序方向"
        onChange={(e) => onChange({ ...sort, direction: e.target.value as SortSpec['direction'] })}
      >
        <option value="ascending">遞增</option>
        <option value="descending">遞減</option>
      </select>
      <button type="button" className={styles.iconButton} aria-label="刪除排序" onClick={onRemove}>
        <UiIcon name="close" size={12} />
      </button>
    </div>
  );
}
