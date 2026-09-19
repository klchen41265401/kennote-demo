# 第五輪視覺 QA — 交接筆記

> 寫給接手的代理。**先讀** `README.md`（數字）、`NOTES-round5.md`（本輪改了什麼、為什麼）、
> `NOTES-round2.md`（Notion block 盒模型的全套實測值）。
> `HANDOFF-round2.md §陷阱`、`HANDOFF-round3.md §4`、**`HANDOFF-round4.md §4`（14~19 條）照樣會踩**。
> 這一份只寫「還沒做完的」「量到還沒用上的數值」「第五輪新踩到的坑」。

---

## 0. 怎麼跑

```bash
cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 node node_modules/vite/bin/vite.js --port 5173 &
cd e2e
rm -f ../reference/shots/kennote/_fresh.json                                  # 要乾淨的一輪
BASE_URL=http://localhost:5173 npx playwright test compare --grep "建立參考頁"  # 5s
BASE_URL=http://localhost:5173 npx playwright test compare --grep "拍照"        # light+dark，1.8 分
BASE_URL=http://localhost:5173 npx playwright test compare --grep "並排"        # 並排圖 + README，30s
```

⚠️ 遠端 `:8090` 開場常常 `ECONNREFUSED`（本輪等了 ~40 秒才通）。
探測：`(echo > /dev/tcp/100.74.148.92/8090)`。`:8080` 是 nginx 靜態站，不是 API。

量測工具 `reference/tools/measure.mjs`（`rows`/`cols`/`diff`/`row`/`colseg`/`ascii`/`col`/`px`）。
⚠️ `rows <code> <theme> [x0 x1]` 的 x0/x1 會**把回報的 x 範圍夾住**，別把它誤讀成版面邊界（本輪差點）。

---

## 1. 本輪完成

| 任務 | 狀態 |
|---|---|
| 1. `07b-db-header-hover` | ✅ 13.3/17.9 → **8.4/12.0**（裁切原點 + 表頭 hover token）|
| 2. `07m` 下半部 | ✅ 10.3/12.0 → **9.2/10.7**（標籤盒模型 + `.row` 右內距，dx −6 的成因已修）|
| 3. `07l-db-sort` | ✅ 11.1/12.7 → **9.8/11.5**（第一列預設反白 + title 排第一）；剩下是資料差 |
| 4. `07d` 儲存格選取態 | ✅ light 13.6 → **10.1**；dark 15.4 → 15.1（**dark 參考是別的狀態**，見 §3）|
| 5. `-full` 整窗圖 | ❌ 沒做（見 §2-A）|
| 6. `02b/02c/02d` | ❌ 沒碰 |
| 7. 深色其餘 > 8 | 🟡 只有 07b/07d/07k/07l/07m 順便下來 |
| 8. NOTES / HANDOFF | ✅ |

---

## 2. 待辦（依 CP 值排序）

### A. `-full` 整窗截圖（`06-slash-menu-full` light **25.7** 最高）

`-full` 是 `shot(page, ...)` 整窗截圖，**沒有 padY 可調**，只能動捲動位置。
現況：`07f-full +6,-5`、`07i-full +5,-5`、`07-db-table-full +5,+5`、`07e-full +1,+3`…
**每張的 dy 方向不一樣，所以「統一補 13px」是錯的**，要嘛逐張在 `centerBlock()` 後加一個
per-code 的 `window.scrollBy(0, n)`，要嘛把 `-full` 改成 `clip()` 並給各自的 padY。
`06-slash-menu-full` light 25.7 / dark 12.2 的落差最大 —— **差在 light 的整頁內容，先開並排圖看**。

### B. `02c-page-mid2` 22.7 / 21.3、`02d-page-bottom` 23.4、`02b` 6.4 / 7.9

連續四輪沒碰。`02c/02d` 是固定捲 1800px / 捲到底，盒模型每個 block 差幾 px 會累積。
`node measure.mjs rows 02c-page-mid2 light` 逐段對照，**找出第一個錯開的 block** 再回去修那一種 block
（`05-*` 逐 block 的分數都 ≤ 5，所以累積差一定來自 block 之間的 margin，不是 block 內部）。

### C. `07c-db-row-hover` 9.2 / **14.0**（dark 明顯比 light 差）

本輪沒碰。dark 的列 hover 底色是主嫌，但**先用 `colseg 07c-db-row-hover dark <x>` 確認
Notion 那張 dark 參考不是又一張「開著的選單」**（`07b`/`07d` 都是，見 §3-20）。

### D. `07-db-table` 6.7 / **10.9**、`07g-db-gallery` 5.7 / **11.4**

dark 比 light 差 4~6 分。用 `_tokens-raw-dark.json` 的 **`bodyVars` / `appVars` / `themeVars`**
取值（**不要** `rootVars` / `sheetVars`，那兩個放的是 light 的值）。

### E. `07m` 第 3 組設定短了 37px

本輪把第 2 組修到逐像素（195 vs 195），第 3 組 kennote y508..572 ＝ **65**、Notion y510..611 ＝ **102**。
第 3 組沒有 `.sectionLabel`（所以本輪的修正沒碰到它），應該是**列數本身就少**——
先開 `07m-db-settings-light.png` 並排圖數一數 Notion 第 3 組有幾列。

### F. 其他沒碰的（從第三/四輪原樣搬過來）

* `05-01-paragraph` 5.2 / 5.5：已確認是**字身算繪差**，建議放寬目標或標註。
* `05-20-bookmark` 23：Notion 那張的縮圖是白的，**下限就是 23**。
* `05-14-table` 的內層 `padding-top: 8px; padding-bottom: 24px` 還沒補（NOTES-round2 §3）。
* 公式不置中、目錄縮排 24px、標題 4 的 padding —— 都還沒對（NOTES-round2 §3）。
* `07d` 的選取列裡 kennote 會露出「⤢ 開啟」按鈕，Notion 那張沒有（滑鼠其實停在格子上）。
* `07d` 選取格下緣多一條 2px 的 `rgb(156,199,242)` 外暈（`:focus-visible` 的 outline 外溢），Notion 沒有。
* `07l`/`07k` 的搜尋框聚焦時 kennote 多一圈 2px `rgb(156,199,242)` 外暈，Notion 只有 2px 實藍框。

---

## 3. 第五輪新踩到的坑（接在第二輪九條、第三輪四條、第四輪 14~19 之後）

20. ⭐ **有些 dark 參考圖拍到的是「開著的下拉選單」，不是 hover。**
    判斷方法：`colseg <code> dark 200`，看到 **`rgb(37,37,37)` 的大面積 ＋ `rgb(49,49,49)` 的 28px 反白**
    就是 Notion 的深色選單面板。目前確認 `07b-db-header-hover-dark`、`07d-db-cell-edit-dark` 都是。
    這種**跟 light 不是同一個狀態**，歸到「比不了」，不要再去調 hover 底色。
    （第四輪「兩個主題位移方向相反 ⇒ 顏色問題」的推論是錯的，真正原因是這個。）

21. **`measure.mjs rows <code> <theme> x0 x1` 的 x0/x1 會夾住回報的 x 範圍。**
    看到 `x30..199` 先確認是不是自己傳了 `0 200`，不要當成「內容只到 x199」。

22. **`.section` 這種共用容器的內距不要整組改。**
    `07m` 三組設定裡只有後兩組有標籤、只有後兩組短，整組改 `.section { padding-bottom }`
    會把已經對齊的第 1 組推超過 6px。用 **`:has(> .sectionLabel)`** 只挑有標籤的那些
    （Playwright 的 Chromium 支援 `:has()`）。

23. **「裁切原點差一整列」的徵兆：兩個主題的 dy 同時頂到 ±6 而 dx 也頂到 ±6。**
    `07b`（+6,−4 / +6,−6）跟 `07d`（−3,−6 / +2,+4）都是。
    **先 `colseg` 找兩邊的高對比橫線（表頭下框線 / 列分隔線）對一次**，再談 CSS。
    這是連續三輪的最高 CP 值修法：`07n`（第四輪）、`07b`+`07d`（第五輪）都靠這一招各砍 3~6 分。

24. **Notion 的搜尋式清單一打開就會把第一列標成作用中。**
    `07k`/`07l` 的第一列底 `rgb(244,243,243)` 不是滑鼠 hover，是鍵盤焦點。
    `07j` 之類還沒做的選單八成也一樣。

---

## 4. 量到但還沒用上的數值（第五輪新量）

| 項目 | 實測 |
|---|---|
| `07b` Notion 表頭列 | 高 **32**（y53..84）、下框線 y85、**沒有上框線**（y46..52 是白的留白 7px）|
| `07b` Notion tab 膠囊 → 表頭上緣 | 膠囊 y14..45，表頭 y53 → 間距 **8**（kennote 是 6 ＋ 一條 kennote 自己多出來的上框線）|
| `07b` Notion 名稱欄 | 頁面 icon x40..53（14px）、文字從 x67 起；kennote 沒有 icon、文字從 x75 起（修正裁切後）|
| `07d` 選取格 | 藍框 **2px** `rgb(39,131,222)`、底 **`rgb(239,246,253)`**、高 36（含框）|
| `07m` 組標籤區塊 | 分隔線 → 第一列上緣 **40**；標籤字身中心在分隔線下 **24**；組下緣留白 **11** |
| `07m` 右側值 | 離面板右框線 **22**（面板 x13..305、字身最右 x283）|
| `07l` 屬性清單 | 搜尋框 y29..58（高 30、上下左右外距 12）、第一列 y70..97（高 **28**、底 `rgb(244,243,243)`）、面板下框線 y189 |
| Notion dark 選單面板 | 底 `rgb(37,37,37)`、反白 `rgb(49,49,49)`、反白列高 **28**、圓角矩形寬 **222** |

---

## 5. 驗收狀態（本輪結束時）

```
pnpm --filter @kennote/web typecheck     ✅
pnpm --filter @kennote/web test          ✅ 14 files / 298 tests
pnpm --filter @kennote/web build         ✅ built in 4.61s
pnpm --filter @kennote/server typecheck  ✅
pnpm --filter @kennote/server test       ✅ 23 files / 352 tests（3 files / 24 skipped）
```

沒有 git commit（依指示）。

---

## 6. 本輪改動的檔案

**新增**

```
reference/shots/compare/NOTES-round5.md      ← 第五輪紀錄（README 會自動接上）
reference/shots/compare/HANDOFF-round5.md    ← 這一份
```

**修改**

```
apps/web/src/styles/tokens.css                                  ← 新增 --kn-color-cell-selected（light/dark）
apps/web/src/features/database/views/table/TableView.module.css ← .headerButton:hover 換實色 token；.cellActive 補淡藍底
apps/web/src/features/database/ViewSettingsPanel.module.css     ← .sectionLabel 11/16/7、.section:has(> .sectionLabel) 下留白 11、.row 內距 0 16 0 14
apps/web/src/features/database/PropertyPicker.tsx               ← 預設反白第一列、上下鍵導覽、hover 跟著走
apps/web/src/features/database/Builders.module.css              ← .pickerItemActive
apps/web/src/features/database/SortBuilder.tsx                  ← 可排序屬性把 title 排第一
apps/web/src/features/database/filter-model.ts                  ← filterableProperties() 把 title 排第一
e2e/compare.spec.ts                                             ← 07b 裁切 (28,53)、07d 改拍第二列 + padY 87
```

**沒有動**：`packages/editor-core`、`packages/ui/src/{components,dnd,overlay,positioning}`、
任何 runtime 依賴、後端程式碼。
