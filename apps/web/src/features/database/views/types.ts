/**
 * View Plugin 化（04 §10.3）。
 *
 * 工具列不寫 `if (viewType === 'board')`，而是讀 ViewDefinition 的能力宣告；
 * 新增一種視圖（例如 timeline）= 一個資料夾 + 這裡註冊一行，
 * 視圖切換器、工具列、設定面板全部自動出現。
 */
import type { FC } from 'react';
import type {
  AggregationResult,
  CollectionSchema,
  CollectionView,
  DatabaseRow,
  FieldType,
  RowGroup,
  ViewFormat,
  ViewPropertyFormat,
  ViewQuery,
  ViewType,
} from '@kennote/shared-types';

export interface ViewProps {
  view: CollectionView;
  schema: CollectionSchema;
  rows: DatabaseRow[];
  groups: RowGroup[] | undefined;
  aggregations: AggregationResult[] | undefined;
  hasMore: boolean;
  isFetching: boolean;
  /** 捲到底時載入下一頁（cursor 分頁） */
  loadMore: () => void;

  /* ── 動作（一律由容器提供，視圖不直接打 API）── */
  updateView: (patch: { query?: ViewQuery; format?: ViewFormat }) => void;
  setCellValue: (rowId: string, propertyId: string, value: unknown) => void;
  setRowTitle: (rowId: string, title: string) => void;
  createRow: (options?: { group?: { property: string; key: string | null } }) => void;
  deleteRow: (rowId: string) => void;
  duplicateRow: (rowId: string) => void;
  openRow: (rowId: string) => void;
}

export interface ViewSettingsProps {
  view: CollectionView;
  schema: CollectionSchema;
  onChange: (patch: { query?: ViewQuery; format?: ViewFormat }) => void;
}

export interface ViewDefinition {
  type: ViewType;
  label: string;
  icon: string;

  /* ── 能力宣告（工具列讀這個，不寫 if）── */
  supportsGrouping: boolean;
  supportsSorting: boolean;
  supportsFiltering: boolean;
  supportsAggregation: boolean;
  /** 需要某種欄位才能呈現（Calendar 需要 date） */
  requiredFieldTypes?: FieldType[];

  Component: FC<ViewProps>;
  SettingsPanel?: FC<ViewSettingsProps>;

  defaultFormat: (schema: CollectionSchema) => ViewFormat;
  /** 告訴容器要不要分組、一次取幾筆 */
  getQueryHints: (view: CollectionView) => { groupBy?: string; pageSize: number };
}

const registry = new Map<ViewType, ViewDefinition>();

export function registerViewType(def: ViewDefinition): void {
  registry.set(def.type, def);
}

export function getViewType(type: ViewType | string): ViewDefinition {
  const def = registry.get(type as ViewType);
  if (!def) {
    const table = registry.get('table');
    if (table) return table;
    throw new Error(`未註冊的視圖型別：${type}`);
  }
  return def;
}

export function listViewTypes(): ViewDefinition[] {
  return [...registry.values()];
}

/** 這個 collection 能不能用這種視圖（Calendar 需要 date 欄位） */
export function viewTypeAvailable(def: ViewDefinition, schema: CollectionSchema): boolean {
  if (!def.requiredFieldTypes || def.requiredFieldTypes.length === 0) return true;
  return Object.values(schema).some((field) =>
    field ? def.requiredFieldTypes?.includes(field.type) : false,
  );
}

/** 視圖裡要顯示哪些欄位、順序與寬度（format.properties 沒列到的排最後） */
export function visibleProperties(
  schema: CollectionSchema,
  format: ViewFormat | undefined,
): Array<{ property: string; width: number }> {
  const configured = format?.properties ?? [];
  const seen = new Set<string>();
  const out: Array<{ property: string; width: number }> = [];

  for (const entry of configured) {
    if (!schema[entry.property] || seen.has(entry.property)) continue;
    seen.add(entry.property);
    if (entry.visible === false) continue;
    out.push({ property: entry.property, width: entry.width ?? 160 });
  }
  for (const property of Object.keys(schema)) {
    if (seen.has(property)) continue;
    // 沒設定過的欄位預設顯示，但 title 一定排最前面
    out.push({ property, width: property === 'title' ? 320 : 160 });
  }
  return out.sort((a, b) => (a.property === 'title' ? -1 : b.property === 'title' ? 1 : 0));
}

/** 新欄位的預設寬度（跟後端 defaultViewFormat 一致） */
export function defaultPropertyWidth(property: string): number {
  return property === 'title' ? 320 : 160;
}

/**
 * BUG-8：新增的欄位要接在 `format.properties` 的**尾端**。
 *
 * 原本 `visibleProperties()` 只把「format 沒列到的欄位」統統補在後面，
 * 而那個順序是 `Object.keys(schema)` ＝ Postgres jsonb 的 key 排序
 * （先比長度、再比 byte），所以剛加的欄位會插在中間，而且重整後才看得出來。
 *
 * 這一支把「目前的 properties」重新對齊 schema：
 *   1. 保留既有順序（連同使用者調過的 width / visible）；
 *   2. 丟掉 schema 已經沒有的欄位；
 *   3. `appended` 裡的欄位一律移到**最後**（就是這次新增的那幾個）；
 *   4. 其餘沒被列到的欄位補在 `appended` 之前。
 *
 * ⚠️ `appended` **不**檢查 schema：呼叫端拿到 propertyId 的當下
 * （`applySchemaOps` 剛回來）本地的 schema 還是舊的一份。
 * 後端 `applySchemaOps` 也跑同一套邏輯（service.ts 的 `alignViewProperties`），
 * 兩邊結果一致，所以誰先誰後都不會打架。
 */
export function alignViewProperties(
  format: ViewFormat | undefined,
  schema: CollectionSchema,
  appended: readonly string[] = [],
): ViewPropertyFormat[] {
  const configured = format?.properties ?? [];
  const prior = new Map(configured.map((entry) => [entry.property, entry]));
  const appendedIds = [...new Set(appended)];
  const isAppended = new Set(appendedIds);

  const seen = new Set<string>();
  const out: ViewPropertyFormat[] = [];

  for (const entry of configured) {
    if (seen.has(entry.property) || isAppended.has(entry.property)) continue;
    if (!schema[entry.property]) continue;
    seen.add(entry.property);
    out.push(entry);
  }
  for (const property of Object.keys(schema)) {
    if (seen.has(property) || isAppended.has(property)) continue;
    seen.add(property);
    out.push({ property, visible: true, width: defaultPropertyWidth(property) });
  }
  for (const property of appendedIds) {
    if (seen.has(property)) continue;
    seen.add(property);
    out.push(prior.get(property) ?? { property, visible: true, width: defaultPropertyWidth(property) });
  }
  return out;
}
