import type { CollectionSchema, ViewFormat } from '@kennote/shared-types';
import { registerViewType, type ViewSettingsProps } from '../types';
import { TableView } from './TableView';
import styles from './TableView.module.css';

function TableSettings({ view, onChange }: ViewSettingsProps) {
  const format = view.format ?? {};
  return (
    <div className={styles.settings}>
      <label>
        <input
          type="checkbox"
          checked={format.tableFreezeColumns !== 0}
          onChange={(e) =>
            onChange({ format: { ...format, tableFreezeColumns: e.target.checked ? 1 : 0 } })
          }
        />
        凍結標題欄
      </label>
      <label>
        <input
          type="checkbox"
          checked={format.tableWrapCells ?? false}
          onChange={(e) => onChange({ format: { ...format, tableWrapCells: e.target.checked } })}
        />
        文字自動換行
      </label>
      <label>
        <input
          type="checkbox"
          checked={format.tableRowNumbers ?? false}
          onChange={(e) => onChange({ format: { ...format, tableRowNumbers: e.target.checked } })}
        />
        顯示列編號
      </label>
    </div>
  );
}

registerViewType({
  type: 'table',
  label: '表格',
  icon: 'table',
  supportsGrouping: true,
  supportsSorting: true,
  supportsFiltering: true,
  supportsAggregation: true,
  Component: TableView,
  SettingsPanel: TableSettings,
  defaultFormat: (schema: CollectionSchema): ViewFormat => ({
    properties: Object.keys(schema).map((property, i) => ({
      property,
      visible: i < 6,
      width: property === 'title' ? 320 : 160,
    })),
    tableFreezeColumns: 1,
  }),
  getQueryHints: (view) => ({
    ...(view.query?.groupBy?.property ? { groupBy: view.query.groupBy.property } : {}),
    pageSize: view.query?.pageSize ?? 50,
  }),
});
