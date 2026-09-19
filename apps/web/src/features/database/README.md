# features/database —— 給其他代理的說明

Notion 類的 database（collection）模組。設計決策與取捨寫在
[`docs/adr/0003-database-registry.md`](../../../../../docs/adr/0003-database-registry.md)。

```
features/database/
├─ index.ts               ← 對外唯一入口，請只從這裡 import
├─ DatabaseView.tsx       ← 容器（整頁與內嵌共用）
├─ InlineDatabase.tsx     ← 內嵌用的薄外框
├─ DatabaseHeader.tsx     ← 視圖 tabs + 工具列
├─ FilterBuilder / SortBuilder / GroupSettings / PropertyList / FieldConfigPopover
├─ RowPeek.tsx            ← Row = Page 的側邊預覽（含編輯器掛載點）
├─ EditableCell.tsx       ← 顯示／編輯雙態的儲存格（Table / Board / RowPeek 共用）
├─ useDatabaseController.ts ← 狀態機：分頁累積、樂觀更新、debounce 存檔
├─ api.ts                 ← 所有 API 呼叫集中在這裡
├─ filter-model.ts        ← 篩選條件樹的純邏輯（可單獨測試）
├─ fields/                ← ⭐ Field Type Registry（每型別一個資料夾）
├─ views/                 ← ⭐ View Registry（每視圖一個資料夾）
└─ _fallback/             ← 暫時的 UI 基元，packages/ui 補齊後替換
```

---

## 1. 怎麼新增一種欄位型別

以 `rating`（星等）為例，**完整步驟只有四步**，其他檔案一行都不用改：

### 1) `packages/shared-types/src/database.ts`

```ts
export const FIELD_TYPES = [..., 'rating'] as const;

export const FIELD_TYPE_META = {
  ...,
  rating: { label: '星等', icon: 'rating', group: 'basic', computed: false },
};

// 值的形狀（03 §6.4：清空 = 刪掉整個 key）
export type FieldValue = ... | { type: 'rating'; rating: number };

// 欄位定義的形狀
export type FieldDefinition = ... | (FieldDefinitionBase & { type: 'rating'; max?: number });
```

### 2) 後端：`apps/server/src/modules/databases/field-types/rating.ts`

```ts
defineFieldType({
  type: 'rating',
  kind: 'number',          // 決定聚合與 cursor 的轉型語意
  sqlCapable: true,
  validateConfig: (d) => parseDef(zodSchema, d),
  normalize: (v, def) => ...,        // 回 null = 空 → 呼叫端刪掉 key
  toSqlExpr: (pid) => sql`((p.properties -> ${pid} ->> 'rating')::numeric)`,
  filterOperators: NUMBER_OPS,
  aggregations: NUMBER_AGGS,
  compare, groupKeys, groupLabel, toPlainText, fromPlainText,
});
```
再到 `field-types/index.ts` 加一行 `import './rating.js';`。

> `toSqlExpr` 的 `propertyId` **一定要當參數傳**（`${pid}`），不要拼進 SQL 文字。
> `query-builder.ts` 的第一段註解寫了完整的安全規則。

### 3) 前端：`apps/web/src/features/database/fields/rating/`

| 檔案 | 內容 |
|---|---|
| `ops.ts` | 能力宣告 + 純邏輯（`compare` / `groupKeys` / `toPlainText` / `defaultConfig`） |
| `Cell.tsx` | 唯讀顯示（**要輕量**：1000 列 × 8 欄都會渲染它） |
| `Editor.tsx` | 編輯器（`onChange(未正規化的原始值)`，後端 registry 會 normalize） |
| `Config.tsx` | 欄位設定面板（可直接 re-export `_shared/configs` 的現成元件） |
| `index.ts` | `registerFieldType({ type: 'rating', ...ops, Cell, Editor, Config, FilterInput })` |

### 4) `fields/index.ts` 加一行 `import './rating/index';`

完成。Table / Board / List / Gallery / Calendar、篩選器、排序面板、屬性清單、
聚合列、CSV 匯出全部自動支援 —— 這就是 04 §8 M4 最後一條驗收標準的意思。

### 能力旗標怎麼選

| 旗標 | 意思 |
|---|---|
| `sortable` | 排序面板要不要列出這個欄位 |
| `filterable` | 篩選器要不要列出 |
| `groupable` | 能不能當 Board 的泳道依據 |
| `computed` | 值由系統算出來 → 不可編輯（Editor 只顯示說明） |
| `editInline` | 點一下就切換，不進編輯態（checkbox / rating） |
| `editorSurface` | `'inline'` 把輸入框蓋在儲存格上；`'popover'`（預設）開浮層 |

---

## 2. 怎麼新增一種視圖

`views/<type>/` 一個資料夾 + `views/index.ts` 一行 import：

```ts
registerViewType({
  type: 'timeline',
  label: '時間軸',
  supportsGrouping: false,
  supportsSorting: true,
  supportsFiltering: true,
  supportsAggregation: false,
  requiredFieldTypes: ['date'],     // 沒有 date 欄位時自動灰掉
  Component: TimelineView,          // props 是 ViewProps
  SettingsPanel: TimelineSettings,  // 「⋯ → 版面設定」自動出現
  defaultFormat: (schema) => ({ ... }),
  getQueryHints: (view) => ({ pageSize: 100 }),
});
```

`ViewProps` 給的是**資料 + 動作**，視圖不要自己打 API：
`rows / groups / aggregations / hasMore / loadMore /
updateView / setCellValue / setRowTitle / createRow / deleteRow / duplicateRow / openRow`。

---

## 3. 怎麼嵌入 InlineDatabase

`collectionView` 型別的 block 直接渲染：

```tsx
import { InlineDatabase } from '../database';

<InlineDatabase
  collectionId={block.props.collectionId}
  viewId={block.props.viewId}   // 可省略 → 用第一個視圖
  readOnly={!canEdit}
  maxHeight={560}
/>
```

- 與整頁資料庫是**同一支 DatabaseView**，query key 也相同，
  所以同一頁出現兩次只會打一次 API。
- 整頁版本在 `/w/:workspaceId/db/:collectionId`（`routes/DatabaseRoute.tsx`），
  可用 `?view=<viewId>` 指定視圖。

### 建立資料庫（側邊欄「＋」與頁面 `/` 選單都用這支）

```ts
import { createDatabase } from '../database';

const snapshot = await createDatabase({
  workspaceId,
  parentPageId: currentPageId ?? null,  // 省略 = 工作區頂層
  title: '任務追蹤',
  inline: true,                          // 內嵌資料庫
});

// snapshot.collection.id → 存進 block.props.collectionId
// snapshot.views[0].id   → 預設的 Table 視圖
```

回來的資料庫已經有預設欄位（名稱 / 標籤 multiSelect / 狀態 select / 日期）與一個表格視圖。

---

## 4. RowPeek 的 editor host 約定 ⭐

「列 = 頁面」是這個模型最大的槓桿點（03 §4.6）。點一列會開 side peek，
裡面有**給編輯器代理的掛載點**：

```html
<div id="editor-host-row" data-page-id="<pageId>"></div>
```

約定：

1. **同一時間只會有一個** `#editor-host-row`（一次只開一個 peek）。
2. `data-page-id` 就是這一列的 `pageId` —— 它是一個真正的 page，
   初次資料走 `GET /api/pages/:id/snapshot`，變更走
   `POST /api/pages/:id/transactions`（跟 `#editor-host` 完全一樣的協定）。
3. peek 關閉時這個 div 會被 React 卸載，請在 cleanup 裡解除掛載
   （建議用 `MutationObserver` 或在掛載時記住 node，`disconnectedCallback` 時清掉）。
4. 「以整頁開啟」會導向 `/page/:pageId`，那裡是既有的 `#editor-host`，不需要特別處理。
5. 屬性表（`<dl>`）在掛載點**上方**，由 database 模組自己管理，編輯器不要動它。

---

## 5. 與後端的契約

| 端點 | 用途 |
|---|---|
| `POST /api/databases` | 建立（回 collection + 預設視圖 + 預設欄位） |
| `GET /api/databases/:id` | schema + 所有視圖 |
| `GET /api/databases/:id/rows?viewId=&cursor=&search=&timeZone=` | `{ rows, groups?, aggregations?, cursor, hasMore, total }` |
| `POST /api/databases/:id/rows` | 可帶 `group: { property, key }`（看板的「＋ 新增」） |
| `PATCH /api/databases/:id/rows/:rowId` | 回傳**重算過的整列**（formula / rollup 會更新） |
| `DELETE /api/databases/:id/rows/:rowId` | 軟刪 |
| `POST /api/databases/:id/rows/:rowId/duplicate` | 複製列 |
| `PATCH /api/databases/:id/schema` | `{ ops: SchemaOp[] }`，回 `{ collection, migrations }` |
| `POST /api/databases/:id/schema/preview-cast` | 改型別前的損失預告（**必做**，02 §4.3.1） |
| `POST/PATCH/DELETE /api/databases/:id/views[/:viewId]` | 視圖 CRUD |
| `GET /api/databases/:id/export.csv?viewId=` | CSV（含 BOM，Excel 開中文不亂碼） |
| `GET /api/databases/field-types` | registry 快照（型別選單／運算子的伺服器端事實） |

分頁一律 **cursor（keyset）**；`cursor` 原封不動回傳給下一次請求即可。

---

## 6. `_fallback/` 要怎麼替換

`packages/ui` 的 Popover / Menu / Dialog / VirtualList / dnd / icons 補齊後，
把 `_fallback/index.tsx` 改成 re-export 就好：

```ts
export { Popover, Menu, MenuItem, Dialog, VirtualList } from '@kennote/ui';
```

模組內**所有**檔案都是 `import { … } from '../_fallback'`，
沒有人直接 import 實作檔，所以替換的 diff 只會有這一支。
需要保留的 API 形狀：

| 元件 | 必要 props |
|---|---|
| `Popover` | `open / anchor(HTMLElement) / onClose / placement / minWidth` |
| `Menu` / `MenuItem` | `MenuItem: onSelect / icon / danger / disabled / selected / hint` |
| `Dialog` | `open / onClose / title / footer / variant('side' \| 'center') / width` |
| `VirtualList` | `items / itemHeight / renderItem / onEndReached / footer` |
| `useDragHandle` / `useDropZone` | payload `{ kind, id, from?, index? }` |
| `FieldIcon` | `type`（欄位型別 key） |

---

## 7. 已知限制（M4 的邊界）

- **formula / rollup 的 filter/sort 走記憶體路徑**，掃描上限 2000 列、cursor 改成 offset。
- **relation 儲存格**顯示標題快取；快取沒命中時顯示 id 前 8 碼（picker 開過就會有標題）。
- **files 欄位**只支援外部連結；`POST /api/files/upload` 接上後換掉 `fields/files/Editor.tsx` 即可。
- **Gallery 的 `pageContent` 封面**（頁面內容首圖）目前退回頁面封面，要載入 block 才做得到。
- **manualOrder（拖曳列排序）** 的 API 已存在（`PATCH view` 的 `manualOrder`），UI 尚未接。
- **子分組 sub-group**、**timeline 視圖**、**個人暫用視圖設定**是 P2，尚未實作。
