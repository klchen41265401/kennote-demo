# kennote ↔ Notion 整體差距盤點（gap-review）

> **這一輪不是 bug QA，是「盤點」。** 前十三輪問的是「寫出來的東西壞了沒」，
> 這一輪問的是「**Notion 有、我們根本沒做／做得不像**的還有哪些」。
>
> * 量測對象：線上站 `http://100.74.148.92:8090`（`b1fdc8e`）+ 本機 vite `127.0.0.1:5320`
>   （前端改動線上站尚未部署）
> * 對照對象：Notion 桌面版 **7.34 zh-TW**（`reference/notion-capture/`，194 張 1440×900）
> * 截圖：`reference/shots/gap-review/`
> * 日期：2026-09-20
>
> ⚠️ **紀律（承第七輪的紅線）**：沒實測的一律明寫「**未實測**」，不要讓推論在下一輪變成事實。
> 本輪 §A 全部實測並已修；§B / §C 的「kennote 現況」全部來自原始碼或瀏覽器實測；
> §B / §C 的「Notion 行為」有一部分來自 `reference/notion-capture/UI-SPEC.md`，
> 另一部分**本輪沒有重新採集**（時間用完），已逐項標注。

| 類 | 項數 | 一句話 |
|---|---|---|
| **A. 明顯 bug** | **3**（全部已修 + e2e） | 右側面板在 <1280 靜靜地不掛載；手機沒有留言入口；整頁資料庫拿不到 pageId |
| **B. 缺的功能** | **9** | side peek 的一整套（URL、三種模式、視圖設定）、更新 feed、留言的頁面內錨點… |
| **C. 做得不像** | **8** | RowPeek 是置中 modal 的骨架硬撐成側欄、寬度 560 vs Notion 的 ~50%、右側面板是 Tabs 而 Notion 是兩個不同的東西 |
| **D. RWD 75→90** | **12** | 最大一塊：768–1279 這一整條斷點**沒有任何 CSS**，全靠 JS 退化成手機版 |

---

## A. 明顯 bug（本輪已修）

三條全部是「**按鈕按得下去，什麼都沒發生**」——第六輪主線 2（前端沒有呼叫端）的變形：
這次呼叫端在、store 也翻了，只是**渲染端把自己關掉了**。

### A-1 ⭐ 右側面板在 768–1279 與 <768 完全不掛載（使用者說的「右側欄不會開啟」）

| | |
|---|---|
| **Notion 行為** | 網頁版在 1024 / 768 / 390 都開得起來留言面板，只是從「佔位欄」退化成**覆蓋抽屜**（主內容不被推窄） |
| **kennote 現況** | `AppShell.tsx` 寫的是 `{ui.rightPanelOpen && !narrow && (<Resizable…>)}`，而 `narrow = bp !== 'desktop'`（`<1280`）。**寬度一旦小於 1280，整個 `RightPanel` 不掛載**。而頂欄／側邊欄的「留言」「更新」按鈕在 768–1279 是看得見、按得下去的 → 按下去只翻了一個 store flag + 寫了 `localStorage['kennote:right-panel']='1'`，畫面零反應。再按一次還會把 flag 翻回去。 |
| **實測** | `reference/shots/gap-review/kn-1024-page.png`：`留言btn visible=true` / `rightpanel dom visible=false` / `localStorage=1`。1440 正常（面板 379px）。 |
| **嚴重度** | **高**（使用者第一句話就是這個） |
| **修法** | 桌機維持 `Resizable` 佔位欄；平板 / 手機改成 `position: fixed` 的**覆蓋抽屜 + 遮罩**（`.rightDrawer` / `.rightBackdrop`，`min(380px,100vw)`，手機 `min(420px,100vw)`），點遮罩關閉。**已修**，`e2e/gap-review.spec.ts` GR-1 / GR-2 / GR-5。 |
| **工時** | 已用 0.5h |

### A-2 手機（<768）上「留言」**完全沒有入口**

| | |
|---|---|
| **Notion 行為** | 手機版把頂欄動作收進 ⋯，但 ⋯ 裡面有「留言」 |
| **kennote 現況** | 頂欄的留言鈕掛 `.compactHide`（`@media (max-width:767px){display:none}`，這是刻意的，UI-SPEC §10），但 ⋯ 選單裡**只有「版本歷史」沒有「留言」**。實測 390：`getByRole('menuitem', {name:/留言/}).count() === 0`。加上 A-1，手機上留言等於不存在。 |
| **嚴重度** | **高**（功能等於沒有） |
| **修法** | `TopBar.tsx` 的 ⋯ 選單補一個「留言」`MenuItem`（桌機重複一份無妨）。**已修**，GR-3。 |
| **工時** | 已用 0.1h |

### A-3 整頁資料庫（`/database/:pageId`）的右側面板永遠是空的

| | |
|---|---|
| **Notion 行為** | 整頁資料庫本身也是一個頁面，一樣有留言與「更新」 |
| **kennote 現況** | `AppShell` 的 `pageId` 是 `location.pathname.startsWith('/page/') ? … : null`。整頁資料庫走的是 `/database/:pageId`（shell README 決策 6）→ `pageId === null` → 面板開了只寫「**選一個頁面才能看留言與版本歷史**」。頂欄的留言鈕卻是亮的（`DatabaseRoute` 有把 `pageId` 傳給 `TopBar`），兩邊不一致。 |
| **嚴重度** | **中** |
| **修法** | 改成 `/^\/(?:page\|database)\/([^/?#]+)/` 的正規表示式（順便修掉 `/page/xxx/yyy` 會把後綴一起吃進去的問題）。**已修**，GR-4。 |
| **工時** | 已用 0.1h |

> **驗收**：`pnpm --filter @kennote/web typecheck && test && build` 全綠；
> `BASE_URL=http://127.0.0.1:5320 npx playwright test gap-review.spec.ts` → **5 passed**。
>
> 動到的檔案：`features/shell/AppShell.tsx`、`features/shell/Shell.module.css`、
> `features/shell/TopBar.tsx`、新增 `e2e/gap-review.spec.ts`。
> **後端零改動，部署只要前端。**

---

## B. 缺的功能（Notion 有、kennote 根本沒有）

### B-1 ⭐ side peek 沒有 URL（不能分享、不能重整、不能上一頁）

* **Notion**：點資料庫的列 → 網址變成 `…?p=<pageId>&pm=s`（`pm` = peek mode）。
  重新整理 peek 還在、按瀏覽器上一頁 peek 關掉、把網址貼給同事他看到的是同一個 peek。
* **kennote**：`DatabaseView.tsx` 的 `const [peekRowId, setPeekRowId] = useState<string|null>(null)`
  ——**純元件內 state**。重整就沒了，上一頁會直接離開資料庫，網址分享不出去。
* 嚴重度 **高**（這是 side peek 之所以叫「peek 而不是 modal」的一半理由）
* 修法：把 `peekRowId` 換成 `useSearchParams()` 的 `p` / `pm`，`openRow()` 改成
  `setSearchParams({p: rowId, pm: 'side'}, {replace:false})`。約 **3h**（含 `InlineDatabase` 的多實例情境）。

### B-2 ⭐ 沒有「置中預覽 / 整頁」三選一

* **Notion**：peek 頂部有 `⤢`（開成整頁）與一組 `側邊 / 置中 / 整頁` 切換；`pm=s` / `pm=c` / 無。
* **kennote**：`RowPeek` 的 `variant?: 'side' | 'center'` **存在但從來沒有呼叫端傳過**
  （`DatabaseView.tsx:167` 只給 `row / open / onClose / …`），永遠是預設的 `'side'`。
  「以整頁開啟」有（`openRowPage()` → `navigate('/page/:id')`），但那是**關掉 peek 再跳頁**，
  不是 Notion 的「就地展開」。
* 嚴重度 **中**。修法：把 `variant` 接上 + peek 頂部加切換鈕，`_fallback/Dialog.tsx` 已經支援 `side|center`，只差 `full`。約 **2h**。

### B-3 ⭐ 視圖設定沒有「開啟頁面方式」

* **Notion**：資料庫視圖 ⋯ → 版面 → 「開啟頁面方式：側邊預覽 / 置中預覽 / 整頁」，**存在 view 上**。
* **kennote（實測 dump 整個面板的項目）**：
  `表格 / 版面配置 / 屬性能見度 / 篩選 / 排序 / 分組 / 條件式顏色 / 拷貝瀏覽模式連結 / 來源 / 編輯屬性 / 自動化 / AI 自動填寫 / 更多設定 / 管理資料來源 / 鎖定資料庫 / 在日曆中管理`
  ——**沒有「開啟頁面方式」**。
* 嚴重度 **中**（B-2 做完才有意義）。修法：`view.format.openPageAs: 'side'|'center'|'full'`，後端 view format 是 jsonb 不用 migration。約 **2h**（含 `ViewSettingsPanel` 一列 + 後端 zod）。

### B-4 一般頁面連結沒有「在側邊預覽開啟」

* **Notion**：側邊欄 / 內文的頁面連結，右鍵或 ⋯ 都有「在側邊預覽中開啟」。
* **kennote**：`grep` 全站只有資料庫的列會開 peek；`TreeRow` / 內文 page mention 的選單沒有這一項。
* 嚴重度 **低–中**。做完 B-1（peek 有 URL）之後這一項只是加選單項，約 **1h**。

### B-5 「更新 / Updates」feed 不存在

* **Notion**：右側面板的「更新」是**活動摘要**（誰在什麼時候改了什麼、留了什麼言），
  跟「版本歷史」（快照清單 + 還原）是**兩個不同的東西**。
* **kennote**：側邊欄的「更新」按鈕（`Sidebar.tsx:330`，`aria-label="更新"`）直接
  `toggleRightPanel('history')` → 打開的是版本歷史。**沒有 updates feed**。
* 嚴重度 **中**（名不符實，使用者會找不到「誰改了什麼」）。約 **6h**（後端要聚合 transactions + comments）。

### B-6 `rightPanelTab` 宣告了 `'inbox'` 卻沒有第三個分頁

`stores/ui.ts:21` 的 `RightPanelTab = 'comments' | 'history' | 'inbox'`，但 `RightPanel` 只畫兩個 tab，
傳 `'inbox'` 進去會兩個 tab 都不 active、body 全空。Notion 的收件匣是獨立面板。
嚴重度 **低**（dead type）。修法：拿掉 `'inbox'`，或補第三個 tab。**0.3h**。

### B-7 版本預覽看到的還是現在的內容（沿用 O-8）

`AppShell` 丟掉 `onPreview` 的 snapshot 參數，橫幅卻寫「編輯已停用」。這是**會誤導的錯**，
不是純缺功能。嚴重度 **中**，約 **3h**。（本輪未動，留給下一輪。）

### B-8 留言沒有「在頁面上就地標註」的完整鏈路

`CommentsPanel` 有 `onHighlightBlock` → `scrollIntoView`，但 Notion 是**行內黃底標註 + 側欄卡片雙向連動**
（點側欄卡片 → 頁面該段亮起；點頁面標註 → 側欄捲到該卡片）。kennote 只有單向捲動。
嚴重度 **低–中**，約 **4h**。（**Notion 側本輪未重新採集**，依 UI-SPEC。）

### B-9 貼上純 URL 沒有「連結／書籤／嵌入」三選一（沿用 O-23）

嚴重度 **低**，約 **2h**。

---

## C. 做得不像（外觀 / 互動）

### C-1 ⭐ RowPeek 是「置中 modal 的骨架硬撐成側欄」

`RowPeek` 用的是 `features/database/_fallback/Dialog.tsx`，`variant='side'` 只是換了一個 class
（`.dialogSide { width: min(560px, calc(100vw - 48px)); margin-left: auto }`）。骨架仍然是 **modal**：

| 面向 | Notion side peek | kennote RowPeek |
|---|---|---|
| 寬度 | 約 **50% 視窗**（1440 → 約 720），**可拖曳調寬** | 固定 **560px**，不可調 |
| 背景 | 主頁仍然**可讀**（只壓一層很淡的遮罩），點主頁就關 peek | `.backdrop` 是 `--kn-color-overlay` + **`backdrop-filter: blur(2px)`**，主頁被糊掉 |
| 焦點 | 不是 modal，Tab 走得出去 | `createFocusTrap` + `inert` 背景 + **捲動鎖**（主頁捲不動） |
| 麵包屑 | 沒有（這是 peek 的特徵） | 沒有 ✅ 一致 |
| 頂部工具列 | `← →`（上／下一列）、`⤢`、`側邊/置中/整頁`、`⋯`、`分享`、`留言` | `✕`、`以整頁開啟`、`⋯` |

嚴重度 **中–高**（這是使用者第二句話問的東西）。
修法：peek 不要再走 `Dialog`，另做一個 `aside`（非 modal、不 trap focus、不鎖捲動），
寬度用 `Resizable`（`clamp(400px, 50vw, 900px)`）。約 **5h**。

### C-2 右側面板是 Tabs，Notion 是兩個不同的東西

kennote 把「留言 / 版本歷史」做成同一個面板的兩個 tab。Notion 的留言與更新在同一個側欄，
**版本歷史是另一個更寬的檢視**（左邊時間軸、右邊該版本的內容預覽）。
接在 B-5 / B-7 後面一起改。嚴重度 **低–中**，約 **4h**。（**Notion 側本輪未重新採集**。）

### C-3 右側面板的頭列高 44 但沒有 Notion 的標題與動作

Notion 側欄頂端是「留言 ⌄」下拉（全部／未解決）+ `⋯` + `✕`。
kennote 只有兩個 tab + `✕`，沒有「未解決／全部」篩選。嚴重度 **低**，約 **1.5h**。

### C-4 peek 沒有「上一列 / 下一列」

Notion 的 `← →` 讓人可以用 peek 一列一列審，這是 peek 的主要用途之一。
kennote 開了 peek 只能關掉再點下一列。嚴重度 **中**，約 **1.5h**（`rowsState.rows` 已經在手上）。

### C-5 peek 的屬性表不是 Notion 的樣子

kennote：`dt` 固定 `flex: 0 0 160px`、`dd` hover 才變底色。
Notion：屬性名欄寬**隨最長的名字自動伸縮**（有上限），且名字本身是可點的按鈕（開屬性選單）。
嚴重度 **低**，約 **1h**。

### C-6 peek 的滑入動畫只有 24px 位移

`@keyframes slideIn { from { transform: translateX(24px); opacity: 0 } }`。
Notion 是**從右緣整個滑進來**（位移 = 面板寬）。細節但很明顯。嚴重度 **低**，約 **0.2h**。

### C-7 右側面板沒有「拖曳把手」的視覺提示

`Resizable` 的把手是隱形的（只有 `handleLabel`），Notion 的側欄邊界 hover 會出現一條藍線。
嚴重度 **低**，約 **0.5h**。

### C-8 側邊欄「留言」圖示按鈕在首頁按了也沒用

`Sidebar.tsx:309` 的「留言」不分頁面一律 `toggleRightPanel('comments')`；
在 `/`（首頁）上 `pageId` 是 `null` → 面板開了只有一句提示。Notion 的側邊欄沒有這顆按鈕
（UI-SPEC §2 明寫 Notion 2026 的側邊欄沒有它）。嚴重度 **低**：
要嘛在沒有頁面時 `disabled`，要嘛拿掉。約 **0.3h**。

---

## D. RWD 75 → 90（以 Notion **網頁版** 在 390 / 768 / 1024 的行為為準）

> **實測基準**（修 A-1 之後，本機 5320）：
> 390 → topbar 40px、無水平捲動；768 / 1024 → topbar 44px、無水平捲動。
> 「沒有水平捲動」這條三個寬度都過 ✅ —— 底分 75 是紮實的，下面是差的那 15 分。

**最大一塊（D-1）一個人就佔 5 分左右，其餘 11 項合計約 10 分。**

| # | 項目 | Notion 網頁版 | kennote 現況 | 分 | 工時 |
|---|---|---|---|---|---|
| **D-1** ⭐ | **768–1279 這一整條斷點沒有任何 CSS** | 1024 仍然是**桌機版面**：側邊欄佔位、可收合、內容欄照樣 720 | `grep '@media' apps/web/src` → **11 個 `max-width:767px`、720px 2 個、640px 1 個，768–1279 一個都沒有**。這一段完全靠 JS 的 `bp === 'tablet'` 退化成「覆蓋抽屜」，等於把 1024 當手機用。Notion 是 **≥768 就給佔位側邊欄** | **5** | 6h |
| D-2 | `100vh` 沒換 `100dvh` | — | `routes/ProtectedRoute.module.css:6`、`WorkspaceRoute.module.css:3,21`、`AuthForm.module.css:5` 都是 `100vh` → 手機瀏覽器網址列會切掉 shell 底部。`Dialog` / `SettingsDialog` 已經改好了，**shell 本體沒有** | 2 | 0.5h |
| D-3 | safe-area | 底部動作貼齊 home indicator | 全站只有 2 處有 `env(safe-area-inset-*)`（database 的批次列、editor 的 bottom sheet）。shell 的抽屜、右側抽屜、頂欄都沒有 | 1.5 | 1h |
| D-4 | 手機沒有固定底部工具列 | 網頁版手機底部有固定列（搜尋 / 新頁面 / …） | 沒有；所有動作都藏在頂欄 ⋯ 的第二層 | 1.5 | 3h |
| D-5 | 手機的浮層不是 bottom sheet | 選單從底部滑上來、可下拉關閉 | `Menu` / `Popover` 在手機仍是貼著 trigger 的浮層（`Dialog` 已經滿版了，`Menu` 沒有） | 1.5 | 3h |
| D-6 | 觸控目標 <44px | ≥44 | 頂欄 icon **28×28**、側邊欄列 **30px**、peek 的 `.iconButton` 28×28。`(hover:none)` 的 media query 只有 3 處（Sidebar / TableView / CalendarView），沒有全站的「觸控放大命中區」 | 1.5 | 2h |
| D-7 | 軟鍵盤 | 浮動工具列跟著 `visualViewport` 上移 | `features/editor/ui/overlay.tsx` **有做**（`visualViewport`）✅，但 shell 的浮層（搜尋 / 設定 / 右側抽屜）沒有 | 1 | 1.5h |
| D-8 | 手機的 peek 沒有下拉關閉手勢 | 下拉關閉 | `.dialogSide` 在 767 以下變成滿版 `sheetUp` ✅，但只能按 `✕` | 0.5 | 1.5h |
| D-9 | 768–1023 的內容欄寬度 | 隨視窗縮，左右留白隨之縮 | `--kn-editor-content-width` 固定 720；768 時左右各剩 24px（沒有 `max-width:767px` 的那條 16px 規則保護），視覺上貼邊 | 0.5 | 0.5h |
| D-10 | 看板 / 日曆在 390 未走查 | — | `O-13`（表格橫捲）第十一輪結案，但**看板 / 日曆 / 圖庫在 390 從來沒走查過**。`CalendarView.module.css` 有一條 `(hover:none)`，其餘未知 | 0.5 | 2h（走查） |
| D-11 | 平板的側邊欄沒有「固定住」的選項 | 1024 可以把抽屜釘住變佔位 | `toggleSidebar()` 在 narrow 一律只開關覆蓋抽屜（`stores/ui.ts:107`），沒有「釘住」 | 0.5 | 1h（D-1 做完就順手） |
| D-12 | 橫向（landscape）390×844 → 844×390 | — | 完全未走查 | 0.5 | 1h（走查） |

> **D-1 的具體做法**：把 `currentBreakpoint()` 的 tablet 門檻從 1280 降到 **768**
> （也就是 `desktop` = `≥768`），並替 768–1023 補一組 CSS（側邊欄預設收合、內容欄 padding 收到 24px）。
> 這樣 1024 就會拿到佔位側邊欄 + 佔位右側面板，跟 Notion 網頁版一致。
> ⚠️ 會動到 `rwd.spec.ts` 的「768–1279 是覆蓋抽屜」那幾條斷言，要一起改。

---

## E. 下一輪三個實作代理的分工建議

> 三份工作**檔案不重疊**，可以同時跑。每一份都附「先讀什麼 / 驗收怎麼跑」。

### 代理一：side peek 補完（B-1 / B-2 / B-3 / B-4 + C-1 / C-4 / C-5 / C-6）

* 範圍：`apps/web/src/features/database/**`（`RowPeek.tsx`、`DatabaseView.tsx`、`ViewSettingsPanel.tsx`、`_fallback/Dialog.tsx`）、`apps/server/src/modules/databases/`（只加 `view.format.openPageAs` 的 zod 欄位）
* 先讀：`features/database/README.md`、`docs/qa/database-gaps.md`、本檔 §B §C
* 關鍵決策：**peek 不要再走 `Dialog`**（modal 的 focus trap + 捲動鎖 + `inert` 正是「不像」的根因），改寫成非 modal 的 `<aside>` + `Resizable`
* 驗收：`e2e/gap-review-peek.spec.ts`（URL 帶 `?p=&pm=`、重整後 peek 還在、上一頁關掉 peek、拖寬、← → 換列、視圖設定三選一）
* 估：**14h**

### 代理二：RWD 75→90（D-1 ~ D-12）

* 範圍：`apps/web/src/stores/ui.ts`（斷點）、`features/shell/**`、`apps/web/src/styles/shell.css`、`packages/ui/src/components/Menu*`（bottom sheet）、`e2e/rwd.spec.ts`
* 先讀：`features/shell/README.md` §4、`reference/notion-capture/UI-SPEC.md` §10、本檔 §D
* **先做 D-1**，其餘全部建立在它上面；D-2 / D-3 / D-9 是十分鐘的小修，可以第一天就清掉
* ⚠️ 改斷點會讓 `rwd.spec.ts` 現有斷言變紅 —— 那是**預期的**，要連測試一起改，不要為了綠燈繞回去
* 驗收：`rwd.spec.ts` 擴充成 390 / 768 / 1024 / 1440 四檔，每檔都斷言「無水平捲動 + 側邊欄型態 + 右側面板型態 + 觸控目標 ≥44」
* 估：**20h**

### 代理三：協作面板補完（B-5 / B-6 / B-7 / B-8 + C-2 / C-3 / C-8 + 舊帳 O-7 / O-10）

* 範圍：`apps/web/src/features/{comments,history}/**`、`features/shell/AppShell.tsx` 的 `RightPanel`、`routes/InboxRoute.tsx`、`apps/server/src/modules/{notifications,pages}/`（updates feed 的聚合端點）
* 先讀：`docs/qa/functional-round5.md`、`functional-round7.md` §4-5~8、`docs/qa/README.md` §二-C、本檔 §B-5 / §B-7
* **B-7（版本預覽顯示的是現在的內容）優先**——它是「會誤導」而不只是「缺」，連四輪延後了
* 驗收：`e2e/gap-review-collab.spec.ts`；`RightPanel` 的改動要跑 `gap-review.spec.ts` 回歸（GR-1~5 都會碰到它）
* 估：**18h**

---

## F. 本輪沒做到的

* **真實 Notion 的重新採集本輪沒有完成**（CDP 接管在時限內沒收尾）。
  §B / §C 裡標「Notion 側本輪未重新採集」的項目，依據是 `reference/notion-capture/UI-SPEC.md`
  與既有的 194 張截圖，**不是這一輪量的**。下一輪動 §B-2 / §B-3 之前，
  請先把「`pm=` 參數的實際值」與「`開啟頁面方式` 三個選項的原文」採回來——
  這兩個是會寫進程式碼的字串，抄錯就白做。
* **RowPeek 的 1440 實測截圖沒拍到**：表格列的「開啟」鈕是 hover-only，
  探索腳本的 hover locator 沒命中（第十二輪 R12-1 用的是 `exact: true` 的 `name: '開啟'`，
  下一輪照抄那一條）。§C-1 的數字全部來自原始碼（`fallback.module.css:119` 的 `min(560px, …)`），
  **不是量出來的**。
* §D 的分數是**估的**，不是量表算出來的。它的用途是排序，不是計分。
