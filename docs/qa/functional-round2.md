# 功能 QA 第二輪（真實瀏覽器走查・資料庫為主）

- 日期：2026-09-20
- 受測站台：`http://100.74.148.92:8090`（開始前 `/api/health` → `status: ok`、`migrations.pending: 0`、
  `features: { realtime: true, ot: true, publicShare: false }`）
- 驗證修正的環境：本機 `vite --port 5299 --strictPort` + `VITE_PROXY_TARGET=http://100.74.148.92:8090`
- 工具：`reference/tools/node_modules` 的 `playwright-core`（`chromium.launch({ channel: 'chrome' })`）
  ＋ `e2e/` 的 `@playwright/test`（回歸測試）
- 範圍：第一輪「未走查」清單的第 5 項（資料庫）為主，第 2 項（編輯器剩餘）只走到 `/` 選單盤點。
  **第 1 輪清單的其餘項目與 390 手機版流程沒走完**，列在 §4。

> ⚠️ 這一輪在資料庫一進門就撞到一個把**整個資料庫設定面板**擋死的 bug（BUG-5），
> 修掉之前後面所有項目（欄位、篩選、排序、分組、欄位設定…）都走不下去，
> 所以時間大部分花在定位 / 修 / 驗證它。

---

## 1. 走查表

### 1.1 建立資料庫

| 項目 | 結果 | 備註 |
|---|---|---|
| `/資料庫 - 內嵌` 建立 inline 資料庫 | ✅ | 預設 schema：`名稱(title)` / `標籤(multiSelect)` / `狀態(select)` / `日期(date)`，預設 1 個「表格」檢視 |
| `/` 選單「資料庫」分組的其他入口 | ⚪ 未走查 | 分組內容已盤點（見 §1.5），只實際插入了「資料庫 - 內嵌」 |
| `/資料庫 - 整頁` | ⚪ 未走查 | |
| 側邊欄「＋」建立資料庫頁 | ⚪ 未走查 | |

### 1.2 檢視

| 項目 | 結果 | 備註 |
|---|---|---|
| 六種檢視都能新增 | ✅ | 表格 / 看板 / 清單 / 圖庫 / 日曆 / 時程表，`POST /views` 全部 2xx |
| 切換到每一種檢視都能渲染 | ✅ | 看板未選分組欄位時有正確引導：「看板需要先選一個分組欄位。在工具列的『⋯ → 分組』選一個單選、多選、人員或核取方塊欄位。」；日曆畫出月曆格；時程表畫出 9 月–5 月時間軸 |
| 分頁列溢位時 ＋ 收進「還有 N 個…」 | ✅（設計如此） | `DatabaseHeader.tsx` 有註解說明這是照 Notion；「還有 N 個…」下拉裡有「新增檢視」 |
| **溢位時看不出目前在哪個檢視、也打不開檢視選單** | ❌ **BUG-7**（未修） | 見 §2 |
| 改名 / 複製 / 刪除檢視 | ⚪ 未走查 | 入口是「點目前選中的 tab → 檢視選單」，被 BUG-7 擋住（選中的檢視被收起來時根本沒有那顆 tab） |

### 1.3 欄位型別

| 項目 | 結果 | 備註 |
|---|---|---|
| `GET /api/databases/field-types` | ✅ | 回 20 種：title / text / url / email / phone / number / checkbox / select / multiSelect / date / person / files / rating / createdTime / lastEditedTime / createdBy / lastEditedBy / relation / rollup / formula |
| 型別選單列出全部（扣掉 title） | ✅ | 19 項，分組正確 |
| **選了型別之後真的新增欄位** | ❌→✅ **BUG-5**（已修） | 修正前**點任何型別都沒反應**，而且整個設定面板被關掉 |
| 19 種型別逐一新增 + 重整後保留 | ✅（修完之後） | 23 欄全部在，無 `pageerror`、無 4xx/5xx |
| **新增後的欄位順序** | ❌ **BUG-8**（未修） | 不是新增順序，而是 jsonb key 排序 |
| 表格標頭右端的「＋ 新增欄位」 | ⚪ 沒有這個入口 | 只能走 設定 → 編輯屬性 → 新增屬性（Notion 表格標頭最右邊有 ＋）。列為缺口，不算 bug |
| formula 循環引用提示 / relation 雙向 / rollup 實際計算 | ⚪ 未走查 | 欄位建得出來，內容沒驗 |

### 1.4 儲存格編輯

| 型別 | 結果 | 備註（用 `GET /rows` 對後端實際值） |
|---|---|---|
| title（名稱） | ✅ | `{"type":"title","plainText":"第一列"}` |
| checkbox | ✅ | `{"type":"checkbox","checkbox":true}` |
| rating | ✅ | 點第 4 顆星 → `{"type":"rating","rating":4}` |
| select（狀態） | ✅ | 選單可開、選「進行中」後儲存格顯示正確 |
| multiSelect（標籤） | ✅ | 選「開發」後顯示正確 |
| **text（多行文字）Enter 送出** | ❌→✅ **BUG-6**（已修） | 修正前 Enter 只塞換行、編輯器不關，後端存到 `"hello\n"` |
| text 失焦送出 | ✅ | blur 會 commit |
| number / url / email / phone 編輯 | ⚠️ 未完整驗證 | 表格**水平虛擬化**只渲染看得到的欄，自動化抓不到 `data-col` 超出視窗的儲存格；需要先橫捲再測 |
| 清空儲存格 | ⚠️ 部分 | 清空 text 後後端留下 `richText:[{"text":"\n"}]`（BUG-6 的副作用，修完之後沒有再完整回歸清空流程） |

### 1.5 `/` 選單分組盤點（第 2 項的一部分）

實際 dump 到的分組與項目（`*` = 標示「即將推出」）：

- **建議**：AI 筆記寫手\* / HTML / 網頁書籤 / 標註
- **基本區塊**：文字・標題 1–4・項目符號列表・編號列表・待辦清單・摺疊列表・頁面・引用・表格・分隔線・連結到頁面
- **媒體**：圖片 / 影片 / 音訊 / 程式碼 / 檔案
- **資料庫**：表格・看板・圖庫・列表・動態\*・儀表板・日曆・時間軸・地圖\*・長條圖\*×2・折線圖\*・環形圖\*・數字圖表\*・表單\*・**資料庫 - 內嵌**・**資料庫 - 整頁**・資料來源的連結瀏覽模式
- **進階區塊**：目錄・方程式區塊・按鈕・頁面路徑・分頁・同步區塊・摺疊標題 1–3・2/3/4/5 欄・Mermaid・AI 區塊\*
- **行內**：提及人員・提及頁面或資料來源・日期或提醒・表情符號・行內方程式
- **嵌入**：52 個第三方（Figma / Miro / Loom / Jira …）
- **匯入**：CSV・文字和 Markdown・Confluence・Google 文件・Dropbox Paper・Evernote・Workflowy・Word・Monday・Quip・ZIP
- **動作**：複製區塊連結・建立複本・移動到・刪除・萬事問 AI\*
- **文字顏色 / 背景顏色**：各 10 色

**實際插入**只做了「資料庫 - 內嵌」；其餘各分組挑 3 個插入 + 重整驗證**未走查**。

---

## 2. Bug 清單

### BUG-5｜巢狀浮層一按下去就把父浮層關掉，整個資料庫設定面板按不動（已修）· 嚴重度：**最高**

**重現**

1. 任一頁 `/資料庫 - 內嵌` 建一個內嵌資料庫
2. 工具列 **設定 → 編輯屬性 → 新增屬性** → 型別選單（「文字 / 數字 / 單選 …」）跳出來
3. 點任何一個型別
4. **兩層浮層同時消失，什麼欄位都沒加**，`PATCH /api/databases/:id/schema` 根本沒送出

playwright 逐階段量到的 `[role="dialog"]` 數量：

```
設定開啟          → 1
編輯屬性          → 1
型別選單          → 2   ← 父（屬性清單）＋ 子（型別選單）
mousedown 之後    → 0   ← 兩層一起被關掉
mouseup 之後      → 0   ← click 永遠不會送出
欄位              → ["Aa名稱","≡標籤","▾狀態","▤日期"]（沒變）
```

**根因**

`apps/web/src/features/database/_fallback/Popover.tsx`：每個浮層都 `createPortal(..., document.body)`，
而「點外面就關」是這樣判斷的：

```ts
if (ref.current?.contains(target)) return;   // 不在自己裡面
if (anchor?.contains(target)) return;        // 也不在 anchor 裡面
onClose();                                   // → 關掉
```

子浮層是**另一個 portal 到 `document.body` 的節點**，DOM 上不在父浮層裡面。
於是在子浮層的選項上 `mousedown` → 父浮層判定「點到外面」→ `onClose()` →
父浮層卸載 → 掛在它底下的子浮層跟著卸載 → `mouseup` / `click` 落在已經不存在的元素上 → 動作不執行。

（形狀和第一輪的 BUG-1 是同一族：**portal 出去的浮層，事件在祖先那邊被誤判**。
BUG-1 是 React 合成事件冒泡，這一個是 DOM `contains()` 認不出 portal 子樹。）

**影響範圍**（凡是「浮層裡再開浮層」的地方全中）

- 新增欄位（型別選單）→ **19 種欄位型別一個都加不了**
- 欄位設定 `FieldConfigPopover`（改名 / 改型別 / 選項設定）
- 篩選 `FilterBuilder`、排序 `SortBuilder`、分組 `GroupSettings` 的欄位 / 運算子下拉
- `RowPeek` 的列選單、relation / files 儲存格編輯器裡的下拉

也就是說**整個資料庫的設定能力等於是壞的**，這是這一輪最嚴重的問題。

**修法**（`apps/web/src/features/database/_fallback/Popover.tsx`）

加一個 module-level 的「已開啟浮層堆疊」`openStack`，每個浮層 open 時 push、unmount 時移除。
外點判斷多一關 `inLaterPopover(target)`：**如果 target 落在「比我晚開」的浮層裡就不要關自己**。
順手把 Escape 也修對：`document` 上多個 listener 不吃 `stopPropagation`，所以原本一按 Escape
會把所有層一起關掉；現在只有堆疊最上面那一層處理 Escape。

**回歸測試**：`e2e/functional-round2.spec.ts` →「巢狀浮層：在型別選單裡選一個型別真的會新增欄位」
（會斷言 mousedown 當下 `[role="dialog"]` 仍然是 2 個，而且重整後欄位還在）

**部署**：前端修正 → **需要重新部署前端**才會在 `100.74.148.92:8090` 生效。

---

### BUG-6｜多行文字儲存格按 Enter 只會換行，值被多存一個換行（已修）· 嚴重度：**中**

**重現**

1. 資料庫加一個 `文字` 欄位，新增一列
2. 點該儲存格 → Enter 進入編輯 → 打 `hello` → 按 **Enter**
3. 編輯器**沒有關**，textarea 內容變成 `hello` + 換行
4. 後端實際存到：`{"type":"text","richText":[{"text":"hello\n"}],"plainText":"hello\n"}`

**根因**

`apps/web/src/features/database/fields/_shared/parts.tsx` 的 `TextEditorInput`：

```ts
if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { … commitAndClose(); }
```

`text` 欄位的 Editor 傳 `multiline={true}`，所以 Enter 落到 textarea 的預設行為（換行），
只有 Ctrl/Cmd+Enter 才送出。Notion 的文字屬性是**Enter 送出、Shift+Enter 換行**，
使用者的肌肉記憶會直接把一個換行寫進資料裡。

**修法**

```ts
if (e.key === 'Enter' && (!multiline || !e.shiftKey || e.metaKey || e.ctrlKey)) { … }
```

Enter 一律送出，`Shift+Enter` 才換行（Ctrl/Cmd+Enter 維持可用）。

**回歸測試**：`e2e/functional-round2.spec.ts` →「文字儲存格：Enter 送出並關閉編輯器（Shift+Enter 才換行）」

**部署**：前端修正 → **需要重新部署前端**。

---

### BUG-7｜檢視分頁列溢位時，選中的檢視會消失、檢視選單打不開（未修）· 嚴重度：**中**

**重現**

1. 一個資料庫加到 6 個檢視（表格 / 看板 / 清單 / 圖庫 / 日曆 / 時程表）
2. 分頁列放不下 → 收成「表格・看板・清單・圖庫・還有 2 個…」
3. 從「還有 2 個…」切到「時程表」
4. 內容確實切到時程表，但**分頁列上完全沒有 `aria-selected="true"` 的 tab**——
   看不出目前在哪個檢視，而且因為「改名 / 建立複本 / 刪除檢視」的入口是
   **點目前選中的那顆 tab**（`DatabaseHeader.tsx`：`if (v.id === view.id) open('viewMenu', e)`），
   選中的檢視被收起來時**整組檢視選單就打不開了**

實測：`nav[aria-label="檢視"] [role="tab"][aria-selected="true"]` 在這個狀態下抓不到任何元素。

**根因**

`apps/web/src/features/database/DatabaseHeader.tsx`

```ts
const shownViews = views.slice(0, visibleTabs);
const hiddenViews = views.slice(visibleTabs);
```

純粹照順序切，沒有保證「目前選中的檢視一定在 `shownViews` 裡」。Notion 的行為是選中的檢視永遠看得到。

**建議修法**（**沒有動手**，這個檔案這一輪由「視覺 QA」代理在改，避免互相踩）

在算完 `visibleTabs` 之後，把選中的檢視換進可見清單：

```ts
const activeIndex = views.findIndex((v) => v.id === view.id);
let shownViews = views.slice(0, visibleTabs);
let hiddenViews = views.slice(visibleTabs);
if (activeIndex >= visibleTabs) {
  // 選中的擠進最後一格，被擠掉的那個退到「還有 N 個…」
  const active = views[activeIndex]!;
  shownViews = [...views.slice(0, Math.max(0, visibleTabs - 1)), active];
  hiddenViews = views.filter((v) => !shownViews.includes(v));
}
```

（或者：讓 `viewMenu` 也能從「還有 N 個…」下拉裡的項目上用 `⋯` 打開。）

---

### BUG-8｜新增的欄位不會排在最後，順序是 jsonb key 的順序（未修）· 嚴重度：**低**

**重現**

依序加入 `文字 / 數字 / 核取 / 星等 / 網址 / 信箱 / 電話 / 建立時間 / 建立者`，重整之後表格欄位順序是：

```
名稱 標籤 狀態 日期 | 建立者 建立時間 核取 信箱 數字 星等 電話 文字 網址
```

——不是新增順序。

**根因**

`apps/web/src/features/database/views/types.ts` 的 `visibleProperties()`：
`format.properties` 沒列到的欄位一律用 `Object.keys(schema)` 補在後面。
新增欄位時**沒有把它追加進該檢視的 `format.properties`**，所以順序完全由
Postgres `jsonb` 的 key 排序（先比長度、再比 byte）決定 —— 實測 `cb, ct, chk, eml, num, rat, tel, txt, url`
正好就是 jsonb 的順序。

**建議修法**：`PropertyList.addProperty()`（或 server 的 `applySchemaOps`）在加欄位的同時
把 `{ property, visible: true, width: 160 }` append 到每個檢視的 `format.properties`。

---

### 觀察（不算 bug）

- **表格標頭最右邊沒有「＋ 新增欄位」**。目前唯一入口是 工具列設定 → 編輯屬性 → 新增屬性。
  Notion 的表格標頭右端有 ＋，是最常用的路徑。建議補。
- 表格**水平方向有虛擬化**：只渲染視窗內的欄（`data-col` 不連續）。
  這對「1000 列 DOM < 100」是好事，但自動化測遠端欄位時要記得先橫捲。
- 第一輪的 BUG-4（markdown 捷徑前綴跑到字尾）這一輪看到已經有
  `apps/web/src/lib/ot-markdown-shortcut.test.ts` 的回歸（2 條綠），是並行的「OT 雙通道」代理處理的。

---

## 3. 改了哪些檔案

| 檔案 | 內容 |
|---|---|
| `apps/web/src/features/database/_fallback/Popover.tsx` | BUG-5：浮層堆疊 `openStack` + `inLaterPopover()` 外點守門；Escape 只關最上層 |
| `apps/web/src/features/database/fields/_shared/parts.tsx` | BUG-6：`TextEditorInput` 多行時 Enter 送出、Shift+Enter 換行 |
| `e2e/functional-round2.spec.ts` | 新增：BUG-5 / BUG-6 的 e2e 回歸（2 條，已綠） |

**沒有碰**：`.css`、`features/database/**` 的樣式檔、`DatabaseHeader.tsx`、`ViewSettingsPanel.tsx`、
`e2e/compare.spec.ts`、`packages/editor-core`、`lib/{sync-client,ot-client}.ts`、
`features/editor/useEditorHost.ts`、`apps/server/src/modules/blocks/ot-*`。
沒有加套件、沒有 commit。

### 驗收

```
pnpm -r typecheck                    ✅ 8/8 專案通過
pnpm --filter @kennote/web test      ✅ 15 檔 / 303 條
pnpm --filter @kennote/server test   ✅ 23 檔 / 357 條（3 檔 skip：需要 DATABASE_URL_TEST）
BASE_URL=http://127.0.0.1:5299 npx playwright test functional-round2.spec.ts
                                     ✅ 2 passed (37.7s)
```

**需部署**：這一輪兩個修正都在前端，遠端 `100.74.148.92:8090` 跑的是打包好的前端，
**要重新部署前端**才會生效。這一輪**沒有**後端修正。

---

## 4. 未走查（留給第三輪）

### 資料庫（第 5 項還剩下的）

1. 側邊欄「＋」建立資料庫、`/資料庫 - 整頁`
2. 檢視 **改名 / 建立複本 / 刪除**（被 BUG-7 擋住，修完 BUG-7 再走）
3. **formula**（含循環引用提示）、**relation 雙向**、**rollup** 的實際計算
4. number / url / email / phone / person / files / date 儲存格的編輯與清空（需先處理水平虛擬化）
5. 篩選 AND/OR 巢狀、多欄排序、分組
6. **看板拖曳換組後重整保持**、**日曆拖曳改日期**、**時程表拖曳**
7. 列 peek（側邊）與整頁開啟並在其中加 block
8. **CSV 匯出內容正確性**（只確認過 route 存在，沒比對內容）
9. **API 灌 1000 列後的捲動流暢度與 DOM 節點數 < 100**
10. 刪除列 → 垃圾桶 → 還原

### 編輯器（第 2 項）

11. `/` 選單每個分組各挑 3 個實際插入 + 重整驗證（只盤點了清單）
12. 貼上純文字 / 多行 / Markdown / 從 Notion 複製的 HTML（`packages/editor-core/test/clipboard/fixtures.ts`）
13. `@` 提及、`[[` 頁面連結
14. 匯出 Markdown / HTML / CSV、匯入 Markdown 檔
15. 留言（選取文字留言、回覆、解決）、版本歷史（列表 / 預覽 / 還原）、分享彈窗邀請成員
16. 側邊欄拖曳（之間 / 進裡面 / 循環拒絕）

### 其他

17. **390 寬手機版完整流程**（登入→首頁→抽屜→開頁→編輯→`/` bottom sheet→浮動工具列→資料庫橫捲→設定）—— 完全沒走
18. 第一輪留下的：永久刪除、訪客升級、登出所有裝置、雙分頁即時同步
