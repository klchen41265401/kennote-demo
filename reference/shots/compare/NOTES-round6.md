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
