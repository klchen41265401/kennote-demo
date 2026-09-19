# kennote ↔ Notion 並排比對

產生時間：2026-09-19T16:23:00.819Z

每張圖三格：**左 = Notion 原版、中 = kennote、右 = 差異熱度圖**（愈紅差愈多）。
由 `e2e/compare.spec.ts` 產生，重跑：

```bash
# 打遠端正式站（注意：正式站跑的是**已建置的 bundle**，
#  前端改完沒重新部署的話，拍到的會是舊畫面）
cd e2e && BASE_URL=http://100.74.148.92:8090 npx playwright test compare

# 改 CSS 時打本機 dev server（vite proxy 到遠端 API，有 HMR）——本報告就是這樣跑出來的
cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 node node_modules/vite/bin/vite.js --port 5173 &
cd e2e && BASE_URL=http://localhost:5173 npx playwright test compare
```

## 量化差異

欄位格式：`平均通道差(0-255) / 明顯差異像素佔比 / 最佳對齊位移(dx,dy)`。
「最佳對齊位移」= 把 kennote 平移幾 px 可以讓差異最小 —— 不是 0 就代表版面有位移。

| 代號 | Light | Dark |
|---|---|---|
| `02-page-top` | 19.8 / 29.2% / 對齊 | 21.0 / 28.8% / 偏移 +5,+1 |
| `02b-page-mid` | 6.9 / 6.0% / 偏移 +1,-5 | 8.1 / 11.0% / 偏移 +1,+1 |
| `02c-page-mid2` | 24.8 / 28.8% / 偏移 +5,+6 | 19.4 / 20.9% / 偏移 +6,-6 |
| `02d-page-bottom` | 23.8 / 16.9% / 偏移 +1,+0 | 10.8 / 11.9% / 對齊 |
| `03e-sidebar-bottom` | 9.2 / 9.0% / 偏移 +1,+6 | 9.6 / 8.6% / 偏移 +1,+6 |
| `04-topbar` | 3.9 / 5.4% / 對齊 | 3.8 / 5.1% / 對齊 |
| `04b-topbar-right` | 8.3 / 11.0% / 偏移 +2,+0 | 7.3 / 9.5% / 偏移 +2,+0 |
| `04d-page-cover-icon` | 36.1 / 56.0% / 偏移 +6,+0 | 46.5 / 56.1% / 偏移 +6,+0 |
| `05-01-paragraph` | 5.2 / 7.2% / 偏移 +1,+0 | 5.5 / 7.4% / 對齊 |
| `05-02-heading1` | 1.4 / 2.2% / 偏移 +1,+0 | 1.4 / 2.2% / 對齊 |
| `05-03-heading2` | 1.0 / 1.8% / 偏移 +1,+0 | 1.0 / 1.8% / 對齊 |
| `05-04-heading3` | 1.1 / 1.8% / 對齊 | 1.2 / 1.8% / 對齊 |
| `05-05-todo-unchecked` | 2.6 / 3.2% / 對齊 | 3.0 / 3.4% / 對齊 |
| `05-06-todo-checked` | 2.7 / 4.1% / 對齊 | 3.5 / 4.3% / 對齊 |
| `05-07-bulleted-list` | 1.6 / 3.0% / 對齊 | 1.9 / 3.0% / 偏移 +1,+0 |
| `05-08-numbered-list` | 1.2 / 2.1% / 對齊 | 1.3 / 2.0% / 偏移 +1,+0 |
| `05-09-toggle` | 2.1 / 3.5% / 對齊 | 2.3 / 3.5% / 對齊 |
| `05-10-quote` | 2.0 / 3.4% / 對齊 | 2.1 / 3.4% / 對齊 |
| `05-11-divider` | 0.2 / 0.3% / 對齊 | 0.2 / 0.4% / 對齊 |
| `05-12-callout` | 4.2 / 5.4% / 偏移 -2,+0 | 5.2 / 5.6% / 偏移 -2,+0 |
| `05-13-code` | 1.6 / 1.6% / 偏移 -1,+0 | 2.8 / 4.8% / 偏移 +1,+6 |
| `05-14-table` | 4.3 / 5.9% / 偏移 -5,-2 | 6.9 / 15.4% / 偏移 -5,-2 |
| `05-15-equation` | 1.5 / 1.4% / 偏移 +2,+0 | 2.0 / 1.5% / 偏移 +2,+5 |
| `05-16-toc` | 1.3 / 2.1% / 對齊 | 2.0 / 2.1% / 對齊 |
| `05-17-synced` | 2.5 / 4.5% / 偏移 +1,+0 | 2.7 / 4.4% / 對齊 |
| `05-18-columns` | 2.8 / 2.9% / 偏移 -1,+0 | 3.3 / 2.9% / 偏移 -1,+0 |
| `05-19-subpage` | 20.9 / 15.6% / 偏移 +6,+0 | 7.6 / 5.2% / 偏移 +6,+2 |
| `05-20-bookmark` | 23.0 / 23.6% / 對齊 | 23.5 / 23.7% / 對齊 |
| `05-21-image` | 2.6 / 1.1% / 對齊 | 2.7 / 1.1% / 對齊 |
| `06-slash-menu` | 7.4 / 7.3% / 偏移 +0,-2 | 7.9 / 7.1% / 偏移 +0,-2 |
| `06-slash-menu-full` | 30.1 / 19.4% / 偏移 +1,-5 | 13.1 / 15.6% / 偏移 +1,-5 |
| `06f-block-hover` | 6.5 / 11.6% / 偏移 +1,+1 | 7.0 / 9.4% / 偏移 +2,+1 |
| `07-db-table` | 6.2 / 8.4% / 偏移 +4,-5 | 10.5 / 9.0% / 偏移 +2,-2 |
| `07-db-table-full` | 7.8 / 10.3% / 偏移 +6,+6 | 12.4 / 13.8% / 偏移 +0,+6 |
| `07b-db-header-hover` | 8.4 / 9.1% / 偏移 +2,+3 | 11.9 / 10.2% / 偏移 +2,+3 |
| `07c-db-row-hover` | 9.2 / 9.7% / 偏移 +4,-5 | 13.8 / 9.4% / 偏移 +0,-1 |
| `07d-db-cell-edit` | 7.6 / 8.9% / 偏移 +4,+0 | 13.7 / 13.6% / 偏移 +6,+0 |
| `07e-db-board` | 6.3 / 6.5% / 偏移 +2,-2 | 7.9 / 7.2% / 偏移 +2,-2 |
| `07e-db-board-full` | 12.0 / 11.4% / 偏移 +5,+6 | 11.5 / 12.1% / 偏移 +0,+6 |
| `07f-db-list` | 5.0 / 5.9% / 偏移 +5,+0 | 6.6 / 7.0% / 偏移 +5,+0 |
| `07f-db-list-full` | 10.7 / 12.9% / 偏移 +6,-5 | 8.4 / 11.5% / 偏移 +6,+5 |
| `07g-db-gallery` | 5.0 / 3.7% / 偏移 +2,-4 | 7.1 / 3.1% / 偏移 +5,-3 |
| `07g-db-gallery-full` | 12.4 / 8.3% / 偏移 +6,+6 | 12.4 / 7.3% / 偏移 +6,+6 |
| `07h-db-calendar` | 3.6 / 4.8% / 偏移 +4,-3 | 4.1 / 5.1% / 偏移 +4,-4 |
| `07h-db-calendar-full` | 11.3 / 9.3% / 偏移 +6,+5 | 8.3 / 8.9% / 偏移 +6,+6 |
| `07i-db-timeline` | 4.6 / 5.3% / 偏移 +4,-3 | 4.8 / 4.4% / 偏移 +4,-3 |
| `07i-db-timeline-full` | 10.1 / 11.5% / 偏移 +5,-6 | 7.1 / 9.0% / 偏移 +5,+6 |
| `07k-db-filter` | 7.1 / 6.5% / 對齊 | 8.2 / 5.8% / 對齊 |
| `07l-db-sort` | 7.5 / 6.7% / 對齊 | 9.0 / 6.9% / 對齊 |
| `07m-db-settings` | 7.4 / 8.5% / 偏移 -1,+0 | 8.7 / 7.7% / 對齊 |
| `07n-db-view-tabs` | 7.0 / 8.0% / 偏移 +0,+2 | 8.3 / 8.2% / 偏移 +0,+2 |

## 沒有比對到的項目

- 07j-db-proptype-menu-dark.png：kennote 沒有對應截圖
- 07j-db-proptype-menu-light.png：kennote 沒有對應截圖
- 07o-db-row-peek-dark.png：kennote 沒有對應截圖
- 07o-db-row-peek-light.png：kennote 沒有對應截圖

> ⚠️ **`-full` 的數字從第七輪起只算「內容欄」**（裁掉左側 270px 側邊欄與上方 44px 頂欄）。
> 兩邊側邊欄的頁面清單內容本來就不同（是資料不是樣式），卻佔 18% 面積、
> 讓每一張 `-full` 憑空多 7~8 分。並排圖仍然是完整的 1440×900，只有分數改成內容欄。
> **第六輪以前的 `-full` 數字不能跟第七輪以後直接比。**

## 已知差異與原因（誠實清單）

### 一、比不了的（來源本身就不一樣）

| 代號 | 原因 |
|---|---|
| `02-page-top` / `04d-page-cover-icon` | Notion 參考頁的封面是內建的萊特兄弟黑白照，kennote 用內建漸層 `gradient:dawn`。**封面圖本來就不同**，數字再低也沒意義；該看的是封面高度（270px）、icon 位置與標題字級。 |
| `02c-page-mid2` / `02d-page-bottom` | 固定捲動 1800px / 捲到底。兩邊 block 高度有幾 px 差，累積到第 1800px 已經錯開一整個 block，**內容不同就不是樣式差**。要逐 block 看請用 `05-*`。 |
| `05-19-subpage` | **Notion 那張參考圖拍壞了** —— 267×58 的裁切框落在側邊欄上，裡面是「上線部署 / 測試與 QA」兩列側邊欄項目，根本沒拍到子頁面 block。kennote 這張拍的是真正的子頁面連結，兩邊永遠對不起來。 |
| `05-21-image` | 同一張 Unsplash 照片，但 Notion 依 `aspectRatio` 裁切、kennote 是 `max-width:100%` 等比縮放 → 高度差約 30px，差異集中在上下兩條帶狀。 |
| `07o-db-row-peek` | 整窗截圖，兩邊頁面內容不同（Notion 那頁是空資料庫）。結構（右側滑出面板 + 屬性清單 + 分隔線 + 正文）已經對齊。 |
| `07j-db-proptype-menu` | kennote 的型別選單沒有「整合」那一組，入口也在欄位設定裡而不是表頭 `+`。未納入比對。 |
| `07b-db-header-hover` / `07c-db-row-hover` / `07d-db-cell-edit` 的 **dark** | 第五、六輪實測：Notion 那三張深色參考拍到的都是**開著的下拉選單**（面板底 `rgb(37,37,37)` ＋ 28px 反白 `rgb(49,49,49)`），跟 light 不是同一個狀態。light 可以比，dark 比不了。 |

> `07i-db-timeline` 從第三輪開始已經納入比對（時程表視圖 + 遠端後端跑完 migration 0060）。

### 二、比對過程中發現的產品缺陷（不是樣式問題）

1. **內嵌資料庫從來沒被渲染過**（已修）
   `features/editor/blocks/externalRegistry.ts` 的 `registerInlineDatabase()` **沒有任何地方呼叫過**，
   所以頁面裡的 `collectionView` block 一律畫成「資料庫模組尚未載入」的佔位卡 ——
   也就是說 `07-*` 這一整組在這次之前**從來沒有被比對到**。
   修法：新增 `apps/web/src/features/database/register.tsx`，由 `App.tsx` 呼叫一次。

2. **`packages/editor-core/src/styles.css` 沒有被任何人 import**（已在 `styles/editor.css` 補上）
   `.kn-todo` / `.kn-toggle` / `.kn-callout` 的 `display:flex` 住在那支 CSS 裡，
   結果待辦的 checkbox、折疊的箭頭、標註的 emoji 全部掉到自己一行去。

3. **CSS specificity 撞車**（已修）
   `.kn-editor .kn-block-main { padding: 3px 2px; border-radius: 3px }`（0,2,0）
   蓋掉了 `.kn-callout` / `.kn-code-block`（0,1,0）的 `padding: 12px` / `24px 22px` 與 `border-radius: 10px`。
   標註的圓角實際只有 3px、程式碼區塊完全沒有內距。

4. **資料庫把自己的載體頁當成一列**（⚠️ 未修，屬於後端）
   `apps/server/src/modules/databases/service.ts` 的 `createDatabase()` 會把 `pages.collection_id`
   寫到**資料庫自己那一頁**上；而 `repo.ts` 的 `queryRows()` 只用 `WHERE p.collection_id = $1` 過濾，
   於是載體頁自己也被當成一列回傳。截圖裡就是表格最後多一列「參考資料庫」
   （看板 / 清單 / 圖庫同樣多一張卡）。
   修法：`queryRows` / `countRows` / `queryGroupedRows` / `queryAggregations` 的 WHERE 加上
   `AND p.is_database = FALSE`。**這次沒有動**：後端跑在遠端已建置好的映像檔上，改了也驗證不到，
   而且不在這一輪視覺 QA 的範圍內。

### 三、修正紀錄（第一輪：五小輪）

| 輪 | 改了什麼 | 代表性的數字變化（light，平均通道差） |
|---|---|---|
| 0 | 基線：先讓 `collectionView` 真的畫出資料庫、再建出參考頁 | — |
| 1 | `editor.css`：補上 todo/toggle/callout 的 `display:flex`；區塊節奏改成 gap 0 + wrapper padding；標題 30/39、24/31.2、20/26；清單縮排 24→32；分隔線改實心 bar；callout / code / table / bookmark / toc / 欄間距 46px 全部換實測值。DB：內嵌外框拿掉、顯示標題、tab 改膠囊、列高 32→37 | `05-03` 7.0→3.8、`05-06` 6.5→2.9、`05-13` 9.5→6.7 |
| 2 | 看板泳道底色 + 卡片 260/邊框、清單列高 32 去線、圖庫卡片 148 封面、日曆格 124 + 週末底色 + 今天紅點；同步區塊改成只有 hover 才出現；書籤改成縮圖在左 + favicon 自成一行；行內樣式那段搬到頁尾讓捲動位置對齊 | `05-01` 19.3→8.0、`05-03` 3.8→1.0、`05-17` 11.1→8.6 |
| 3 | ⭐ specificity 修正（`.kn-editor` 前綴）讓 callout 圓角 10px、code 內距 24/22 真的生效；06f 改拍 callout；07d 改拍「選取中」並補上右下角小方塊 | `05-12` 9.3→6.1、`05-13` 6.7→5.2、`06f` 19.0→7.4 |
| 4 | 逐像素量 `05-05/06/07` 反推出：清單文字落在 +30（marker 24 + gap 6）、checkbox 框線 1px rgb(56,56,54)、勾選填色 **#2783de**（不是 #2383e2） | `05-06` 4.5→2.0、`05-07` 4.8→**1.6**、`05-08` 3.9→**1.2** |
| 5 | 再量 `05-10` / `05-18` + 讀 `dom/21-column-list.html`：引言內距 14→21px、每欄內距補到 Notion 的 `padding: 12px 6px`；`新建 ⌄` 分段按鈕；側邊欄底部也納入比對 | `05-09` 9.5→9.4、`02b` 6.9→6.6 |

> 量測方法：把參考 PNG 解碼後逐列掃「最左邊的深色像素」，直接讀出 bullet / 文字 / 框線的 x 座標，
> 不靠目測。腳本邏輯與 `e2e/fixtures/png.ts` 的 decoder 相同。

### 四、與任務說明不一致的實測值（以實測為準）

| 項目 | 任務說明 | 實測（來源） |
|---|---|---|
| 資料庫列高 | 32px | **37px**（`UI-SPEC.md` §8.1 + `07-db-table-light.png`） |
| 待辦 checkbox 藍 | `#2383e2` | **`#2783de`** = rgb(39,131,222)（`05-06-todo-checked-light.png` 取色） |
| 標註背景 | `rgb(241,241,239)` | **rgb(249,248,247)** / dark rgb(56,56,54)（`_extra-light.json`） |
| 表格格線 | `rgba(55,53,47,.09)` | **rgb(230,229,227)** / dark rgb(56,56,54)（`_extra-*.json` 的 `tableBorder`） |


### 三之二、第二輪（視覺 QA 第二輪）

> 第一輪的紀錄原封不動保留在上面。本輪的重點是**把 block 的盒模型換成 Notion 真正的那一套**
> —— 第一輪從 `tokens.md` 推出「相鄰 block gap = 0、內距 `3px 2px`」，那個結論是錯的。
>
> 這一段是手寫的，放在 `reference/shots/compare/NOTES-round2.md`，
> 由 `e2e/compare.spec.ts` 在產生 README 時接到最後面 —— 直接改那支 `.md` 就好，不必動 spec。

#### ⭐ 根因：block 的上下留白是「wrapper + leaf」兩層相加

`reference/notion-capture/dom/*.html` 的 inline style 寫得很清楚，每個 block 都是
「外層 wrapper 的 `padding-block`」＋「content-editable leaf 的 `padding-block`」兩層：

| block | wrapper | leaf | 內容高 | **總高** | kennote 第一輪 |
|---|---|---|---|---|---|
| 文字段落 | 6 / 6 | 2 / 2 | 24 | **40** | 30（少 10） |
| 標題一 | 30 / 6 | 2 / 2 | 39 | **79** | 71 |
| 標題二 | 26 / 6 | 2 / 2 | 31.2 | **67.2** | 55.2 |
| 標題三 | 22 / 6 | 2 / 2 | 26 | **58** | 43 |
| 項目 / 編號清單 | 1 / 1 | 2 / 2 | 24 | **30** | 30 ✓ |
| 待辦 | 6 / 1 | 2 / 2 | 24 | **35** | 30 |
| 折疊（標題列） | 1 / 6 ※ | 2 / 2 | 24 | **29 + 子層 + 6** ※ | 30 + 子層 |
| 引言 | 8 / 8 | 0 | 24 | **40**（粗線只有 24 高） | 30（粗線 30 高） |
| 分隔線 | — | — | — | **13** | 23 |
| 標註 / 程式碼 / 圖片 / 書籤 / 表格 / 目錄 / 公式 | 8 / 8 | — | — | 8 + 內容 + 8 | 3 / 3 |
| 多欄 | 每欄 12 / 12 | — | — | — | 多一條 6px 的空白帶 |

※ 折疊的 `padding-bottom: 6px` 在**子層之後**（wrapper 同時包住標題列與子層）。

每段少 10px，捲到 `02b`（第 900px）就差 35px、捲到 `02c` 差一整個 block ——
第一輪把 `02b` / `02c` / `02d` 歸類成「比不了的」，其實是**可以修**的。

#### 本輪改了什麼（依影響大小）

| # | 改動 | 檔案 | 代表性數字 |
|---|---|---|---|
| 1 | **block 盒模型換成實測值**（上表）：泛用 `.kn-block-main` 內距 `3px 2px` → `8px 2px`，標題 / 清單 / 待辦 / 折疊各自覆寫 | `apps/web/src/styles/editor.css` | `05-02` 4.6→**1.4**；`05-04` 2.6→**1.1**；`05-05` 5.3→**2.6** |
| 2 | 同步區塊 / 多欄的 `.kn-block-main` 是**空的 chrome 容器**，卻吃到泛用的 8px 上下內距 → 子層上方多一條 16px 空白帶（= 任務說的「+6px 偏移」，bbox 中心被拉高 3px）；同步區塊的子層還被多縮排 32px | `styles/editor.css` | `05-09` 9.4→**2.1**；`05-17` 8.2→**2.5**；`05-18` 6.2→**2.8** |
| 3 | 上下的 8px 一律改用**父層 `.kn-block--*` 的 padding**，不用 margin —— 相鄰 block 的上下 margin 會 collapse，量出來就是「分隔線上下各短 6px」 | `styles/editor.css` | `05-11` 0.7→**0.2** |
| 4 | 引言：粗線只有一行文字高（`dom/13-quote.html` 的 border 在內層 blockquote），文字左緣 = 粗線 3 + 14 + 8 = **+22** | `styles/editor.css` | `05-10` 5.1→**2.0** |
| 5 | 內容欄寬 720 → **724**（文字欄 704，量自 `05-11` 的實心 bar x22..725）—— 滿版元素右緣原本短 4px | `styles/tokens.css` | `05-13` 5.2→**2.9** |
| 6 | 圖片：沒有說明文字時「新增說明文字」**不能佔位**（`opacity:0` 照吃 25px + 8px gap，整塊高了 33px，圖片整個往上跑） | `styles/editor.css` | `05-21` 21.5→**2.6** |
| 7 | 標註：icon 欄 24px + `margin-top: 7.5px`，文字欄自己 8px 內距（內層是一個完整 text-block，所以框高 12+40+12 = **64** 而不是 48） | `styles/editor.css` | `05-12` 6.1→**4.2** / dark 10.3→**5.2** |
| 8 | 書籤：卡片高 **156**、圓角 **10**、縮圖 `flex:1 1 100px`、文字欄 `flex:4 1 180px` + 內距 18/24/14、標題 17/22、說明與網址 13/18 | `styles/editor.css` | `05-20` 30.5→**23.0** |
| 9 | 目錄：項目字級 16 → **14 / line-height 1.3**、內距 6px（`dom/19-toc.html`） | `styles/editor.css` | `05-16` 3.5→**1.3** |
| 10 | `06-slash-menu` 的裁切被 clamp 到畫面底部（錨點置中時 370px 的浮層放不下，`clip()` 會把 y 夾到 `900-高`）→ 改成把錨點捲到**上緣** | `e2e/compare.spec.ts` | `06-slash-menu` 13.8→**8.9** / dark 34.6→**9.9** |
| 11 | ⭐ **內嵌資料庫收不到 `mousedown`**（見「產品缺陷 5」）→ 儲存格選取態改用 `onPointerDown` | `views/table/TableView.tsx` | `07d` 17.6→**13.5** |
| 12 | ⭐ **點資料庫裡任何東西都會把整塊選起來**（見「產品缺陷 6」）→ 整張表蓋一層藍 | `features/editor/Editor.tsx` | `07c` 15.2→**9.4**（回到正常） |
| 13 | 篩選 / 排序改成 Notion 的**兩段式**：還沒有條件時先給「搜尋框 + 屬性清單（列高 28）+ 底部動作列」 | 新增 `PropertyPicker.tsx`、`Builders.module.css` | `07k` 15.0→**10.5**；`07l` 14.8→**11.3** |
| 14 | ⚙ 改成 Notion 的「瀏覽模式設定」整張面板（三段、列高 29、右側值 + `›`） | 新增 `ViewSettingsPanel.tsx` + `.module.css` | `07m` dark 20.3→**15.7**（light 反而變差，見待辦） |
| 15 | 工具列補 ⚡ 自動化 / ✨ AI / ⤢ 展開，順序照 UI-SPEC §8.1（篩選 排序 ⚡ ✨ 🔍 ⤢ ⚙ ＋新建） | `DatabaseHeader.tsx`、`_fallback/icons.tsx` | `07n` 11.9→12.5（tab 版面仍有差） |
| 16 | 斜線選單：`HTML` 補上灰字來源分組「· 嵌入區塊」（`_slash-menu-full.json` 第 2 項是 `HTML \| · \| 嵌入區塊 \| 新`，那是**行內**的來源分組，不是右側對齊的 hint） | `slashCommands.ts`、`SlashMenu.tsx` | — |
| 17 | **新增時程表（Timeline）視圖** | 見下方專節 | `07i` 仍待後端部署 |

#### 第一輪 → 第二輪（平均通道差）

| 代號 | light | dark |
|---|---|---|
| `05-01-paragraph` | 8.0 → 5.2 | 8.6 → 5.5 |
| `05-02-heading1` | 4.6 → **1.4** | 4.5 → **1.4** |
| `05-03-heading2` | 1.0 → 1.0 | 1.0 → 1.0 |
| `05-04-heading3` | 2.6 → **1.1** | 2.6 → **1.2** |
| `05-05-todo-unchecked` | 5.3 → **2.6** | 5.9 → **3.0** |
| `05-06-todo-checked` | 2.0 → 4.7 ⚠ | 2.6 → 5.3 ⚠ |
| `05-09-toggle` | 9.4 → **2.1** | 11.2 → **2.3** |
| `05-10-quote` | 5.1 → **2.0** | 6.0 → **2.1** |
| `05-11-divider` | 0.7 → **0.2** | 2.3 → **0.2** |
| `05-12-callout` | 6.1 → **4.2** | 10.3 → **5.2** |
| `05-13-code` | 5.2 → **2.9** | 11.4 → **6.3** |
| `05-14-table` | 4.7 → 4.6 | 7.7 → 7.6 |
| `05-15-equation` | 1.7 → 1.5 | 2.2 → 2.0 |
| `05-16-toc` | 3.5 → **1.3** | 4.0 → **2.0** |
| `05-17-synced` | 8.2 → **2.5** | 9.9 → **2.7** |
| `05-18-columns` | 6.2 → **2.8** | 7.6 → **3.3** |
| `05-19-subpage` | 22.1 → 20.9 | 11.7 → **7.6** |
| `05-20-bookmark` | 30.5 → **23.0** | 33.3 → **23.5** |
| `05-21-image` | 21.5 → **2.6** | 22.4 → **2.7** |
| `06-slash-menu` | 13.8 → **8.9** | 34.6 → **9.9** |
| `06-slash-menu-full` | 25.7 → 25.6 | 47.6 → **12.1** |
| `06f-block-hover` | 7.4 → **6.5** | 11.4 → **7.0** |
| `02b-page-mid` | 6.6 → 6.4 | 10.1 → **7.9** |
| `02c-page-mid2` | 28.1 → 22.7 | 38.6 → **21.3** |
| `07c-db-row-hover` | 9.3 → 9.4 | 14.1 → 14.2 |
| `07d-db-cell-edit` | 17.6 → **13.5** | 20.5 → **15.3** |
| `07k-db-filter` | 15.0 → **10.5** | 22.3 → **12.0** |
| `07l-db-sort` | 14.8 → **11.3** | 22.3 → **13.3** |
| `07m-db-settings` | 11.1 → 15.4 ⚠ | 20.3 → **15.7** |
| `07n-db-view-tabs` | 11.9 → 12.5 ⚠ | 14.4 → 14.6 |

#### 第二輪新增的功能：時程表（Timeline）視圖

* 前端：`apps/web/src/features/database/views/timeline/`
  （`TimelineView.tsx` + `TimelineView.module.css` + `index.tsx`）
  * 月 / 週 / 日三種刻度（`TIMELINE_SCALES`），`‹ 今天 ›` 翻頁，`«` 折疊左側表格欄
  * 依「開始 / 結束」日期欄位畫長條；沒指定結束欄位時用開始欄位的 date range
  * 長條可整條拖曳（平移日期）或拖兩端（改開始 / 結束），放開才寫回 API
  * 今天有一條直線 + 頂端紅點；日刻度時週末那一欄有淺灰底
  * 沒有日期欄位時顯示引導文案（`requiredFieldTypes` 已宣告，視圖切換器會自動灰掉）
* 型別：`shared-types` 的 `VIEW_TYPES` / `VIEW_TYPE_LABELS` / `ViewFormat`
  （`timelineStartProperty`、`timelineEndProperty`、`timelineScale`、`timelineShowTable`、`timelineTableWidth`）
  與 `TIMELINE_SCALES` / `TIMELINE_SCALE_LABELS`
* 後端：`apps/server/migrations/0060_timeline_view.sql`
  （`ALTER TYPE collection_view_type ADD VALUE IF NOT EXISTS 'timeline'`）；
  routes 的 `z.enum(VIEW_TYPES)` 會自動吃到新值，不必改 route
* 斜線選單：`db:timeline` 從「即將推出」的佔位改成真的能建視圖
* ⚠️ **`07i-*` 還沒有數字**：比對打的是遠端 `100.74.148.92:8090` 的**已建置後端**，
  它的 `VIEW_TYPES` 還沒有 `timeline`，建視圖會回 400
  （`e2e/fixtures/reference-page.ts` 已經 try/catch 吞掉並印警告）。
  後端重新部署 + 跑完 `0060` 之後，`compare.spec.ts` 的 `07i-db-timeline` 會自動納入比對。

#### 第二輪新發現的產品缺陷

5. **內嵌資料庫（以及所有 React block）收不到 `mousedown`**（已修）
   `packages/editor-core/src/input/controller.ts` 的 `onPointerDown` 對「沒有 inline content」
   的 block 呼叫 `event.preventDefault()`。依 Pointer Events 規範，被取消的 `pointerdown`
   **不會再產生相容的 `mousedown`**，所以資料庫裡任何 `onMouseDown` 都收不到 ——
   表格的儲存格選取態（藍框 + 右下角小方塊）因此從來沒畫出來過（CSS 一直都在，只是沒人觸發）。
   修法：`TableView` 改用 `onPointerDown` / `pointermove` / `pointerup`。
   ⚠️ 其他還在用 `onMouseDown` 的元件（`_fallback/Dialog.tsx`）在編輯器裡也會踩到同一個坑。

6. **點資料庫裡任何東西都會把整塊選起來**（已修）
   同一個 `onPointerDown` 也會 `setSelection(blockSelection([id]))`，於是
   `.kn-block[data-selected='true'] > .kn-block-main` 把整張表蓋上一層
   `rgba(35,131,226,.14)` —— `07c` / `07d` / `07k` 的截圖整片發藍。
   修法：`Editor.tsx` 在 **bubble 階段**（一定在 editor-core 之後）監聽 `pointerdown`，
   發現目標落在 `collectionView` / `table` / `button` / `syncedBlock` 這幾種
   「自己有 UI」的 React block 裡，就把剛設好的整塊選取取消。
   ⚠️ 不能用 `capture + queueMicrotask`：microtask checkpoint 在**每個監聽器之間**就會排空，
   等於還是搶在 editor-core 前面跑（實測過，沒有效果）。
   ⚠️ 也不能 `stopPropagation()`：React 18 的事件監聽掛在 root container（editor 的祖先），
   攔下來連元件自己的 `onClick` 都會消失。

### 三之三、第三輪（視覺 QA 第三輪）

> 前兩輪的紀錄原封不動保留在上面。本輪的重點是**讓「比對」本身是真的**
> —— 第二輪有一整組數字（`07e`/`07f`/`07g`/`07h`）其實比的是同一張表格視圖。
>
> 這一段是手寫的，放在 `reference/shots/compare/NOTES-round3.md`，
> 由 `e2e/compare.spec.ts` 在產生 README 時接到最後面。

#### ⭐ 根因一：view tab 沒有 `role="tab"`，**四種視圖從來沒被切換過**

`compare.spec.ts` 靠 `db.getByRole('tab', { name: /^看板$/ })` 切視圖再拍照，
但 `DatabaseHeader.tsx` 的 tab 是**沒有 role 的 `<button>`**（`<nav>` 裡的 button ＝ `role="button"`）。
`getByRole('tab')` 因此永遠 `count() === 0`；spec 寫的是「找不到就不點，但照樣拍」，
於是 `07e-db-board` / `07f-db-list` / `07g-db-gallery` / `07h-db-calendar`
**四張（含 `-full` 共八張）拍的全部是表格視圖**，拿去跟 Notion 的看板 / 清單 / 圖庫 / 日曆比。
第二輪 README 上那幾個「6.2 / 6.5 / 8.1 / 6.8」是假的。

修法：`<nav role="tablist">` + 每顆 tab `role="tab" aria-selected`。
補上之後八張全部變成**真的同視圖比對**，而且數字還更低（見下表）。

#### ⭐ 根因二：三張浮層的裁切原點是目測的，而 `07m` 還撞到 `clip()` 的 clamp

1. `06-slash-menu` 的裁切原點第一輪寫死 `(24, 33)`，實測 Notion 的面板左上角框線在 **(13, 13)**
   （面板 y13..374 ＝ 高 362、左框線 x13）。kennote 的在 (23, 32)。差 11/20px，
   最佳位移一路頂到 `+6,+6` 的搜尋上限。改成 `(13, 13)` 後 → `+0,-2`。
2. `07m-db-settings` 的參考圖有 **624px 高**，浮層開在畫面中段時
   `clip()` 會把 y 夾到 `900 - 624 = 276`（交接筆記的陷阱 #4）——
   量到的「面板上緣在裁切裡是 y7」其實是 clamp 之後的位置，怎麼調 `padY` 都沒用。
   修法：拍這三張之前先把資料庫 `scrollIntoView({ block: 'start' })`。
3. `_fallback/Popover` 有 `padding: 8px` **加上 `overflow: auto`**，
   第二輪用子元件 `margin: -8px` 去抵銷 —— 但 `overflow: auto` 會把負外距裁掉，
   實測面板只有 **284** 寬而不是 292，而且左緣被吃掉 4px。
   修法：`Popover` 加 `flush` prop（`.popoverFlush { padding: 0 }`），
   `.picker` / `.panel` 的 `margin: -8px` 拿掉。篩選 / 排序 / 設定三顆都帶 `flush`。

#### 本輪改了什麼

| # | 改動 | 檔案 | 代表性數字（light） |
|---|---|---|---|
| 1 | ⭐ view tab 補 `role="tablist"` / `role="tab"` / `aria-selected` | `DatabaseHeader.tsx` | `07e`~`07h` 首次真的比到；`07g-full` 19.4→**12.3**、`07h-full` 19.4→**11.4**、`07f-full` 15.4→**10.0** |
| 2 | ⭐ 時程表視圖首次納入比對（遠端後端已跑完 migration 0060） | — | `07i-db-timeline` **5.0**／`-full` **9.7**（第二輪沒有數字） |
| 3 | tab 列溢出收成「還有 N 個…」下拉（UI-SPEC §8.1），收起來的檢視在浮層裡**仍然是 `role="tab"`**，`compare.spec.ts` 的 `selectView()` 找不到就先展開下拉 | `DatabaseHeader.tsx` / `.module.css`、`compare.spec.ts` | `07n` 12.5→12.6（版面結構對了，但標題列仍有差，見待辦） |
| 4 | `Popover` 新增 `flush`（拿掉 8px 內距），`.picker` / `.panel` 不再用 `margin: -8px` → 面板真的是 292 寬、左緣對齊 x13 | `_fallback/Popover.tsx`、`fallback.module.css`、`Builders.module.css`、`ViewSettingsPanel.module.css` | `07k` 對齊、`07m` 面板左緣 x17→**x13** |
| 5 | `07m` 拍照前先把資料庫捲到上緣（避開 `clip()` 的 y clamp） | `compare.spec.ts` | `07m` 15.4→**10.5**／dark 15.7→**12.2** |
| 6 | `06-slash-menu` 裁切原點 `(24,33)` → **`(13,13)`**（實測值） | `compare.spec.ts` | `06-slash-menu` 8.9→**7.7**／dark 9.9→**8.1** |
| 7 | `05-06-todo-checked` 補 `dy: +2`（上一個 block 兩邊高度不同，bbox 置中會讓文字低 2px；實測 N y21..36 / K y23..38），`clipBlock` 新增 `dy` 選項 | `compare.spec.ts` | `05-06` 4.7→**2.7**／dark 5.3→**3.5**，兩邊都回到「對齊」 |
| 8 | 量測工具進 repo：`reference/tools/measure.mjs`（`rows`/`cols`/`diff`/`row`/`colseg`/`ascii`/`col`/`px`），取代第二輪散在 scratchpad 的六支腳本 | 新增 | — |

#### 第二輪 → 第三輪（平均通道差 / 最佳位移）

| 代號 | light | dark |
|---|---|---|
| `05-06-todo-checked` | 4.7 → **2.7**（+0,+2 → 對齊） | 5.3 → **3.5**（對齊） |
| `06-slash-menu` | 8.9 → **7.7**（+6,+6 → +0,-2） | 9.9 → **8.1**（+6,+6 → +0,-2） |
| `07b-db-header-hover` | 13.3 → 13.3 | 17.8 → 17.9 |
| `07e-db-board` | 6.2ᶠ → **7.1** | 8.1ᶠ → 8.7 |
| `07e-db-board-full` | 14.6ᶠ → **12.5** | 12.1ᶠ → **11.6** |
| `07f-db-list` | 6.5ᶠ → **5.8** | 8.1ᶠ → 8.7 |
| `07f-db-list-full` | 15.4ᶠ → **10.0** | 9.1ᶠ → 9.4 |
| `07g-db-gallery` | 8.1ᶠ → **6.3** | 15.2ᶠ → **12.4** |
| `07g-db-gallery-full` | 19.4ᶠ → **12.3** | 12.7ᶠ → **11.7** |
| `07h-db-calendar` | 6.8ᶠ → **4.3** | 8.0ᶠ → **5.1** |
| `07h-db-calendar-full` | 19.4ᶠ → **11.4** | 11.5ᶠ → **8.7** |
| `07i-db-timeline` | — → **5.0** | — → **5.4** |
| `07i-db-timeline-full` | — → **9.7** | — → **8.1** |
| `07k-db-filter` | 10.5 → 10.1（對齊） | 12.0 → **11.3**（對齊） |
| `07l-db-sort` | 11.3 → 10.8 | 13.3 → **12.5** |
| `07m-db-settings` | 15.4 → **10.5** | 15.7 → **12.2** |
| `07n-db-view-tabs` | 12.5 → 12.6 | 14.6 → 14.6 |

> ᶠ = 第二輪那個數字是**假的**（拍到的是表格視圖），不能跟第三輪直接比大小；
> 真正的意義是「這一欄從這一輪開始才是同視圖對同視圖」。

#### 第三輪新發現的產品缺陷

7. **view tab 不是 tab**（已修）
   `DatabaseHeader` 的檢視切換器是一排沒有 role 的 `<button>`，
   輔助技術讀不出「這是一組分頁、目前選的是哪一個」，e2e 也抓不到。
   已補 `role="tablist"` / `role="tab"` / `aria-selected`。

8. **`_fallback/Popover` 的 `padding` + `overflow: auto` 會裁掉負外距**（已修）
   任何想做「滿版內容」的浮層都會被吃掉左右各 8px。已加 `flush` prop。
   ⚠️ 若之後換成 `packages/ui` 的 Popover，記得把 `flush` 一起帶過去。

### 三之四、第四輪（視覺 QA 第四輪）

> 前三輪的紀錄原封不動保留在上面。本輪的重點是**資料庫標題列 / tab 列的盒模型**
> 與**「選單反白底色」這顆一直被用錯的 token**。
>
> 這一段是手寫的，放在 `reference/shots/compare/NOTES-round4.md`，
> 由 `e2e/compare.spec.ts` 在產生 README 時接到最後面。

#### ⭐ 根因一：`--kn-color-surface-hover` 不是 Notion 的「選單反白」

第三輪量到斜線選單的 hover 底是 `rgb(244,243,243)`、kennote 是 `rgb(240,239,237)`，
當時以為是 alpha 調錯。實際去翻 `reference/notion-capture/_tokens-raw-light.json` 才發現
Notion 有**兩顆不同的變數**：

| Notion 變數 | light | dark | kennote 對應 |
|---|---|---|---|
| `--ca-graBacSecTra`（半透明 hover） | `rgba(42,28,0,.07)` → 疊白 `rgb(240,239,237)` | `rgba(255,255,255,.055)` | `--kn-color-surface-hover` |
| **`--c-bacInt` / `--c-graBacInt`**（實色互動底） | **`#f4f3f3`** ＝ `rgb(244,243,243)` | `#262626` | 本輪新增 `--kn-color-menu-hover` |

**選單列、浮層裡的屬性列、作用中的 view tab 膠囊，用的都是後者**（實色）。
本輪新增 `--kn-color-menu-hover` 並套到斜線選單、`Builders.module.css`、
`ViewSettingsPanel.module.css`、`.tabActive`。

⚠️ **但 dark 不能照抄 `#262626`** —— 那是深色的 *sunken* 底，
疊在 `rgb(37,37,37)` 的面板上幾乎看不見（實測 kennote 一度變成 `rgb(38,38,38)`）。
`06-slash-menu-dark.png` 的反白實測是 **`rgb(49,49,48)`**，正好等於
`rgb(37,37,37)` 疊 `rgba(255,255,255,.055)`，所以 dark 的 `--kn-color-menu-hover`
維持半透明值。第一版照抄 `#262626` 讓 `06-slash-menu` dark 從 8.1 變成 8.5，改回來之後是 **7.9**。

#### ⭐ 根因二：內嵌資料庫的標題列矮了 13px，`07n` 的裁切原點差 19px

`07n-db-view-tabs-light.png` 逐列量測：

| | Notion | kennote（第三輪） |
|---|---|---|
| 標題字身 | y29..50（＝ font-size 24 ✓ 兩邊一樣） | y48..69 |
| 標題左緣 | x49 | x53 |
| tab 膠囊 | y69..100（高 **32**）、x48..125（寬 **78**）、底 `rgb(244,243,243)` | y81..108（高 28）、寬 64 |
| 標題下緣 → tab 上緣 | **19px** | 12px |

→ 裁切原點 `(box.x-48, box.y-26)` 改成 **`(box.x-44, box.y-7)`**；
`.titleInline` 的 `margin-bottom` 6 → **15**；`.tab/.tabActive` 高 28 → **32**、
內距 `0 8px` → `0 12px`、gap 6 → **10**（12+16+10+28+12 ＝ 78 ✓）；`.bar` `min-height` 34 → 36。

**副作用（必修）**：標題列一共長高 13px，`07`/`07e`~`07i` 那七張的裁切
（同一行 `y: box.y - 26`）整批變成 `dy +6` 頂到搜尋上限。padY 26 → **13** 之後全部回到 ≤|4|，
而且比第三輪更低。**改資料庫表頭的高度，記得同步改這一行。**

> 位移符號怎麼讀（`fixtures/png.ts` 的 `meanAbsAt`）：比的是 `kennote[y+dy]` vs `notion[y]`，
> 所以 **`dy = +6` ＝ kennote 的內容比 Notion 低 6px**，要把 padY **調小**。
> 第三輪一直在猜這個方向，這裡寫死。

#### ⭐ 根因三：`flex column` + `max-height` 會把面板上半部壓扁

`07m` 的 `.panel` 是 `display:flex; flex-direction:column; max-height:560px; overflow-y:auto`。
第三輪量到的「面板上緣→名稱框 39px」不是 CSS 寫的值 —— 面板內容本來就已經頂到 560，
`.header` / `.nameRow` **沒有 `flex-shrink:0`**，把 `.header` 從 34 調到 45 之後
只長了 3px（其餘 8px 被 flex 壓回去）。
Notion 的面板實測 y13..612 ＝ 高 **599**，`max-height` 要放大到 600，
並替 `.header` / `.nameRow` / `.section` / `.row` 補 `flex: 0 0 auto`。

補完之後 `07m` 的上半部**逐像素對上**：

| | Notion | kennote（第四輪） |
|---|---|---|
| 面板上緣 | y13 | y12 |
| 上緣 → 名稱框上框線 | **49**（y14..62） | **49**（y13..61）✓ |
| 名稱框填色 | y64..91（高 **28**） | y63..90（高 **28**）✓ |
| 第一組設定的分隔線 | y313 | y311（第三輪 y299） |

另外 Notion 的名稱框與第一組設定之間**沒有分隔線**（y93..312 全白），
`.section` 的 `border-top` 改成 `.section + .section`。

#### 本輪改了什麼

| # | 改動 | 檔案 | 代表性數字（light / dark） |
|---|---|---|---|
| 1 | ⭐ `07n` 裁切原點 `(48,26)` → **`(44,7)`**（實測標題字身 y29..50 / x49） | `e2e/compare.spec.ts` | `07n` 12.6/14.6 → **7.0/8.4**，位移 `+6,+6` → `+0,+2` |
| 2 | tab 膠囊 28×64 → **32×78**（內距 12、gap 10）、`.bar` min-height 36、標題下留白 6 → **15** | `DatabaseHeader.module.css` | 同上 |
| 3 | ＋ 收進「還有 N 個…」的下拉（Notion 的 tab 列上沒有 ＋），`measureTabs` 不再替它留 28px | `DatabaseHeader.tsx` / `.module.css` | 同上 |
| 4 | ⭐ `07`/`07e`~`07i` 的 padY 26 → **13**（跟著 #2 的高度改） | `e2e/compare.spec.ts` | `07-db-table` 7.2→**6.7**、`07h` 4.3→**3.6**、`07g` 6.3→**5.7** |
| 5 | ⭐ 新增 `--kn-color-menu-hover`（light `#f4f3f3`、dark 維持 `rgba(255,255,255,.055)`），套到斜線選單 / 篩選排序面板 / 設定面板 / `.tabActive` | `tokens.css`、`editor.css`、`Builders.module.css`、`ViewSettingsPanel.module.css`、`DatabaseHeader.module.css` | `06-slash-menu` 7.7/8.1 → **7.4/7.9** |
| 6 | 斜線選單：捲動區 `max-height` 330 → **318**、上內距 4 → **7**、列高 33 → **32**（`padding` 6→5px）、footer 內距 8 → **12**（高 40） | `styles/editor.css` | 同上 |
| 7 | ⭐ `07m` 面板：`max-height` 560 → **600**、`.header` 34 → **45**、名稱框 28 → **30**、`.nameRow` 32 → **34**、全部補 `flex:0 0 auto`、第一組設定不要 `border-top` | `ViewSettingsPanel.module.css` | `07m` 10.5/12.2 → **10.3/12.0**（上半部逐像素對齊） |
| 8 | 確認後端「載體頁被當成一列」已修（見下） | — | — |

#### 第三輪 → 第四輪

| 代號 | light | dark |
|---|---|---|
| `06-slash-menu` | 7.7 → **7.4** | 8.1 → **7.9** |
| `07-db-table` | 7.2 → **6.7** | 11.7 → **10.9** |
| `07-db-table-full` | 9.5 → **8.8** | 12.5 → **12.1** |
| `07c-db-row-hover` | 9.4 → **9.2** | 14.2 → **14.0** |
| `07e-db-board` | 7.1 → **6.6** | 8.7 → **8.0** |
| `07e-db-board-full` | 12.5 → **11.8** | 11.6 → **11.2** |
| `07f-db-list` | 5.8 → **5.2** | 8.7 → **8.0** |
| `07g-db-gallery` | 6.3 → **5.7** | 12.4 → **11.4** |
| `07g-db-gallery-full` | 12.3 → **12.2** | 11.7 → 11.6 |
| `07h-db-calendar` | 4.3 → **3.6** | 5.1 → **4.1** |
| `07h-db-calendar-full` | 11.4 → **11.3** | 8.7 → **8.5** |
| `07i-db-timeline` | 5.0 → **4.6** | 5.4 → **4.8** |
| `07i-db-timeline-full` | 9.7 → 10.3 ⚠ | 8.1 → **7.5** |
| `07m-db-settings` | 10.5 → **10.3** | 12.2 → **12.0** |
| `07n-db-view-tabs` | 12.6 → **7.0** ⭐ | 14.6 → **8.4** ⭐ |
| `07f-db-list-full` | 10.0 → 10.7 ⚠ | 9.4 → **8.8** |
| `07l-db-sort` | 10.8 → 11.1 ⚠ | 12.5 → 12.7 ⚠ |

⚠ 三個小幅退步：`-full` 那兩張是整頁圖，表頭長高 13px 之後**下方內容跟著往下推**，
裁切沒有跟著動（`-full` 是整窗截圖，沒有 padY 可調）；`07l` 見交接筆記。

#### 第四輪的驗證（不是樣式改動）

**後端「資料庫把載體頁當成一列」已經修好了**（第一/二/三輪都列為未修）。
本輪直接打遠端 API 數過：`repo.ts` 的五條查詢路徑
（`queryRows` / `countRows` / `queryGroupedRows` / `queryAggregations` / `queryRowsForRollup`）
都已經有 `AND p.is_database = FALSE`，而且**遠端部署的也是這一版**：

```
collection 01a0ba30-7352-7b72-8be3-cc4043aadbf6
  table/表格   rows=6 total=6   上線部署 | 測試與 QA | 設計稿 | 前端開發 | 後端 API | 使用者研究
  board/看板   rows=6 total=6   groups: opt_todo=2, opt_doing=2, opt_done=2, ∅=0
  list/清單    rows=6 total=6
  gallery/圖庫 rows=6 total=6
  calendar/日曆 rows=6 total=6
  timeline/時程表 rows=6 total=6
```

六個視圖一律 6 列（＝ `reference-page.ts` 種下的六筆），沒有第七列「參考資料庫」；
看板的「無選取」那一欄是 **0**（第三輪截圖裡的「無選取 4」已經不存在，
那一組還在只是因為 `hideEmptyGroups: false`，Notion 也是這樣）。
**這一條可以從「已知缺陷」清單移除了。**

### 三之五、第五輪（視覺 QA 第五輪）

> 前四輪的紀錄原封不動保留在上面。本輪的重點是
> **裁切原點（又一次）**、**07m 面板的組標籤盒模型**，
> 以及一條會影響往後每一輪的發現：**有兩張 dark 參考圖拍到的是「開著的下拉選單」**。
>
> 這一段手寫在 `reference/shots/compare/NOTES-round5.md`，由 `e2e/compare.spec.ts` 接到 README 最後面。

#### ⭐ 根因一：`07b-db-header-hover` 的裁切原點差 20 / 23px

跟第四輪的 `07n` 一模一樣的坑 —— 先量原點，不要先調 CSS。
`measure.mjs rows / colseg 07b-db-header-hover light` 量到：

| | Notion | kennote（padX 48 / padY 30） |
|---|---|---|
| 作用中 tab 膠囊 | x30..106（寬 77）、y14..45（高 32） | x50..126（寬 77）、下緣 y24 |
| 表頭下框線 | y85 | y62 |
| 資料列 | y86..121 / y123..158（高 36） | y63..98 / y100..135（高 36） |

→ 水平差 **20**、垂直差 **23**，裁切改成 `{ x: box.x - 28, y: hb.y - 53 }`。
列高（36）、膠囊寬（77）、表頭高（32）本來就是對的，只是整張錯位。

**`07b` 13.3 / 17.9 → 8.4 / 12.0。**

另外實測 Notion 那張 light 參考圖的**表頭底其實是純白**（x200 / x400 / x600 量到都是
`rgb(255,255,255)`），kennote 用的是半透明的 `--kn-color-surface-hover`（`rgb(240,239,237)`）。
依第四輪 §根因一的分類，欄頭這種「互動底」該用實色那顆，已改成 `--kn-color-menu-hover`
（light `rgb(244,243,243)`，離白更近也更正確）。

#### ⭐ 根因二：`07m` 的「組標籤」少了 18px，`.row` 右內距少了 6px

第 1 組（7 列、無標籤）本來就對（kennote 219 / Notion 220），
第 2、3 組各短 18 / 19px —— 兩組唯一多出來的就是 `.sectionLabel`。逐列量：

| 以「組上緣的分隔線」為原點 | Notion | kennote（第四輪） |
|---|---|---|
| 標籤字身中心 | +24 | +19 |
| 第 1 列字身中心 | +54.5 | +44.5 |
| 第 2 列字身中心 | +83 | +72.5 |
| 列距 | 29 | 29 ✓ |
| 組高（第 2 組） | **196** | 178 |

→ 標籤區塊（分隔線 → 第一列上緣）Notion 是 **40**、kennote 是 30；組下緣留白 Notion **11**、kennote 2。
`.sectionLabel` 內距 `6px 12px 2px` → **`11px 16px 7px`**（列下移 10、標籤下移 5），
組下緣留白用 **`.section:has(> .sectionLabel)`** 單獨補到 11px —— 
**不要**直接改 `.section`，第 1 組已經對齊了，一起改會超過 6px。

改完第 2 組 y312..506 ＝ **195**（Notion 195）逐像素對上。

`dx -6` 是**列內容的右內距**：Notion 的右側值離面板右框線 22px（面板右緣 x305、字身最右 x283），
kennote 只有 15。`.row` 內距 `0 10px 0 12px` → **`0 16px 0 14px`**。

**`07m` 10.3 / 12.0 → 9.2 / 10.7。**

#### ⭐ 根因三：`07d` 的參考圖選的是**第二列**，而且選取格有淡藍底

`colseg 07d-db-cell-edit light 200`：

| | Notion | kennote |
|---|---|---|
| 表頭下框線 | y49 | y6 |
| 第 1 列 | y50..85（白） | y7..38（其實是表頭） |
| 選取格 | **y87..122**（藍框 2px ＋ 底 `rgb(239,246,253)`） | y40..75（藍框 2px ＋ 底 `rgb(249,248,247)`）|

kennote 原本點**第一列**＋ padY 40，等於整張錯開一列（表頭落在 Notion 的第一列上）。
→ spec 改點 `nth(1)`、padY 40 → **87**；
新增 token `--kn-color-cell-selected`（light `#eff6fd` ＝ 實測值，dark `rgba(35,131,226,.16)`）
給 `.cellActive` 當底色。

**`07d` light 13.6 → 10.1。**（dark 見根因四）

#### ⭐ 根因四：`07b` / `07d` 的 **dark 參考圖拍到的是「開著的下拉選單」**，不是 hover

這一條解釋了第四輪「兩個主題位移方向相反」的怪象，也解釋了為什麼 dark 一直下不來。

`colseg 07b-db-header-hover dark 200`：
```
y0..48   rgb(25,25,25)   ← 頁面底
y49      rgb(56,56,54)   ← 面板上框線
y50..53  rgb(37,37,37)   ← **選單面板底**
y54..81  rgb(49,49,49)   ← 選單列反白（28px，正是第四輪量到的 06 選單反白色）
y82..    rgb(37,37,37)
```
`rows` 量到那塊是 x29..250 的圓角矩形（寬 222）—— 一張蓋住表頭的**下拉選單**。
`07d-db-cell-edit-dark` 一模一樣（y14..46 面板、y47..74 反白 28px）。

**這兩張 dark 參考跟 light 參考不是同一個 UI 狀態**，跟 `07j` / `05-19` 一樣屬於「比不了」，
不要再花時間調 dark 的 hover 底色。（本輪靠裁切修正還是把 `07b` dark 17.9 → 12.0。）

#### `07k` / `07l`：清單第一列要預設反白，標題欄要排第一

`colseg 07l-db-sort light 250` 量到 Notion 的第一列是 `rgb(244,243,243)`、高 **28**（y70..97），
搜尋框 y29..58（高 30）跟 kennote 完全一致 —— 差的是 kennote **沒有「作用中」那一列**。
Notion 這種搜尋清單一打開就把第一列標起來（上下鍵移動、Enter 選它）。
→ `PropertyPicker` 加 `active` 狀態（預設 0、`ArrowUp/Down`、`onMouseEnter` 跟著走）
＋ `.pickerItemActive`。

另外並排圖看出 Notion 的第一列是「名稱」（標題欄），kennote 把標題欄排在很後面。
`views/types.ts` 的 `visibleProperties()` 早就有「title 一定排最前面」的規則，
排序 / 篩選的屬性清單沒跟上 → `SortBuilder` 與 `filter-model.ts` 的 `filterableProperties()`
補上同一個 sort。

**`07l` 11.1 / 12.7 → 9.8 / 11.5；`07k` 10.2 / 11.5 → 9.1 / 10.3。**

⚠ `07l` 剩下的差是**資料差**：Notion 那個資料庫只有 4 個可排序屬性（名稱 / 數字 / 日期 / 選取），
面板下緣在 y189 就收掉了；kennote 的參考資料庫有 7 個，面板比裁切還長。跟 `07n` 的檢視數一樣，不要硬湊。

#### 本輪改了什麼

| # | 改動 | 檔案 | 代表性數字（light / dark） |
|---|---|---|---|
| 1 | ⭐ `07b` 裁切原點 `(48,30)` → **`(28,53)`** | `e2e/compare.spec.ts` | `07b` 13.3/17.9 → **8.4/12.0** |
| 2 | 表頭 hover 換實色 `--kn-color-menu-hover` | `views/table/TableView.module.css` | 同上 |
| 3 | ⭐ `07m` `.sectionLabel` `6/12/2` → **`11/16/7`**、`.section:has(> .sectionLabel)` 下留白 **11** | `ViewSettingsPanel.module.css` | `07m` 10.3/12.0 → **9.2/10.7** |
| 4 | `07m` `.row` 內距 `0 10 0 12` → **`0 16 0 14`**（dx −6 的成因） | 同上 | 同上 |
| 5 | ⭐ `07d` 改拍**第二列**、padY 40 → **87** | `e2e/compare.spec.ts` | `07d` light 13.6 → **10.1** |
| 6 | ⭐ 新增 `--kn-color-cell-selected`（light `#eff6fd` 實測）給 `.cellActive` | `tokens.css`、`TableView.module.css` | 同上 |
| 7 | `PropertyPicker` 預設反白第一列 ＋ 上下鍵導覽 | `PropertyPicker.tsx`、`Builders.module.css` | `07k`/`07l` 各 −1.1 / −1.2 |
| 8 | 排序 / 篩選的屬性清單把 `title` 排第一 | `SortBuilder.tsx`、`filter-model.ts` | 同上 |

#### 第四輪 → 第五輪

| 代號 | light | dark |
|---|---|---|
| `07b-db-header-hover` | 13.3 → **8.4** ⭐ | 17.9 → **12.0** ⭐ |
| `07d-db-cell-edit` | 13.6 → **10.1** ⭐ | 15.4 → 15.1 |
| `07k-db-filter` | 10.2 → **9.1** | 11.5 → **10.3** |
| `07l-db-sort` | 11.1 → **9.8** | 12.7 → **11.5** |
| `07m-db-settings` | 10.3 → **9.2** | 12.0 → **10.7** |
| `07-db-table-full` | 8.8 → **8.7** | 12.1 → 12.1 |
| `07h-db-calendar-full` | 11.3 → **11.2** | 8.5 → 8.5 |
| `06-slash-menu-full` | 25.8 → **25.7** | 12.2 → 12.2 |

沒有任何一項退步。

### 三之六、第六輪（視覺 QA 第六輪）

> 前五輪的紀錄原封不動保留在上面。本輪的重點是
> **程式碼區塊與簡單表格的盒模型**（第五輪一直沒碰的 `02b/02c/02d` 逐 block 量測副產品）、
> **kennote 自己拍到的殘留浮層**，以及 **kennote 多出來的 `:focus-visible` 外暈**。
>
> 這一段手寫在 `reference/shots/compare/NOTES-round6.md`，由 `e2e/compare.spec.ts` 接到 README 最後面。

#### ⭐ 根因一：程式碼區塊短 13px（行高 24 → 21、內距 24 → 36/34）

`02b-page-mid` 的整頁圖逐 block 量（`measure.mjs colseg 02b-page-mid light 1150`），
以「引言下的分隔線」為原點對照，可以一眼看出差在哪一個 block：

| 以分隔線為原點的區段 | Notion | kennote（第五輪） |
|---|---|---|
| 分隔線 → 標註上緣 | 14 | 14 ✓ |
| 標註（`rgb(249,248,247)`） | 66 | 64 |
| 標註 → 程式碼區塊 | 16 | 16 ✓ |
| **程式碼區塊** | **133** | **120** |
| **程式碼區塊 → 表格** | **24** | **16** |
| **表格列距（含 1px 格線）** | **35** | **39** |

`05-13-code` 的特寫圖量到一樣的數字（Notion 區塊 y22..154＝133、kennote y28..147＝120），
再用「只看深色像素的逐列掃描」抓文字行：

| | Notion | kennote |
|---|---|---|
| 第 1 行字身 | y63..75 | y59..71 |
| 第 2 行字身 | y84..96 | y84..96 |
| 第 3 行字身 | y104..116 | y110..121 |
| **行距** | **21** | **25** |
| 區塊左緣 → 文字左緣 | 23 | ~22 ✓ |

→ `line-height: 24px` → **21px**、`padding: 24px 22px` → **`36px 22px 34px`**
（36 + 3×21 + 34 ＝ 133，跟 Notion 逐像素對上）。
`.kn-code-highlight` 的 `inset` 與 `.kn-code-gutter` 的 `top` 必須跟著改，
不然高亮層會跟上層文字錯開（它們是兩層疊在一起的）。

**`05-13-code` 2.9 / 6.3 → 1.6 / 2.8。**

#### ⭐ 根因二：簡單表格列高多 4px（字級 16 → 14、行高 24 → 20）

`05-14-table` 的格線位置：Notion y30 / 65 / 100 / 135（**列距 35**），
kennote y18 / 57 / 96 / 135（**列距 39**）。
字身高度 Notion 12px、kennote 14~15px —— **kennote 的表格字級太大**。

`.kn-table` 的 `font-size: var(--kn-font-size-md)`（16px）是 Notion 正文的字級，
但 Notion 的**簡單表格是 14px**；`line-height` 24 → 20，
搭配原本就對的 `padding: 7px 9px` → 20 + 14 + 1 ＝ **35**，跟 Notion 一致。

另外 `.kn-table-wrap` 補 `padding-top: 8px`
（NOTES-round2 §3 早就記過「表格內層 padding-top 8px 還沒補」，這輪從 `02b` 的
「程式碼區塊 → 表格」24 vs 16 再次量到同一個 8px）。

**`05-14-table` 4.6 / 7.6 → 4.3 / 6.9。**

#### ⭐ 根因三：`07g-db-gallery-dark` 拍到的是 **kennote 自己**開著的選單

`colseg 07g-db-gallery dark 200` 的 **K 側**（不是 N 側！）量到
`rgb(37,37,37)` 的面板底 ＋ `rgb(48,48,48)` 的 28px 反白 ——
跟第五輪 §3-20 描述的「Notion 深色選單」長得一模一樣，但這次是 kennote 自己。

並排圖證實：kennote 那張圖庫深色截圖上蓋著一個**「檢視型別」選單**
（表格／看板／清單／圖庫／日曆／時程表 ＋ 重新命名／複製檢視／刪除檢視）。
成因：`selectView()` 點的是一個**已經作用中**的檢視 tab，kennote 會把該檢視的設定選單打開，
而 `page.mouse.move()` 不會關掉它（它不是 hover 態，是點開的浮層）。

→ `selectView()` 兩條成功路徑後面都加 `dismissOverlays(page)`
（偵測 `[role="menu"] / [role="dialog"] / [class*="popover"]`，有就按 Escape，最多兩次）。

**`07g-db-gallery` 明顯差異像素 5.5% → 3.8%（light）、5.5% → 4.2%（dark）。**

#### 根因四：kennote 多出來的 2px `rgb(156,199,242)` 外暈

`global.css` 的 `:focus-visible { outline: 2px solid var(--kn-color-focus-ring); outline-offset: 1px }`
會在**已經自己畫了框**的元件外面再畫一圈。第四~五輪的「還沒對的小外觀」清單裡有兩條就是它：

* `07d` 選取格下緣多一條外暈 → `.cellActive:focus-visible { outline: none }`（選取格本來就有 `inset 0 0 0 2px`）
* `07k`/`07l` 的搜尋框聚焦時多一圈外暈 → `.pickerSearch:focus-visible { outline: none }`
  （`.pickerSearch` 本來就寫了 `outline: none`，但那只蓋得住 `:focus`，
  `:focus-visible` 同樣是 0,1,0 而且在 global.css，載入順序贏；要用 `.pickerSearch:focus-visible` 0,2,0 才蓋得掉）

順手把 `07d` 的另一條也修掉：Notion 那張沒有「⤢ 開啟」按鈕，
kennote 的 `.openButton` 綁在 `.row:hover`，所以 spec 裡點完格子要 `page.mouse.move(1380, 860)`。

**`07d` 10.1 / 15.1 → 7.6 / 13.7；`07k` 9.1 / 10.3 → 8.2 / 9.4；`07l` 9.8 / 11.5 → 8.7 / 10.4。**

#### 根因五：深色表格格線是 `rgb(44,44,43)`，不是 `rgb(56,56,54)`

`colseg 07-db-table dark 600`：Notion 的列分隔線與表頭下框線都是 **`rgb(44,44,43)`**，
kennote 用的是 `rgb(56,56,54)`（`_extra-*.json` 的 `tableBorder`，那是**區塊**框線不是**資料庫格線**）。
列高兩邊都是 37 ✓。→ `TableView.module.css` 的深色 `--kn-db-line` 改成 `rgb(44, 44, 43)`。

**`07-db-table` 6.7 / 10.9 → 6.2 / 10.5；`07-db-table-full` 8.7 / 12.1 → 8.5 / 11.7。**

#### `07c-db-row-hover` 的 dark 參考也是「開著的選單」

`colseg 07c-db-row-hover dark 200`：
```
N y0..62   rgb(37,37,37)   ← 選單面板底
N y63..90  rgb(49,49,49)   ← 28px 反白
N y91..126 rgb(37,37,37)
```
跟 `07b` / `07d` 一樣。**`07c` 的 dark 併入「比不了」名單**，不要再調列 hover 底色。
（kennote 那側是正常的 `rgb(25,25,25)` 頁面底 ＋ `rgb(32,32,32)` hover 列。）

#### 本輪改了什麼

| # | 改動 | 檔案 | 代表性數字（light / dark） |
|---|---|---|---|
| 1 | ⭐ 程式碼區塊 `line-height` 24→**21**、`padding` 24→**36/22/34**（含 highlight `inset`、gutter `top`） | `styles/editor.css` | `05-13` 2.9/6.3 → **1.6/2.8** |
| 2 | ⭐ 簡單表格 `font-size` md→**sm(14)**、`line-height` 24→**20**（列距 39→35） | `styles/editor.css` | `05-14` 4.6/7.6 → **4.3/6.9** |
| 3 | `.kn-table-wrap` 補 `padding-top: 8px` | `styles/editor.css` | 同上 |
| 4 | ⭐ `selectView()` 之後 `dismissOverlays()` 關掉殘留浮層 | `e2e/compare.spec.ts` | `07g` 差異像素 5.5%→3.8% |
| 5 | `07d` 點完格子把滑鼠移開（不露出只有 kennote 有的「⤢ 開啟」） | `e2e/compare.spec.ts` | `07d` 10.1 → **7.6** |
| 6 | `.cellActive:focus-visible` / `.pickerSearch:focus-visible` 取消 2px 外暈 | `TableView.module.css`、`Builders.module.css` | `07k` −0.9、`07l` −1.1 |
| 7 | 深色資料庫格線 `rgb(56,56,54)` → **`rgb(44,44,43)`** | `TableView.module.css` | `07-db-table` dark 10.9 → **10.5** |

#### 第五輪 → 第六輪

| 代號 | light | dark |
|---|---|---|
| `05-13-code` | 2.9 → **1.6** ⭐ | 6.3 → **2.8** ⭐ |
| `05-14-table` | 4.6 → **4.3** | 7.6 → **6.9** |
| `07d-db-cell-edit` | 10.1 → **7.6** ⭐ | 15.1 → **13.7** |
| `07k-db-filter` | 9.1 → **8.2** | 10.3 → **9.4** |
| `07l-db-sort` | 9.8 → **8.7** | 11.5 → **10.4** |
| `07-db-table` | 6.7 → **6.2** | 10.9 → **10.5** |
| `07-db-table-full` | 8.7 → **8.5** | 12.1 → **11.7** |
| `07f-db-list` | 5.2 → **5.0** | 8.0 → **6.6** |
| `07e-db-board` | 6.6 → **6.3** | 8.0 → **7.1** |
| `07g-db-gallery` | 5.7 → **5.1** | 11.4 → 11.9 ⚠（差異像素 5.5%→4.2%）|
| `07b-db-header-hover` | 8.4 → 8.4 | 12.0 → **11.9** |
| `07c-db-row-hover` | 9.2 → 9.2 | 14.0 → **13.8** |
| `02b-page-mid` | 6.4 → 6.5 ⚠ | 7.9 → **7.7** |
| `02c-page-mid2` | 22.7 → 24.4 ⚠ | 21.3 → **19.0** |
| `02d-page-bottom` | 23.4 → 23.4 | 10.5 → **10.4** |

⚠ `02c` light 退 1.7：`02c/02d` 是**固定捲動**的整窗圖，
block 高度一改，1800px 處落在哪一個 block 就跟著變。
本輪三個盒模型修正對 kennote 的淨影響是「上半部變高約 9px」
（程式碼 +13、表格上緣 +8、表格三列 −12），所以 1800px 那一刀切在不同位置。
逐 block 的 `05-*` 全部沒有退步，這才是該看的數字（見 §待辦 B）。

### 三之七、第七輪（視覺 QA 第七輪）

> 前六輪的紀錄原封不動保留在上面。本輪做的是第六輪交接單上的 A / C / D 三題
> ＋ `07k` / `07l` 的原點，重點是**三個元件的左內距其實是同一個 bug**，
> 以及 **`-full` 的計分方式改了（斷點，跨輪不可直接比）**。
>
> 這一段手寫在 `reference/shots/compare/NOTES-round7.md`，由 `e2e/compare.spec.ts` 接到 README 最後面。

#### ⭐ 根因一：三個浮層元件的「左內距少 6px」是同一個 bug

第五輪起 `07k` / `07l` / `07m` 的最佳位移一直卡在 **`-6,+0`**，三輪都被當成三件事。
這一輪逐像素量（找「一列裡最左邊的深色像素」）才確定是同一條：

| | Notion 圖示 ink 左緣 | kennote | 面板左框線 |
|---|---|---|---|
| `07m` 第 1 列（版面配置） | x40 | x30 | x13 |
| `07k` / `07l` 屬性列 | **x33** | **x27** | x12~13 |

→ `ViewSettingsPanel.module.css` 的 `.row` `padding-left: 14 → 20`、
`Builders.module.css` 的 `.pickerItem` `padding: 0 12px → 0 12px 0 18px`。
兩邊的搜尋框（`07k` 量到兩邊都是 x25..292）**本來就對齊，不要一起改**。

補完之後 `07k` 的圖示對到 x33，但**文字**還差 3px（N x59 / K x56）——
Notion 的型別圖示 ink 寬 14、kennote 12，所以 `.pickerItem` 的 `gap: 8 → 11`。

**`07k` 8.2/9.4 → 7.1/8.2、`07l` 8.7/10.4 → 7.5/9.0，兩張的位移都變成「對齊」。**

#### ⭐ 根因二：`07m` 面板的三段垂直原點

第六輪量到、沒改的三條（`ViewSettingsPanel.module.css`）：

| | Notion | kennote（第六輪） | 修法 |
|---|---|---|---|
| 標題「瀏覽模式設定」字身 | y34..44 | y30..41 | `.header` 補 `padding-top: 8px` |
| 名稱框填色 | y64..91（高 28） | y62..91（高 30） | `.nameIcon` / `.nameInput` 30 → **28** |
| 第 1 列字身上緣 | y108 | y114 | `.nameRow` `margin-bottom: 8 → 2` |

⚠ **`.header` 是 `align-items: center` ＋ `box-sizing: border-box`**，
所以「只補 `padding-top: P`」實際只會把內容往下移 **P/2**；要下移 4px 得寫 8px。
`height: 45px` 不變，下面的列完全不受影響 —— 這是最省事的寫法。

**`07m` 9.2/10.7 → 7.4/8.7，位移 `-6,+6` → `-1,+0` / 對齊。**

> 第六輪交接 §2-E 的「第 3 組少一列『在日曆中管理』」在本輪開工前
> **已經被別的代理補在 `ViewSettingsPanel.tsx` 了**（第 3 組現在是 3 列，
> 右側是 `↗`、`onSelect` 接 `views` 裡的日曆檢視、沒有日曆檢視時 `disabled`）。本輪沒有再動。

#### ⭐ 根因三：深色圖庫卡片的三個顏色全部吃錯 token ＋ 多一顆 emoji

`07g-db-gallery` 的 dark 從第二輪起就一直在 11~12 分。`GalleryView.module.css` 裡
封面底 / 卡片底 / 框線三個都直接吃 `--kn-color-bg-subtle` / `--kn-color-bg` / `--kn-editor-hairline`，
但 Notion 深色的圖庫卡片是**另外三個顏色**（第六輪量到、沒用上）：

| | Notion（dark） | kennote（第六輪） |
|---|---|---|
| 卡片框線 | `rgb(44,44,43)` | `rgb(56,56,54)` |
| 封面底 | `rgb(45,45,45)` | `rgb(32,32,32)` |
| 卡片內文區底 | `rgb(38,38,38)`、高 **39** | 同頁面底、高 43 |
| 空封面內容 | **純色佔位、沒有圖示** | 中央一顆 32px 文件 emoji |

→ `.grid` 上宣告 `--kn-gallery-line / -cover / -body` 三個變數，深色兩個 selector
（`:root[data-theme='dark']` ＋ `prefers-color-scheme` 的 `:root:not([data-theme='light'])`）覆寫；
`.cardBody` `padding: 10px 12px → 8px 12px`（1 + 8 + 22 + 8 ＝ 39）；
`.coverGlyph` 改 `display: none`（DOM 留著，之後要放真的封面圖示再開）。

**`07g-db-gallery` dark 11.9 → 7.1、明顯差異像素 4.2% → 3.1%**（light 5.1 → 5.0）。

#### ⭐ 根因四：`-full` 的分數 80% 是「側邊欄與頂欄」——但方向跟第六輪猜的相反

第六輪交接 §2-A 寫「`-full` 的 8~12 分主要來自左邊 260px 側邊欄，
那塊平均差 ~40、光這塊就貢獻 7 分」。**這一輪實測，這個估計是錯的。**

`measure.mjs row 07-db-table-full light 500` 先確認兩邊的側邊欄**都在 x269 結束**
（Notion 258 ＋ 11px 捲軸溝，kennote 實色 270），頂欄兩邊都是 44px。
再逐區塊算平均通道差：

| | whole | sidebar(0..270) | topbar(270..1440, 0..44) | **content(270..1440, 44..900)** |
|---|---|---|---|---|
| `07-db-table-full` | 9.0 | 14.5 | 3.7 | **7.9** |
| `07e-db-board-full` | 14.6 | 14.5 | 3.7 | **15.2** |
| `06-slash-menu-full` | 26.1 | 14.4 | 3.7 | **30.1** |
| `07g-db-gallery-full` | 12.4 | 14.5 | 3.7 | **12.4** |

→ 側邊欄的平均差其實只有 **14.5**（不是 40），而**頂欄的 3.7 才是那個「稀釋劑」**：
它佔 5% 的面積、幾乎完全對齊，一直在把 `-full` 的平均往下拉。
換句話說 `-full` 的數字**同時被側邊欄拉高又被頂欄拉低**，兩邊都不是內容本身。

→ `compare.spec.ts` 的計分改成：代號以 `-full` 結尾時，
把兩張圖都先裁成 `FULL_CROP = { x: 270, y: 44, width: 1170, height: 856 }` 再算 `diffStats`。
**並排圖仍然是完整的 1440×900**（結構還是要看得到側邊欄），只有分數改成內容欄。

⚠ **這是一個計分斷點：第六輪以前的 `-full` 數字不能跟第七輪以後直接比。**
有些變高（`07e-full` 11.8 → 12.0、`07g-full` 12.1 → 12.4、`06-slash-menu-full` 25.7 → 30.1），
有些變低（`07-db-table-full` 8.5 → 7.8、`07i-full` dark 7.5 → 7.1），
但**從現在起這些數字反映的是內容本身**，追起來才有意義。

#### 深色 view-tab 列的下框線也是 `rgb(44,44,43)`

`colseg 07-db-table dark 600`：Notion 的 tab 列下框線 `rgb(44,43,42)`，
kennote 吃 `--kn-color-divider` ＝ `rgb(48,48,46)` —— 整張深色表格裡唯一一條顏色不對的線
（第六輪只修了 `TableView` 的格線）。→ `DatabaseHeader.module.css` 的 `.bar` 加深色覆寫。
只有 1px，`07n-db-view-tabs` dark 8.4 → 8.3。

#### 本輪改了什麼

| # | 改動 | 檔案 | 代表性數字（light / dark） |
|---|---|---|---|
| 1 | ⭐ `.row` `padding-left` 14 → **20** | `ViewSettingsPanel.module.css` | `07m` 位移 `-6` → `-1` |
| 2 | ⭐ `.header` `padding-top: 8px`（＝標題下移 4）、`.nameRow` `margin-bottom` 8 → **2**、名稱框 30 → **28** | `ViewSettingsPanel.module.css` | `07m` 9.2/10.7 → **7.4/8.7** |
| 3 | ⭐ `.pickerItem` `padding-left` 12 → **18**、`gap` 8 → **11** | `Builders.module.css` | `07k` **7.1/8.2**、`07l` **7.5/9.0**（都「對齊」） |
| 4 | ⭐ 深色圖庫卡片三色 ＋ 內文區高 39 ＋ 拿掉封面 emoji | `GalleryView.module.css` | `07g` dark 11.9 → **7.1** |
| 5 | ⭐ `-full` 只算內容欄（裁掉側邊欄 270 ＋ 頂欄 44） | `e2e/compare.spec.ts` | 計分斷點，見根因四 |
| 6 | 深色 view-tab 列下框線 `rgb(48,48,46)` → **`rgb(44,44,43)`** | `DatabaseHeader.module.css` | `07n` dark 8.4 → **8.3** |

#### 第六輪 → 第七輪

| 代號 | light | dark |
|---|---|---|
| `07m-db-settings` | 9.2 → **7.4** ⭐ | 10.7 → **8.7** ⭐ |
| `07g-db-gallery` | 5.1 → **5.0** | 11.9 → **7.1** ⭐ |
| `07k-db-filter` | 8.2 → **7.1**（對齊）| 9.4 → **8.2**（對齊）|
| `07l-db-sort` | 8.7 → **7.5**（對齊）| 10.4 → **9.0**（對齊）|
| `07n-db-view-tabs` | 7.0 → 7.0 | 8.4 → **8.3** |
| `07-db-table` | 6.2 → 6.2 | 10.5 → 10.5 |
| `07-db-table-full` ᶜ | 8.5 → 7.8 | 11.7 → 12.4 |
| `07e-db-board-full` ᶜ | 11.8 → 12.0 | 11.2ᵃ → 11.5 |
| `07f-db-list-full` ᶜ | 10.8 → 10.7 | 8.6 → 8.4 |
| `07g-db-gallery-full` ᶜ | 12.1 → 12.4 | 11.5 → 12.4 |
| `07h-db-calendar-full` ᶜ | 11.3 → 11.3 | 8.5 → 8.3 |
| `07i-db-timeline-full` ᶜ | 10.3 → 10.1 | 7.5 → 7.1 |
| `06-slash-menu-full` ᶜ | 25.7 → 30.1 | 12.2 → 13.1 |

ᶜ ＝ **換了計分方式**（只算內容欄），跟上一輪的數字不是同一把尺，不要當成進步／退步。
ᵃ ＝ 第五輪數字（第六輪表上沒列 dark）。
