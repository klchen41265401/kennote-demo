/**
 * 篩選器 UI（02 §4.3.3）：AND/OR 巢狀群組，最多 2 層。
 *
 * 單列結構：[欄位 ⌄] [運算子 ⌄] [值編輯器] [✕]
 * 運算子選項與值編輯器**都由 field registry 提供**，
 * 這個檔案完全不知道有哪些欄位型別存在。
 */
import type {
  CollectionSchema,
  FilterCondition,
  FilterGroup,
  FilterOperator,
  ViewQuery,
} from '@kennote/shared-types';
import { FILTER_OPERATOR_LABELS, isFilterGroup } from '@kennote/shared-types';
import { FieldIcon, UiIcon } from './_fallback';
import { PropertyPicker } from './PropertyPicker';
import { getFieldType } from './fields/types';
import {
  MAX_FILTER_DEPTH,
  addCondition,
  addGroup,
  changeProperty,
  defaultCondition,
  filterableProperties,
  needsValue,
  normalizeFilter,
  replaceChild,
  setOperator,
} from './filter-model';
import styles from './Builders.module.css';

interface Props {
  schema: CollectionSchema;
  query: ViewQuery;
  onChange: (query: ViewQuery) => void;
}

export function FilterBuilder({ schema, query, onChange }: Props) {
  const root: FilterGroup = query.filter ?? { operator: 'and', filters: [] };

  function update(next: FilterGroup) {
    onChange({ ...query, filter: normalizeFilter(next) });
  }

  /**
   * 還沒有任何條件時，Notion 先給一張**屬性清單**（07k-db-filter-*），
   * 而不是空的條件編輯器；選了屬性才展開成 [欄位][運算子][值] 那一列。
   */
  if (root.filters.length === 0) {
    return (
      <PropertyPicker
        ariaLabel="選擇要篩選的屬性"
        placeholder="篩選條件…"
        schema={schema}
        properties={filterableProperties(schema)}
        onSelect={(property) => {
          const condition = defaultCondition(schema);
          if (condition) update(addCondition(root, changeProperty(schema, condition, property)));
        }}
        footerLabel="新增進階篩選"
        onFooter={() => {
          const condition = defaultCondition(schema);
          if (condition) update(addGroup(root, condition));
        }}
      />
    );
  }

  return (
    <div className={styles.panel}>
      <GroupEditor schema={schema} group={root} depth={0} onChange={update} />
      <div className={styles.panelActions}>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => {
            const condition = defaultCondition(schema);
            if (condition) update(addCondition(root, condition));
          }}
        >
          <UiIcon name="plus" size={12} /> 新增條件
        </button>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => {
            const condition = defaultCondition(schema);
            if (condition) update(addGroup(root, condition));
          }}
        >
          <UiIcon name="plus" size={12} /> 新增條件群組
        </button>
        {root.filters.length > 0 ? (
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => onChange({ ...query, filter: null })}
          >
            全部清除
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface GroupEditorProps {
  schema: CollectionSchema;
  group: FilterGroup;
  depth: number;
  onChange: (next: FilterGroup) => void;
}

function GroupEditor({ schema, group, depth, onChange }: GroupEditorProps) {
  function replaceAt(index: number, next: FilterCondition | FilterGroup | null) {
    onChange(replaceChild(group, index, next));
  }

  return (
    <div className={depth === 0 ? styles.group : styles.nestedGroup}>
      {group.filters.map((child, index) => (
        <div key={index} className={styles.filterRow}>
          <span className={styles.joiner}>
            {index === 0 ? (
              '篩選'
            ) : index === 1 ? (
              <select
                value={group.operator}
                aria-label="條件關係"
                onChange={(e) => onChange(setOperator(group, e.target.value as 'and' | 'or'))}
              >
                <option value="and">且</option>
                <option value="or">或</option>
              </select>
            ) : (
              <span className={styles.joinerText}>{group.operator === 'and' ? '且' : '或'}</span>
            )}
          </span>

          {isFilterGroup(child) ? (
            <div className={styles.groupBody}>
              <GroupEditor
                schema={schema}
                group={child}
                depth={depth + 1}
                onChange={(next) => replaceAt(index, next.filters.length === 0 ? null : next)}
              />
              {depth + 1 < MAX_FILTER_DEPTH ? (
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => {
                    const condition = defaultCondition(schema);
                    if (condition) replaceAt(index, addCondition(child, condition));
                  }}
                >
                  <UiIcon name="plus" size={12} /> 條件
                </button>
              ) : null}
            </div>
          ) : (
            <ConditionEditor
              schema={schema}
              condition={child}
              onChange={(next) => replaceAt(index, next)}
            />
          )}

          <button
            type="button"
            className={styles.iconButton}
            aria-label="刪除條件"
            onClick={() => replaceAt(index, null)}
          >
            <UiIcon name="close" size={12} />
          </button>
        </div>
      ))}
      {group.filters.length === 0 ? <p className={styles.hint}>還沒有任何篩選條件。</p> : null}
    </div>
  );
}

function ConditionEditor({
  schema,
  condition,
  onChange,
}: {
  schema: CollectionSchema;
  condition: FilterCondition;
  onChange: (next: FilterCondition) => void;
}) {
  const def = schema[condition.property];
  if (!def) return <span className={styles.hint}>欄位已刪除</span>;
  const fieldType = getFieldType(def.type);
  const FilterInput = fieldType.FilterInput;
  const showValue = needsValue(condition.operator);

  return (
    <>
      <select
        className={styles.select}
        value={condition.property}
        aria-label="篩選欄位"
        onChange={(e) => onChange(changeProperty(schema, condition, e.target.value))}
      >
        {filterableProperties(schema).map((id) => (
          <option key={id} value={id}>
            {schema[id]?.name}
          </option>
        ))}
      </select>

      <span className={styles.fieldIcon}>
        <FieldIcon type={def.type} />
      </span>

      <select
        className={styles.select}
        value={condition.operator}
        aria-label="運算子"
        onChange={(e) => onChange({ ...condition, operator: e.target.value as FilterOperator })}
      >
        {fieldType.filterOperators.map((op) => (
          <option key={op} value={op}>
            {FILTER_OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>

      {showValue ? (
        <FilterInput
          operator={condition.operator}
          value={condition.value}
          def={def}
          onChange={(value) => onChange({ ...condition, value })}
        />
      ) : (
        <span className={styles.hint}>—</span>
      )}
    </>
  );
}
