# 第七輪視覺 QA — 交接筆記

> 寫給接手的代理。**先讀** `README.md`（數字）、`NOTES-round7.md`（本輪改了什麼、為什麼）、
> `NOTES-round2.md`（Notion block 盒模型的全套實測值）。
> 坑清單是累積的：`HANDOFF-round2.md §陷阱`（1~9）、`round3 §4`（10~13）、`round4 §4`（14~19）、
> `round5 §3`（20~24）、**`round6 §3`（25~30）照樣會踩**。本輪新增 31~34。
> 這一份只寫「還沒做完的」「量到還沒用上的數值」「第七輪新踩到的坑」。

---

## 0. 怎麼跑

```bash
cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 node node_modules/vite/bin/vite.js --port 5173 &
# ⚠️ 5173 被佔走時 vite 會**自己跳到 5174 / 5175**，一定要看它印出來的 Local 網址。
#    第七輪實測：同時有別的代理開著 dev server 時，5173 / 5174 兩個埠都回 200 而且
#    **HTML 完全一樣**（同一份 repo），光 curl 分不出來 —— 以 vite 印的為準。
cd e2e
rm -f ../reference/shots/kennote/_fresh.json                                  # 要乾淨的一輪
BASE_URL=http://localhost:5173 npx playwright test compare --grep "建立參考頁"  # 5s
BASE_URL=http://localhost:5173 npx playwright test compare --grep "拍照"        # light+dark，1.8 分
BASE_URL=http://localhost:5173 npx playwright test compare --grep "並排"        # 並排圖 + README，30s
```

量測工具 `reference/tools/measure.mjs`（`rows`/`cols`/`diff`/`row`/`colseg`/`ascii`/`col`/`px`）。

---

## 1. 本輪完成

| 第六輪交接的題目 | 狀態 |
|---|---|
| A. `-full` 改成只裁內容欄 | ✅ 做了，而且**推翻了第六輪對成因的估計**（見 `NOTES-round7` 根因四）|
| C. `07m` 三條修法 | ✅ 9.2/10.7 → **7.4/8.7**，位移 `-6,+6` → `-1,+0` / 對齊 |
| D. `07g-db-gallery` dark | ✅ 11.9 → **7.1** |
| E. `07m` 第 3 組補「在日曆中管理」 | ✅ **開工前就被別的代理補完了**（`ViewSettingsPanel.tsx` 第 3 組已是 3 列）|
| `07k` / `07l` 的殘留 | ✅ 8.2/9.4 → **7.1/8.2**、8.7/10.4 → **7.5/9.0**，兩張都「對齊」|
| `07-db-table` dark 10.5 | 🟡 量完了、只修掉 1px 的 tab 下框線；**主因見 §2-A** |
| `07c` light 9.2 | ❌ 沒碰（`07c` 的 light 跟 `07-db-table` 是同一個原點問題，跟著 §2-A 走）|

---

## 2. 待辦（依 CP 值排序）

### A. ⭐ `07-db-table` dark 10.5 / `07c` light 9.2：**表頭帶的高度差 23px**

`colseg 07-db-table dark 600`（light 完全一樣的形狀）：

| | Notion | kennote |
|---|---|---|
| view-tab 列下框線 | y93..94（**2px**，`rgb(44,43,42)` / light `rgb(241,240,240)`）| y112（1px，本輪已改成 `rgb(44,44,43)`）|
| 表頭列上緣 → 表頭底線 | y95..149 ＝ **55** | y113..144 ＝ **32** |
| 第一條資料列格線 | **y150** | **y145** |
| 之後每一列 | 37（36 ＋ 1 格線）✓ | 37 ✓ |

也就是說：**列高、格線顏色、格線間距三樣都已經對了**，
剩下的是「tab 列下框線 → 第一條格線」這一段 Notion 是 **57px**、kennote 只有 **33px**。
其中 tab 下框線本身 Notion 是 **2px**（kennote 1px）。
`07-db-table` / `07b` / `07c` / `07d` 的裁切原點都是 `box.y - 13`，
所以這 24px 會讓**整張表往上跑**，四張圖一起受害 —— 這是目前資料庫組最大的一塊。

→ 入口：`DatabaseHeader.module.css` 的 `.bar`（`min-height: 36` ＋ `padding-bottom: 4`）
與 `TableView.module.css` 的表頭列。**先 `colseg` 確認 Notion 那 55px 裡有什麼**
（很可能是 Notion 的表頭列本身就比 kennote 高，或中間多一條工具列），不要直接塞 margin。

### B. `06-slash-menu-full` 30.1：改成「在資料庫上面那一段打 `/`」或列進「比不了」

第六輪就確認過：Notion 那張是在**靠近資料庫的那一段**打 `/`（畫面上是一張大圖 ＋ 日曆資料庫），
kennote 是在**文件第一段**打 `/`。換成只算內容欄之後這張變成 30.1（全場最高），
因為側邊欄那塊「剛好比較像」的稀釋沒有了。**兩邊拍的不是同一個位置，捲動補 px 沒有意義。**
→ 要嘛改 `compare.spec.ts` 讓它在資料庫前一段打 `/`，要嘛寫進 KNOWN_GAPS 的「比不了」。

### C. `07g-db-gallery-full` 12.4 / `07e-db-board-full` 12.0

單張（非 `-full`）的 `07g` 已經 5.0/7.1、`07e` 5.5/7.1，
`-full` 卻是 12.4 / 12.0 —— 差的是**資料庫以外**的那一整頁（標題、封面、上下文 block）。
`-full` 現在只算內容欄了，所以這個差是真的。
→ 先 `colseg <code>-full light 800` 找出是哪一段開始錯開，多半是頁面上緣的封面高度。

### D. 第六輪就掛著、本輪也沒碰的

* `02b` 的**標註（callout）高 Notion 66 / kennote 64**（`05-12` 還有 `dx −2`）。
* `02c-page-mid2` 24.8 / 19.4、`02d-page-bottom` 23.8 / 10.8 —— 參考頁內容本身不同，見 KNOWN_GAPS。
* `05-01-paragraph` 5.2 / 5.5：字身算繪差，建議放寬目標或標註。
* `05-20-bookmark` 23：Notion 那張的縮圖是白的，**下限就是 23**。
* `05-14-table` dark 的明顯差異像素 **15.4%**（light 只有 5.9%）—— 深色簡單表格還沒對過。
* 公式不置中、目錄縮排 24px、標題 4 的 padding（NOTES-round2 §3）。
* `03e-sidebar-bottom` 9.2 / 9.6（`+1,+6` 頂到上限 ⇒ 又是原點）。
* `07l` 剩下的差是**資料差**（Notion 只有 4 個可排序屬性、kennote 有 7 個）。
* `04b-topbar-right` 7.3（`+2,+0`）、`07n-db-view-tabs` 7.0（`+0,+2`）—— 兩張都是小位移，還沒量。

---

## 3. 第七輪新踩到的坑（接在第六輪 25~30 之後）

31. ⭐ **`align-items: center` ＋ `box-sizing: border-box` 的元件，補 `padding-top: P` 只會下移 P/2。**
    `07m` 的 `.header` 要「標題往下 4px」，寫 `padding-top: 4px` 只會動 2px，得寫 **8px**。
    （高度固定 ＋ 置中 ⇒ 剩餘空間對半分。）好處是 `height` 不變、下面的列完全不受影響，
    比改 `margin` 安全得多。

32. ⭐ **連續好幾張圖卡在同一個 `偏移 -6,+0`，先假設它們是同一個 bug。**
    `07k`/`07l`/`07m` 的 `-6` 掛了三輪、被當成三件事調了三次；
    實際上是三個元件**各自**把列的 `padding-left` 寫少 6px（14 vs 20、12 vs 18）。
    → 量法：挑一列，掃「這個 y 區間裡最左邊的深色像素」，兩邊一比就出來
    （`measure.mjs` 沒有這個模式，本輪是寫了 20 行的臨時腳本；值得補進工具）。

33. ⭐ **圖示對齊了、文字還差幾 px，那是 `gap` 不是 `padding`。**
    `07k` 補完 `padding-left` 之後圖示 ink 兩邊都在 x33，但文字 N x59 / K x56。
    原因是 Notion 的型別圖示 ink 寬 14、kennote 12 ⇒ 後面的東西整體少 2~3px。
    改 `gap` 而不是再加 `padding-left`（否則圖示又跑掉）。

34. ⭐ **「側邊欄害的」這種面積直覺會騙人，一定要逐區塊算平均差。**
    第六輪估「側邊欄平均差 ~40、貢獻 7 分」，實測只有 **14.5**；
    真正在動手腳的是**頂欄**（平均差 3.7、佔 5% 面積），它一直把 `-full` 的平均**拉低**。
    裁掉兩者之後有一半的 `-full` 分數是**上升**的 —— 那才是內容本身的真實數字。
    → 改計分方式一定要在 README / NOTES 標成「斷點」，不然下一輪會把它讀成退步。

---

## 4. 量到但還沒用上的數值（第七輪新量）

| 項目 | 實測 |
|---|---|
| `-full` 的版面邊界 | 兩邊側邊欄**都在 x269 結束**（Notion 實色 258 ＋ 11px 捲軸溝、kennote 實色 270）；頂欄 44 |
| `-full` 分區平均通道差 | sidebar **14.5**、topbar **3.7**、content = 現在 README 上的數字 |
| Notion 表格 tab 列下框線 | **2px**，dark `rgb(44,43,42)` / light `rgb(241,240,240)` |
| Notion「tab 下框線 → 第一條資料格線」 | **57**（kennote 33）；其中表頭列 Notion 55 / kennote 32 |
| `07k` 屬性列 | 圖示 ink `x33..46`（寬 14）、文字左緣 **x59**；kennote 圖示寬 12 |
| `07k` 搜尋框 | 兩邊都是 `x25..292` ✓（不要動） |
| `07k` / `07l` 面板列距 | 兩邊都是 **37**（N 線在 55/92/129/166/203、K 差 3px，已由 `.nameRow` 之外的原點吸收） |
| Notion 深色圖庫卡片 | 框線 `rgb(44,44,43)`、封面底 `rgb(45,45,45)`、內文區底 `rgb(38,38,38)` 高 **39** |

---

## 5. 驗收狀態（本輪結束時）

```
apps/web  tsc --noEmit   ✅
apps/web  npm run test   ✅ 15 files / 303 tests
apps/web  npm run build  ✅ built in 4.69s
```

沒有 git commit（依指示）。

---

## 6. 本輪改動的檔案

**新增**

```
reference/shots/compare/NOTES-round7.md      ← 第七輪紀錄（README 會自動接上）
reference/shots/compare/HANDOFF-round7.md    ← 這一份
```

**修改**

```
apps/web/src/features/database/ViewSettingsPanel.module.css        ← .header padding-top 8、.nameRow margin-bottom 2、名稱框 28、.row padding-left 20
apps/web/src/features/database/Builders.module.css                 ← .pickerItem padding-left 18、gap 11
apps/web/src/features/database/views/gallery/GalleryView.module.css← 深色三色變數、.cardBody padding 8px、.coverGlyph display:none
apps/web/src/features/database/DatabaseHeader.module.css           ← 深色 .bar 下框線 rgb(44,44,43)
e2e/compare.spec.ts                                                ← FULL_CROP / cropRaster()，`-full` 只算內容欄 + README 加註斷點
```

**沒有動**：`packages/editor-core`、`packages/ui/src/{components,dnd,overlay,positioning}`、
任何 runtime 依賴、後端程式碼、任何 `.tsx` 邏輯檔（`ViewSettingsPanel.tsx` 的「在日曆中管理」
是別的代理在本輪開工前就補好的）。
