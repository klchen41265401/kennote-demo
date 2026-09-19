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

## 4. RowPeek 的編輯器 ⭐

「列 = 頁面」是這個模型最大的槓桿點（03 §4.6）。點一列會開 side peek，
標題與屬性表（`<dl>`）由 database 模組自己管，底下**直接掛整頁用的那一支編輯器**：

```tsx
<div id="editor-host-row" data-page-id={row.id}>
  <Editor key={row.id} pageId={row.id} workspaceId={workspaceId}
          snapshot={usePageSnapshot(open ? row.id : null).data} … />
</div>
```

- 初次資料 `GET /api/pages/:id/snapshot`、變更走同一條同步層 ——
  peek 與 `/page/:id` 改的是**同一份資料**。
- `key={row.id}` 保證換一列就重建編輯器；peek 關閉時整棵子樹卸載，
  `useEditorHost` 的 cleanup 會銷毀 editor-core。
- 「以整頁開啟」導向 `/page/:rowId`（那裡是既有的 `#editor-host`）。
- `id="editor-host-row"` 仍然保留，外部還是可以靠它找到 peek 的內容區。

## 5. 與後端的契約

| 端點 | 用途 |
|---|---|
| `POST /api/databases` | 建立（回 collection + 預設視圖 + 預設欄位） |
| `GET /api/databases?workspaceId=` | 工作區的資料庫清單（relation 的「目標資料庫」下拉） |
| `GET /api/databases/:id` | schema + 所有視圖 |
| `GET /api/databases/:id/rows?viewId=&cursor=&search=&timeZone=` | `{ rows, groups?, aggregations?, cursor, hasMore, total }` |
| `POST /api/databases/:id/rows` | 可帶 `group: { property, key }`（看板的「＋ 新增」） |
| `PATCH /api/databases/:id/rows/:rowId` | 回傳**重算過的整列**（formula / rollup 會更新） |
| `DELETE /api/databases/:id/rows/:rowId` | 軟刪（走 pages 的軟刪除路徑 → 進工作區垃圾桶） |
| `POST /api/databases/:id/rows/reorder` | `{ rowId, afterId }` 拖曳排序（`afterId: null` = 最前面） |
| `POST /api/databases/:id/rows/:rowId/duplicate` | 複製列 |
| `PATCH /api/databases/:id/schema` | `{ ops: SchemaOp[] }`，回 `{ collection, migrations }`。relation 的 `add`/`update` 可帶 `createDual: { name }` 自動建反向欄位 |
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

## 7. 已知限制

> 完整清單與編號在 [`docs/qa/README.md`](../../../../../docs/qa/README.md) §2
> （資料庫相關的是 B 的 O-3、D 的 O-11 / O-13、**E 的 O-16～O-21 整組**、F 的 O-24 / O-27）。
> 這裡只留「改這個模組時一定要知道」的。

### 仍然開著

- **`BUG-7`：檢視分頁列溢位時，選中的檢視會被收進溢位選單**，
  `aria-selected` 的 tab 因此不存在，整組檢視選單（改名／複本／刪除）打不開。
  第二輪抓到、第三輪再次確認仍擋著，**從未結案**。
- **`BUG-8`：新增欄位不排在最後**（順序是 jsonb key 序）。
  server 端有 `alignViewProperties()`，`database-gaps` 也沿用了 append 規則，
  但**沒有做過正式回歸驗證**，所以仍算開著。
- **formula / rollup 的 filter/sort 走記憶體路徑**，`MEMORY_SCAN_LIMIT = 2000`、
  cursor 改成 offset，超過會截斷而且**UI 沒有提示**（ADR 0003）。
- **`loadRollupSources` / `loadRelationTitles` 讀目標 collection 的列時沒再問一次權限**
  —— 舊 relation 指向你看不見的資料庫時，rollup 仍讀得到標題（QA O-3）。
- **relation 儲存格**顯示標題快取；快取沒命中時顯示 id 前 8 碼（picker 開過就會有標題）。
- **files 欄位只支援外部連結。** `POST /api/files/upload` 早就可以用了，
  換掉 `fields/files/Editor.tsx` 走上傳流程即可 —— 這一項純粹是還沒接（QA O-27）。
- **date 儲存格是輸入框不是月曆格**（QA O-27）。
- **Gallery 的 `pageContent` 封面**（頁面內容首圖）目前退回頁面封面，要載入 block 才做得到。
- **列選取 / 批次操作只有表格有**（看板 / 圖庫 / 清單沒有勾選框與批次列，QA O-16）；
  批次操作也沒有「移動到」「加到收藏」與批次改屬性值（O-20）。
- **拖曳列排序只有表格接了**（`POST /api/databases/:id/rows/reorder`，寫 `pages.sort_key`），
  **沒有鍵盤替代路徑**，而且視圖有 `sort` 時仍可拖曳（Notion 是停用）（O-17）。
  `view.format.manualOrder` 那條既有路徑仍未使用（O-18）。
- **看板卡片、日曆、`PropertyList`、`SortBuilder` 還是 HTML5 DnD → 觸控全死。**
  正解是統一改用 `@kennote/ui` 的 dnd 引擎（O-11）。連續四輪延後。
- **手機版的資料庫表格橫捲**連續五～六輪沒有走查過（O-13）。
- `createDual` 關掉開關時**不會刪對方的欄位**（刻意），UI 也沒有「順便刪掉」的選項（O-19）。
- 舊資料裡**已經寫出去的孤兒屬性沒有清理腳本**（新的寫入已經擋住了）（O-21）。
- **子分組 sub-group** 與**個人暫用視圖設定**是 P2，尚未實作。
- **資料庫的列刪掉後該進哪個垃圾桶**規格面未定案（目前進工作區垃圾桶）（O-24）。

### 已經修掉、不要再照抄

- ~~timeline 視圖尚未實作~~ → **已實作**（`views/timeline/`，migration `0060_timeline_view.sql`
  把 `'timeline'` 加進 `collection_view_type` enum）。**6 種視圖全部都在。**
- ~~relation 的 `dualProperty` 指到不存在的欄位會寫出孤兒資料（BUG-11）~~ →
  **已修**（`database-gaps.md` 第 1 項：雙向驗證 + 自動建立反向欄位）。
- ~~表格預設只看得到前 5 個欄位（BUG-10）~~ → **已修**（前後端兩份 `defaultFormat` 都改了）。
- ~~巢狀浮層一按就把父浮層關掉、資料庫設定面板整個按不動（BUG-5）~~ →
  **已修**（`@kennote/ui` 的 overlay stack）。
- ~~RowPeek 的內容區是寫死的佔位文字~~ → **已是完整的編輯器**（見 §4）。
- ~~側邊欄沒有「建立資料庫」入口~~ / ~~刪除的列不進垃圾桶~~ / ~~CSV 欄序不對~~ →
  全部在 `database-gaps.md` 結清。
