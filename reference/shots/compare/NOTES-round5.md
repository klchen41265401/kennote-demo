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
