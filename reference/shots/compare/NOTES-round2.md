### 三之二、第二輪（視覺 QA 第二輪）

> 第一輪的紀錄原封不動保留在上面。本輪的重點是**把 block 的盒模型換成 Notion 真正的那一套**
> —— 第一輪從 `tokens.md` 推出「相鄰 block gap = 0、內距 `3px 2px`」，那個結論是錯的。
>
> 這一段是手寫的，放在 `reference/shots/compare/NOTES-round2.md`，
> 由 `e2e/compare.spec.ts` 在產生 README 時接到最後面 —— 直接改那支 `.md` 就好，不必動 spec。

#### ⭐ 根因：block 的上下留白是「wrapper + leaf」兩層相加

`reference/notion-capture/dom/*.html` 的 inline style 寫得很清楚，每個 block 都是
「外層 wrapper 的 `padding-block`」＋「content-editable leaf 的 `padding-block`」兩層：

| block | wrapper | leaf | 內容高 | **總高** | kennote 第一輪 |
|---|---|---|---|---|---|
| 文字段落 | 6 / 6 | 2 / 2 | 24 | **40** | 30（少 10） |
| 標題一 | 30 / 6 | 2 / 2 | 39 | **79** | 71 |
| 標題二 | 26 / 6 | 2 / 2 | 31.2 | **67.2** | 55.2 |
| 標題三 | 22 / 6 | 2 / 2 | 26 | **58** | 43 |
| 項目 / 編號清單 | 1 / 1 | 2 / 2 | 24 | **30** | 30 ✓ |
| 待辦 | 6 / 1 | 2 / 2 | 24 | **35** | 30 |
| 折疊（標題列） | 1 / 6 ※ | 2 / 2 | 24 | **29 + 子層 + 6** ※ | 30 + 子層 |
| 引言 | 8 / 8 | 0 | 24 | **40**（粗線只有 24 高） | 30（粗線 30 高） |
| 分隔線 | — | — | — | **13** | 23 |
| 標註 / 程式碼 / 圖片 / 書籤 / 表格 / 目錄 / 公式 | 8 / 8 | — | — | 8 + 內容 + 8 | 3 / 3 |
| 多欄 | 每欄 12 / 12 | — | — | — | 多一條 6px 的空白帶 |

※ 折疊的 `padding-bottom: 6px` 在**子層之後**（wrapper 同時包住標題列與子層）。

每段少 10px，捲到 `02b`（第 900px）就差 35px、捲到 `02c` 差一整個 block ——
第一輪把 `02b` / `02c` / `02d` 歸類成「比不了的」，其實是**可以修**的。

#### 本輪改了什麼（依影響大小）

| # | 改動 | 檔案 | 代表性數字 |
|---|---|---|---|
| 1 | **block 盒模型換成實測值**（上表）：泛用 `.kn-block-main` 內距 `3px 2px` → `8px 2px`，標題 / 清單 / 待辦 / 折疊各自覆寫 | `apps/web/src/styles/editor.css` | `05-02` 4.6→**1.4**；`05-04` 2.6→**1.1**；`05-05` 5.3→**2.6** |
| 2 | 同步區塊 / 多欄的 `.kn-block-main` 是**空的 chrome 容器**，卻吃到泛用的 8px 上下內距 → 子層上方多一條 16px 空白帶（= 任務說的「+6px 偏移」，bbox 中心被拉高 3px）；同步區塊的子層還被多縮排 32px | `styles/editor.css` | `05-09` 9.4→**2.1**；`05-17` 8.2→**2.5**；`05-18` 6.2→**2.8** |
| 3 | 上下的 8px 一律改用**父層 `.kn-block--*` 的 padding**，不用 margin —— 相鄰 block 的上下 margin 會 collapse，量出來就是「分隔線上下各短 6px」 | `styles/editor.css` | `05-11` 0.7→**0.2** |
| 4 | 引言：粗線只有一行文字高（`dom/13-quote.html` 的 border 在內層 blockquote），文字左緣 = 粗線 3 + 14 + 8 = **+22** | `styles/editor.css` | `05-10` 5.1→**2.0** |
| 5 | 內容欄寬 720 → **724**（文字欄 704，量自 `05-11` 的實心 bar x22..725）—— 滿版元素右緣原本短 4px | `styles/tokens.css` | `05-13` 5.2→**2.9** |
| 6 | 圖片：沒有說明文字時「新增說明文字」**不能佔位**（`opacity:0` 照吃 25px + 8px gap，整塊高了 33px，圖片整個往上跑） | `styles/editor.css` | `05-21` 21.5→**2.6** |
| 7 | 標註：icon 欄 24px + `margin-top: 7.5px`，文字欄自己 8px 內距（內層是一個完整 text-block，所以框高 12+40+12 = **64** 而不是 48） | `styles/editor.css` | `05-12` 6.1→**4.2** / dark 10.3→**5.2** |
| 8 | 書籤：卡片高 **156**、圓角 **10**、縮圖 `flex:1 1 100px`、文字欄 `flex:4 1 180px` + 內距 18/24/14、標題 17/22、說明與網址 13/18 | `styles/editor.css` | `05-20` 30.5→**23.0** |
| 9 | 目錄：項目字級 16 → **14 / line-height 1.3**、內距 6px（`dom/19-toc.html`） | `styles/editor.css` | `05-16` 3.5→**1.3** |
| 10 | `06-slash-menu` 的裁切被 clamp 到畫面底部（錨點置中時 370px 的浮層放不下，`clip()` 會把 y 夾到 `900-高`）→ 改成把錨點捲到**上緣** | `e2e/compare.spec.ts` | `06-slash-menu` 13.8→**8.9** / dark 34.6→**9.9** |
| 11 | ⭐ **內嵌資料庫收不到 `mousedown`**（見「產品缺陷 5」）→ 儲存格選取態改用 `onPointerDown` | `views/table/TableView.tsx` | `07d` 17.6→**13.5** |
| 12 | ⭐ **點資料庫裡任何東西都會把整塊選起來**（見「產品缺陷 6」）→ 整張表蓋一層藍 | `features/editor/Editor.tsx` | `07c` 15.2→**9.4**（回到正常） |
| 13 | 篩選 / 排序改成 Notion 的**兩段式**：還沒有條件時先給「搜尋框 + 屬性清單（列高 28）+ 底部動作列」 | 新增 `PropertyPicker.tsx`、`Builders.module.css` | `07k` 15.0→**10.5**；`07l` 14.8→**11.3** |
| 14 | ⚙ 改成 Notion 的「瀏覽模式設定」整張面板（三段、列高 29、右側值 + `›`） | 新增 `ViewSettingsPanel.tsx` + `.module.css` | `07m` dark 20.3→**15.7**（light 反而變差，見待辦） |
| 15 | 工具列補 ⚡ 自動化 / ✨ AI / ⤢ 展開，順序照 UI-SPEC §8.1（篩選 排序 ⚡ ✨ 🔍 ⤢ ⚙ ＋新建） | `DatabaseHeader.tsx`、`_fallback/icons.tsx` | `07n` 11.9→12.5（tab 版面仍有差） |
| 16 | 斜線選單：`HTML` 補上灰字來源分組「· 嵌入區塊」（`_slash-menu-full.json` 第 2 項是 `HTML \| · \| 嵌入區塊 \| 新`，那是**行內**的來源分組，不是右側對齊的 hint） | `slashCommands.ts`、`SlashMenu.tsx` | — |
| 17 | **新增時程表（Timeline）視圖** | 見下方專節 | `07i` 仍待後端部署 |

#### 第一輪 → 第二輪（平均通道差）

| 代號 | light | dark |
|---|---|---|
| `05-01-paragraph` | 8.0 → 5.2 | 8.6 → 5.5 |
| `05-02-heading1` | 4.6 → **1.4** | 4.5 → **1.4** |
| `05-03-heading2` | 1.0 → 1.0 | 1.0 → 1.0 |
| `05-04-heading3` | 2.6 → **1.1** | 2.6 → **1.2** |
| `05-05-todo-unchecked` | 5.3 → **2.6** | 5.9 → **3.0** |
| `05-06-todo-checked` | 2.0 → 4.7 ⚠ | 2.6 → 5.3 ⚠ |
| `05-09-toggle` | 9.4 → **2.1** | 11.2 → **2.3** |
| `05-10-quote` | 5.1 → **2.0** | 6.0 → **2.1** |
| `05-11-divider` | 0.7 → **0.2** | 2.3 → **0.2** |
| `05-12-callout` | 6.1 → **4.2** | 10.3 → **5.2** |
| `05-13-code` | 5.2 → **2.9** | 11.4 → **6.3** |
| `05-14-table` | 4.7 → 4.6 | 7.7 → 7.6 |
| `05-15-equation` | 1.7 → 1.5 | 2.2 → 2.0 |
| `05-16-toc` | 3.5 → **1.3** | 4.0 → **2.0** |
| `05-17-synced` | 8.2 → **2.5** | 9.9 → **2.7** |
| `05-18-columns` | 6.2 → **2.8** | 7.6 → **3.3** |
| `05-19-subpage` | 22.1 → 20.9 | 11.7 → **7.6** |
| `05-20-bookmark` | 30.5 → **23.0** | 33.3 → **23.5** |
| `05-21-image` | 21.5 → **2.6** | 22.4 → **2.7** |
| `06-slash-menu` | 13.8 → **8.9** | 34.6 → **9.9** |
| `06-slash-menu-full` | 25.7 → 25.6 | 47.6 → **12.1** |
| `06f-block-hover` | 7.4 → **6.5** | 11.4 → **7.0** |
| `02b-page-mid` | 6.6 → 6.4 | 10.1 → **7.9** |
| `02c-page-mid2` | 28.1 → 22.7 | 38.6 → **21.3** |
| `07c-db-row-hover` | 9.3 → 9.4 | 14.1 → 14.2 |
| `07d-db-cell-edit` | 17.6 → **13.5** | 20.5 → **15.3** |
| `07k-db-filter` | 15.0 → **10.5** | 22.3 → **12.0** |
| `07l-db-sort` | 14.8 → **11.3** | 22.3 → **13.3** |
| `07m-db-settings` | 11.1 → 15.4 ⚠ | 20.3 → **15.7** |
| `07n-db-view-tabs` | 11.9 → 12.5 ⚠ | 14.4 → 14.6 |

#### 第二輪新增的功能：時程表（Timeline）視圖

* 前端：`apps/web/src/features/database/views/timeline/`
  （`TimelineView.tsx` + `TimelineView.module.css` + `index.tsx`）
  * 月 / 週 / 日三種刻度（`TIMELINE_SCALES`），`‹ 今天 ›` 翻頁，`«` 折疊左側表格欄
  * 依「開始 / 結束」日期欄位畫長條；沒指定結束欄位時用開始欄位的 date range
  * 長條可整條拖曳（平移日期）或拖兩端（改開始 / 結束），放開才寫回 API
  * 今天有一條直線 + 頂端紅點；日刻度時週末那一欄有淺灰底
  * 沒有日期欄位時顯示引導文案（`requiredFieldTypes` 已宣告，視圖切換器會自動灰掉）
* 型別：`shared-types` 的 `VIEW_TYPES` / `VIEW_TYPE_LABELS` / `ViewFormat`
  （`timelineStartProperty`、`timelineEndProperty`、`timelineScale`、`timelineShowTable`、`timelineTableWidth`）
  與 `TIMELINE_SCALES` / `TIMELINE_SCALE_LABELS`
* 後端：`apps/server/migrations/0060_timeline_view.sql`
  （`ALTER TYPE collection_view_type ADD VALUE IF NOT EXISTS 'timeline'`）；
  routes 的 `z.enum(VIEW_TYPES)` 會自動吃到新值，不必改 route
* 斜線選單：`db:timeline` 從「即將推出」的佔位改成真的能建視圖
* ⚠️ **`07i-*` 還沒有數字**：比對打的是遠端 `100.74.148.92:8090` 的**已建置後端**，
  它的 `VIEW_TYPES` 還沒有 `timeline`，建視圖會回 400
  （`e2e/fixtures/reference-page.ts` 已經 try/catch 吞掉並印警告）。
  後端重新部署 + 跑完 `0060` 之後，`compare.spec.ts` 的 `07i-db-timeline` 會自動納入比對。

#### 第二輪新發現的產品缺陷

5. **內嵌資料庫（以及所有 React block）收不到 `mousedown`**（已修）
   `packages/editor-core/src/input/controller.ts` 的 `onPointerDown` 對「沒有 inline content」
   的 block 呼叫 `event.preventDefault()`。依 Pointer Events 規範，被取消的 `pointerdown`
   **不會再產生相容的 `mousedown`**，所以資料庫裡任何 `onMouseDown` 都收不到 ——
   表格的儲存格選取態（藍框 + 右下角小方塊）因此從來沒畫出來過（CSS 一直都在，只是沒人觸發）。
   修法：`TableView` 改用 `onPointerDown` / `pointermove` / `pointerup`。
   ⚠️ 其他還在用 `onMouseDown` 的元件（`_fallback/Dialog.tsx`）在編輯器裡也會踩到同一個坑。

6. **點資料庫裡任何東西都會把整塊選起來**（已修）
   同一個 `onPointerDown` 也會 `setSelection(blockSelection([id]))`，於是
   `.kn-block[data-selected='true'] > .kn-block-main` 把整張表蓋上一層
   `rgba(35,131,226,.14)` —— `07c` / `07d` / `07k` 的截圖整片發藍。
   修法：`Editor.tsx` 在 **bubble 階段**（一定在 editor-core 之後）監聽 `pointerdown`，
   發現目標落在 `collectionView` / `table` / `button` / `syncedBlock` 這幾種
   「自己有 UI」的 React block 裡，就把剛設好的整塊選取取消。
   ⚠️ 不能用 `capture + queueMicrotask`：microtask checkpoint 在**每個監聽器之間**就會排空，
   等於還是搶在 editor-core 前面跑（實測過，沒有效果）。
   ⚠️ 也不能 `stopPropagation()`：React 18 的事件監聽掛在 root container（editor 的祖先），
   攔下來連元件自己的 `onClick` 都會消失。
