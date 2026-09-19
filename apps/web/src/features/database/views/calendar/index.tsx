import { registerViewType, type ViewSettingsProps } from '../types';
import { CalendarView } from './CalendarView';
import styles from './CalendarView.module.css';

function CalendarSettings({ view, schema, onChange }: ViewSettingsProps) {
  const format = view.format ?? {};
  const dateProperties = Object.entries(schema).filter(
    ([, def]) => def?.type === 'date' || def?.type === 'createdTime' || def?.type === 'lastEditedTime',
  );
  return (
    <div className={styles.settings}>
      <label>
        日期欄位
        <select
          value={format.calendarDateProperty ?? ''}
          onChange={(e) =>
            onChange({ format: { ...format, calendarDateProperty: e.target.value || null } })
          }
        >
          <option value="">自動（第一個日期欄位）</option>
          {dateProperties.map(([id, def]) => (
            <option key={id} value={id}>
              {def?.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

registerViewType({
  type: 'calendar',
  label: '日曆',
  icon: 'calendar',
  supportsGrouping: false,
  supportsSorting: true,
  supportsFiltering: true,
  supportsAggregation: false,
  // Calendar 需要 date 欄位才有意義（能力宣告，視圖切換器讀這個）
  requiredFieldTypes: ['date', 'createdTime', 'lastEditedTime'],
  Component: CalendarView,
  SettingsPanel: CalendarSettings,
  defaultFormat: (schema) => ({
    calendarDateProperty: Object.entries(schema).find(([, def]) => def?.type === 'date')?.[0] ?? null,
    calendarShowWeekend: true,
  }),
  // 月曆一次要看一整個月，pageSize 給大一點
  getQueryHints: (view) => ({ pageSize: view.query?.pageSize ?? 200 }),
});
