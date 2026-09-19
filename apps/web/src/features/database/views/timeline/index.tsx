import { TIMELINE_SCALES, TIMELINE_SCALE_LABELS } from '@kennote/shared-types';
import { registerViewType, type ViewSettingsProps } from '../types';
import { TimelineView } from './TimelineView';
import styles from './TimelineView.module.css';

function TimelineSettings({ view, schema, onChange }: ViewSettingsProps) {
  const format = view.format ?? {};
  const dateProperties = Object.entries(schema).filter(
    ([, def]) =>
      def?.type === 'date' || def?.type === 'createdTime' || def?.type === 'lastEditedTime',
  );

  return (
    <div className={styles.settings}>
      <label>
        開始日期欄位
        <select
          value={format.timelineStartProperty ?? ''}
          onChange={(e) =>
            onChange({ format: { ...format, timelineStartProperty: e.target.value || null } })
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

      <label>
        結束日期欄位
        <select
          value={format.timelineEndProperty ?? ''}
          onChange={(e) =>
            onChange({ format: { ...format, timelineEndProperty: e.target.value || null } })
          }
        >
          <option value="">用開始欄位的日期區間</option>
          {dateProperties.map(([id, def]) => (
            <option key={id} value={id}>
              {def?.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        刻度
        <select
          value={format.timelineScale ?? 'month'}
          onChange={(e) =>
            onChange({
              format: { ...format, timelineScale: e.target.value as (typeof TIMELINE_SCALES)[number] },
            })
          }
        >
          {TIMELINE_SCALES.map((s) => (
            <option key={s} value={s}>
              {TIMELINE_SCALE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <label>
        左側表格欄
        <select
          value={(format.timelineShowTable ?? true) ? 'on' : 'off'}
          onChange={(e) =>
            onChange({ format: { ...format, timelineShowTable: e.target.value === 'on' } })
          }
        >
          <option value="on">展開</option>
          <option value="off">收合</option>
        </select>
      </label>
    </div>
  );
}

registerViewType({
  type: 'timeline',
  label: '時程表',
  icon: 'timeline',
  supportsGrouping: false,
  supportsSorting: true,
  supportsFiltering: true,
  supportsAggregation: false,
  // 時程表跟日曆一樣，沒有日期欄位就沒有意義（能力宣告，視圖切換器讀這個）
  requiredFieldTypes: ['date', 'createdTime', 'lastEditedTime'],
  Component: TimelineView,
  SettingsPanel: TimelineSettings,
  defaultFormat: (schema) => ({
    timelineStartProperty:
      Object.entries(schema).find(([, def]) => def?.type === 'date')?.[0] ?? null,
    timelineEndProperty: null,
    timelineScale: 'month',
    timelineShowTable: true,
    timelineTableWidth: 200,
  }),
  // 一個畫面要看好幾個月，pageSize 給大一點（跟日曆同樣的理由）
  getQueryHints: (view) => ({ pageSize: view.query?.pageSize ?? 200 }),
});
