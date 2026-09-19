# 第六輪視覺 QA — 交接筆記

> 寫給接手的代理。**先讀** `README.md`（數字）、`NOTES-round6.md`（本輪改了什麼、為什麼）、
> `NOTES-round2.md`（Notion block 盒模型的全套實測值）。
> `HANDOFF-round2.md §陷阱`、`HANDOFF-round3.md §4`、`HANDOFF-round4.md §4`（14~19）、
> **`HANDOFF-round5.md §3`（20~24）照樣會踩**。
> 這一份只寫「還沒做完的」「量到還沒用上的數值」「第六輪新踩到的坑」。

---

## 0. 怎麼跑

```bash
cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 node node_modules/vite/bin/vite.js --port 5173 &
# ⚠️ 5173 被佔走時 vite 會**自己跳到 5174 / 5175**，一定要看它印出來的 Local 網址，
#    BASE_URL 打錯埠號會拍到別的專案（或一片空白）而完全不報錯。
cd e2e
rm -f ../reference/shots/kennote/_fresh.json                                  # 要乾淨的一輪
BASE_URL=http://localhost:5173 npx playwright test compare --grep "建立參考頁"  # 5s
BASE_URL=http://localhost:5173 npx playwright test compare --grep "拍照"        # light+dark，1.8 分
BASE_URL=http://localhost:5173 npx playwright test compare --grep "並排"        # 並排圖 + README，30s
```

量測工具 `reference/tools/measure.mjs`（`rows`/`cols`/`diff`/`row`/`colseg`/`ascii`/`col`/`px`）。

---

## 1. 本輪完成

| 任務 | 狀態 |
|---|---|
| 1. `02b/02c/02d` 逐 block 量測 | 🟡 **量完了、根因找到了**（程式碼區塊 −13、表格上緣 −8、表格列 +4/列），三個盒模型都修好；但 `02c/02d` 本身是固定捲動的整窗圖，數字沒有跟著降（見 §2-B）|
| 2. `-full` 整窗圖 per-code `scrollBy` | ❌ 沒做 —— **先看 §2-A，這題的前提是錯的** |
| 3. `07c` dark | ✅ 確認是「開著的選單」，併入「比不了」名單 |
| 4. `07-db-table` / `07g` dark | ✅ 格線實色修好；`07g` dark 的真正問題是 kennote 自己開著選單（已修）|
| 5. `07m` 第 3 組短 37px | 🟡 **找到原因、沒修**（Notion 多一列「在日曆中管理」，見 §2-E）|
| 6. 三個小外觀（`07d` ⤢ 按鈕、2px 外暈） | ✅ 三條都修掉了 |
| 7. NOTES / HANDOFF | ✅ |

---

## 2. 待辦（依 CP 值排序）

### A. ⚠️ `-full` 整窗圖：**per-code `scrollBy` 不會有用，先看這一段**

第五輪交接寫「逐張加 `scrollBy` 讓 `06-slash-menu-full`（25.7）對齊」。本輪開圖確認：

* **`06-slash-menu-full` 的兩邊根本是文件的不同位置。**
  Notion 那張是在**靠近資料庫的那一段**打 `/`（畫面上是一張大圖 ＋ 日曆資料庫），
  kennote 是在**文件第一段**打 `/`（畫面上是第一段 ＋ 整串清單）。
  捲動補幾 px 沒有意義 —— 要嘛改成在「資料庫上面那一段」打 `/`，要嘛列進「比不了」。
* **所有 `-full` 的 8~12 分主要來自左邊 260px 的側邊欄。**
  兩邊側邊欄的頁面清單內容完全不同（Notion：上線部署／測試與 QA／設計稿…；
  kennote：多了「/database 暫實資料庫」「Side project」等）。
  260/1440 ＝ 18% 的面積、那塊的平均差 ~40 → 光這塊就貢獻 7 分左右。
  **`-full` 的下限大約就是 8**，除非把參考頁的側邊欄也對齊（那是資料，不是樣式）。

→ 建議：把 `-full` 系列標成「結構比對用，不追數字」，或改成只裁內容欄（不含側邊欄）。

### B. `02c-page-mid2` 24.4 / 19.0、`02d-page-bottom` 23.4 / 10.4

本輪把逐 block 的差量完了（見 `NOTES-round6.md` §根因一/二的表），
剩下的差**不是盒模型**，而是：

1. **參考頁內容本身不同。** 並排圖上 Notion 在 1800px 處顯示「表格瀏覽 / 新資料庫 / 日曆」，
   kennote 顯示「行內樣式：粗體…／參考資料庫 / 表格」—— 兩邊文件到這裡已經是不同的 block。
2. **側邊欄清單不同**（同 §A）。

還沒量完的盒模型（`02b` 量到、沒改）：
* **標註（callout）高 Notion 66 / kennote 64**（差 2px，`05-12` 還有 `dx −2`）。

想繼續追的話：`colseg 02b-page-mid light 1150` 是最省事的入口 ——
那個 x 只會切到區塊底色與格線，逐段對照就能算出每一種 block 差幾 px。

### C. `07m-db-settings` 9.2 / 10.7：**`-6,+6` 同時頂到搜尋上限 ⇒ 又是原點問題**

（第五輪 §3-23 的徵兆。）本輪量到但沒改：

| | Notion | kennote |
|---|---|---|
| 面板上框線 | y13 | y12 ✓ |
| 標題「瀏覽模式設定」字身 | y34..44 | y30..41（**高 4px**）|
| 搜尋框上/下框線 | y64 / y91（高 28）| y62 / y91（高 **30**）|
| 第 1 列（版面配置）字身上緣 | **y108** | **y114**（低 6px）|
| 第 1 列圖示的 x | ≥ x40 | **x30**（左 6~10px）|

→ 兩條各自獨立的修法（都在 `ViewSettingsPanel.module.css`）：
* `.header` 的 padding-top 補 4px（標題往下 4）；
* 搜尋框 → 第 1 列之間少 6px（`.section` 的第一組 padding-top，或搜尋框的 margin-bottom）；
* `.row` 的 `padding-left: 14px` → **20px**（`dx −6` 的成因，第五輪只修了 padding-right）。

改完務必重拍，這三條會互相影響。

### D. `07g-db-gallery` dark 11.9（light 5.1）

殘留選單已經修掉（差異像素 5.5% → 4.2%），剩下的是**卡片本身**：

| | Notion | kennote |
|---|---|---|
| 卡片封面底（dark） | `rgb(45,45,45)` | `rgb(32,32,32)` |
| 封面高 | **146** | ~104 |
| 卡片內文區 | 39（底 `rgb(38,38,38)`）| — |
| 卡片框線 | `rgb(44,44,43)` | `rgb(56,56,54)`（表格已改，圖庫還沒）|
| 封面內容 | 純色佔位，**沒有圖示** | 中央一個文件 emoji |
| 卡片內文 | 只有標題 | 標題 ＋ 標籤 ＋ 日期 ＋ 數字（資料差）|

→ 先把 `GalleryView` 的框線換成 `rgb(44,44,43)`、封面底換 `rgb(45,45,45)`、封面高補到 146。

### E. `07m` 第 3 組短 37px ＝ **少一列**

並排圖數過了：Notion 第 3 組是 **3 列**（管理資料來源 / 鎖定資料庫 / **在日曆中管理**），
kennote 只有 **2 列**。不是盒模型問題，是 `ViewSettingsPanel.tsx` 少一個項目
（Notion 的那一列右邊是 `↗` 外開圖示，不是 `›`）。
**這是 `.tsx` 的功能改動**，本輪守著「只改 CSS / 樣式」的分工沒有動它。

### F. 其他沒碰的（從第三~五輪原樣搬過來）

* `05-01-paragraph` 5.2 / 5.5：已確認是**字身算繪差**，建議放寬目標或標註。
* `05-20-bookmark` 23：Notion 那張的縮圖是白的，**下限就是 23**。
* 公式不置中、目錄縮排 24px、標題 4 的 padding —— 都還沒對（NOTES-round2 §3）。
* `05-12-callout` 的 `dx −2` 與高度差 2px。
* `07l` 剩下的差是**資料差**（Notion 只有 4 個可排序屬性、kennote 有 7 個）。
* `03e-sidebar-bottom` 9.2 / 9.6（`+1,+6` 頂到上限 ⇒ 大概又是原點）。

---

## 3. 第六輪新踩到的坑（接在第二輪九條、第三輪四條、第四輪 14~19、第五輪 20~24 之後）

25. ⭐ **「開著的選單」也可能是 kennote 自己那一側。**
    第五輪 §3-20 只檢查了 N 側。本輪 `07g-db-gallery-dark` 的 **K 側**量到同樣的
    `rgb(37,37,37)` 面板 ＋ `rgb(48,48,48)` 反白 —— 是 kennote 的「檢視型別」選單沒關。
    成因：`selectView()` 點到一個**已經作用中**的 tab，kennote 會打開該檢視的設定選單，
    而 `page.mouse.move()` 關不掉（不是 hover 態）。
    → `selectView()` 後面一律 `dismissOverlays()`（按 Escape 直到沒有 `[role="menu"]`）。
    **拿到一張分數怪異的圖，先 `colseg` 看 K 側，不要只看 N 側。**

26. ⭐ **`global.css` 的 `:focus-visible { outline: 2px }` 會在自己畫框的元件外再加一圈。**
    連續三輪的「小外觀」清單裡有三條都是它（`07d` 選取格、`07k`/`07l` 搜尋框）。
    元件裡寫 `outline: none` **蓋不掉**：兩邊都是 0,1,0，global.css 載入順序在後。
    要寫 `.xxx:focus-visible { outline: none }`（0,2,0）才有用。

27. **「整頁捲動」類的圖（`02b/02c/02d`）不要看總分，要用 `colseg <code> <theme> <內容欄的 x>` 逐段讀。**
    選一個「只會切到底色與格線、不會切到文字」的 x（`02b` 用 1150 很準），
    輸出就是一串「block 高度 / block 間距」，跟 Notion 對照即可直接算出差幾 px。
    比 `rows` / `diff` 有用一個數量級。

28. **改了 block 高度之後，`02c/02d` 的分數會「隨機」變動，那不是退步。**
    它們是固定捲 1800px / 捲到底的整窗圖，內容一動、那一刀就切在不同的 block 上。
    要看的是 `05-*` 的逐 block 分數（本輪全部沒退）。

29. **程式碼區塊是「高亮層 + 文字層」兩層疊的。**
    改 `.kn-code-block` 的 `padding` 一定要同步改 `.kn-code-highlight` 的 `inset`
    與 `.kn-code-gutter` 的 `top`，不然上下兩層會錯開（看起來像重影）。

30. **`vite` 佔埠時會自己往上跳（5173 → 5174 → 5175）且不報錯。**
    `BASE_URL` 打到沒人的埠，playwright 只會拍到空白頁，分數全面惡化但測試照樣 pass。
    每次啟動都要看 vite 印出來的 `Local:` 網址。

---

## 4. 量到但還沒用上的數值（第六輪新量）

| 項目 | 實測 |
|---|---|
| Notion 程式碼區塊 | 行高 **21**、上下內距 **36 / 34**、左內距 **23**、圓角 10、3 行總高 **133** |
| Notion 簡單表格 | 列距 **35**（內容 34 ＋ 1px 格線）、字身高 **12**（≒ 14px 字級）、行高 **20** |
| Notion 標註（02b） | 高 **66**（kennote 64）；上一個分隔線 → 標註上緣 **14** |
| Notion「程式碼 → 表格」間距 | **24**（kennote 16） |
| Notion 深色資料庫格線 | **`rgb(44,44,43)`**（不是區塊框線的 `rgb(56,56,54)`）；深色列高 **37** |
| Notion 深色圖庫卡片 | 封面底 `rgb(45,45,45)` 高 **146**、內文區底 `rgb(38,38,38)` 高 **39**、框線 `rgb(44,44,43)` |
| `07m` 面板 | 上框線 y13、標題字身 y34..44、搜尋框 y64..91（高 28）、第 1 列字身上緣 y108、列距 29 |
| `07m` 第 3 組 | Notion **3 列**（管理資料來源 / 鎖定資料庫 / 在日曆中管理），kennote 2 列 |
| `07c-db-row-hover` dark 參考 | 選單面板 `rgb(37,37,37)`、反白 `rgb(49,49,49)` y63..90（28px）→ 比不了 |

---

## 5. 驗收狀態（本輪結束時）

```
pnpm --filter @kennote/web typecheck     ✅
pnpm --filter @kennote/web test          ✅ 14 files / 298 tests
pnpm --filter @kennote/web build         ✅ built in 5.24s
```

沒有 git commit（依指示）。

---

## 6. 本輪改動的檔案

**新增**

```
reference/shots/compare/NOTES-round6.md      ← 第六輪紀錄（README 會自動接上）
reference/shots/compare/HANDOFF-round6.md    ← 這一份
```

**修改**

```
apps/web/src/styles/editor.css                                  ← 程式碼區塊行高/內距、簡單表格字級/行高、.kn-table-wrap padding-top
apps/web/src/features/database/views/table/TableView.module.css ← 深色 --kn-db-line rgb(44,44,43)、.cellActive:focus-visible
apps/web/src/features/database/Builders.module.css              ← .pickerSearch:focus-visible
e2e/compare.spec.ts                                             ← dismissOverlays()、07d 拍照前移開滑鼠、07c dark 併入「比不了」
```

**沒有動**：`packages/editor-core`、`packages/ui/src/{components,dnd,overlay,positioning}`、
任何 runtime 依賴、後端程式碼、任何 `.tsx` 邏輯檔。
