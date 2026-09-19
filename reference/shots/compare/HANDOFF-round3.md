# 第三輪視覺 QA — 交接筆記

> 寫給接手的代理。**先讀** `reference/shots/compare/README.md`（數字）與
> `NOTES-round3.md`（本輪改了什麼、為什麼）、`NOTES-round2.md`（Notion block 盒模型的全套實測值）。
> `HANDOFF-round2.md` 的「陷阱」那一節仍然有效，**照樣會踩**，先看一遍。
> 這一份只寫「還沒做完的事」「量到但還沒用上的數值」「第三輪新踩到的坑」。

---

## 0. 怎麼跑

```bash
cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 node node_modules/vite/bin/vite.js --port 5173 &
cd e2e
BASE_URL=http://localhost:5173 npx playwright test compare --grep "建立參考頁"
BASE_URL=http://localhost:5173 npx playwright test compare --grep "拍照"      # light + dark，約 1.7 分
BASE_URL=http://localhost:5173 npx playwright test compare --grep "並排"      # 產並排圖 + README
```

⚠️ 要乾淨的一輪：先 `rm -f reference/shots/kennote/_fresh.json` 再兩個主題都拍
（`_fresh.json` 是累加的，只拍一個主題另一欄會沿用舊檔）。

### 量測工具（**這一輪已經進 repo**）

`reference/tools/measure.mjs` —— 純 `node:zlib`，跟 `e2e/fixtures/png.ts` 同一套 decoder。

```bash
cd reference/tools
node measure.mjs rows   07m-db-settings light [x0 x1]  # 逐列有內容的橫向區段（找垂直位移）
node measure.mjs cols   07m-db-settings light [y0 y1]  # 逐行（找水平位移 / 欄寬）
node measure.mjs diff   07m-db-settings light          # 逐列/逐行的差異像素數（差在哪一條線）
node measure.mjs row    07m-db-settings light 200      # 把一列壓成顏色區段（量框線最準）
node measure.mjs colseg 07m-db-settings light 160      # 把一行壓成顏色區段（量面板上下緣最準）
node measure.mjs ascii / col / px                      # ASCII 圖 / 單行 RGB / 單點 RGB
```

`rows` / `cols` 的背景色是取左上角像素，**浮層那種「白底白面板」的圖會失效**，用 `row` / `colseg`。

---

## 1. 本輪完成

| 任務 | 狀態 |
|---|---|
| 1. 修裁切原點（`07m` / `06-slash-menu` / `05-06` 的 `padY`） | ✅ 見 NOTES-round3 §根因二 |
| 2. `07n` tab 列溢出收成「還有 N 個…」 | 🟡 收合做好了（且 `07e`~`07i` 仍拍得到），但 `07n` 數字沒降（見 A） |
| 3. `07k/07l/07m` 浮層（292 寬、`flush`） | 🟡 左右對齊了、`07m` 15.4→10.5，但列高/分段仍有差（見 B） |
| 4. `07i-db-timeline` | ✅ **首次有數字**：light 5.0 / dark 5.4（`-full` 9.7 / 8.1） |
| 5. `07d` / `07c` | ❌ 沒碰（13.5 / 9.4 原地） |
| 6. 深色全套 | ❌ 沒碰（只有跟著 light 一起改善的部分） |
| 7. `02b/02c/02d` 整頁捲動 | ❌ 沒碰 |
| 8. NOTES / HANDOFF | ✅ |

⭐ 本輪最大的一件事不是 CSS：**`07e`/`07f`/`07g`/`07h` 之前比的是同一張表格視圖**
（tab 沒有 `role="tab"`，spec 的 `getByRole('tab')` 永遠抓不到，找不到就不點照樣拍）。
補上 role 之後這八張才第一次是真的。**看 README 的數字前請先確認那張圖真的拍到東西。**

---

## 2. 待辦（依 CP 值排序）

### A. `07n-db-view-tabs` 12.6 / 14.6，位移 `+6,+6` 仍頂到上限

已做：溢出收成「還有 N 個…」。**沒做完的**：

* kennote 露 5 顆 tab，Notion 露 **4 顆**（`還有 3 個…`；kennote 是「還有 2 個…」）。
  `DatabaseHeader.tsx` 的 `measure()` 目前替「還有 N 個…」保留 **92px**、替 `＋` 保留 28px，
  調這兩個常數就能對齊；更準的做法是照 Notion 量 tab 列可用寬。
* **Notion 的 tab 列沒有 `＋`**（那顆在「還有…」的下拉裡）。kennote 還露在外面，整列右移 ~28px。
* 檢視名稱：Notion 是「列表」，kennote 是「清單」（`e2e/fixtures/reference-page.ts` 建的名字）。
* 標題：Notion 是淺灰 placeholder「新資料庫」（那個 collection 沒命名），
  kennote 是實名「參考資料庫」且字級更大 —— 這是 `+6,+6` 的主要來源之一。
  裁切是 `x: box.x - 48, y: box.y - 26`（寫死），**還沒有用 measure.mjs 量過**，
  先量 Notion 的 tab 列上緣在裁切裡的 y，再回推 padY。

### B. `07m-db-settings` 10.5 / 12.2（-6,-6）—— 剩下的是**面板上半部高度**

實測（`node measure.mjs colseg 07m-db-settings light 160`）：

| | Notion | kennote |
|---|---|---|
| 面板上緣 | y13 | y12 ✓ |
| 第一條分隔線 | **y63** | y51 |
| 填色列（名稱欄）| y64..91（高 **28**）| y52..77（高 26）|
| 第二條分隔線 | y92 | y78 |

→ kennote 面板上緣到第一條分隔線 **39px**，Notion 是 **50px**（少 11px）；名稱列少 2px。
`ViewSettingsPanel.module.css` 的 `.header { height: 34px }` / `.nameRow { height: 32px; margin: 2px 12px 8px }`
要重新配到 50 / 28。之後整個面板往下的每一列都會跟著對齊，`-6,-6` 應該就會消失。

### C. `07l-db-sort` 10.8（-6,+0）

`07k` 用同樣的 padX 是「對齊」，`07l` 卻水平差 ≥6 —— 參考圖只有 199px 高，
兩邊內容段落不同（Notion 那張已經有一條排序條件？）。**先打開 `compare/07l-db-sort-light.png` 看一眼**再決定要不要調。

### D. `07d`（13.5 / 15.3）、`07c`（9.4 / 14.2）、`07b`（13.3 / 17.9）

完全沒碰。`07b` 的 dark 17.9 是 07 系列最高的，值得先看。

### E. 深色專項

README 中 dark > 8 的：`02-page-top` 20.6（比不了）、`02c` 21.3、`03e` 9.6、
`05-13-code` 6.3（14.9% 差異像素、位移 -1,-6）、`05-14-table` 7.6（16.3%）、
`07-db-table` 11.7、`07b` 17.9、`07c` 14.2、`07d` 15.3、`07e-full` 11.6、
`07g` 12.4、`07g-full` 11.7、`07k` 11.3、`07l` 12.5、`07m` 12.2、`07n` 14.6。
用 `tokens.json` / `_extra-dark.json` 的實測色，不要自己調 alpha。

### F. `02b`（6.4 / 7.9）、`02c`（22.7 / 21.3）、`02d`（23.1 / 10.5）

第二輪的盒模型修正讓 `02b` 從 6.6 降到 6.4 就停住了。
用 `node measure.mjs rows 02c-page-mid2 light` 逐段對照，找出是哪一個 block 開始錯開。

### G. 仍未修的後端缺陷（第一輪就列了）

`apps/server/src/modules/databases/repo.ts` 的 `queryRows` / `countRows` /
`queryGroupedRows` / `queryAggregations` 要補 `AND p.is_database = FALSE`。
**注意**：任務說明說遠端已經部署了這個修正，但 `07e-db-board` 的截圖裡
看板第一欄仍是「無選取 4」＋ 卡片，**請自己再確認一次**（拍一張 `07-db-table-full` 數列數）。

### H. 其他沒碰的

* `06-slash-menu-full` 25.6（light）—— dark 只有 12.1，差在 light 的整頁內容。
* `05-01-paragraph` 5.2 / 5.5：第二輪已確認是**字身算繪差**，建議放寬目標或標註。
* `05-20-bookmark` 23：Notion 那張的縮圖是白的（抓不到 og:image），**下限就是 23**。
* `05-19-subpage` / `07o-db-row-peek` / `02-page-top` / `04d`：來源不同，比不了。
* `05-14-table` 的內層 `padding-top: 8px; padding-bottom: 24px` 還沒補（見 NOTES-round2 §3）。
* 公式不置中、目錄縮排 24px、標題 4 的 padding —— 都還沒對（見 NOTES-round2 §3）。

---

## 3. 量到但還沒用上的數值（第三輪新量）

| 項目 | 實測 |
|---|---|
| `06-slash-menu` Notion 面板 | 左框線 **x13**、上緣 **y13**、下緣 y374（高 **362**）；右緣**超出裁切**（裁切只有 337 寬）—— 第二輪筆記寫的「面板寬 292」對斜線選單是錯的，292 是篩選/排序/設定那三張 |
| `06-slash-menu` kennote 面板 | 左框線 x23、上緣 y32、下緣 y398（高 **367**，比 Notion 高 5） |
| 斜線選單群組分隔線 | Notion 距面板上緣 **+174**、kennote **+166**；底部「關閉選單 esc」的分隔線 Notion **+319**、kennote **+331** |
| 斜線選單列高 | Notion **32**（hover 底 `rgb(244,243,243)`、y47..78）、kennote **33**（底 `rgb(240,239,237)`）⚠ 底色還沒改 |
| 斜線選單捲軸 | Notion 的 thumb 在 x326..334（寬 9、`rgb(211,209,203)`） |
| `07k`/`07l` Notion 面板 | x13..304（寬 **292**）、上緣 **y17**；搜尋框上下各 2px 藍框 `rgb(35,131,226)`、內底 `rgb(249,248,247)`（y29..58）；屬性列 hover 底 `rgb(244,243,243)`（y70..97，高 **28**） |
| `07m` Notion 面板 | x13..304、上緣 **y13**；第一條分隔線 y63、填色列 y64..91（高 28）、第二條 y92 |
| 參考圖尺寸 | `07k` 318×236、`07l` 318×199、`07m` 315×624（**624 > 900-276，會觸發 clip clamp**） |
| `05-06-todo-checked` | Notion 文字 y21..36、kennote（未補 dy 前）y23..38 → 已用 `dy: 2` 修掉 |

---

## 4. 第三輪新踩到的坑（加在第二輪那九條之後）

10. **`getByRole('tab')` 需要真的有 `role="tab"`。**
    `<nav>` 裡的 `<button>` 是 `role="button"`。spec 裡「找不到就不點、但照樣拍」的寫法
    會**靜默產生假數字**。任何「切到某個狀態再拍」的截圖，都要讓找不到時**大聲警告**
    （`compare.spec.ts` 的 `selectView()` 現在回傳 boolean，失敗會 `console.warn`）。

11. **`clip()` 的 y clamp 會吃掉高參考圖。**（第二輪陷阱 #4 的續集）
    `07m` 的參考圖 624 高 → y 被夾到 276。**判斷方法**：
    如果某張圖的位移一直是 `-6,-6` 或 `+6,+6` 而且調 padY 完全沒反應，就是被 clamp 了。
    修法：拍之前把錨點 `scrollIntoView({ block: 'start' })`。

12. **`padding` + `overflow: auto` 會裁掉子元件的負外距。**
    `_fallback/Popover` 就是這樣讓「292 寬」的面板變成 284。
    要滿版內容就用新加的 `flush` prop，不要再用 `margin: -8px`。

13. **tab 溢出收合會自己震盪。**
    `.tabs` 沒有 `flex: 1 1 auto` 的話，收合 → nav 變窄 → 量到更窄 → 收更多，
    一路收到只剩 1 顆。量寬度用的是 `.tabsGhost`（`position: absolute; visibility: hidden`）
    裡的完整 tab 清單，不是真正畫出來的那幾顆。

---

## 5. 驗收狀態（本輪結束時）

```
pnpm --filter @kennote/web typecheck     ✅
pnpm --filter @kennote/web test          ✅ 14 files / 298 tests
pnpm --filter @kennote/web build         ✅ built in 4.54s
pnpm --filter @kennote/server typecheck  ✅
pnpm --filter @kennote/server test       ✅
```

沒有 git commit（依指示）。

---

## 6. 本輪改動的檔案

**新增**

```
reference/tools/measure.mjs                       ← 量測工具（進 repo 了）
reference/shots/compare/NOTES-round3.md           ← 第三輪紀錄（README 會自動接上）
reference/shots/compare/HANDOFF-round3.md         ← 這一份
```

**修改**

```
apps/web/src/features/database/DatabaseHeader.tsx          ← role=tablist/tab、tab 溢出收合、flush
apps/web/src/features/database/DatabaseHeader.module.css   ← .tabs flex、.tabsGhost、.tabMore、.tabMoreList
apps/web/src/features/database/_fallback/Popover.tsx       ← flush prop
apps/web/src/features/database/_fallback/fallback.module.css ← .popoverFlush
apps/web/src/features/database/Builders.module.css         ← .picker 拿掉 margin:-8px
apps/web/src/features/database/ViewSettingsPanel.module.css← .panel 拿掉 margin:-8px
e2e/compare.spec.ts                                        ← selectView()、clipBlock 的 dy、
                                                              06/07k/07l/07m 裁切原點、07m 捲到上緣
```
