# 功能 QA 第一輪（真實瀏覽器走查）

- 日期：2026-09-19 / 20
- 受測站台：`http://100.74.148.92:8090`（登入頁「不輸入，直接進入」與一般註冊登入都走過）
- 驗證修正時的環境：本機 `vite --port 5199` + `VITE_PROXY_TARGET=http://100.74.148.92:8090`
  （前端改動可以立刻驗證；**後端改動需要 deploy 才會在遠端生效**，見下面 BUG-3）
- 工具：`reference/tools/node_modules` 的 `playwright-core`（`chromium.launch({ channel: 'chrome' })`）
- 範圍：走查清單第 1–4 項 + RWD 抽查；第 5 項（資料庫）、第 6 項（完整 RWD 流程）未走完，列在最後。

---

## 1. 走查表

### 1.1 認證 / 帳號

| 項目 | 結果 | 備註 |
|---|---|---|
| 開放登入（不輸入，直接進入） | ✅ | 直接落到工作區首頁，自動建立「訪客 的工作區」＋「歡迎使用 kennote」 |
| 註冊 | ✅ | 建立帳號 + 預設工作區 + 第一頁 |
| email / 密碼 登入 | ✅ | |
| 重新整理保持登入 | ✅ | 首次進站的 `POST /api/auth/refresh` 回 401 是預期（還沒有 refresh cookie），不是 bug |
| 設定 → 我的帳號 | ✅ | 顯示名稱、上傳頭像、變更密碼、登出、**登入中的裝置清單**（Chrome・Windows / IP / 登入時間 / 最後活動）都渲染正確 |
| 訪客升級 / 登出所有裝置 | ⚪ 未走查 | 時間不足 |

註（非 bug，測試時要知道）：註冊頁沒有「顯示名稱」欄位，`name` 會自動用 email 的 local part。

### 1.2 側邊欄

| 項目 | 結果 | 備註 |
|---|---|---|
| 新增頂層頁面 | ✅ | |
| 新增子頁（列上的 `＋`） | ✅ | `aria-level` 正確變 2 |
| 標題輸入同步到側邊欄 | ✅ | |
| 列的 `⋯` 選單**打得開** | ✅ | |
| 列選單：重新命名 / 加入收藏 / 從收藏中移除 / 建立複本 / 移動到 / 移至垃圾桶 / 拷貝連結 / 在新分頁中開啟 | ❌→✅ **BUG-1**（已修） | 修正前**整組選單點了完全沒反應**，反而會跳到那一頁 |
| 垃圾桶：列表 / 還原 | ✅ | |
| 永久刪除 | ⚪ 未走查 | |
| 展開狀態保存（重整後） | ✅ | |
| 收合 / 展開側邊欄（`Ctrl+\`） | ✅ | 270 → 隱藏 → 270 |
| 寬度拖曳 | ✅ | 270 → 350 |
| `Ctrl+K` 搜尋（中文標題） | ✅ | |
| `Ctrl+K` 搜尋（內文關鍵字） | ✅ | |
| 搜尋 ↑↓ + Enter 跳頁 | ✅ | |
| `Ctrl+P` 快速切換 | ✅ | |
| `Ctrl+/` 快捷鍵表 | ✅ | 「開新視窗（尚未實作）」有照說明標示 |
| `Ctrl+Shift+L` 主題切換 | ✅ | |
| `Ctrl+,` 設定 | ✅ | |
| 首頁最近造訪 / 範本建立 | ✅（人工確認） | 自動化用的 `main` 選擇器抓不到，改用 body 文字確認「最近造訪 / 精選範本（會議記錄・週報・需求規格）」都在 |
| 拖曳搬移（之間 / 進裡面 / 循環拒絕） | ⚪ 未走查 | 已有 `e2e/sidebar.spec.ts` 覆蓋 |

### 1.3 編輯器

| 項目 | 結果 | 備註 |
|---|---|---|
| 輸入中英文 | ✅ | |
| Enter 分割 / Backspace 合併 | ✅ | 1→2→1，文字不掉 |
| Tab 縮排 / Shift+Tab 反縮排 | ✅ | left 501 → 533 → 501 |
| `Ctrl+B` 粗體 | ✅ | 產生 `data-marks=[{"t":"b"}]` 的 `kn-b` span |
| 選取後浮動工具列 | ✅ | `kn-popover--bubble` 出現，含型別下拉 / 顏色 / 連結 |
| `/` 選單 | ✅ | 分組完整（建議 / 基本區塊 / 媒體 / 資料庫 …），快捷提示 `#`、`-`、`1.`、`[]`、`>`、```` ``` ```` 都在 |
| Markdown 捷徑 `# `、`- `、`1. `、`[] `、`> ` | ✅（畫面上） | 型別正確轉成 `heading1 / bulletedList / numberedList / todo / quote` |
| **Markdown 捷徑存到後端的內容** | ❌→✅ **BUG-4**（已修，**前端改動需 deploy**） | 修正前重整後變成 `一級標題#`、`bullet-`、`numbered1.`、`todo[]`、`quote>` —— 前綴字元被搬到字尾 |
| `Ctrl+Z` / `Ctrl+Y` | ✅ | |
| 改完標題後內文保留 | ❌→✅ **BUG-2**（已修） | 修正前**整段內文會在 1 秒內被清空** |
| 重整後內容保留 | ✅ | BUG-4 修好之後，Markdown 捷徑建立的 block 也一字不差 |
| `@` 提及 / `[[` 頁面連結 / 拖曳把手 / block 選單 / 圖片拖放 / Escape 批次刪除 / 雙分頁即時同步 | ⚪ 未走查 | 時間不足 |

### 1.4 頁面

| 項目 | 結果 | 備註 |
|---|---|---|
| 標題編輯 | ✅ | |
| Icon（emoji picker） | ✅ | 分頁齊全（隨機 / 表情與人物 …） |
| 封面 | ✅ | 新增後 cover 元素出現 |
| 麵包屑 | ✅ | `頁面功能測試 / 私人` |
| 頂欄 `⋯` 選單 | ✅ | 字型（預設 / 襯線 / 等寬）、小字型、全寬、鎖定、拷貝連結、建立複本、移動到、匯入、匯出、版本歷史、頁面統計、快捷鍵、移至垃圾桶 |
| 分享彈窗 | ✅ | 成員列（owner / 完全存取 / 可編輯 / 可留言 / 可檢視 / 移除）都在；「公開連結」因為 `/api/health` 回 `publicShare: false` 而停用 —— 未開旗標，**記錄不算 bug** |
| 留言面板 | ✅ | 空狀態文案正確 |
| 版本歷史 | ✅ | 「目前 seq 3・3 次變更・1 人編輯」 |
| 建立複本（頁面有子頁時） | ❌ **BUG-3**（程式已修，**待 deploy**） | `POST /pages/:id/duplicate` 回 500 |
| 匯出 Markdown / HTML / CSV、匯入 Markdown | ⚪ 未走查 | 自動化在子選單上逾時，沒能確認 |

### 1.5 RWD

390×844 只做到抽屜開關的抽查（自動化選擇器逾時），**未完成**。

---

## 2. Bug 清單

### BUG-1｜側邊欄列選單的每一個項目都沒反應（已修）· 嚴重度：**高**

**重現**

1. 任一頁在側邊欄的列上 hover → 點 `⋯`
2. 點「重新命名」（或收藏 / 建立複本 / 移動到 / 移至垃圾桶 / 拷貝連結 / 在新分頁中開啟）
3. 什麼都沒發生；選單留在畫面上，而且**瀏覽器跳到了那一頁**

**根因**

`TreeRow.tsx` 把 `<Menu>` 放在列的 `<div role="treeitem">` **裡面**。浮層雖然用 `createPortal`
掛到 overlay root，但 **React 的合成事件仍然沿著 React 樹冒泡**，所以在選單項目上按下滑鼠時，
這一列的 `onPointerDown` 照樣會收到 → `useDraggable` 對這一列 `setPointerCapture()` →
之後的 `pointerup` / `click` 全被重新指派到列身上。結果是：

- 選單項目永遠收不到 `click`（`MenuItem` 的 `onSelect` 掛在 `onClick` 上）→ 動作不執行
- 列的 `onPointerUp` 反而判定成「點了這一列」→ 導頁

用 `playwright` 監聽驗證過：

```
pointerdown -> SPAN._itemLabel      ← 事件落在選單項目
setPointerCapture on DIV._row       ← 但列的 handler 也跑了
pointerup   -> DIV._row[treeitem]   ← 被重新指派
click       -> DIV._row[treeitem]   ← 選單項目沒有 click
```

**修法**（`apps/web/src/features/page-tree/TreeRow.tsx`）

加一個 `isInsideRow(e.target)` 守門，列層級的 `onPointerDown` / `onPointerUp` / `onClick` /
`onKeyDown` / `onContextMenu` 一律先確認事件真的發生在這一列的 **DOM** 子樹裡，
portal 出去的浮層事件直接忽略。

**回歸測試**：`e2e/functional-round1.spec.ts` →「側邊欄列選單的項目真的會被執行（重新命名）」

---

### BUG-2｜改完標題，剛打的內文整段被清空（已修）· 嚴重度：**最高（資料遺失）**

**重現**

1. 新增一頁，在標題打字（任何會送 `PATCH /api/pages/:id` 的操作都算：標題 / icon / 封面）
2. 點進內文打幾個字
3. **約 0.5–1 秒後，內文整段消失**，block 數退回原本的樣子，之後打字也進不去

**根因**

`apps/web/src/features/editor/useEditorHost.ts`：建立 editor 的 `useLayoutEffect`
依賴陣列裡有 `initialSeq`，而它原本是 `snapshot?.seq ?? 0`。
`PageHeader` 存標題時會 `invalidateQueries(queryKeys.snapshot(page.id))`，snapshot 一重新驗證、
`seq` 一變，這個 effect 就整段重跑：cleanup 砸掉現在的 editor 實例，再用
`builtRef` 裡那份**建立當下的舊 doc**（空白頁）重建 —— 使用者剛打的字就這樣沒了。

`initialDoc` 本來就刻意用 `(pageId, reloadToken)` 當 key 保持穩定，只有 `initialSeq` 漏掉了。

**修法**

把 seq 跟 doc 綁在一起存進 `builtRef`（`{ key, doc, seq }`），`initialSeq` 取「建出這份 doc 的那個
snapshot 的 seq」，於是它和 `initialDoc` 一樣以 `(pageId, reloadToken)` 為 key 穩定。
語意上也更正確：transport 的起始 seq 本來就該對應它手上那份 doc。

**回歸測試**：`e2e/functional-round1.spec.ts` →「改完標題之後內文不會被清空」

---

### BUG-3｜有子頁的頁面「建立複本」回 500（程式已修，**尚未 deploy 到遠端**）· 嚴重度：**高**

**重現**

```
POST /api/pages            {"workspaceId":…, "title":[{"text":"空頁測試"}]}      → 201
POST /api/pages            {"parentId":<上面那頁>, "title":[{"text":"子"}]}      → 201
POST /api/pages/<父頁>/duplicate                                                → 500 INTERNAL_ERROR
```

沒有子頁時 201（正常）；一旦有子頁就 500。UI 上表現為「建立複本」點了跳錯誤 toast、樹沒變。

**根因**

`apps/server/src/modules/pages/service.ts` 的 `duplicatePage()` 用
`ORDER BY sort_key ASC` 取出要複製的頁面，然後照那個順序 INSERT。
但 `pages.parent_id` 有指向自己那張表的外鍵（`0002_pages_blocks.sql`），
而子頁的 `sort_key` 字典序經常排在父頁**前面**（實測父頁 `zV`、子頁 `z`），
於是子頁先被 INSERT → 撞外鍵 → 整個交易回滾 → 500。
`blocks` 也是同一個形狀（`ORDER BY created_at`＋自參照外鍵），同樣有風險。

**修法**

新增 `orderParentsFirst()`，把 pages / blocks 重排成「父先於子」的前序再插入；
parent 不在這一批裡的當根，資料成環也不掉列。

**回歸測試**：`apps/server/test/pages-order-parents-first.test.ts`（4 條，已綠）
＋ `e2e/functional-round1.spec.ts` →「有子頁的頁面可以建立複本」
（這一條目前會紅，因為**遠端還跑著舊的 server**；deploy 後就會過）。

---

### BUG-4｜Markdown 捷徑的前綴字元存到後端會跑到字尾（已修，**前端待 deploy**）· 嚴重度：**高**

**重現**

1. 在空 block 輸入 `> quote`（或 `# 標題`、`- bullet`、`1. numbered`、`[] todo`）
2. 畫面正確：block 變成引用，文字是 `quote`
3. **重新整理**
4. 文字變成 `quote>`（其他型別同理：`標題#`、`bullet-`、`numbered1.`、`todo[]`）

**根因（已定位，未動手修）**

宿主把 editor 的 `localOps` 拆成**兩條通道**（`useEditorHost.ts` 的 `localOps` handler）：

- `text.delta` → OT 通道（`OtPageChannel`，**立刻送**，但三狀態機會把 delta 壓進 buffer）
- 其他 op（含 `block.update { content }`）→ tx 通道（**debounce 300ms**）

Markdown 規則（`packages/editor-core/src/input/input-rules.ts`）產生的是
`block.update { blockType, content: 去掉前綴後的內容 }`，走 tx 通道。
實際抓到的 WS 送出順序是：

```
1) text.delta  insert ">"                 baseRev 0     ← 打 ">"
2) block.update {blockType:"quote", content: []}        ← markdown 規則（tx 通道）
3) text.delta  retain 1, insert " "                     ← 打空白鍵（被 OT 狀態機 buffer 住，晚送）
```

第 3 筆是「打空白鍵」那一下的 delta，它在語意上應該被第 2 筆整段覆蓋掉，
但 OT 狀態機還握著它、之後才送出，於是伺服器把空白（以及後面打的字）套在**已經被覆蓋過**的內容上，
rev 線一錯就再也對不回來，前綴字元被留在字尾。

伺服器那邊其實已經想到這件事（`apply-transaction.ts` 會把整段覆蓋也記成一筆 delta，
讓兩條通道在同一條 rev 線上），問題純粹出在**客戶端送出的順序**。

**試過但回退的修法**

在 localOps handler 裡偵測到 `block.update { content }` 就 `sync.flush()`，
想讓它排在後續 delta 前面。實測**沒有修好**（因為第 3 筆 delta 是被 OT 狀態機 buffer 的，
flush tx 通道救不了它），而且會讓本機編輯器在某些時序下把內容清空 —— 已經回退，沒有留在 code 裡。

**實際的修法（2026-09-20 第二輪，ADR 0006 §2.9）**

比「作廢 buffer」更乾淨的做法：**不要讓 content 走 tx 通道**。
`Editor.toWireOps()`（editor-core）在 OT 模式下把每一筆「覆寫既有 block content」的
`block.update` 拆成：

```
block.update { blockType, props }   → tx 通道（LWW）
text.delta   { …diff… }             → OT 通道（同一條 rev 線）
```

與伺服器廣播時的拆法完全對稱（§2.6 的 `splitDeltaOps`）。
於是「打空白鍵」那一筆 `retain 1, insert " "` 與「整段覆寫」的 `delete 2`
在三狀態機裡被 `compose` 成 `delete 1` —— 不該存在的歷史就地被抵銷。
宿主（`useEditorHost.ts`）改成用 `splitDeltaOps(ops)` **依原順序**一組一組分流，
確保排在 delta 前面的 `block.insert` / `block.update{blockType}` 先進 tx buffer。

另外兩道防線：`OtPageChannel.dropPendingBuffer()`（真的還有 content 走 tx 時作廢 buffer）、
`OtClient.observeRev()`（別條通道推進 rev 時只對齊 rev，不動狀態機）。

**伺服器一行都沒改** —— §2.6 的行為本來就是對的，壞的是客戶端送出的東西。

**回歸測試**：`packages/editor-core/test/ot/wire-ops.test.ts`（12 條）、
`packages/editor-core/test/ot/client.test.ts`（+4 條）、
`apps/web/src/lib/ot-markdown-shortcut.test.ts`（2 條，真 Editor + 假 WS + MiniServer）、
`apps/web/src/lib/ot-client.test.ts`（+3 條）、
`apps/server/test/ot-service.test.ts`（+5 條）、
`e2e/realtime.spec.ts`（2 條）。

**線上實測**（本機 vite `:5199` + 遠端 `100.74.148.92:8090`）：
`> quote` / `# 標題` / `- bullet` / `1. item` / `[] todo` / ```` ``` ```` 各打一次，
重整後六種型別與內容全對，沒有殘留前綴。

---

### 觀察（不算 bug，但值得記一筆）

- 進入一頁會連打 **3 次** `GET /api/pages/:id/snapshot`（掛載 + 兩次 revalidate）。
  BUG-2 修好之後不會再造成資料遺失，但白做兩次請求。
- `FEATURE_PUBLIC_SHARE` 在遠端是關的（`/api/health` → `features.publicShare: false`），
  所以分享彈窗的「公開連結」不能測，照規格記錄。

---

## 3. 改了哪些檔案

| 檔案 | 內容 |
|---|---|
| `apps/web/src/features/page-tree/TreeRow.tsx` | BUG-1：portal 事件守門 `isInsideRow()` |
| `apps/web/src/features/editor/useEditorHost.ts` | BUG-2：`initialSeq` 跟著 `initialDoc` 一起以 `(pageId, reloadToken)` 為 key 穩定 |
| `apps/server/src/modules/pages/service.ts` | BUG-3：`orderParentsFirst()`，複本的 pages / blocks 父先於子 |
| `apps/server/test/pages-order-parents-first.test.ts` | 新增：BUG-3 的單元測試 |
| `e2e/functional-round1.spec.ts` | 新增：BUG-1 / BUG-2 / BUG-3 的 e2e 回歸 |
| `packages/editor-core/src/core.ts` | BUG-4：`toWireOps()` 把「覆寫 content 的 block.update」拆成 `block.update{blockType,props}` + `text.delta` |
| `packages/editor-core/src/ot/client.ts` | BUG-4：新增 `observeRev()` / `dropBuffer()` |
| `apps/web/src/lib/ot-client.ts` | BUG-4：`dropPendingBuffer()`；非本人 ack 只對齊 rev |
| `apps/web/src/features/editor/useEditorHost.ts` | BUG-4：`splitDeltaOps()` 依原順序分流兩條通道 |
| `apps/web/src/features/editor/Editor.tsx` | presence 的 block 外框 + 名牌（`decoratePresence` 原本寫好了卻沒人呼叫） |
| `packages/editor-core/test/ot/wire-ops.test.ts` | 新增：BUG-4 的線路形狀測試 |
| `apps/web/src/lib/ot-markdown-shortcut.test.ts` | 新增：真 Editor + 假 WS + MiniServer 重現 BUG-4 訊框順序 |
| `e2e/realtime.spec.ts` | 新增：Markdown 捷徑重整 + 雙分頁即時同步 + presence |

**沒有碰**任何 `.css`、`features/database/**`、`e2e/compare.spec.ts`，也沒有加套件、沒有 commit。
（BUG-4 那一輪有動 `packages/editor-core`：`core.ts` 的 `toWireOps()` 與 `ot/client.ts`，
OT property test / fuzz test 全部重跑過。）

### 驗收

```
pnpm -r typecheck                 ✅ 8/8 專案通過
pnpm --filter @kennote/web test   ✅ 14 檔 / 298 條
pnpm --filter @kennote/server test ✅ 23 檔 / 352 條（3 檔 skip：需要 DATABASE_URL_TEST）
```

`e2e/functional-round1.spec.ts` 目前 2 綠 1 紅，紅的那條是 BUG-3，**要等 server deploy**
（驗證環境是「本機前端 + 遠端舊 server」，前端修正立刻生效，後端修正不會）。

---

## 4. 未走查（留給第二輪）

1. 側邊欄拖曳搬移（之間 / 進裡面 / 循環拒絕）、永久刪除、訪客升級、登出所有裝置
2. 編輯器：`/` 選單各分組實際插入（圖片 URL / 書籤 / 表格 / 多欄 / 程式碼語言 / 折疊 / 標註 / 按鈕 / 目錄）、
   貼上（純文字 / 多行 / Markdown）、複製貼上 block、拖曳把手排序、block 選單、
   `@` 提及、`[[` 頁面連結、圖片檔案拖放、Escape 批次刪除
3. ~~**雙分頁即時同步**（雙向、同段落雙打、presence 頭像與游標名牌）~~
   → 已隨 BUG-4 一起走完，回歸測試在 `e2e/realtime.spec.ts`
4. 匯出 Markdown / HTML / CSV、匯入 Markdown
5. **整個第 5 項：資料庫**（六種視圖、欄位型別、formula 循環引用、relation / rollup、
   篩選 AND/OR、多欄排序、分組、看板 / 日曆 / 時程表拖曳、peek、CSV 匯出、1000 列效能）
6. **第 6 項：390 寬完整主要流程**（只抽查了抽屜與輸入）
