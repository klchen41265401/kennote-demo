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
