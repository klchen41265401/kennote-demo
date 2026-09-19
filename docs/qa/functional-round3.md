# 功能 QA 第三輪（真實瀏覽器走查・第二輪未走的資料庫項目）

- 日期：2026-09-20
- 受測站台：`http://100.74.148.92:8090`
  （開始前輪詢 `/api/health` 直到 `status: ok`：`migrations.pending: 0`、
  `latest: 0060_timeline_view.sql`、`features: { realtime: true, ot: true, publicShare: false }`，
  再等 60 秒才開始）
- 驗證修正的環境：本機 `vite --port 5301 --strictPort` + `VITE_PROXY_TARGET=http://100.74.148.92:8090`
  → **前端改動立刻生效，後端改動要 deploy 才會在遠端生效**
- 工具：`e2e/` 的 `@playwright/test` + 一組 node 直打 API 的 harness
  （`POST /api/auth/open` 拿 token，再用 REST 灌資料／對後端實際值）
- 範圍：第二輪 §4 的**資料庫**清單（第 1 項）走完。
  **編輯器（第 2 項）、390 手機版（第 3 項）沒走**，原因與清單在 §4。

> 這一輪的方法跟前兩輪不太一樣：資料庫的行為大半可以直接對 REST 驗，
> 所以先用 API harness 把 formula / relation / rollup / 篩選 / 排序 / 分組 / CSV / 垃圾桶
> 一次掃完，再把「只有 UI 會壞」的部分（三種拖曳、peek、橫捲、1000 列）放到瀏覽器裡走。

---

## 1. 走查表

### 1.1 建立資料庫

| 項目 | 結果 | 備註 |
|---|---|---|
| `/資料庫 - 整頁` | ✅ | slash 選單搜得到，插入後導到 `/database/:pageId`，側邊欄多一個「未命名資料庫」節點 |
| 側邊欄「＋」建立資料庫 | ⚪ **沒有這個入口** | 側邊欄按鈕只有「新增頁面」。路徑是「新增頁面 → `/資料庫 - 整頁`」。列為缺口，不算 bug |

### 1.2 計算欄位

| 項目 | 結果 | 備註（對 `GET /rows` 的實際值） |
|---|---|---|
| formula 新增與求值 | ✅ | `prop("數字") * 2`：10→20、5→10、20→40 |
| **formula 循環引用提示** | ✅ | 互相引用時 `PATCH /schema` 回 **400** `INVALID_FIELD_TYPE`，訊息是「公式出現循環引用：循環A → 循環B → 循環A」，`details.cycles` 也給了環的路徑 |
| formula 引用不存在的欄位 | ✅ | 不擋新增，但值是 `{ value: null, error: "找不到欄位「循環B」" }`——有錯誤欄位，不會 crash |
| formula 自我引用 | ✅ | 同上，`error: "找不到欄位「自我」"`（因為 add 的當下自己還不在 schema 裡） |
| **relation 雙向** | ⚠️ 見 **BUG-11**（未修） | 兩邊都手動設好 `dualProperty` 時**雙向同步是對的**（A→B 寫入會出現在 B 的反向欄位、清空也會跟著清、從 B 端寫也會同步回 A）。問題是**不會自動幫目標建反向欄位**，而且 `dualProperty` 指到不存在的欄位時會寫出孤兒資料 |
| rollup 計算 | ✅ | `sum`：relation 指到金額 100 + 250 → `{ type: 'rollup', value: 350, valueType: 'number' }` |

### 1.3 查詢

| 項目 | 結果 | 備註 |
|---|---|---|
| **篩選 AND/OR 巢狀** | ✅ | `and[ num>=5, or[ sel is o2, chk is true ] ]` → 回 `甲/乙/丙`，正確排除 `丁(5, o3, 未勾)` |
| **多欄排序** | ✅ | `num asc, title desc` → `乙(5) 丁(5) 甲(10) 丙(20)`，同 num 的兩筆照 title 降冪 |
| **分組** | ✅ | `groupBy: sel` → `[["o1",1],["o2",2],["o3",1],[null,0]]`，含空組 |
| **CSV 匯出內容正確性** | ✅（內容對）／⚠️（欄序、relation 呈現） | 見下 |

CSV 實際輸出：

```
日期,雙倍,循環A,自我,匯總,核取,數字,關聯,狀態,名稱
2026-09-01,20,,,350,是,10,"01a0…f76d, 01a0…820b",待辦,甲
2026-09-10,10,,,0,否,5,,進行中,乙
```

- 值本身**都對**：日期、formula（雙倍）、rollup（匯總）、checkbox（是/否）、select 都是人看得懂的字。
- 兩個**可以更好但不算壞**的地方（記錄，未修）：
  1. **欄序是 jsonb key 序，`名稱`（title）被排到最後**。Notion 的 CSV 第一欄一定是 title。
     根因跟第二輪 BUG-8 同一族：匯出沒有走 `view.format.properties`。
  2. **relation 欄位輸出的是 pageId**，不是目標列的標題。

### 1.4 檢視操作（UI）

| 項目 | 結果 | 備註 |
|---|---|---|
| 看板拖曳換組 | ✅ | 拖「卡片A」到「完成」欄 → `PATCH /rows` 把 `sel` 改成 `o3`，後端實際值確認 |
| **看板拖曳換組重整後保持** | ✅ | 重整 + 切回看板，卡片A 在「完成」欄 |
| 日曆拖曳改日期 | ✅ | `2026-09-12` → `2026-09-25`，後端值確認 |
| 時程表拖曳改日期 | ✅（值）／❌→✅ **BUG-9**（已修） | 日期會改，但**每拖一次就彈出一個列 peek 蓋住畫面** |
| 列 peek 打得開 | ✅ | hover 列 → 標題欄上的「開啟」→ `[role="dialog"]`，標題 + 全部屬性都可編輯 |
| **peek 裡加 block** | ❌ **未實作**（不算這一輪的 bug） | `RowPeek.tsx` 的內容區是寫死的佔位文字：「這一列就是一個頁面。內容編輯器（editor-core）會掛在這個區塊，掛載點 id 為 `editor-host-row`」。code 裡有註解說明「編輯器代理把 editor-core 掛進來即可」，屬於**已知未完成**，不是回歸 |
| peek →「以整頁開啟」 | ✅ | 導到 `/page/:rowId` |
| **列整頁開啟並加 block** | ✅ | 打字 → 重整後內容還在，`snapshot` 的 `seq` 也有推進 |

### 1.5 表格

| 項目 | 結果 | 備註 |
|---|---|---|
| **欄位超過 5 個時看不到後面的欄** | ❌→✅ **BUG-10**（已修，後端半邊**需部署**） | 8 個欄位的資料庫，表格只畫得出 5 欄，而且**橫捲不出去**（`.grid` 的 `scrollWidth === clientWidth`） |
| 表格標頭右端「＋ 新增欄位」 | ✅ | 第二輪記的缺口已經補上（`aria-label="新增欄位"`） |
| number / url / email / phone 儲存格 | ✅ | 點格 → Enter → 打字 → Enter，後端分別存成 `{number:42}` / `{url:"https://example.com"}` / `{email:"a@b.com"}` / `{phone:"0912345678"}` |
| date 儲存格 | ⚠️ 部分 | 橫捲後編輯器開得出來（「開始 / 結束日期 / 包含時間 / 清除」），但**是輸入框不是月曆格**，這一輪沒有把「打字輸入日期 → 存檔」走完 |
| person 儲存格 | ✅ | 橫捲後開得出人員選單（「訪客」），選完後端存 `{ type:'person', userIds:[…] }` |
| files 儲存格 | ⚠️ 部分 | 橫捲後開得出編輯器（「新增」），**沒有實際上傳檔案** |
| **1000 列：DOM 節點 < 100** | ✅ | 灌 997 列（另外 3 筆撞到 `240/min` 的寫入 rate limit）。列節點 **61**、儲存格 **150**、整頁 DOM **1082** |
| **1000 列：捲動流暢** | ✅ | 連續 15 次 `scrollTop += 2000` 共 **1.9 秒**；捲到後段畫面上的列從 `列0999` 換成別的，虛擬捲動正常 |

### 1.6 列的生命週期

| 項目 | 結果 | 備註 |
|---|---|---|
| 刪除列 | ✅ | `DELETE /api/databases/:id/rows/:rowId` 2xx，列表不再有該列 |
| **刪除的列進垃圾桶** | ⚠️ **不進工作區垃圾桶** | `GET /api/pages/trash?workspaceId=…` 回 `[]`。資料庫的列雖然是 page，但刪掉之後在側邊欄垃圾桶裡看不到。記錄為缺口（見 §2 觀察），**沒有動手改**，因為有可能是刻意的設計（Notion 的列刪除也是回到資料庫裡的垃圾桶，不是工作區垃圾桶） |
| 還原列 | ✅ | `POST /api/pages/:id/restore` 2xx，列回到資料庫 |

---

## 2. Bug 清單

### BUG-9｜時程表拖曳改日期，順便把列 peek 打開（已修）· 嚴重度：**中**

**重現**

1. 資料庫加一個 date 欄位、幾列有日期的資料，切到「時程表」檢視
2. 把任何一條長條往右拖 150px 放開
3. 日期確實改了，**但同時跳出那一列的 peek 對話框把整個畫面蓋住**
4. 之後想切回別的檢視，分頁列被 `_dialogOverlay_` 擋住點不到（playwright 實測 `[role="tab"]` 點擊逾時 30 秒）

**根因**

`apps/web/src/features/database/views/timeline/TimelineView.tsx` 的長條同時掛了兩件事：

```tsx
onPointerDown={(e) => startDrag('move', e)}
onClick={onOpen}
```

`startDrag()` 裡有 `e.preventDefault()`，但依規範那只擋「相容滑鼠事件」，
**`click` 照樣會在 `pointerup` 之後補送**。`startDrag` 自己有一個 local 的 `moved` 旗標，
只用來決定要不要 `onCommit`，完全沒人告訴 `onClick` 這一發要作廢。
於是「拖曳」= 改日期 **＋** 開 peek。

（形狀跟第一輪 BUG-1、第二輪 BUG-5 是同一族：
**同一個元素上，指標互動與點擊互動互相污染**。）

**修法**（只動 `.tsx`，沒有碰 `.module.css`）

加一個 `suppressClickRef`：`pointerup` 時若 `moved` 就設 true，
`onClick` 看到它就把這一發吃掉並歸零。純拖曳不再開 peek，純點擊照常開。

**回歸測試**：`e2e/functional-round3.spec.ts` →
「BUG-9 時程表：拖曳改日期之後不會順便把列 peek 打開」
（斷言日期有變 **而且** `[role="dialog"]` 數量是 0）

**部署**：前端修正 → **需要重新部署前端**。

---

### BUG-10｜資料庫欄位超過 5 個時，第 6 個以後在表格裡看不到也編輯不到（已修）· 嚴重度：**高**

**重現**

1. 建一個有 8 個欄位的資料庫（名稱 / 數字 / 網址 / 信箱 / 電話 / 日期 / 人員 / 檔案）
2. 開表格檢視
3. 標頭只有 **5 欄**（名稱・數字・網址・信箱・電話），日期 / 人員 / 檔案**不見了**
4. 想橫捲也捲不動 —— 因為根本沒有溢出：

```
[role="grid"] → scrollLeft 0, scrollWidth 1170, clientWidth 1170
```

畫面上沒有任何「有欄位被隱藏」的提示，
唯一找得回來的路徑是 **設定 → 編輯屬性 → 把眼睛一個一個打開**。

> 第二輪把這個現象記成「表格有水平虛擬化」。實際量過之後**不是虛擬化**：
> 欄位是在建立視圖的當下就被寫成 `visible: false` 了。

**根因**（兩個地方各有一份，**兩邊都要改**）

```ts
// apps/server/src/modules/databases/service.ts → defaultViewFormat()
properties: Object.keys(schema).map((property, i) => ({ property, visible: i < 5, … }))

// apps/web/src/features/database/views/table/index.tsx → defaultFormat()
properties: Object.keys(schema).map((property, i) => ({ property, visible: i < 6, … }))
```

`POST /api/databases` 建立預設表格視圖時走的是**後端**那一份（`i < 5`），
所以遠端看到的是 5 欄；前端那一份（`i < 6`）是後端沒給 format 時的退路。

表格的 `.grid` 本來就是 `overflow-x: auto`，欄位多了本來就會橫捲——
實測把 `visible` 全部打開之後：`scrollWidth 1476 > clientWidth 1170`，
`scrollLeft` 捲到 306，八個欄位都在標頭上，最後面的「檔案」欄也點得到、編輯得到。
也就是說**橫捲機制是好的，壞的是預設把欄位藏起來**。

**修法**

兩份 `defaultFormat` 都改成 `visible: true`（看板 `i<4`／圖庫 `i<4`／清單 `i<3` 維持不動——
那三種是卡片，欄位本來就該挑過）。

**回歸測試**：`e2e/functional-round3.spec.ts` →
「BUG-10 表格：欄位超過 5 個時，預設全部看得到而且可以橫捲到最後一欄」
（斷言 `format.properties` 沒有 `visible: false`、`scrollWidth > clientWidth`、
捲出去之後 `scrollLeft > 0`、最後一欄的儲存格可見）

**部署**：**一半在後端** → `defaultViewFormat` **需要重新部署 server** 才會在遠端生效。
在那之前這一條 e2e 的前半段（檢查 `format.properties`）會紅，後半段（橫捲）是綠的。

---

### BUG-11｜relation 的 `dualProperty` 指到不存在的欄位時會寫出孤兒資料（未修）· 嚴重度：**中**

**重現**

```
1) A 表加 relation 欄位 rc：{ collectionId: C, dualProperty: 'nope' }   → 200（沒有任何警告）
2) C 表的 schema 裡**沒有** 'nope' 這個欄位
3) PATCH A 的某一列：{ rc: { type:'relation', pageIds:[C1] } }         → 200
4) GET C 的列：
   C1.properties = { "nope": { "type":"relation", "pageIds":["<A1>"] }, "title": … }
   C 的 schema   = { "title": … }        ← schema 裡沒有 nope
```

C 的列上被塞了一個 **schema 裡不存在的屬性**，UI 上完全看不到，
`export.csv` 也不會輸出它，但它會一直躺在 `properties` jsonb 裡，
而且 `relation_edges` 也被寫了對應的邊。

**根因**

`apps/server/src/modules/databases/service.ts` 的 `syncDualRelations()`
只看本表 `def.dualProperty` 有沒有值，**沒有驗證目標 collection 的 schema 真的有那個欄位**：

```ts
if (!def.dualProperty) continue;
const dualProperty = def.dualProperty;
…
next[dualProperty] = { type: 'relation', pageIds: ids };
await repo.setRowPropertiesRaw(tx, target.id, next);
```

**建議修法**（**沒有動手**，因為要多讀一次目標 collection 的 schema，
牽涉到交易內的額外查詢與既有資料的相容性，風險大於這一輪的時間）

在 `syncDualRelations()` 裡先載入目標 collection 的 schema，
`dualProperty` 不在裡面（或型別不是 `relation`）就當單向處理、跳過反向寫入；
另外在 `PATCH /schema` 的 relation `validateConfig` 裡給一個 warning。

**另外一件相關的事（不算 bug，是缺口）**：
**新增 relation 欄位不會自動在目標 collection 建反向欄位**。
`RelationConfig` 的 UI 是兩個裸的文字輸入框——
「目標資料庫」要貼 collection 的 **UUID**、「反向欄位 id」要手打對方的 **propertyId**。
Notion 的作法是選資料庫 + 一個「顯示在〈目標〉」開關，打開就自動建反向欄位。
雙向同步的**後端邏輯是對的**（實測 A→B、B→A、清空都會同步），只是沒人幫使用者接線。

---

## 3. 改了哪些檔案

| 檔案 | 內容 | 需部署 |
|---|---|---|
| `apps/web/src/features/database/views/timeline/TimelineView.tsx` | BUG-9：`suppressClickRef`，拖曳之後那一發 click 作廢 | 前端 |
| `apps/web/src/features/database/views/table/index.tsx` | BUG-10：表格 `defaultFormat` 欄位一律 `visible: true` | 前端 |
| `apps/server/src/modules/databases/service.ts` | BUG-10：`defaultViewFormat()` 欄位一律 `visible: true` | **後端（需 deploy）** |
| `e2e/functional-round3.spec.ts` | 新增：BUG-9 / BUG-10 + 「列整頁開啟加 block」共 3 條 | — |

**沒有碰**：任何 `.css`／`.module.css`、`features/database/**` 的樣式檔、
`DatabaseHeader*`、`ViewSettingsPanel.tsx`、`e2e/compare.spec.ts`、
`packages/editor-core`、`lib/{sync-client,ot-client}.ts`。
沒有加 runtime 套件、沒有 git commit。

### 驗收

```
pnpm -r typecheck                    ✅ 8/8 專案通過
pnpm --filter @kennote/web test      ✅ 16 檔 / 316 條
pnpm --filter @kennote/server test   ✅ 24 檔 / 366 條（3 檔 skip：需要 DATABASE_URL_TEST）
BASE_URL=http://127.0.0.1:5301 npx playwright test functional-round3.spec.ts
                                     2 passed / 1 failed
```

那一條紅的是 BUG-10 檢查**後端** `defaultViewFormat` 的斷言，
驗證環境是「本機前端 + 遠端舊 server」，**deploy 後就會綠**（同第一輪 BUG-3 的情況）。

---

## 4. 未走查（留給第四輪）

### 這一輪沒走完的資料庫細節

1. 檢視**改名 / 建立複本 / 刪除**（仍被第二輪的 **BUG-7** 擋著：選中的檢視被收進「還有 N 個…」時，
   `aria-selected` 的 tab 不存在，檢視選單就打不開）
2. **BUG-8**（新增欄位的順序）第二輪列為未修；這一輪看到 server 已經有 `alignViewProperties()`
   在處理 append 順序（`service.ts` 的註解直接寫了「BUG-8」），**但沒有實際回歸驗證**
3. date 儲存格「打字輸入日期 → 存檔 / 清除」、files 儲存格**實際上傳檔案**
4. 看板 / 日曆 / 時程表的**鍵盤替代路徑**（HTML5 DnD 在觸控裝置上完全不能用，
   `_fallback/dnd.ts` 的註解也提到「鍵盤／螢幕閱讀器的替代路徑本來就得另外做」——**目前沒有**）
5. 列刪除之後到底該進哪個垃圾桶（見 §1.6，需要先確認規格）
6. CSV 匯出的欄序（title 應該在第一欄）與 relation 欄位輸出標題而不是 pageId

### 完全沒走的（第二輪 §4 的第 2、3 項）

7. **編輯器**：`/` 選單每個分組各挑 3 個實際插入 + 重整驗證；
   貼上純文字 / 多行 / Markdown / Notion HTML（`packages/editor-core/test/clipboard/fixtures.ts`）；
   `@` 提及與 `[[` 頁面連結；匯出 Markdown/HTML/CSV 與匯入 Markdown；
   留言（選取文字留言 / 回覆 / 解決）；版本歷史（列表 / 預覽 / 還原）；
   分享彈窗邀請成員；側邊欄拖曳（之間 / 進裡面 / 循環拒絕）
8. **390 寬手機版完整流程**（登入→首頁→抽屜→開頁→編輯→`/` 選單→浮動工具列→資料庫橫捲→設定）

> 為什麼沒走：這一輪在「三種拖曳 + 表格欄位消失」上花掉大半時間——
> BUG-10 一開始被誤判成「橫捲壞了」，量到 `scrollWidth === clientWidth` 才回頭找到
> `visible: i < 5`，而那需要同時比對前端與後端兩份 `defaultFormat`。

### 前兩輪留下、仍然未走的

9. 永久刪除、訪客升級、登出所有裝置

---

## 5. 觀察（不算 bug）

- **資料庫的列刪掉之後不在工作區垃圾桶裡**（`GET /api/pages/trash` 回空），
  但 `POST /api/pages/:id/restore` 還原得回來。也就是「還原得了，卻沒有入口」。
- **寫入 rate limit 是 240 筆/分鐘**（`writeLimit`）。灌 1000 列必須自己限速，
  一次全送會拿到 429。壓力測試的腳本要記得這件事。
- 本機 vite 代理時頂欄會顯示「**尚未連線**」——WebSocket 沒有跟著 proxy 過去。
  REST 照常運作，所以這一輪的驗證不受影響，但即時同步的項目在這個環境下測不了。
- 進站第一發 `POST /api/auth/refresh` 回 401 是預期（還沒有 refresh cookie），第一輪已經記過。
