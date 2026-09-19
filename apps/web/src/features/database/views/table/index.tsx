import type { CollectionSchema, ViewFormat } from '@kennote/shared-types';
import { defaultPropertyWidth, registerViewType, type ViewSettingsProps } from '../types';
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
  /**
   * ⭐ 表格預設**顯示全部欄位**。
   *
   * 原本是 `visible: i < 6`，第 7 個以後的欄位一建出來就是隱藏的。
   * 表格的 `.grid` 本來就會 `overflow-x: auto`，欄位總寬超過視窗時就橫捲，
   * 所以沒有必要先砍掉；砍掉之後使用者反而以為「欄位不見了」——
   * 唯一找回來的路徑是 設定 → 編輯屬性 → 打開眼睛，很難發現（功能 QA 第三輪 BUG-10）。
   * Notion 的表格也是預設全開 + 橫捲。
   */
  defaultFormat: (schema: CollectionSchema): ViewFormat => ({
    properties: Object.keys(schema).map((property) => ({
      property,
      visible: true,
      width: defaultPropertyWidth(property),
    })),
    tableFreezeColumns: 1,
  }),
  getQueryHints: (view) => ({
    ...(view.query?.groupBy?.property ? { groupBy: view.query.groupBy.property } : {}),
    pageSize: view.query?.pageSize ?? 50,
  }),
});
