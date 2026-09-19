import { registerViewType, type ViewSettingsProps } from '../types';
import { ListView } from './ListView';
import styles from './ListView.module.css';

function ListSettings({ view, onChange }: ViewSettingsProps) {
  const format = view.format ?? {};
  return (
    <div className={styles.settings}>
      <label>
        <input
          type="checkbox"
          checked={format.listShowProperties ?? true}
          onChange={(e) => onChange({ format: { ...format, listShowProperties: e.target.checked } })}
        />
        顯示屬性
      </label>
    </div>
  );
}

registerViewType({
  type: 'list',
  label: '清單',
  icon: 'list',
  supportsGrouping: false,
  supportsSorting: true,
  supportsFiltering: true,
  supportsAggregation: false,
  Component: ListView,
  SettingsPanel: ListSettings,
  defaultFormat: (schema) => ({
    listShowProperties: true,
    properties: Object.keys(schema).map((property, i) => ({ property, visible: i < 3 })),
  }),
  getQueryHints: (view) => ({ pageSize: view.query?.pageSize ?? 50 }),
});
