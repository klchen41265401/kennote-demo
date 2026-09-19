/** 分組設定：選分組欄位、隱藏空白分組、泳道顯示／隱藏。 */
import type { CollectionSchema, ViewQuery } from '@kennote/shared-types';
import { getFieldType } from './fields/types';
import styles from './Builders.module.css';

interface Props {
  schema: CollectionSchema;
  query: ViewQuery;
  onChange: (query: ViewQuery) => void;
  /** 目前資料回來的泳道（讓使用者逐一隱藏） */
  groups?: Array<{ key: string | null; label: string; count: number }>;
}

export function GroupSettings({ schema, query, onChange, groups }: Props) {
  const groupable = Object.entries(schema).filter(
    ([, def]) => def && getFieldType(def.type).groupable,
  );
  const current = query.groupBy?.property ?? '';
  const hidden = new Set(
    (query.groupBy?.groups ?? []).filter((g) => g.visible === false).map((g) => g.key),
  );

  function setHidden(key: string | null, visible: boolean) {
    if (!query.groupBy) return;
    const existing = query.groupBy.groups ?? [];
    const next = existing.some((g) => g.key === key)
      ? existing.map((g) => (g.key === key ? { ...g, visible } : g))
      : [...existing, { key, visible }];
    onChange({ ...query, groupBy: { ...query.groupBy, groups: next } });
  }

  return (
    <div className={styles.panel}>
      <label className={styles.rowLabel}>
        分組依據
        <select
          className={styles.select}
          value={current}
          onChange={(e) =>
            onChange({
              ...query,
              groupBy: e.target.value
                ? { property: e.target.value, hideEmptyGroups: false, groups: [] }
                : null,
            })
          }
        >
          <option value="">不分組</option>
          {groupable.map(([id, def]) => (
            <option key={id} value={id}>
              {def?.name}
            </option>
          ))}
        </select>
      </label>

      {query.groupBy ? (
        <>
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={query.groupBy.hideEmptyGroups ?? false}
              onChange={(e) =>
                onChange({
                  ...query,
                  groupBy: { ...query.groupBy!, hideEmptyGroups: e.target.checked },
                })
              }
            />
            隱藏空白分組
          </label>

          {groups && groups.length > 0 ? (
            <div className={styles.laneList}>
              {groups.map((g) => (
                <label key={g.key ?? '__empty__'} className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={!hidden.has(g.key)}
                    onChange={(e) => setHidden(g.key, e.target.checked)}
                  />
                  <span className={styles.laneName}>{g.label}</span>
                  <span className={styles.laneCount}>{g.count}</span>
                </label>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className={styles.hint}>看板需要分組欄位才能呈現。</p>
      )}
    </div>
  );
}
