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
