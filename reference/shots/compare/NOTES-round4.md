### 三之四、第四輪（視覺 QA 第四輪）

> 前三輪的紀錄原封不動保留在上面。本輪的重點是**資料庫標題列 / tab 列的盒模型**
> 與**「選單反白底色」這顆一直被用錯的 token**。
>
> 這一段是手寫的，放在 `reference/shots/compare/NOTES-round4.md`，
> 由 `e2e/compare.spec.ts` 在產生 README 時接到最後面。

#### ⭐ 根因一：`--kn-color-surface-hover` 不是 Notion 的「選單反白」

第三輪量到斜線選單的 hover 底是 `rgb(244,243,243)`、kennote 是 `rgb(240,239,237)`，
當時以為是 alpha 調錯。實際去翻 `reference/notion-capture/_tokens-raw-light.json` 才發現
Notion 有**兩顆不同的變數**：

| Notion 變數 | light | dark | kennote 對應 |
|---|---|---|---|
| `--ca-graBacSecTra`（半透明 hover） | `rgba(42,28,0,.07)` → 疊白 `rgb(240,239,237)` | `rgba(255,255,255,.055)` | `--kn-color-surface-hover` |
| **`--c-bacInt` / `--c-graBacInt`**（實色互動底） | **`#f4f3f3`** ＝ `rgb(244,243,243)` | `#262626` | 本輪新增 `--kn-color-menu-hover` |

**選單列、浮層裡的屬性列、作用中的 view tab 膠囊，用的都是後者**（實色）。
本輪新增 `--kn-color-menu-hover` 並套到斜線選單、`Builders.module.css`、
`ViewSettingsPanel.module.css`、`.tabActive`。

⚠️ **但 dark 不能照抄 `#262626`** —— 那是深色的 *sunken* 底，
疊在 `rgb(37,37,37)` 的面板上幾乎看不見（實測 kennote 一度變成 `rgb(38,38,38)`）。
`06-slash-menu-dark.png` 的反白實測是 **`rgb(49,49,48)`**，正好等於
`rgb(37,37,37)` 疊 `rgba(255,255,255,.055)`，所以 dark 的 `--kn-color-menu-hover`
維持半透明值。第一版照抄 `#262626` 讓 `06-slash-menu` dark 從 8.1 變成 8.5，改回來之後是 **7.9**。

#### ⭐ 根因二：內嵌資料庫的標題列矮了 13px，`07n` 的裁切原點差 19px

`07n-db-view-tabs-light.png` 逐列量測：

| | Notion | kennote（第三輪） |
|---|---|---|
| 標題字身 | y29..50（＝ font-size 24 ✓ 兩邊一樣） | y48..69 |
| 標題左緣 | x49 | x53 |
| tab 膠囊 | y69..100（高 **32**）、x48..125（寬 **78**）、底 `rgb(244,243,243)` | y81..108（高 28）、寬 64 |
| 標題下緣 → tab 上緣 | **19px** | 12px |

→ 裁切原點 `(box.x-48, box.y-26)` 改成 **`(box.x-44, box.y-7)`**；
`.titleInline` 的 `margin-bottom` 6 → **15**；`.tab/.tabActive` 高 28 → **32**、
內距 `0 8px` → `0 12px`、gap 6 → **10**（12+16+10+28+12 ＝ 78 ✓）；`.bar` `min-height` 34 → 36。

**副作用（必修）**：標題列一共長高 13px，`07`/`07e`~`07i` 那七張的裁切
（同一行 `y: box.y - 26`）整批變成 `dy +6` 頂到搜尋上限。padY 26 → **13** 之後全部回到 ≤|4|，
而且比第三輪更低。**改資料庫表頭的高度，記得同步改這一行。**

> 位移符號怎麼讀（`fixtures/png.ts` 的 `meanAbsAt`）：比的是 `kennote[y+dy]` vs `notion[y]`，
> 所以 **`dy = +6` ＝ kennote 的內容比 Notion 低 6px**，要把 padY **調小**。
> 第三輪一直在猜這個方向，這裡寫死。

#### ⭐ 根因三：`flex column` + `max-height` 會把面板上半部壓扁

`07m` 的 `.panel` 是 `display:flex; flex-direction:column; max-height:560px; overflow-y:auto`。
第三輪量到的「面板上緣→名稱框 39px」不是 CSS 寫的值 —— 面板內容本來就已經頂到 560，
`.header` / `.nameRow` **沒有 `flex-shrink:0`**，把 `.header` 從 34 調到 45 之後
只長了 3px（其餘 8px 被 flex 壓回去）。
Notion 的面板實測 y13..612 ＝ 高 **599**，`max-height` 要放大到 600，
並替 `.header` / `.nameRow` / `.section` / `.row` 補 `flex: 0 0 auto`。

補完之後 `07m` 的上半部**逐像素對上**：

| | Notion | kennote（第四輪） |
|---|---|---|
| 面板上緣 | y13 | y12 |
| 上緣 → 名稱框上框線 | **49**（y14..62） | **49**（y13..61）✓ |
| 名稱框填色 | y64..91（高 **28**） | y63..90（高 **28**）✓ |
| 第一組設定的分隔線 | y313 | y311（第三輪 y299） |

另外 Notion 的名稱框與第一組設定之間**沒有分隔線**（y93..312 全白），
`.section` 的 `border-top` 改成 `.section + .section`。

#### 本輪改了什麼

| # | 改動 | 檔案 | 代表性數字（light / dark） |
|---|---|---|---|
| 1 | ⭐ `07n` 裁切原點 `(48,26)` → **`(44,7)`**（實測標題字身 y29..50 / x49） | `e2e/compare.spec.ts` | `07n` 12.6/14.6 → **7.0/8.4**，位移 `+6,+6` → `+0,+2` |
| 2 | tab 膠囊 28×64 → **32×78**（內距 12、gap 10）、`.bar` min-height 36、標題下留白 6 → **15** | `DatabaseHeader.module.css` | 同上 |
| 3 | ＋ 收進「還有 N 個…」的下拉（Notion 的 tab 列上沒有 ＋），`measureTabs` 不再替它留 28px | `DatabaseHeader.tsx` / `.module.css` | 同上 |
| 4 | ⭐ `07`/`07e`~`07i` 的 padY 26 → **13**（跟著 #2 的高度改） | `e2e/compare.spec.ts` | `07-db-table` 7.2→**6.7**、`07h` 4.3→**3.6**、`07g` 6.3→**5.7** |
| 5 | ⭐ 新增 `--kn-color-menu-hover`（light `#f4f3f3`、dark 維持 `rgba(255,255,255,.055)`），套到斜線選單 / 篩選排序面板 / 設定面板 / `.tabActive` | `tokens.css`、`editor.css`、`Builders.module.css`、`ViewSettingsPanel.module.css`、`DatabaseHeader.module.css` | `06-slash-menu` 7.7/8.1 → **7.4/7.9** |
| 6 | 斜線選單：捲動區 `max-height` 330 → **318**、上內距 4 → **7**、列高 33 → **32**（`padding` 6→5px）、footer 內距 8 → **12**（高 40） | `styles/editor.css` | 同上 |
| 7 | ⭐ `07m` 面板：`max-height` 560 → **600**、`.header` 34 → **45**、名稱框 28 → **30**、`.nameRow` 32 → **34**、全部補 `flex:0 0 auto`、第一組設定不要 `border-top` | `ViewSettingsPanel.module.css` | `07m` 10.5/12.2 → **10.3/12.0**（上半部逐像素對齊） |
| 8 | 確認後端「載體頁被當成一列」已修（見下） | — | — |

#### 第三輪 → 第四輪

| 代號 | light | dark |
|---|---|---|
| `06-slash-menu` | 7.7 → **7.4** | 8.1 → **7.9** |
| `07-db-table` | 7.2 → **6.7** | 11.7 → **10.9** |
| `07-db-table-full` | 9.5 → **8.8** | 12.5 → **12.1** |
| `07c-db-row-hover` | 9.4 → **9.2** | 14.2 → **14.0** |
| `07e-db-board` | 7.1 → **6.6** | 8.7 → **8.0** |
| `07e-db-board-full` | 12.5 → **11.8** | 11.6 → **11.2** |
| `07f-db-list` | 5.8 → **5.2** | 8.7 → **8.0** |
| `07g-db-gallery` | 6.3 → **5.7** | 12.4 → **11.4** |
| `07g-db-gallery-full` | 12.3 → **12.2** | 11.7 → 11.6 |
| `07h-db-calendar` | 4.3 → **3.6** | 5.1 → **4.1** |
| `07h-db-calendar-full` | 11.4 → **11.3** | 8.7 → **8.5** |
| `07i-db-timeline` | 5.0 → **4.6** | 5.4 → **4.8** |
| `07i-db-timeline-full` | 9.7 → 10.3 ⚠ | 8.1 → **7.5** |
| `07m-db-settings` | 10.5 → **10.3** | 12.2 → **12.0** |
| `07n-db-view-tabs` | 12.6 → **7.0** ⭐ | 14.6 → **8.4** ⭐ |
| `07f-db-list-full` | 10.0 → 10.7 ⚠ | 9.4 → **8.8** |
| `07l-db-sort` | 10.8 → 11.1 ⚠ | 12.5 → 12.7 ⚠ |

⚠ 三個小幅退步：`-full` 那兩張是整頁圖，表頭長高 13px 之後**下方內容跟著往下推**，
裁切沒有跟著動（`-full` 是整窗截圖，沒有 padY 可調）；`07l` 見交接筆記。

#### 第四輪的驗證（不是樣式改動）

**後端「資料庫把載體頁當成一列」已經修好了**（第一/二/三輪都列為未修）。
本輪直接打遠端 API 數過：`repo.ts` 的五條查詢路徑
（`queryRows` / `countRows` / `queryGroupedRows` / `queryAggregations` / `queryRowsForRollup`）
都已經有 `AND p.is_database = FALSE`，而且**遠端部署的也是這一版**：

```
collection 01a0ba30-7352-7b72-8be3-cc4043aadbf6
  table/表格   rows=6 total=6   上線部署 | 測試與 QA | 設計稿 | 前端開發 | 後端 API | 使用者研究
  board/看板   rows=6 total=6   groups: opt_todo=2, opt_doing=2, opt_done=2, ∅=0
  list/清單    rows=6 total=6
  gallery/圖庫 rows=6 total=6
  calendar/日曆 rows=6 total=6
  timeline/時程表 rows=6 total=6
```

六個視圖一律 6 列（＝ `reference-page.ts` 種下的六筆），沒有第七列「參考資料庫」；
看板的「無選取」那一欄是 **0**（第三輪截圖裡的「無選取 4」已經不存在，
那一組還在只是因為 `hideEmptyGroups: false`，Notion 也是這樣）。
**這一條可以從「已知缺陷」清單移除了。**
