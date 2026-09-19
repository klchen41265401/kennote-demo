# 第八輪視覺 QA — 交接筆記

> 寫給接手的代理。**先讀** `README.md`（數字）、`NOTES-round8.md`（本輪改了什麼、為什麼）、
> `NOTES-round2.md`（Notion block 盒模型的全套實測值）。
> 坑清單是累積的：`HANDOFF-round2.md §陷阱`（1~9）、`round3 §4`（10~13）、`round4 §4`（14~19）、
> `round5 §3`（20~24）、`round6 §3`（25~30）、`round7 §3`（31~34）。本輪新增 **35~39**。
> 這一份只寫「還沒做完的」「量到還沒用上的數值」「第八輪新踩到的坑」。

---

## 0. 怎麼跑

```bash
cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 \
  node node_modules/vite/bin/vite.js --port 5176 --strictPort &
# ⚠️ 一定要 --strictPort ＋ 自己挑一個沒人用的埠（第八輪用 5176）。
#    不加 strictPort 時 vite 會自己跳號，而且同時有別的代理開著 dev server 時
#    每個埠都回 200、HTML 還完全一樣（同一份 repo），光 curl 分不出來。
#    收尾只關自己那個埠的 process，**絕不要用 `--port 5173` 之類的字串去 kill**。
cd e2e
rm -f ../reference/shots/kennote/_fresh.json                                  # 要乾淨的一輪
BASE_URL=http://localhost:5176 npx playwright test compare --grep "建立參考頁"  # 6s
BASE_URL=http://localhost:5176 npx playwright test compare --grep "拍照"        # light+dark，1.7 分
BASE_URL=http://localhost:5176 npx playwright test compare --grep "並排"        # 並排圖 + README，27s
```

量測工具 `reference/tools/measure.mjs`（`rows`/`cols`/`diff`/`row`/`colseg`/`ascii`/`col`/`px`）。

---

## 1. 本輪完成

| 第七輪交接的題目 | 狀態 |
|---|---|
| A. `07-db-table` dark / `07c` light「表頭帶高度差 23px」| ✅ 做了，但**整個診斷被推翻**（見 `NOTES-round8` 根因一）。表頭列高兩邊本來就都是 32＋1，真正差的是 tab 列的 1px 假框線 ＋ 2px 內距 ＋ 3px 裁切原點 |
| B. `06-slash-menu-full` | ✅ 選「列入比不了」，已寫進 KNOWN_GAPS |
| `05-14-table` dark 15.4% | ✅ **15.4% → 2.9%**，6.9 → **3.0** |
| `07c` 掛四輪的 9.2 | ✅ → **6.1**（Notion 那張 hover 的是第二列） |
| C. `07e-full` / `07g-full` | ❌ 只起了個頭，見 §2-C（**不是封面高度**） |

---

## 2. 待辦（依 CP 值排序）

### A. ⭐ kennote 的表格多一欄 32px 的「列把手欄」，Notion 的把手在表格外面

這是資料庫組現在最大的一塊，`07` / `07b` / `07c` / `07d` / `07-full` 的 **dx `+4`~`+5` 全部來自這裡**。

`row 07-db-table light 151`（第一條資料列）：

| | Notion | kennote |
|---|---|---|
| 表格左緣 | x48 | x50 |
| 第一條**直**格線 | **x327** | **x361** |
| 之後的欄寬 | 199 / 199 / 199 | 160 / 160 / 160 |
| 第一列的名稱文字左緣 | **x58** | **x95** |

`361 - 327 = 34 = 32（.rowGutter）＋ 2（表格左緣）`，文字也整整差 37。
**Notion 的 ⠿ 把手浮在表格左邊的頁面留白上，不佔欄寬**；
kennote 的 `.rowGutter { flex: 0 0 32px }` 是表格裡真的一欄，把整張表往右推 32px。

→ 入口：`TableView.module.css` 的 `.rowGutter` / `.rowHandle`（還有 `.newRow` 的
`padding-left: 32px` 要一起改）。
⚠️ `.grid` 有 `overflow-x: auto`，把手要往左溢出 32px 不能只靠 `position:absolute; left:-32px`
（會被裁掉／生出捲軸），得先確定 `.wrapper` 有多餘的左邊距可以放。
⚠️ 欄寬 160 vs 199 是**資料差**（Notion 那個資料庫的欄比較寬），把手拿掉之後
第一條直格線會對上 x327，後面三條仍然對不上 —— 那不是樣式問題。

### B. `07f-db-list` 自己還少 5px（本輪唯一退步的一張）

六個視圖共用 `padY`（本輪 13 → 16）。補完之後五張的 dy 都往 0 靠，
只有 `07f-db-list` 從 `+0` 變成 **`+5`**（light 5.0 → 5.2、dark 6.6 → 6.9）。
→ 代表清單視圖**內部**的上緣留白比 Notion 多 5px。
量法：`colseg 07f-db-list light 600`，比「膠囊下緣 → 第一列分隔線」。
**不要回頭去動共用的 `padY`**，那只會把另外五張弄壞（坑 32 的變形）。

### C. `07e-db-board-full` 11.7 / `07g-db-gallery-full` 12.4 —— **不是封面高度，是捲動位置**

第七輪交接猜「差的是頁面上緣的封面高度」。本輪 `colseg 07g-db-gallery-full light 800` 實測：

* Notion 那張在 x800 從 y93 起是 **tab 膠囊 ＋ 圖庫卡片**（`rgb(249,248,247)` 封面 145px ＋ 內文 39px），
  完全沒有封面照；
* kennote 那張在 x800 從 **y44 起就是一張照片**（封面圖）。

也就是兩張的**捲動位置根本不同**：`-full` 是 `centerBlock(db)` 之後直接整窗截圖，
kennote 的頁面比較短 → 捲不下去 → 封面還留在畫面上。
→ 要嘛 `-full` 改成「以資料庫上緣對齊」而不是整窗，要嘛列入比不了。
**先確認捲動位置再談封面高度**，不要重蹈第七輪 §2-C 的猜測。

### D. 第七輪就掛著、本輪也沒碰的

* `02b` 的標註（callout）高 Notion 66 / kennote 64（`05-12` 還有 `dx −2`）。
* `02c-page-mid2` 24.8 / 19.4、`02d-page-bottom` 23.8 / 10.8 —— 參考頁內容本身不同，見 KNOWN_GAPS。
* `05-01-paragraph` 5.2 / 5.5：字身算繪差，建議放寬目標或標註。
* `05-20-bookmark` 23：Notion 那張的縮圖是白的，**下限就是 23**。
* 公式不置中、目錄縮排 24px、標題 4 的 padding（NOTES-round2 §3）。
* `03e-sidebar-bottom` 9.2 / 9.6（`+1,+6` 頂到上限 ⇒ 又是原點）。
* `04b-topbar-right` 8.3 / 7.3（`+2,+0`）—— 小位移，還沒量。
* `07l` 剩下的差是**資料差**（Notion 只有 4 個可排序屬性、kennote 有 7 個）。
* `05-14-table` 剩下的 `dx -5`：Notion 的表格寬 952（x13..964）、kennote 937（x13..949），
  欄寬 232/238/239/238 vs 233/233/234/233 —— 內容欄寬度差，不是表格樣式。

---

## 3. 第八輪新踩到的坑（接在第七輪 31~34 之後）

35. ⭐⭐ **用單一 `colseg <x>` 找「橫線」會把工具列／文字的像素當成框線。**
    第七輪就是在 `colseg 07-db-table dark 600` 的 y93..94 看到 2px 的 `rgb(241,240,240)`，
    斷定那是 tab 列下框線，推出「Notion 表頭列 55px」——**那其實是右上角工具列裡的一小段**。
    整整一輪的交接單主打題目建立在這上面。
    → 找橫線要**逐列掃「同色連續 ≥ 300px」**（20 行的腳本，`measure.mjs` 還沒有這個模式，
    跟坑 32 的「找一列最左邊的深色像素」一樣值得補進工具）。
    一條真的框線在四張不同的參考圖裡都會出現；只在一張、只在一個 x 出現的，就不是框線。

36. ⭐ **「Notion 有一條線」先反過來假設「Notion 沒有那條線」。**
    kennote 的 tab 列下框線掛了八輪，前七輪都在調它的**顏色**
    （`--kn-color-divider` → `rgb(44,44,43)`），從來沒人問過 Notion 到底有沒有這條線。
    答案是**沒有**（`07-db-table` light/dark、`07b`、`07n` 四張一致）。
    多畫一條 704px 的線對平均分只值 0.04，但它會**把底下所有東西推掉 1px**，
    害後面每一輪都在追那 1px。

37. ⭐ **錨在不同元素上的裁切，同一個 CSS 改動的補償方向是相反的。**
    本輪把 `.bar` 加高 2px 之後：
    * `07*`（錨在 block 上緣 `box.y`）：表頭以下在裁切圖裡**下移 2**；
    * `07b`（錨在表頭列 `hb.y`）：錨點自己跟著下移 ⇒ 表頭不動、**膠囊往上跑 2**（正好補掉原本的 2px 誤差）；
    * `07d`（錨在第二列的儲存格 `cb.y`）：表頭與列的相對關係沒變 ⇒ **整張不動**。
    → 動版面之前先問「這張的 `padY` 錨在哪個元素」，再決定要不要一起改。
    本輪四張裡只有 `07*` 與 `07c` 要改 `padY`，`07b` / `07d` 改了反而會壞。

38. ⭐ **hover 態的參考圖，先確認 Notion hover 的是第幾列。**
    `07c` 掛了四輪。Notion 那張 hover 的是**第二列**（跟第五輪發現的 `07d` 一樣），
    kennote hover 第一列 → 裁切裡 Notion 的位置是「上一列的下框線」、kennote 是「表頭下框線」，
    間距一個 37 一個 33，怎麼平移都對不起來。
    → 量法：把兩邊的**橫線 y 座標列出來看間距**。出現一個不是 37 的間距，就是表頭跑進來了。

39. ⭐ **深色 token 撞色會製造出「一整塊實心色塊」，而不是「顏色有點不一樣」。**
    `--kn-editor-callout-bg` 深色 ＝ `rgb(56,56,54)` ＝ `--kn-editor-hairline` 深色。
    簡易表格的標題列同時用這兩個當底色與框線 ⇒ 整條列變成一塊 704×36 的實心，
    欄分隔線消失。**明顯差異像素 15.4%，但平均通道差只有 6.9** —— 這個比例
    （diffRatio 遠高於 meanAbs 的暗示）就是「大面積、中等色差」的特徵，
    看到就去找撞色的 token，不要去追字身。

---

## 4. 量到但還沒用上的數值（第八輪新量）

| 項目 | 實測 |
|---|---|
| Notion 資料庫：膠囊下緣 → 表頭列上緣 | **7px**（kennote 改後也是 7）|
| Notion 資料庫：表頭列 | **32 ＋ 1px 下框線**（跟 kennote 一樣，第七輪的「55」是錯的）|
| Notion 資料庫 tab 列 | **沒有下框線** |
| Notion 資料庫欄寬（`07-db-table`）| 名稱欄 279、其餘 **199**；kennote 名稱欄 279 ＋ 32 把手欄、其餘 **160** |
| Notion 資料列文字左緣 | **x58**（kennote x95，差 37 ＝ 32 把手 ＋ 5）|
| Notion 資料庫列 hover | **不染色**（整列 `rgb(255,255,255)`，只出現 ⠿ 把手）|
| Notion 簡易表格標題列 | **沒有底色**（light 255,255,255 / dark 25,25,25），只有粗體 |
| Notion 簡易表格 | 寬 952（x13..964）、列高 34 ＋ 1、格線 y30/65/100/135 |
| `07-db-table-dark` 的參考浮層 | `x48..267` / `y115..184`、底 `rgb(37,37,37)`、上框線 `rgb(56,56,54)` |
| `07g-db-gallery-full` 的 kennote 側 | x800 從 **y44** 起就是封面照 ⇒ 兩邊捲動位置不同 |

---

## 5. 驗收狀態（本輪結束時）

```
pnpm --filter @kennote/web typecheck   ✅
pnpm --filter @kennote/web test        ✅
pnpm --filter @kennote/web build       ✅ built in 4.65s
```

沒有 git commit（依指示）。

---

## 6. 本輪改動的檔案

**新增**

```
reference/shots/compare/NOTES-round8.md      ← 第八輪紀錄（README 會自動接上）
reference/shots/compare/HANDOFF-round8.md    ← 這一份
```

**修改**

```
apps/web/src/features/database/DatabaseHeader.module.css        ← .bar 拿掉 border-bottom、padding-bottom 4→7
apps/web/src/features/database/views/table/TableView.module.css ← 拿掉 .row:hover / .row:hover .frozen 的底色
apps/web/src/styles/editor.css                                  ← .kn-table th 的 background → transparent
e2e/compare.spec.ts                                             ← 六視圖 padY 13→16、07c hover 第二列 + padY 45、
                                                                   05-14-table dy:-2、KNOWN_GAPS 補兩條
```

**沒有動**：`packages/editor-core`、`packages/ui/src/{components,dnd,overlay,positioning}`、
任何 runtime 依賴、後端程式碼、任何 `.tsx` / `.ts` 邏輯檔。
