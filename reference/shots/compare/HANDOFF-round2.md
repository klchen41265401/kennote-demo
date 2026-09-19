# 第二輪視覺 QA — 交接筆記

> 寫給接手的代理。**先讀** `reference/shots/compare/README.md`（數字）與
> `reference/shots/compare/NOTES-round2.md`（本輪改了什麼、為什麼）。
> 這一份只寫「還沒做完的事」「量到但還沒用上的數值」「會踩到的坑」。

---

## 0. 怎麼跑（環境）

```bash
# 1) 本機 dev server，/api 代理到遠端後端
cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 node node_modules/vite/bin/vite.js --port 5173 &

# 2) 建參考頁（冪等）→ 拍照 → 並排 + README
cd e2e
BASE_URL=http://localhost:5173 npx playwright test compare                       # 全部（約 2 分鐘）
BASE_URL=http://localhost:5173 npx playwright test compare --grep "建立參考頁"
BASE_URL=http://localhost:5173 npx playwright test compare --grep "拍照（light）"
BASE_URL=http://localhost:5173 npx playwright test compare --grep "並排"
```

⚠️ **PowerShell 下 `--grep "拍照|並排"` 會被當成 pipeline**，要用 Bash 工具跑，
或把 grep 字串改成不含 `|` 的單一樣式。

⚠️ 遠端 `100.74.148.92:8090` 偶爾會重啟（本輪一開始 connection refused，兩分鐘後才起來）。
`curl` 在沙箱裡連不出去，用 `Invoke-WebRequest` 或直接跑 playwright 試。

### 量測用的小工具（這一輪寫的，放在 scratchpad，沒有進 repo）

我用純 JS（`node:zlib`，跟 `e2e/fixtures/png.ts` 同一套 decoder）寫了幾支腳本量像素：

* `prof.mjs <code> <theme>` — 印 notion / kennote 各自「有內容的橫向區段」（找垂直位移最好用）
* `prof2.mjs <code> <theme> <x0> <x1>` — 兩邊逐段對照 + dy
* `prof3.mjs <code> <theme>` — 逐列 / 逐行的**差異**像素數（找差在哪一條線）
* `rowdump.mjs <code> <theme> <y1,y2,...> <maxX>` — 把一列畫成 ASCII（`#` 深 `-` 中 `.` 白）
* `rowfind.mjs <code> <theme> <y>` — 把一列壓成顏色區段（量框線 / 欄寬最準）
* `cdump.mjs <code> <theme> col <x> <y0> <y1>` — 印某一行的 RGB（量邊界、底色）
* `inspect.mjs <theme> <fn.js>` — 開瀏覽器登入 → 開參考頁 → `page.evaluate(fn)`，
  用來 dump 實際 DOM 的 rect / computed style

**建議重寫一份放進 repo**（例如 `reference/tools/measure.mjs`），下一輪會一直用到。
Windows 上要注意：node ESM 不吃 `E:/中文路徑` 的 import，要用 `createRequire` 取 playwright。

---

## 1. 已完成

| 任務 | 狀態 |
|---|---|
| 1. 垂直 +6px 偏移（`05-09` / `05-17` / `05-18`） | ✅ 找到根因（空的 `.kn-block-main` 吃到 8px 上下內距），順手把**整套 block 盒模型**換成 `dom/*.html` 的實測值 |
| 2a. `05-10-quote` | ✅ 但**任務描述的「偏左 ≥6px」與實測不符**：粗線與文字的 x 只差 1px，真正的問題是粗線高 30 而不是 24（block 8/8 在粗線之外）。已修，5.1 → 2.0 |
| 2b. `05-12` / `05-13` 深色底色 | ✅ 已經用 `_extra-dark.json` 的實測色（`rgb(56,56,54)` / `rgba(252,252,252,.03)`），沒有 alpha 疊算。本輪修的是**幾何**（標註框高 64、內距欄位），dark 10.3 → 5.2 / 11.4 → 6.3 |
| 2c. `05-20-bookmark` 卡片高度 | ✅ 實測是 **156**（不是任務說的 165）：`07i` 那張量到卡片 y22..177。已改 156 + 圓角 10 + Notion 的 flex 比例 |
| 2d. `05-21-image` 裁切 | ✅ 真正的原因不是 `aspectRatio`，是**「新增說明文字」按鈕即使 `opacity:0` 也佔 25px + 8px gap**，讓 block 高了 33px。21.5 → **2.6**（已對齊，不需要 object-fit） |
| 3a. `07d` 儲存格選取態 | ✅ CSS 早就有（2px `--kn-color-accent` + 右下角小方塊），是 **`mousedown` 收不到**。17.6 → 13.5 |
| 3b. `07k` / `07l` 浮層版面 | ✅ 改成 Notion 的兩段式（搜尋框 + 屬性清單 + 底部動作列）。15.0 → 10.5 / 14.8 → 11.3 |
| 3c. `07m` 設定浮層 | 🟡 已重做成「瀏覽模式設定」整張面板，dark 20.3 → 15.7，**但 light 11.1 → 15.4 變差**（見待辦） |
| 3d. `07n` 工具列補三顆 | ✅ ⚡ 自動化（佔位選單）、✨ AI（佔位選單）、⤢ 展開（內嵌時跳整頁）。tab 版面仍有差（見待辦） |
| 4. Timeline 視圖 | 🟡 **程式全部寫完**（前端 + 型別 + migration + slash + compare），但**跑不到數字**：遠端後端還沒部署，建視圖會回 400 |
| 5. 斜線選單提示文字 | 🟡 `HTML · 嵌入區塊` 已補。「即將推出」維持在 AI + 佔位視圖（見待辦的爭議點） |
| 6. dark 全套 | ✅ 跟 light 同一套修正，dark 大幅改善（`06-slash-menu-full` 47.6 → 12.1、`05-21` 22.4 → 2.7） |
| 7. README 寫回 | ✅ 第一輪紀錄保留，第二輪寫在 `NOTES-round2.md`（spec 會自動接到 README 尾巴） |

跑了 **4 輪迭代**（每輪 = 改 CSS/程式 → 重拍 → 看數字）。

---

## 2. 進行中 / 沒做完（下一輪的待辦，依 CP 值排序）

### A. `07m-db-settings` light 反而變差（11.1 → 15.4，位移仍是 -6,-6 = 被 ±6 的搜尋上限夾住）

* 做到哪：面板結構、列高 29、三段分隔都照 `07m-db-settings-light.png` 量好了
  （標題 y34..44、名稱列 y71..84，之後每列間距 29：108 / 137 / 166 / 194 / 223 / 252 / 281；
  第二段標籤 y332..342，列 361 / 390 / 418 / 448 / 477；第三段 524 / 553 / 582）。
* 卡在哪：**裁切原點**。Notion 的裁切把浮層外的陰影也框進去，面板左上角落在 **(13, 13)**；
  我把 `compare.spec.ts` 的 padX/padY 調成 (17, 17) 之後 `07k`/`07l` 對齊了，
  但 `07m` 還是 -6,-6 → 表示 kennote 的面板比 Notion 再低 / 再右一些，或高度不同造成 popover 往上翻。
* 下一步：用 `cdump.mjs 07m-db-settings light col 160 0 40` 把 Notion 面板的上緣找精確，
  再用 `inspect.mjs` dump kennote popover 的 `getBoundingClientRect()`，兩邊相減直接得到 padX/padY。
  （`_fallback/Popover` 有 8px 內距，我在 `.panel` / `.picker` 用 `margin: -8px` 抵銷 ——
  若之後 `packages/ui` 的 Popover 換掉，記得把這個 hack 一起拿掉。）

### B. `07n-db-view-tabs`（12.5 / 14.6，位移 +6,+6 頂到上限）

* Notion 的 tab 列**超過寬度會收成「還有 N 個…」下拉**（UI-SPEC §8.1），
  截圖裡只顯示 3 個 tab；kennote 顯示全部 5 個 + `＋`。
* ⚠️ **不要直接砍成 3 個**：`compare.spec.ts` 靠 `getByRole('tab', {name:/^日曆$/})` 點 tab 才能拍
  `07e`/`07f`/`07g`/`07h`，tab 被收起來這四張就拍不到了。
  要嘛做成「溢出才收」並在 spec 裡先展開下拉，要嘛先不做。
* 另外 Notion 的 inline 資料庫標題是**淺灰 placeholder「新資料庫」**（那個 collection 沒命名），
  kennote 是實名「參考資料庫」且字級更大 —— 先量 `07n` 的標題字高再決定要不要調。

### C. `06-slash-menu`（8.9 / 9.9，位移 +6,+6 頂到上限）

* 裁切原點也不對。實測 Notion 的浮層在那張裁切裡是 **x13..304（面板寬 292）、面板上緣 y≈29**，
  而 `compare.spec.ts` 目前寫死 `(24, 33)`（第一輪留下的註解）。
* kennote 的浮層上緣在裁切裡是 y32、左緣 x23。
* 下一步：把 `06-slash-menu` 的裁切改成 `x: box.x - 13, y: box.y - 29`（或實測值），再看剩多少。
* 另外 kennote 的選單比 Notion **高約 14px**：Notion 面板 353px（含底部「關閉選單 esc」），
  kennote 367px。`.kn-slash-scroll` 是 `max-height: 330px` + `padding: 8px 0`，
  `.kn-popover--slash .kn-menu-group-title` 是 `padding: 6px 16px 4px` ——
  Notion 的群組標題到第一列的距離比我們短約 7px。

### D. `05-06-todo-checked` 退步（2.0 → 4.7，位移 +0,+2）

* `05-05`（未勾選，同一組 CSS）是 **2.6 且對齊**，所以不是待辦的盒模型錯。
* 實測：Notion 文字在 y21..36、kennote 在 y23..38，整整差 2px；
  但兩張都是同一個 35px 的 block、同一個裁切規則。懷疑是**上下相鄰 block 不同**造成 bbox 中心差。
* 下一步：`prof.mjs 05-06-todo-checked light` 看上下鄰居，必要時在 `BLOCKS` 給它一個 `padY`。

### E. `05-01-paragraph` 卡在 5.2 / 5.5（目標 ≤5）

* `prof3.mjs` 顯示差異**全部集中在字身**（每列 ~300px 不同），不是版面位移。
  兩邊字級 / 行高 / 左緣都已經對齊（文字都落在裁切的 x22、y26..43）。
* 這是**字體 hinting / 次像素算繪**的差（Notion 是 Electron 自己的渲染設定）。
  要再往下壓得調 `-webkit-font-smoothing` / `text-rendering`，投資報酬率低。
  **建議把 `05-01` 的目標放寬到 ≤6，或在 README 標註為「字身差」。**

### F. `05-20-bookmark` 卡在 23（結構已對齊）

* **Notion 那張參考圖的縮圖是白的**（書籤沒抓到 og:image），kennote 抓得到真圖。
  逐像素看：Notion 在 y25 那一列從 x26 到 x721 全是 255,255,255。
* 所以 23 這個數字的下限就是「一塊 ~212×154 的彩色圖 vs 白色」。
  要嘛把它列進「比不了的」，要嘛讓 seed 的書籤指向一個沒有縮圖的 URL。

### G. 尚未開始

* `02-page-top` / `04d-page-cover-icon`：封面圖來源不同（第一輪已列為比不了）。
  但**封面高度 270 / icon 位置 / 標題字級**還沒逐項量過。
* `02d-page-bottom`（23.1）、`03e-sidebar-bottom`（9.2）、`04b-topbar-right`（7.3~8.3）沒碰過。
* `07b-db-header-hover`（13.3 / 17.8）、`07*-full`（14~19）沒碰過。
* `07o-db-row-peek` light 88.1 —— 兩邊頁面內容不同，第一輪已列為比不了。
* `07j-db-proptype-menu`：kennote 的型別選單沒有「整合」那一組，入口也不同。未納入比對。
* 第一輪紀錄的**後端缺陷「資料庫把自己的載體頁當成一列」仍未修**
  （`apps/server/src/modules/databases/repo.ts` 的 `queryRows` / `countRows` /
  `queryGroupedRows` / `queryAggregations` 要補 `AND p.is_database = FALSE`）。
  這會讓所有 `07-*` 多一列 / 多一張卡，是**現在 07 系列數字下不去的共同底噪**。
  修了要重新部署後端才看得到。

---

## 3. 量到但還沒用上的數值

### Notion 的 block 盒模型（`dom/*.html` 的 inline style，本輪已用）

見 `NOTES-round2.md` 的表。額外沒用上的：

* **標題 4**：kennote 有 `heading4`，但 Notion 的 `dom/` 沒抓到那一支，padding 還沒對過。
* **簡易表格**：`dom/17-simple-table.html` 外層 `padding: 8px`，
  內層另有 `padding-top: 8px; padding-bottom: 24px`，`notion-table-content` 左右各 `215.5px`。
  kennote 現在只有外層 8px，內層的 8/24 還沒補（`05-14` 卡在 4.6 / 7.6）。
* **公式**：`dom/18-equation.html` 內層 `padding: 4px 8px`（已套），
  但 Notion 的公式**不是置中**的（`flex-direction: column`），kennote 是 `text-align: center`。
  實測 Notion 的式子在 x320..393、kennote 在 x338..402。
* **目錄**：Notion 每層縮排 24px（`[data-level='2']` 目前是 26、`3` 是 50），還沒校正。

### 顏色（`_extra-*.json` 實測，本輪已用）

| 項目 | light | dark |
|---|---|---|
| 標註底 | `rgb(249,248,247)` | `rgb(56,56,54)` |
| 程式碼底 | `rgba(66,35,3,.03)` | `rgba(252,252,252,.03)` |
| 引言粗線 | `rgb(44,44,43)` | `rgb(240,239,237)` |
| 分隔線 | `rgba(28,19,1,.11)` | `rgba(255,255,235,.1)` |
| 表格 / 書籤框線 | `rgb(230,229,227)` | `rgb(56,56,54)` |

### 浮層（本輪新量，只用了一部分）

| 項目 | 實測 |
|---|---|
| 斜線選單面板底色 | light `#fff`、dark **`rgb(37,37,37)`**（kennote 已一致） |
| 斜線選單 hover / active 列底 | light **`rgb(244,243,243)`**（kennote 是 `rgb(240,239,237)`，**還沒改**）、dark `rgb(49,49,49)`（kennote 48,48,48） |
| 斜線選單面板寬 | **292px**（`x13..304`）；kennote `.kn-popover--slash` 是 330px ⚠ **還沒改** |
| 篩選 / 排序浮層 | 面板 `x13..304`（寬 292），上緣 y17；搜尋框 y29..58（高 30、底 `rgb(249,248,247)`、2px 藍框 `rgb(35,131,226)`）；屬性列高 **28**（y70 / 98 / 126 / 154）；分隔線 y189；底部動作列 y190..225（高 36） |
| 設定面板 | 面板 `x13..304`，上緣 **y13**；列高 **29** |
| `tokens.json` 的陰影 | `--c-shaOutMd` = `0px 8px 12px 0 rgba(25,25,25,.027), 0px 2px 6px 0 rgba(25,25,25,.027), 0 0 0 1px rgba(42,28,0,.07)`；`--c-popBac` = `#fff`（**只有 light 一套**，dark 要自己從 PNG 取色） |

### 內容欄

* Notion 文字欄 **704px**（`05-11` 的實心 bar 在裁切的 x22..725）。
* Notion 的 block 外框 = 文字欄 **+16**（左右各 8 的 `padding-inline`）。
* kennote：`--kn-size-content-width: 724px` → `.kn-editor-host` 減 `2×8` → block 708 →
  `.kn-block-main` 減 `2×2` → 文字欄 **704** ✓。
  ⚠️ 如果要讓 block 外框也等於 720，得同時改 `clipBlock` 的 `padX`（目前預設 20）。

---

## 4. 陷阱（踩過的，不要再踩一次）

1. **`preventDefault()` 的 pointerdown 會吃掉 mousedown。**
   編輯器裡任何 React block 的 `onMouseDown` 都收不到。一律用 `onPointerDown`。
   （`features/database/_fallback/Dialog.tsx` 還在用 `onMouseDown`，還沒踩到但遲早會。）

2. **想在 editor-core 之前/之後插手事件，只能用 bubble 階段。**
   `capture + queueMicrotask` 沒用（microtask checkpoint 在每個監聽器之間就排空）；
   `stopPropagation()` 會連 React 自己的合成事件一起殺掉（React 18 掛在 root container）。

3. **相鄰 block 的上下 margin 會 collapse。**
   block 的上下留白一律寫在**父層 `.kn-block--*` 的 padding**，不要用 margin。

4. **`clip()` 會把 x/y 夾在 `[0, 1440-w]` / `[0, 900-h]`。**
   浮層太靠下就會拍到完全不同的地方，而且數字看起來「還好」——
   `06-slash-menu` 第一輪的 13.8 就是這樣來的假數字。改動浮層相關的截圖後**一定要打開圖看一眼**。

5. **`diffStats` 的 `bestShift` 只搜 ±6。**
   看到 `+6,+6` / `-6,-6` 要當成「至少 6，可能更多」，不能當成「差 6」。
   要精確值就自己把 search 開大或用 `prof.mjs` 量。

6. **`_fresh.json`**：README 只列「這一輪真的重拍過的」。
   只跑 `--grep 拍照（light）` 再跑 `並排`，dark 那一欄會沿用上次的檔案（不會消失，因為 `_fresh.json` 是累加的）。
   要乾淨的一輪就兩個主題都拍。

7. **CSS module 的 class 名在 dev 是 `_cellWrap_<hash>_<n>`**，
   e2e 用 `[class*="cellWrap"]` 抓；改 class 名字會默默讓截圖抓不到東西（不會報錯）。

8. **改 `editor.css` 時注意 specificity。**
   `.kn-editor .kn-block-main`（0,2,0）會蓋掉單一 class（0,1,0）。
   第一輪就是這樣讓 callout 的圓角與 code 的內距全部失效；新規則記得帶 `.kn-editor` 前綴。

9. **Windows / PowerShell**：`--grep "a|b"` 會被當 pipeline；
   heredoc 裡有大量 `'` 時 Bash 工具偶爾會解析失敗（改用 Write 工具寫檔）。

---

## 5. 驗收狀態（本輪結束時）

```
pnpm --filter @kennote/web typecheck       ✅
pnpm --filter @kennote/web test            ✅ 14 files / 298 tests
pnpm --filter @kennote/web build           ✅ built in 4.66s
pnpm --filter @kennote/server test         ✅ 22 files / 348 tests（3 files / 24 tests skipped）
pnpm --filter @kennote/server typecheck    ✅
pnpm --filter @kennote/shared-types typecheck ✅
eslint apps/web/src                        ✅
```

沒有 git commit（依指示）。

---

## 6. 本輪改動的檔案

**新增**

```
apps/web/src/features/database/views/timeline/TimelineView.tsx
apps/web/src/features/database/views/timeline/TimelineView.module.css
apps/web/src/features/database/views/timeline/index.tsx
apps/web/src/features/database/PropertyPicker.tsx
apps/web/src/features/database/ViewSettingsPanel.tsx
apps/web/src/features/database/ViewSettingsPanel.module.css
apps/server/migrations/0060_timeline_view.sql
reference/shots/compare/NOTES-round2.md          ← 第二輪紀錄（README 會自動接上）
reference/shots/compare/HANDOFF-round2.md        ← 這一份
```

**修改**

```
apps/web/src/styles/editor.css                   ← 盒模型、引言、標註、分隔線、書籤、目錄、圖片說明
apps/web/src/styles/tokens.css                   ← --kn-size-content-width 720 → 724
apps/web/src/features/editor/Editor.tsx          ← React block 內不要整塊選取
apps/web/src/features/editor/menus/slashCommands.ts  ← groupLabel、db:timeline
apps/web/src/features/editor/menus/SlashMenu.tsx ← 行內來源分組
apps/web/src/features/editor/lib/slash-actions.ts    ← VIEW_LABELS 補 timeline
apps/web/src/features/editor/__tests__/slash.test.ts ← timeline 不再是佔位
apps/web/src/features/database/DatabaseHeader.tsx    ← ⚡/✨/⤢、設定面板
apps/web/src/features/database/DatabaseView.tsx      ← onExpand
apps/web/src/features/database/FilterBuilder.tsx     ← 兩段式
apps/web/src/features/database/SortBuilder.tsx       ← 兩段式
apps/web/src/features/database/Builders.module.css   ← PropertyPicker 樣式
apps/web/src/features/database/views/table/TableView.tsx  ← pointerdown
apps/web/src/features/database/views/index.ts        ← 註冊 timeline
apps/web/src/features/database/views/types.ts        ← （無變更，僅確認）
apps/web/src/features/database/_fallback/icons.tsx   ← timeline / bolt / sparkle / settings
apps/web/src/features/database/fields/_shared/ops.ts ← dateEndOf
apps/web/src/features/database/__tests__/registry.test.ts ← 六種視圖
packages/shared-types/src/database.ts            ← VIEW_TYPES / ViewFormat / TIMELINE_*
e2e/compare.spec.ts                              ← 斜線裁切、07k/l/m 裁切、07i、NOTES-*.md
e2e/fixtures/reference-page.ts                   ← 建 timeline 視圖（容錯）
```
