import { registerViewType, type ViewSettingsProps } from '../types';
import { BoardView } from './BoardView';
import styles from './BoardView.module.css';

function BoardSettings({ view, onChange }: ViewSettingsProps) {
  const format = view.format ?? {};
  return (
    <div className={styles.settings}>
      <label>
        欄寬
        <input
          type="number"
          min={180}
          max={480}
          value={format.boardColumnWidth ?? 260}
          onChange={(e) => onChange({ format: { ...format, boardColumnWidth: Number(e.target.value) } })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={view.query?.groupBy?.hideEmptyGroups ?? false}
          onChange={(e) =>
            onChange({
              query: {
                ...view.query,
                groupBy: view.query?.groupBy
                  ? { ...view.query.groupBy, hideEmptyGroups: e.target.checked }
                  : null,
              },
            })
          }
        />
        隱藏空白分組
      </label>
    </div>
  );
}

registerViewType({
  type: 'board',
  label: '看板',
  icon: 'board',
  supportsGrouping: true,
  supportsSorting: true,
  supportsFiltering: true,
  supportsAggregation: false,
  Component: BoardView,
  SettingsPanel: BoardSettings,
  defaultFormat: (schema) => ({
    boardColumnWidth: 260,
    properties: Object.keys(schema).map((property, i) => ({ property, visible: i < 4 })),
  }),
  getQueryHints: (view) => ({
    ...(view.query?.groupBy?.property ? { groupBy: view.query.groupBy.property } : {}),
    pageSize: view.query?.pageSize ?? 50,
  }),
});
