# ADR 0003 — Database 的 Field Type Registry 與 View Registry

- 狀態：已採用
- 日期：2026-09-19
- 範圍：M4 Database 系統（規格：01 §5、02 §3.5 / §4.3、03 §4.6–4.8 / §6.3–6.6 / §7.3、04 §8 M4 / §10.2–10.3）
- 影響的程式碼：
  - `packages/shared-types/src/database.ts`、`packages/shared-types/src/formula/**`
  - `apps/server/src/modules/databases/**`、`apps/server/migrations/0006_database_m4.sql`
  - `apps/web/src/features/database/**`

---

## 1. 背景

Database 是 Notion 的殺手級功能，也是全專案**最容易變成義大利麵**的地方：
每種欄位型別都同時影響儲存格顯示、編輯器、篩選運算子、排序規則、SQL 查詢、
分組行為、聚合、匯入匯出；每種視圖又都要決定工具列要顯示哪些按鈕。

如果用 `switch (type)` 硬幹，新增一種欄位型別要改十幾個檔案，而且**漏改的地方不會報錯**
（filter 會靜默給出錯誤結果 —— 00-README §5 風險三）。

---

## 2. 決策

### 2.1 兩份 registry，一組 key

- **後端**：`apps/server/src/modules/databases/field-types/`，介面 `ServerFieldType`
  （驗證器 / 正規化 / SQL 投影式 / filter SQL / 分組鍵 / 聚合 / 比較子 / CSV 字串化 / 型別轉換）
- **前端**：`apps/web/src/features/database/fields/`，介面 `FieldTypeDefinition`
  （Cell / Editor / Config / FilterInput / 能力宣告 / 比較子 / 分組鍵 / 純文字化）
- **唯一事實來源**是 `packages/shared-types/src/database.ts` 的 `FIELD_TYPES` 與 `FIELD_TYPE_META`。
  兩邊都有測試檢查「shared-types 宣告的每一種型別都已註冊」，少一個就紅燈。

**為什麼不共用一份？** 後端需要 `Sql` 片段（依賴 pg 的語意），前端需要 React 元件；
硬要共用會讓 shared-types 依賴兩邊的執行環境。共用的是**型別與 key**，不是實作。

**驗收**：新增 `rating` 星等型別只動了
`shared-types` 一個字串 + 後端一個檔案 + 前端一個資料夾 + 兩行 import。
Table / Board / List / Gallery / Calendar / 篩選 / 排序 / 聚合 / CSV 匯出**一行都沒改**。

### 2.2 View 也 registry 化

`apps/web/src/features/database/views/` 的 `ViewDefinition` 宣告
`supportsGrouping / supportsSorting / supportsFiltering / supportsAggregation / requiredFieldTypes`，
工具列（`DatabaseHeader`）讀這些旗標決定顯示哪些按鈕，沒有任何 `if (viewType === 'board')`。
Calendar 用 `requiredFieldTypes: ['date', …]` 宣告「需要日期欄位」，
視圖切換器自動把它灰掉並顯示原因。

### 2.3 相對日期在產生 SQL 時才展開

`{"kind":"relative","relative":"today"}` 存進 `collection_views.query`，
查詢時才用**使用者時區**展開成絕對區間（`expandDateFilterValue`）。
存絕對值的話，「今天到期」明天就是錯的。

### 2.4 日期比較用 ISO 文字，不用 `::timestamptz`

ISO 8601 的字典序就是時間序，而且不會因為某一列被寫進壞資料就讓整批查詢
cast 失敗（那會讓整個視圖打不開）。代價是混用「純日期」與「含時間」時，
純日期會被當成當天零時 —— 這正是我們要的語意。

### 2.5 keyset 分頁展開成 OR 鏈，不用 row-value 比較

PostgreSQL 的 `(a, b, id) > ($1, $2, $3)` 要求所有欄位同方向，
但多欄排序可以 ASC/DESC 混用，而且 `NULLS LAST` 的語意 row-value 表達不出來。
所以 `buildCursorSql` 展開成字典序的 OR 鏈：
`(k1 之後) OR (k1 相同 AND k2 之後) OR (全部相同 AND id > 游標 id)`。
`p.id` 是永遠存在的 tie-break（03 §7.3 明列為必備）。

### 2.6 計算欄位（formula / rollup）不下推 SQL

`ServerFieldType.sqlCapable = false`。牽涉到它們的 filter/sort 由 service 取回後
在記憶體處理（`memory-filter.ts`），並**關閉 cursor 分頁**改用 offset，
掃描上限 `MEMORY_SCAN_LIMIT = 2000`。

**取捨**：正確性優先。要把公式下推 SQL 得把整個運算式編譯成 SQL 表達式，
型別系統與 null 語意一定會跟 JS 求值器有差異，而「兩邊算出不同答案」比「大資料庫時慢一點」嚴重得多。
之後若成為瓶頸，正確的做法是 03 §6.4 建議的「寫入時標 stale + 背景 worker 重算並寫回 JSONB」，
屆時 formula 就會變成一般的 JSONB 欄位、自動變回 `sqlCapable`。

### 2.7 rollup / formula 目前是「查詢時計算」

03 §6.4 建議背景重算；M4 先做查詢時計算（每頁 ≤ 200 筆，rollup 的目標列**一次批次載入**，
沒有 N+1）。`computeRowProperties` 的呼叫點之後移到 worker 即可，形狀不必改。

### 2.8 relation 的邊表叫 `row_relations`，不叫 `block_relations`

03 §4.8 的邊表指向 `blocks`；本專案的 database 列是 **pages**（ADR 0002 的分表決定），
所以改名並指向 `pages`。欄位語意、唯一鍵、索引策略與 03 §4.8 完全一致。
**真值仍是 `pages.properties.<prop>.pageIds`**，邊表是同一個交易內維護的投影；
雙向 relation 的反向欄位也在同一個交易內寫回目標列。

### 2.9 公式引擎放在 `packages/shared-types/src/formula/`

需求是「前端即時檢查、後端求值，同一份程式碼」。shared-types 是零依賴的純 TS 套件，
前後端都已經依賴它；另開一個 `packages/formula` 只會多一層 workspace 依賴而沒有好處。
組成：tokenizer → Pratt parser → compile（型別檢查 + `prop("名稱")` → propertyId + dependsOn）→ evaluate。
循環引用在 **存檔時** 就被 `findSchemaFormulaCycles` 擋下（不是等到求值），
求值器另外有 visiting 集合與步數上限當防呆。

### 2.10 schema 變更走 ops，不是整份覆蓋

`PATCH /api/databases/:id/schema` 接 `{ ops: SchemaOp[] }`：
`add / rename / update / retype / delete`。
`retype` 在同一個交易內做值遷移，轉不動的**清空**並在回應的 `migrations` 裡回報筆數。
改型別前 UI 必須先打 `POST /api/databases/:id/schema/preview-cast`
（02 §4.3.1：「絕不可靜默轉換並丟失資料」）。
轉換規則由 registry 提供：`target.coerceFrom` → 否則 `source.toPlainText` + `target.fromPlainText`，
所以新型別只要實作 `fromPlainText` 就自動支援所有來源型別。

### 2.11 `_fallback/` 是暫時的 UI 基元

`packages/ui` 的 Popover / Menu / Dialog / VirtualList / dnd / icons 由另一位代理平行開發。
database 模組全部從 `features/database/_fallback` import，
`packages/ui` 補齊後只要改 `_fallback/index.tsx` 的 re-export，diff 只有一支檔案。

---

## 3. 被否決的選項

| 選項 | 為什麼不採用 |
|---|---|
| 值用 EAV（每個屬性一列） | 多條件篩選要 N 次 self-join，1000 列就開始痛（03 §5.1 也是同樣的結論） |
| 欄位定義直接用欄位**名稱**當 key | 改名要 rewrite 每一列的 JSONB，而且看板分組設定會斷（03 §4.6） |
| `OFFSET` 分頁 | 大表會爆；keyset 是 03 §7.4.7 的硬性要求 |
| 前端全量載入後自己篩選 | 02 §3.5 明確要求「由後端做篩選排序」 |
| 引入 TanStack Table / ag-grid | 00-README 決策：自研，不引入 UI 套件 |
| 公式用 `eval` 或 `new Function` | XSS／沙箱風險，而且無法做型別檢查與循環偵測 |

---

## 4. 後果

**好的**
- 新增欄位型別 / 視圖型別的成本是「一個資料夾 + 一行 import」
- filter 的欄位名走白名單、值全參數化，injection 測試釘在 `databases-query-builder.test.ts`
- 前後端的排序／分組語意由同一組比較子定義，樂觀更新不會跟伺服器結果打架

**要注意的**
- 兩份 registry 必須同步；靠 `FIELD_TYPES` 的完整性測試把關（兩邊都有）
- formula/rollup 的 filter/sort 有 2000 列掃描上限，超過會截斷（UI 需提示，目前未做）
- `MAX_MIGRATION_ROWS = 10000`：超大 collection 的型別轉換要改走匯出／匯入
- relation 的儲存格目前顯示標題快取，快取沒命中時退回顯示 id 前 8 碼

---

## 5. 驗收對照（04 §8 M4）

| 驗收標準 | 對應實作 |
|---|---|
| 8 種欄位型別 | `field-types/`（text / number / select / multiSelect / date / checkbox / url / person）+ title |
| 各視圖篩選排序各自保存 | `collection_views.query` / `format`，`PATCH view` 以 400ms debounce 存檔 |
| 巢狀 AND/OR 篩選 | `buildFilterSql` 遞迴 + `FilterBuilder` 兩層群組 UI |
| Board 拖曳換組 | `BoardView` 的 `useDropZone` → `setCellValue(分組欄位)` |
| 列可展開成頁面 | `RowPeek` + `<div id="editor-host-row" data-page-id>` |
| 1000 列 DOM < 100 | `_fallback/VirtualList`（固定列高 32px + overscan 6） |
| relation 雙向 | `service.syncRelations` + `row_relations` |
| formula 循環引用被偵測 | `detectFormulaCycles` / `findSchemaFormulaCycles`，存檔時擋下 |
| SQL injection 測試 | `apps/server/test/databases-query-builder.test.ts` 的 `SQL injection` 段 |
| 新增 rating 只要 registry + 一個資料夾 | `field-types/rating.ts` + `fields/rating/`，測試在兩邊的 registry 測試裡 |
