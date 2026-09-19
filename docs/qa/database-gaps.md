# 資料庫功能缺口補完（第三輪 BUG-11 與「缺口」清單）

- 日期：2026-09-20
- 範圍：`apps/web/src/features/database/**`、`apps/server/src/modules/databases/**`、
  `packages/shared-types/src/database.ts`、垃圾桶（`pages/repo.ts` 的 `listTrash`）、
  側邊欄一個入口（`features/page-tree/Sidebar.tsx`）
- 驗證環境：本機 `vite --port 5304 --strictPort` + `VITE_PROXY_TARGET=http://100.74.148.92:8090`
  → **前端立刻生效，後端要 deploy 才會在遠端生效**
- 回歸測試：`e2e/database-gaps.spec.ts`（9 條，其中 6 條標「需部署」）

---

## 1. 逐項狀態

| # | 項目 | 狀態 | 需部署 |
|---|---|---|---|
| 1 | BUG-11：`dualProperty` 驗證 + 自動建反向欄位 + FieldConfig 改版 | ✅ | **後端**＋前端 |
| 2 | RowPeek 內容區掛真的 `<Editor>` | ✅ | 前端 |
| 3 | 刪除列進工作區垃圾桶（可還原 / 永久刪除，顯示所屬資料庫） | ✅ | **後端**＋前端 |
| 4 | CSV 匯出：欄序依視圖、title 第一欄、relation 輸出標題 | ✅ | **後端** |
| 5 | 側邊欄「新增資料庫」入口 | ✅ | 前端 |
| 6 | 預設欄寬 200 / title 276 | ✅ | **後端**＋前端 |
| 7 | 列選取 + 批次操作 + 表格列拖曳排序 | ✅ | **後端**（`POST /rows/reorder`）＋前端 |

### 1. BUG-11 —— relation 的反向欄位

**擋下壞設定**：`PATCH /schema` 的 `add` / `update` / `retype` 碰到 relation 欄位時，
會載入 `definition.collectionId` 指到的那個 collection 的 schema，確認
`dualProperty` 真的存在而且型別是 `relation`，否則回 **400**，訊息直接說明怎麼修
（「目標資料庫裡沒有欄位「X」，反向關聯無法建立。請改用『在目標資料庫顯示反向欄位』…」）。
只驗**這一批動過的** relation 欄位，既有的壞資料不會被無關的 op 連坐。

**寫入時的保險**：`syncRelations()` 也會檢查一次，目標 schema 沒有那個欄位就
**當成單向關聯**跳過反向寫入 —— 舊資料不會再繼續長出孤兒屬性與孤兒邊。

**自動建反向欄位**：`add` / `update` op 新增了 `createDual: { name }`。
後端在**同一個交易**裡：

1. 在目標 collection 的 schema 加一個 relation 欄位（`collectionId` 指回來源、
   `dualProperty` 指向來源欄位）；
2. 把來源欄位的 `dualProperty` 設成新欄位的 id（互指）；
3. 對目標 collection 的**每一個視圖**跑 `alignViewProperties()`，新欄位接在尾端（BUG-8 的規則）。

目標是自己（自我關聯）時走同一份邏輯，只是兩個欄位都在同一份 schema 裡。

**前端**：`fields/relation/Config.tsx` 重寫（原本是 `_shared/configs.tsx` 裡兩個裸的文字框）：

- 「目標資料庫」變成**下拉**，資料來自新的 `GET /api/databases?workspaceId=`
  （`service.listDatabases()` / `repo.listCollectionsForUser()`）；
- 「在目標資料庫顯示反向欄位」**開關** + 反向欄位名稱輸入；打開就送 `createDual`；
- 關掉只解除本欄的 `dualProperty`（單向化），**不會**去刪對方的欄位 —— 刪欄位是破壞性動作。
- 換目標資料庫時一定連帶清掉 `dualProperty`，否則會指到另一個資料庫的欄位。

### 2. RowPeek 掛編輯器

`RowPeek.tsx` 的佔位文字換成與整頁**完全同一支** `<Editor>`：
`usePageSnapshot(open ? row.id : null)` 拿 snapshot，`key={row.id}` 保證換列重建，
peek 關閉時整棵子樹卸載（`useEditorHost` 的 cleanup 會銷毀 editor-core）。
外框仍保留 `id="editor-host-row"`，維持 README §4 的掛載點約定。
「以整頁開啟」導向 `/page/:rowId`（App.tsx 現行路由是 `/page/:pageId` 與
`/database/:pageId`，**沒有** `/w/:ws/p/:id` 這種形狀，所以沒有改路由）。

### 3. 刪除列進垃圾桶

- `service.deleteRow()` 改走**與 pages 相同的軟刪除路徑**：
  `pagesRepo.collectDescendantIds()` + `pagesRepo.softDeleteSubtree()`
  （以前只 `UPDATE pages SET deleted_at`，列底下的 block 沒跟著走）。
- `pages/repo.ts` 的 `listTrash()` 拿掉了 `AND collection_id IS NULL`
  —— 就是那一條讓「還原得了，卻沒有入口」的條件 —— 並 join 回 collection 的頁面標題，
  多回 `collectionId` / `collectionTitle`（`TrashedPage` 加了兩個選填欄位）。
  「父層也被刪掉就不重複列出」那條規則仍在，所以整個資料庫被刪時只會看到資料庫本身。
- `TrashPopover` 在時間旁邊顯示「〈資料庫名稱〉・N 分鐘前刪除」，
  點資料庫本身會導向 `/database/:id`。

### 4. CSV 匯出

- 沒帶 `viewId` 時**退回第一個視圖**（以前是「沒有視圖」→ 欄序退回 jsonb key 序，
  title 被排到最後）；
- 欄序抽成可單測的 `csvColumns(schema, format)`：可見欄照視圖順序、title 一律第一欄；
- relation 欄位輸出**目標列的標題**（多個以 `, ` 連接），
  用一次 `findRowsByIds()` 批次撈回來，不是每格一次查詢。

### 5. 側邊欄入口

`Sidebar.tsx` 的「新增頁面」下面加一顆「新增資料庫」（`table` icon），
呼叫 `createDatabase({ inline: false })` 後導向 `/database/:pageId`。
這是本輪唯一動到 `features/page-tree` 的地方。

### 6. 預設欄寬

前後端各有一份常數，數字必須一致：

| 位置 | 常數 |
|---|---|
| `apps/server/src/modules/databases/service.ts` | `DEFAULT_TITLE_WIDTH = 276` / `DEFAULT_PROPERTY_WIDTH = 200` |
| `apps/web/src/features/database/views/types.ts` | 同上（`defaultPropertyWidth()`） |

`defaultViewFormat()` / `alignViewProperties()` / 表格的 `defaultFormat()` 全部改讀這個函式。

### 7. 列選取、批次操作、拖曳排序

- **勾選框**壓在名稱欄左側（`.rowCheckbox`，`position: absolute; left: 4px`），
  平常 `display: none`，列 hover 或已選取才出現；此時名稱欄文字 `padding-left: 20px`
  往右讓位（Notion 07c 的量測值）。
- **Shift 連選**：以上一次點的那一列為錨點，兩端之間全部加選（Notion 只加不減）。
- **批次列**：選到東西才浮出來（`.batchBar`，表格頂端置中），
  有「全選 / 已選取 N 列」「匯出選取」「複製」「刪除」「取消」。
  匯出走**瀏覽器端**組 CSV（欄序＝目前視圖，含 BOM，relation 用標題快取），
  不必為了選取再打一次後端。
- **拖曳排序**：沿用既有那顆浮在表格左邊的 ⠿ 把手，加上 HTML5 DnD
  （不加套件、不用 `@kennote/ui` 的 dnd，因為把手不在 `.grid` 的捲動容器裡）。
  落點用「指標在列的上半／下半」決定，放開時呼叫新的
  **`POST /api/databases/:id/rows/reorder`**（`{ rowId, afterId }`，`afterId: null` = 移到最前面），
  後端用 pages 同一支 `computeSortKey()` 算 fractional index，只寫一列。
  前端先做樂觀重排，再以伺服器回來的順序為準。

---

## 2. 改了哪些檔案

| 檔案 | 內容 | 需部署 |
|---|---|---|
| `packages/shared-types/src/database.ts` | `SchemaOp` 的 `add` / `update` 加 `createDual` | 兩邊 |
| `packages/shared-types/src/page.ts` | `TrashedPage` 加 `collectionId` / `collectionTitle` | 兩邊 |
| `apps/server/src/modules/databases/service.ts` | BUG-11 驗證與 `createDual`、`syncRelations` 守門、`csvColumns` / relation 標題、`reorderRow`、`listDatabases`、預設欄寬、`deleteRow` 改走 pages 軟刪除 | **後端** |
| `apps/server/src/modules/databases/routes.ts` | `GET /`（資料庫清單）、`POST /:id/rows/reorder`、`createDual` 的 zod | **後端** |
| `apps/server/src/modules/databases/repo.ts` | `listCollectionsForUser` / `updateRowSortKey` | **後端** |
| `apps/server/src/modules/pages/repo.ts` | `listTrash` 納入資料庫的列 + 帶回資料庫名稱 | **後端** |
| `apps/web/src/features/database/fields/relation/Config.tsx` | relation 設定改版（下拉 + 反向欄位開關） | 前端 |
| `apps/web/src/features/database/fields/_shared/configs.tsx` | 舊的 `RelationConfig` 移除 | 前端 |
| `apps/web/src/features/database/RowPeek.tsx` | 掛真的 `<Editor>` | 前端 |
| `apps/web/src/features/database/api.ts` | `useWorkspaceDatabases` / `reorderRow` | 前端 |
| `apps/web/src/features/database/useDatabaseController.ts` | `deleteRows` / `reorderRow` | 前端 |
| `apps/web/src/features/database/DatabaseView.tsx`・`views/types.ts` | 把兩個新動作往視圖傳 | 前端 |
| `apps/web/src/features/database/views/table/TableView.tsx`＋`.module.css` | 列選取 / 批次列 / 拖曳排序 | 前端 |
| `apps/web/src/features/database/views/types.ts`・`views/table/index.tsx` | 預設欄寬 | 前端 |
| `apps/web/src/features/trash/TrashPopover.tsx` | 顯示所屬資料庫、資料庫導向 `/database/:id` | 前端 |
| `apps/web/src/features/page-tree/Sidebar.tsx` | 「新增資料庫」入口 | 前端 |
| `apps/server/test/databases-csv-and-dual.test.ts` | 新增 10 條純邏輯測試 | — |
| `apps/server/test/databases-view-properties.test.ts`・`apps/web/src/features/database/__tests__/view-properties.test.ts` | 欄寬常數 | — |
| `e2e/database-gaps.spec.ts` | 新增 9 條 | — |

**沒有碰**：`packages/editor-core`、`features/{editor,shell}` 的邏輯檔、
`lib/{sync-client,ot-client}.ts`、`e2e/compare.spec.ts`。
沒有加 runtime 套件、沒有 git commit。

---

## 3. 驗收

```
pnpm --filter @kennote/shared-types typecheck   ✅
pnpm --filter @kennote/server typecheck         ✅
pnpm --filter @kennote/server test              ✅ 25 檔 / 376 條（3 檔 skip：需 DATABASE_URL_TEST）
pnpm --filter @kennote/web typecheck            ✅
pnpm --filter @kennote/web test                 ✅ 16 檔 / 317 條
pnpm --filter @kennote/web build                ✅
BASE_URL=http://127.0.0.1:5304 npx playwright test database-gaps.spec.ts
                                                3 passed / 6 failed
```

那 6 條紅的**全部**是標「需部署」的後端項目（對著遠端舊 server 跑，
`POST /rows/reorder` 甚至回 404 —— 端點還不存在）。
3 條綠的是純前端：RowPeek 掛編輯器、側邊欄入口、列選取 / Shift 連選 / 批次刪除。
**deploy 之後那 6 條就會綠**（同第一輪 BUG-3、第三輪 BUG-10 的情況）。

---

## 4. 還沒做 / 留給下一輪

1. **看板 / 圖庫 / 清單的列選取**：只有表格有勾選框與批次列。
2. **拖曳排序只在表格**，而且**沒有鍵盤替代路徑**（HTML5 DnD 在觸控裝置上不能用；
   第三輪 §4 第 4 點列的那個缺口仍然存在）。
   另外目前的視圖若有 `sort`，拖曳仍會寫 `sort_key`，但畫面會照排序規則重排 ——
   Notion 的做法是「有排序時停用手動拖曳」，這裡還沒擋。
3. **`view.format.manualOrder`** 這條既有路徑仍然沒接（README §7 的已知限制），
   這一輪走的是 `sort_key`。
4. **`createDual` 關掉開關時不會刪對方的欄位**（刻意），UI 上也沒有「順便刪掉」的選項。
5. **批次操作沒有「移動到」「加到收藏」**，也沒有批次改屬性值。
6. 既有資料裡**已經寫出去的孤兒屬性**沒有清理腳本（新的寫入已經擋住，舊的還躺在 jsonb 裡）。
