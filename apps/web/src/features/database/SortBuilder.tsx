/**
 * 排序面板（02 §4.3.3）：多欄排序，可拖曳調整優先順序。
 * 欄位清單只列 registry 裡 sortable = true 的型別。
 */
import type { CollectionSchema, SortSpec, ViewQuery } from '@kennote/shared-types';
import { FieldIcon, UiIcon } from './_fallback';
import { reorder, useSortableItem, useSortableList } from './dnd';
import { useKeyboardReorder, useReorderAnnouncer } from '../../lib/keyboard-reorder';
import { PropertyPicker } from './PropertyPicker';
import { getFieldType } from './fields/types';
import styles from './Builders.module.css';

interface Props {
  schema: CollectionSchema;
  query: ViewQuery;
  onChange: (query: ViewQuery) => void;
}

export function SortBuilder({ schema, query, onChange }: Props) {
  const sorts = query.sort ?? [];
  /* Notion 的排序屬性清單一律把標題欄排第一（07l-db-sort 參考圖的第一列是「名稱」），
     跟 views/types.ts 的 visibleProperties() 同一個規則。 */
  const sortable = Object.entries(schema)
    .filter(([, def]) => def && getFieldType(def.type).sortable)
    .sort(([a], [b]) => (a === 'title' ? -1 : b === 'title' ? 1 : 0));
  const unused = sortable.filter(([id]) => !sorts.some((s) => s.property === id));

  function update(next: SortSpec[]) {
    onChange({ ...query, sort: next });
  }

  // 第十一輪：整份清單一個 drop zone（Pointer Events；觸控長按 400ms）
  const { listRef } = useSortableList({
    kind: 'sort',
    ids: sorts.map((s) => s.property),
    onReorder: (from, to) => update(reorder(sorts, from, to)),
  });

  // O-17：排序條件的優先順序也要有鍵盤路徑（Alt + ↑/↓）
  const announcer = useReorderAnnouncer();

  /** 還沒有排序條件時先給屬性清單（07l-db-sort-*），跟篩選同一個版型、沒有底部動作列 */
  if (sorts.length === 0) {
    return (
      <PropertyPicker
        ariaLabel="選擇要排序的屬性"
        placeholder="排序方式"
        schema={schema}
        properties={sortable.map(([id]) => id)}
        onSelect={(property) => update([{ property, direction: 'ascending' }])}
      />
    );
  }

  return (
    <div className={styles.panel} ref={listRef}>
      {sorts.map((sort, index) => (
        <SortRow
          key={sort.property}
          sort={sort}
          index={index}
          count={sorts.length}
          schema={schema}
          announce={announcer.announce}
          onMove={(to) => update(reorder(sorts, index, to))}
          sortable={sortable.map(([id]) => id)}
          onChange={(next) => update(sorts.map((s, i) => (i === index ? next : s)))}
          onRemove={() => update(sorts.filter((_, i) => i !== index))}
        />
      ))}
      {announcer.live}

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
  count: number;
  schema: CollectionSchema;
  sortable: string[];
  announce: (message: string) => void;
  onMove: (to: number) => void;
  onChange: (next: SortSpec) => void;
  onRemove: () => void;
}

function SortRow({
  sort,
  index,
  count,
  schema,
  sortable,
  announce,
  onMove,
  onChange,
  onRemove,
}: SortRowProps) {
  const def = schema[sort.property];
  const { isDragging, dragRef, itemProps, handleProps } = useSortableItem('sort', sort.property, index);
  const keyboardProps = useKeyboardReorder({
    label: def?.name ?? sort.property,
    index,
    count,
    onMove,
    announce,
  });

  if (!def) return null;

  return (
    <div
      ref={dragRef}
      {...itemProps}
      className={`${styles.sortRow} ${isDragging ? styles.rowDragging : ''}`}
    >
      {/* O-17：見 PropertyList 的同一段 —— 把手要是 button，鍵盤才摸得到 */}
      <button type="button" className={styles.dragHandle} {...handleProps} {...keyboardProps}>
        <UiIcon name="drag" size={12} />
      </button>
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
