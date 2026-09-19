# features/shell —— App shell（M3）

> 把已完成的各功能模組（editor / database / comments / history / share / notifications）
> 接成一個完整產品的外殼：側邊欄、頂欄、右側面板、全域浮層、快捷鍵、RWD。
>
> 對應規格：02 §2（版面）、§3.2–3.3、§3.6（骨架層 / Sidebar / RightPanel）、§4.2（頁面樹互動）、§6（設計系統）；
> 01 §3（頁面系統）、§7–§9（分享 / 搜尋導覽 / 資料生命週期）、§11（快捷鍵）；04 §8 M3。
>
> **視覺還原的真值來源是 `reference/notion-capture/`**：
> `UI-SPEC.md`（版面 / 行為）、`tokens.md` + `tokens.json`（Light/Dark 各 770 個原生 CSS 變數）、
> `dom/*.html`（27 個元件的精簡 DOM）、194 張 1440×900 截圖。
> 這裡所有的尺寸與顏色都是照抄的，不是估的。

---

## 1. 三十秒版本

```
main.tsx
 └ <OverlayRoot><DndProvider><App/><ToastRegion/></DndProvider></OverlayRoot>
     └ App.tsx（路由）
         ├ /login /register /share/:token      ← 不進 shell
         └ <ProtectedRoute> → <AppShell>       ← 骨架層
              ├ <Sidebar>            features/page-tree
              ├ <Outlet>             HomeRoute / PageRoute / DatabaseRoute / InboxRoute / 404
              │    └ 每個 route 自己畫 <TopBar>（麵包屑要依頁面而定）
              ├ RightPanel           留言 / 版本歷史（Resizable 300–520，預設收合）
              └ 全域浮層             SearchDialog / SettingsDialog / ShortcutsDialog / MoveToDialog
```

| 檔案 | 內容 |
|---|---|
| `AppShell.tsx` | 骨架層：側邊欄槽（Resizable 200–420）、收合 / 左緣浮出抽屜、平板手機的覆蓋抽屜、右側面板、全域浮層、全域快捷鍵 |
| `TopBar.tsx` | 44px 頂欄：麵包屑、「已於 X 分鐘前 編輯」、presence、連線、分享、連結、留言、星號、⋯ 選單 |
| `Breadcrumbs.tsx` | 祖先鏈 + 中段 `…` 下拉 + hover 預覽（省略規則是 `page-tree/tree.ts` 的純函式） |
| `MoveToDialog.tsx` | 「移動到…」：搜尋頁面、選目標，循環一律擋下 |
| `ShortcutsDialog.tsx` | `Ctrl+/` 快捷鍵說明（直接讀 `lib/shortcuts.ts` 的表） |
| `ErrorBoundary.tsx` | render 期例外不會變成白畫面；換頁自動重設 |
| `export.ts` | 匯出（最小版：snapshot → Markdown），並留 `registerExport()` 給 M6 的 `features/export` |
| `Shell.module.css` / `TopBar.module.css` | 版面樣式 |

其餘模組：

| 路徑 | 內容 |
|---|---|
| `features/page-tree/` | `Sidebar` / `TreeRow` / `WorkspaceSwitcher` / **`tree.ts`（純邏輯 + 測試）** |
| `features/home/` | 首頁：問候、最近造訪、即將到來、精選範本 |
| `features/search/` | `Ctrl+K` 搜尋 / `Ctrl+P` 快速切換（同一個元件） |
| `features/settings/` | 設定 Dialog（帳號 / 我的設定 / 通知 / 成員 / 工作區 / 匯入匯出） |
| `features/trash/` | 垃圾桶 Popover（清單 / 搜尋 / 還原 / 永久刪除） |
| `features/templates/` | 3 個內建範本 + 建立流程（走 transaction，不直接寫 block） |
| `features/onboarding/` | 登入後的落點（首頁 / 上次造訪的頁面） |
| `stores/ui.ts` | 側邊欄寬度 / 收合 / 樹的展開 / 分區收合 / 浮層開關（會持久化的都寫 localStorage） |
| `stores/workspace.ts` | 目前作用中的工作區（可切換） |
| `stores/pages.ts` | 頁面版面（全寬 / 小字 / 字型 / 鎖定）、瀏覽紀錄、**相對時間 / 問候語**（有測試） |
| `lib/keyboard.ts` / `lib/shortcuts.ts` | 鍵盤事件正規化 + 全域快捷鍵表（有測試） |

---

## 2. 對照 Notion 的關鍵數值（全部量自 `reference/notion-capture/`）

| 項目 | 值 | 出處 |
|---|---|---|
| 側邊欄寬 | **270px**（可拖 200–420） | UI-SPEC §1 |
| 側邊欄右緣 | `inset box-shadow`，**不是 border** | UI-SPEC §11.3 |
| 側邊欄列 | 高 **30px**、圓角 6、字 **14/21**、pitch 31 | tokens.md §1/§2 |
| 側邊欄 icon 欄 | **一個** 20px 欄位，hover 時 icon 原地換成箭頭 | UI-SPEC §2.4 |
| 頂欄 | 高 **44px**、`padding-inline: 12px 10px`、按鈕 28×28、圓角 6 | dom/03-topbar.html |
| 頂欄右側動作 | 滑鼠閒置時 `opacity 0.7s` 淡出 | UI-SPEC §3.1 |
| 內容欄 | **720px**（文字實寬 708 + 左右 6px） | UI-SPEC §1 |
| 封面 | 30vh | UI-SPEC §3.2 |
| 清單縮排 | **32px**（不是 24） | UI-SPEC §11.5 |
| block 間距 | **gap 0**，節奏全在 wrapper 的 padding | UI-SPEC §11.1 |
| 主要文字 | `#2c2c2b` / dark `#f0efed` | tokens.md §3 |
| 側邊欄底 | `#f9f8f7` / dark `rgb(32,32,32)` | tokens.md §3.1 |
| hover 底 | `rgba(42,28,0,.07)` | tokens.md §3.2 |
| 浮層陰影 | 2–3 層疊加 + `0 0 0 1px` 描邊（照抄） | tokens.md §4 |
| 圓角 | 列 / 按鈕 6px、浮層 / code / callout 10px | tokens.md §5 |
| 動效 | 側邊欄 width `0.2s`、頂欄動作 opacity `0.7s` | tokens.md §6 |

---

## 3. 快捷鍵（01 §11.1，唯一定義在 `lib/shortcuts.ts`）

| 組合 | 動作 |
|---|---|
| `Ctrl+N` | 新頁面 |
| `Ctrl+K` | 搜尋 |
| `Ctrl+P` | 快速切換頁面 |
| `Ctrl+O` | 新對話（AI 佔位） |
| `Ctrl+\` | 開關側邊欄 |
| `Ctrl+Shift+L` | 切換深色 / 淺色 |
| `Ctrl+/` | 快捷鍵說明 |
| `Ctrl+,` | 設定 |
| `Ctrl+[` / `Ctrl+]` | 上一頁 / 下一頁 |
| `Ctrl+Shift+N` | 開新視窗（**未實作**，說明表上會標示） |

`allowInInput` 為 true 的才會在輸入框 / contenteditable 裡生效（`Ctrl+N` 刻意不生效）。

---

## 4. RWD

| 斷點 | 行為 |
|---|---|
| **≥1280 桌機** | 側邊欄佔位（Resizable 200–420）。`Ctrl+\` 或側邊欄右上角的 `«` 收合；收合後滑到視窗左緣 12px 內 → 浮出抽屜；滑開超過「抽屜寬 + 32」→ 收回 |
| **768–1279 平板** | 側邊欄改成**覆蓋抽屜 + 遮罩**，由頂欄左側的 `«` 開關；點遮罩關閉 |
| **<768 手機** | 同上但抽屜幾乎全寬（`min(320px, 92vw)`）；topbar **40px**；內容欄左右 **16px**；右側面板停用；任何情況下都沒有水平捲動 |

驗證腳本：`e2e/rwd.spec.ts`（三種寬度各一個 test，會把截圖寫到
`reference/shots/kennote/rwd-*.png`）。

---

## 5. 截圖比對流程

```bash
# 1. 本機前端 + 遠端 API
VITE_PROXY_TARGET=http://100.74.148.92:8090 pnpm --filter @kennote/web dev

# 2. 截圖（輸出到 reference/shots/kennote/，檔名對照 notion-capture 的代號）
cd e2e
npm i -D @playwright/test && npx playwright install chromium
BASE_URL=http://127.0.0.1:5173 npx playwright test screenshots.spec.ts
BASE_URL=http://127.0.0.1:5173 npx playwright test rwd.spec.ts
```

`playwright.config.ts` 刻意**不** spread `devices['Desktop Chrome']`——它會把 viewport 蓋成
1280×720，那就跟 `reference/notion-capture/` 的 1440×900 對不起來了。

---

## 6. 決策

1. **工作區切換器自成一列，放在頂端圖示列底下。**
   Notion 2026（7.34）的側邊欄**沒有**工作區切換器（實測見 UI-SPEC §2），它被收進「首頁」選單裡。
   但 kennote 一個帳號可以有多個工作區，把切換動作藏進一個叫「首頁」的選單裡違反最小驚訝原則。
   這一列刻意做得很低調（30px、13–14px 字、chevron 只在 hover 顯示），不破壞整體比例。

2. **側邊欄底部保留「範本 / 垃圾桶 / 說明 / 設定」四列。**
   Notion 這個版本也沒有（UI-SPEC §2 的警語），設定走 `Ctrl+,`、垃圾桶只能從頁面 `⋯` 進去。
   但交付清單明確要求這四個入口，而且沒有入口的功能等於不存在。
   四列都用次要文字色、28px 高，視覺份量低於頁面樹。

3. **內容欄寬度用 720px，`--kn-editor-content-width` 提到 `:root`。**
   原本這個變數只宣告在 `.kn-editor-shell` 上，而 `<PageHeader>` 在 shell 之外
   → 它的 `max-width: var(--kn-editor-content-width)` 解析失敗 → 標題與 block 左緣差了 200 多 px。
   提到 `:root` 之後兩者天生共用同一個置中欄，且 `styles/shell.css` 只要覆寫
   `.kn-page-layout[data-full-width='true']` 就能做「全寬」，不必改 `styles/editor.css`（不在本代理範圍）。
   殘留誤差：Notion 的內容欄左緣在 x=487.5（它右側有捲軸槽造成左右不對稱），我們在 x≈495，差約 8px。

4. **`[contenteditable]:focus { outline: none }` 放在 `styles/shell.css`（全域）。**
   瀏覽器預設會替 contenteditable 畫 focus ring，Notion 沒有（游標本身就是狀態指示）。
   放全域是因為 `styles/editor.css` 不在本代理的可改範圍。按鈕 / 連結的 `:focus-visible` 保留。

5. **頁面版面（全寬 / 小字 / 字型 / 鎖定）存 localStorage，不存後端。**
   `PatchPageRequest` 只收 `title` / `icon` / `cover`，沒有 `props.layout`。
   加欄位要動 migration 與後端契約，跨代理成本太高。
   等後端補上之後把 `stores/pages.ts` 的 `usePageLayout` 讀寫換成 `page.props` 即可，呼叫端一行都不用改。

6. **整頁資料庫走獨立路由 `/database/:pageId`，PageRoute 偵測到 `isDatabase` 就 `<Navigate>` 過去。**
   這樣 `PageRoute` 不需要 `import` `features/database`（那個模組由另一位代理並行開發中，
   直接 import 會讓 typecheck 跟著它的進度上上下下）。TopBar 兩條路由共用同一個元件，所以外觀完全一致。

7. **設定裡的「變更密碼 / 登出所有裝置 / 頭像上傳」做成停用狀態。**
   這三個需要 `apps/server/src/modules/auth/**` 的新端點，而本代理的後端可改範圍只有
   `pages/**`、`workspaces/**`、`search/**`。UI 已經就位，端點補上之後只要換掉 onClick。

8. **後端只補了「本來就該有、而且屬於我範圍」的四組 API。**
   - `GET /api/pages/favorites`、`POST|DELETE /api/pages/:id/favorite`（`favorites` 表在 0004 就建好了，一直沒有 API）
   - `GET /api/pages/recent`（M6 會提供 `/api/recent`，前端三層 fallback：`/api/recent` → `/api/pages/recent` → 用頁面樹的 `updatedAt` 推）
   - `POST /api/workspaces`、`PATCH|DELETE /api/workspaces/:id`（設定頁需要）
   搜尋沿用既有的 `GET /api/search`，但前端的 `normalizeHits()` 同時吃
   `SearchHit[]` 與 M6 之後的 `{ hits: [...] }` 兩種形狀，M6 上線時前端不用改。

9. **`Ctrl+K` 與 `Ctrl+P` 是同一個元件，差別只有篩選 chips。**
   Notion 兩者的結果清單、分組、鍵盤行為完全一樣（UI-SPEC §6.7），
   維護兩份只會漂移。`compact` prop 控制差異。

10. **側邊欄「收合後浮出抽屜」用 window 的 `mousemove` 判斷，不用 `onMouseEnter` / `onMouseLeave`。**
    抽屜是在「滑鼠已經停在左緣」時才掛載的，那時候不會有 enter 事件；
    而剛掛載的元素又會立刻收到一個 `mouseout`，抽屜會當場自己關掉（實測過）。
    改成單一 handler 判斷 `clientX`：`≤12` 開、`> 抽屜寬 + 32` 關。

11. **範本用 `POST /api/pages` + 一筆 transaction 塞內容，不走任何捷徑。**
    00-README 的紀律一：所有 block 變更必經 `applyTransaction()`。

12. **`Ctrl+\` 在窄螢幕改成開關覆蓋抽屜。**
    平板 / 手機上「收合」沒有意義（側邊欄本來就不佔位），同一個快捷鍵做最符合當下語境的事。

13. **側邊欄的列用 `pointerup` 導頁，不是 `click`。**
    見下面「踩到的 primitives 問題」#3：pointer capture 會把 click 整個吃掉。
    `onClick` 仍然留著當鍵盤 / 輔助技術的後備（400ms 內不重複導頁）。

14. **e2e 打「正式 build + `vite preview` proxy」而不是 dev server。**
    多個代理同時在改 `apps/web/src`，dev server 只要有人存到一半語法不完整，
    整包就 pre-transform error、所有 e2e 一起紅。
    `vite build` 成功 ＝ 原始碼在那一刻是完整的，之後 preview 服務的是不會再變的靜態檔。
    `vite.config.ts` 的 `preview.proxy` 與 `server.proxy` 共用同一個 `VITE_PROXY_TARGET`。

---

## 6.5 踩到的 `@kennote/ui` primitives 問題（⚠️ **四個都已經在上游修掉了**）

> **這一節保留下來是為了記錄症狀，不是為了照抄繞法。**
> 下面四個坑當初是在這個模組裡繞過去的，後來**全部在 `packages/ui` 本體修好了**
> （對照 [`packages/ui/README.md`](../../../../../packages/ui/README.md)
> 的「這四個曾經害下游靜靜壞掉的坑」）：
> `Resizable` 先求值再呼叫、dnd 註冊改以 effect 為準（`dnd/useNodeRegistration.ts`）、
> 指標捕獲打在註冊的元素上、trigger 的 handler 組合收斂到 `components/trigger.ts`。
>
> **新的呼叫端不需要再繞。** 本模組留著的繞法是歷史包袱，
> 下次動到這幾個檔案時可以順手拆掉（拆完記得跑 `pnpm --filter @kennote/ui test`，
> 那 133 條裡有 dnd 落點與浮層堆疊的回歸）。

原始症狀（都是實測到的、會讓功能「靜靜地壞掉」的坑）：

1. **`Resizable` 的鍵盤調整與雙擊重設，在沒給 `onResizeEnd` 時完全沒作用。**
   `onResizeEnd?.(apply(size + delta))` —— optional chaining 在 `onResizeEnd` 是
   `undefined` 時**連參數都不會求值**，所以 `apply()` 沒跑。
   繞法：呼叫端一定要同時給 `onResize` 與 `onResizeEnd`。
   建議改成 `const next = apply(...); onResizeEnd?.(next);`。

2. **`useDraggable` / `useDroppable` 在 React 18 StrictMode 下會把自己註銷。**
   ref callback 先 `registerSource()`，接著 StrictMode 把掛載 effect 跑
   「setup → cleanup → setup」，而 cleanup 正好是反註冊；ref 不會再被呼叫。
   繞法：呼叫端自己用一個 effect 把節點重新 `setNodeRef()` 回去
   （相依只能放**穩定**的 `setNodeRef`，放整個回傳物件會在拖曳中把 rect 快取清掉）。
   建議把反註冊搬到真正的 unmount。

3. **`DragController.handlePointerDown()` 會在 `#root` 上 `setPointerCapture()`。**
   它用 `event.currentTarget` 決定捕獲對象，但拿到的是 React 合成事件的 `nativeEvent`，
   而 React 18 的原生監聽掛在 root container 上 —— `currentTarget` 就是 `#root`。
   後果：指標被 `#root` 捕獲，之後的 `pointerup` / `mouseup` / `click` 全部被重新指派到 `#root`，
   **整個側邊欄點了沒反應**。
   繞法：交出事件前先把 `currentTarget` 指回那一列（`Object.defineProperty`）。
   建議改用 `registerSource()` 當時記下來的 `el`。

4. **在 `Popover` / `Menu` 的 trigger 按鈕上呼叫 `stopPropagation()`，選單就永遠打不開。**
   `Popover` 把開關用的 `onClick` 掛在包住 trigger 的外層 `<span>`，擋掉冒泡等於擋掉它自己。
   繞法：trigger 只在 `pointerdown` 擋冒泡，`click` 不擋；外層容器改用
   `e.target.closest('[data-row-action]')` 判斷要不要忽略。

---

## 7. 已知限制

> 完整清單在 [`docs/qa/README.md`](../../../../../docs/qa/README.md) §2
> （shell 相關的是 C 的 O-7 / O-8 / O-10、D 的 O-12、F 的 O-26 / O-29）。

### 仍然開著

- **`/settings` 這個 URL 根本不存在。** `App.tsx` 沒有宣告這條路由，打進去會掉到
  `NotFoundRoute`；設定是 store 裡的 overlay，**不支援深連結**（QA O-12，連三輪延後）。
- **點通知跳頁後不會捲到該討論串**：`InboxRoute` 把 `discussionId` 丟掉了（QA O-7）。
- **版本預覽時，編輯器顯示的還是現在的內容。**
  `AppShell` 丟掉了 `onPreview` 的 snapshot 參數，但橫幅照樣寫「編輯已停用」
  —— 使用者會以為自己在看舊版。這是**會誤導的錯**，不是純缺功能（QA O-8）。
- **「追蹤這個頁面」藏在 ⋯ 選單第二層**，而 `page_updated` 只通知 `explicit` 訂閱者
  —— 整條鏈路通了但沒人走得到（QA O-10）。
- **`Ctrl+Shift+N`（開新視窗）未實作**，快捷鍵說明表上有標示。
- **收藏區不支援拖曳排序**（`favorites.sort_key` 欄位在，API 還沒開）。
- **AI（新對話 / Ctrl+O）是佔位**，P2。
  側邊欄底部「新對話」用的是 `sync` icon —— 80 個自建 icon 裡沒有 Notion 那顆 AI 星芒。
- **永久刪除（UI 路徑）、訪客升級、登出所有裝置**三條流程從第一輪掛到第六輪
  **都沒有實際走查過**（後端與 UI 都在，只是沒人驗）（QA O-26）。
- `SharePopover` 的 `entryPermission()` 對「沒有 `page_permissions` 條目的成員」
  **寫死 fallback `'edit'`**，對 guest 是錯的（實際是 `none`）——
  UI 會顯示比真實權限更高的值（QA O-2，連四輪延後）。
- 分享彈窗用 `goto('/page/:id')` 直接進去時**偶爾開不起來**（頂欄按鈕點得到但 popover 不出現），
  沒有穩定重現（QA O-29）。
- 內容欄左緣與 Notion 差約 8px：Notion 的 frame 右側有捲軸槽，左右留白是不對稱的
  （量到 217.5 / 232.5），我們是對稱置中。寬度本身（720）一致。

### 已經修掉、不要再照抄

- ~~搜尋的「建立者 / 日期」篩選 chips 是 UI 佔位，後端沒有對應參數~~ →
  **後端已經有了**：`GET /api/search` 收 `type` / `createdBy` / `updatedAfter` / `cursor`
  （`modules/search/routes.ts`）。**但前端 `SearchDialog.tsx` 還沒接** ——
  `creator` / `date` 兩個 chip 目前只改本地 state，不會進 query。
  這是「後端好了、前端沒有呼叫端」的老型態（QA §1 主線 2），接上去就好。
  ⚠️ 順便注意 `filter === 'title'` 目前送的是 `{ type: 'title' }`，
  但後端的 `type` 只收 `page | database` —— 這個值會被 zod 擋下來。
- ~~匯入只跳 toast~~ → **已接上**（`features/import/ImportDialog`、
  `features/export/ExportDialog`，第五輪 BUG-19：模組早就寫好了，只是沒人 import）。
- ~~guest / 唯讀使用者看得到完整編輯 UI~~ → **已修**（第六輪 BUG-32）。
- ~~分享彈窗邀不了 guest、一按就把人放進整個工作區~~ → **已修**（第六輪 BUG-31）。
- ~~手機版設定 Dialog 不是真的滿版~~ → **已修**（第六輪 BUG-33）。
- ~~`@提及 → 通知`整條鏈路從 UI 完全走不到~~ → **已修**（第六輪 BUG-30、第七輪 BUG-38/39）。
