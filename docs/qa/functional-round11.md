# 功能 QA 第十一輪（殘餘佔位入口・跨頁搬移・觸控拖曳・手機版資料庫）

- 日期：2026-09-20
- 起點：`docs/qa/functional-round10.md` §7（「未修 / 留給第十一輪」的 1、2 兩項）、
  README「仍然開著」的 **O-11 / O-13 / O-15**
- 線上站 `http://100.74.148.92:8090`（仍是**第九輪**的 commit）。
  本輪的 e2e 打的是**本機 vite（`--port 5312`）+ 遠端 API**：9 條綠、4 條 `fixme`。
- **刻意沒碰**：`packages/editor-core`；沒有加 runtime 套件；沒有 git commit

> 這一輪的主題是同一個形狀的第三次出現：
> **後面那個模組早就做好了，前面那顆按鈕還在說「以後才會開放」。**
> 第五輪叫它「模組寫好了卻沒人 import」，第六輪叫它「前端沒有呼叫端」，
> 這一輪的名字是**佔位 toast**——而它比前兩種更糟，
> 因為前兩種是「沒有入口」，這一種是**有入口、而且入口會告訴你別試了**。

---

## 1. 佔位 toast 是一種主動的錯誤資訊

動手之前，repo 裡有三顆按鈕會 toast：

| 位置 | 文案 | 後面那個模組 |
|---|---|---|
| `BubbleMenu`（選取文字） | 「留言功能在 M5 才會開放」 | `features/comments/CommentPopover.tsx`（**零呼叫端**） |
| `BlockMenu`（區塊選單） | 「留言功能在 M5 才會開放」 | 同上 |
| `PageHeader`（新增留言） | 「留言功能在 M5 才會開放」 | `CommentsPanel` 的頁面層級輸入框（**一直都在**） |
| `BlockMenu`（移動到…） | 「跨頁面搬移會在 M3（頁面樹）開放」 | 後端沒有端點（這一輪補） |

留言那三顆**背後全部是通的**：`POST /api/pages/:id/discussions` 從 M5 就在、
`CommentsPanel` 掛在 `AppShell` 的右側面板上、WS 的 `comment` 事件也會讓它失效
（第十輪 R10-4 實測通過）。缺的只有「按下去之後呼叫誰」這一行。

> **佔位 toast 與「沒有入口」不是同一件事。**
> 沒有入口的功能，使用者會去找別條路（於是我們會收到「怎麼留言？」的回報）。
> 而「M5 才會開放」是一個**看起來權威的否定句**：使用者會相信它、
> 停止嘗試，而且**不會回報**——因為系統已經回答過了。
> 第十輪 BUG-47（SharePopover 對 guest 顯示「可編輯」）講的是同一件事：
> **UI 說謊會讓人不去做那件事。**

---

## 2. Bug 清單

| # | 嚴重度 | 位置 | 狀態 |
|---|---|---|---|
| BUG-53 | **高** | 手機上「開啟列 peek」的按鈕**從來沒有出現過**（hover-only） | 已修 |
| BUG-54 | 中 | 搜尋的「標題」chip 送 `type:'title'`，後端 zod 400，前端吞掉變成「找不到」 | 已修 |
| BUG-55 | 中 | 看板 / 日曆 / 屬性清單 / 排序清單走 HTML5 DnD，**觸控完全沒有路徑** | 已修 |
| BUG-56 | 中 | 留言 / 移動到的入口是佔位 toast（見 §1） | 已修（移動到**需部署**） |

另有兩個**新發現、未修**的項目，見 §7。

---

## 3. 編輯器裡的「留言」入口（交辦第 1 項）

### 3-1 錨點的順序不能反

`shared-types/comments.ts` 的檔頭寫死了策略：
**行內留言一律用 rich text 上的 `{t:'comment',id}` mark**，不用字元位移
（位移會在原文被編輯後失效，03 §4.9 的警告）。
`CommentPopover` 的檔頭也早就把順序寫好了：

1. 前端先產生 `discussionId`
2. `POST` 成功 → `onCreated(discussionId)`
3. **才**把 mark 套上去

宿主（`Editor.tsx`）這一側按這個順序接：

```
openInlineComment() → 凍結 {blockId, start, end} → <CommentPopover>
                    → onCreated → toggleMarkOps(doc, blockId, start, end, {t:'comment',id})
                    → host.applyOps(...) → setRightPanel(true,'comments')
```

**兩個地方不能省：**

- **範圍要在按下「留言」的那一刻就凍起來。**
  `editor.toggleMark()` 讀的是 `this.selection.value`，而留言輸入框一拿到焦點，
  編輯器的選取就沒了 —— 直接呼叫 `toggleMark()` 會**靜靜地什麼都不做**
  （`orderedRange()` 回 null 就 `return false`，沒有任何錯誤）。
  所以改成把 `{blockId,start,end}` 存進 state，送出時用
  `toggleMarkOps(doc, …)` 建 op 再走 `host.applyOps()`。
- **先 POST 再套 mark。** 反過來的話，POST 失敗會在文件裡留下一個
  指向不存在討論串的 mark —— 而那個 mark 會被同步出去、被別人看到、
  而且**沒有任何 UI 能讓人刪掉它**。

### 3-2 block 層級留言 = 錨點在 block 上

`BlockMenu` 的「留言」走 `openBlockComment(blockId)`：
`discussion.blockId` 就是錨點，mark 套在整段內容上；
沒有行內內容的 block（圖片 / 分隔線）**只留 blockId、不套 mark** ——
面板的 hover 高亮走 `[data-block-id]`，不依賴 mark，所以仍然指得到。

### 3-3 `PageHeader` 的「新增留言」只要把面板打開

頁面層級討論串的輸入框**本來就在** `CommentsPanel` 裡
（`createDiscussion(pageId, { anchor: { kind: 'page' } })`）。
所以這顆按鈕不需要自己的彈出框，`setRightPanel(true, 'comments')` 就結案了。

> **接線之前先找「這件事是不是已經有地方做了」。**
> 這一顆如果照著另外兩顆的形狀做，就會多出第二個頁面層級留言的輸入框，
> 兩個入口寫進同一張表、行為卻不一樣。

---

## 4. 跨頁面搬移 block（交辦第 2 項，**需部署**）

### 4-1 為什麼是新端點，不是新的 op

`Operation` 的 `block.move` **沒有 `pageId` 欄位**，而
`applyTransaction()` 的每一筆 transaction 都綁死在單一頁面上
（`pages.seq` 是頁面層級序號、`page_transactions` 逐頁記、OT 的 rev 也是）。
要讓 `block.move` 跨頁，等於同時動協定、OT、版本歷史重播三層。

所以跨頁搬移在協定上就是**剪下 → 貼上**：
來源頁一筆 `block.delete`、目標頁一筆 `block.insert`，
**兩筆在同一個資料庫交易裡**。

`POST /api/pages/:id/blocks/move-to { blockIds, targetPageId, afterId }`
（`apps/server/src/modules/blocks/move-to.ts`）。

### 4-2 ⭐ block id 不換

`insertBlock()` 的 `ON CONFLICT ... WHERE blocks.deleted_at IS NOT NULL`
本來是為了「軟刪除後復活」寫的（BUG-18 伺服器那一半），
而它會把 `page_id` 換成 EXCLUDED 的值。
於是「先刪後插、同一批 id」**正好就是一次真正的搬家**。

為什麼這一格是核心而不是實作細節：

| 認 blockId 的東西 | 換 id 之後 |
|---|---|
| 行內留言的 `{t:'comment',id}` mark | 討論串變孤兒 |
| `#blockId` 的深連結 / 「複製區塊連結」 | 連結全部失效 |
| `files.page_id` 的對應 | 附件跟不上 |

**而且三樣都不會報錯**，只是安靜地指不到東西。
所以 e2e（R11-4）第一條斷言就是 `target.recordMap.block[parent].value.id === parent`。

### 4-3 三條紅線

| 紅線 | 做法 | 理由 |
|---|---|---|
| **兩頁都要 `edit`** | `applyWithin()` 對每一頁都跑一次 `permissionGuard` | 只對目標頁有 edit 就能把別人私密頁的內容搬到自己頁面上 = 一次繞過整套頁面權限（與第十輪 §3-1 `/rebind` 同一條） |
| **鎖的順序固定** | 進交易先 `SELECT … WHERE id = ANY(…) ORDER BY id FOR UPDATE` | 兩個人同時 A→B 與 B→A，照呼叫順序鎖會互等；排序鎖之後 applyWithin 再鎖是同一交易內的 no-op |
| **不能跨工作區** | `source.workspace_id !== target.workspace_id` → 400 | 附件的儲存路徑帶 workspaceId（`buildStorageKey`），`blocks.workspace_id` 也要換，那是「複製到另一個工作區」另一件事 |

另外兩個小決定：

- **同一頁 → 400。** 同頁搬移有 `block.move`；走這支會先刪後插、
  白白多記兩筆 transaction，而且中間那一瞬間內容是不存在的。
- **同時選了父與子 → 只搬父。** 子會跟著父走；
  再單獨搬一次等於「把它從自己的父底下拔出來丟到根層」——
  使用者選了一整段，結果結構被拆平。

### 4-4 附件跟著搬

`UPDATE files SET page_id = 目標 WHERE id = ANY(…) AND page_id IS NOT DISTINCT FROM 來源`。
帶 `IS NOT DISTINCT FROM` 是刻意的：同一個 fileId 被別頁引用時（複製頁面）
那一筆的 `page_id` 已經指向別頁，改了會把**別頁的附件權限**一起換掉。
這正是第十輪回填腳本第 2 條紅線（「被多頁引用時整個跳過」）的同一個理由。

> 第九輪 O-5「附件的 page_id 不會跟著 block 搬家」在第十輪補了手動的
> `/rebind`，這一輪讓**搬家這條路自己就會做**。
> `/rebind` 仍然有用（剪下貼上走的是編輯器，不是這支端點）。

### 4-5 前端

`BlockMenu` 的「移動到…」→ `Editor` 的 `PickerPopover`（沿用「連結到頁面」那一顆，
排掉目前這一頁）→ `POST /blocks/move-to`。
頁面層級的「移動到」維持原本的 `MoveToDialog`（`movePage`），兩者不混。

---

## 5. 搜尋 chips（交辦第 3 項）

三顆 chip 原本**只有「標題」會送東西，而且送的是壞的**：

```ts
searchPages(q, workspaceId, filter === 'title' ? { type: 'title' } : {})
```

`search/routes.ts` 的 zod 是 `type: z.enum(['page','database'])` ——
`'title'` 直接 400，而前端 `.catch(() => setHits([]))` 把它吞成
**「找不到符合的頁面」**。

> ⭐ **一個會 400 的篩選器比沒有篩選器更糟。**
> 它不會壞在看得見的地方，它會給出一個**看起來合理的錯誤答案**：
> 使用者以為「這個關鍵字不在標題裡」，而事實是請求根本沒送成功。
> 這和第十輪 §1 的教訓是一組的：**沉默的失敗會被讀成資料**。

修法：

| chip | 接到哪裡 |
|---|---|
| 僅標題 | **前端過濾**（`titleMatches()`：標題文字含關鍵字才留）——不動後端契約 |
| 我建立的 | `createdBy = 目前使用者 id`（後端從 M6 就有這個參數，**零呼叫端**） |
| 最近 7 天 | `updatedAfter = now - 7d`（同上） |

`createdBy` / `updatedAfter` 又是一次「後端寫好了、型別也對，就是沒人叫它」。

---

## 6. 觸控：刪掉 `_fallback/dnd.ts`（交辦第 4 項）

第十輪 §7 排第一的項目。**目標不是「幫看板加觸控」，是刪掉那支檔案** —— 已刪。

### 6-1 換了什麼

| 呼叫端 | 舊（HTML5 DnD） | 新（`packages/ui/src/dnd`，Pointer + 長按 400ms） |
|---|---|---|
| 看板卡片換組 | `useDragHandle` / `useDropZone` | `useCardDrag` / `useCardZone` |
| 日曆卡片改日期 | 同上 | 同上 |
| `PropertyList` 排序 | **每一列自己是一個 drop zone** | `useSortableList`（整份清單一個 zone）+ `useSortableItem` |
| `SortBuilder` 排序 | 同上 | 同上 |
| 時程表 | 本來就是 Pointer | 不動 |

轉接層是 `apps/web/src/features/database/dnd.ts`（**不再放在 `_fallback/`** ——
它不是「等 packages/ui 補齊前的替代品」，它就是正式的用法）。

### 6-2 三個不明顯的決定

**① 看板 / 日曆用「整塊都是落點」，不用 `computeDropTarget`。**
那支純函式是為了「插到第幾個」設計的，而看板要的是「丟進這一欄就好」——
沒有序位的概念。所以 `resolveDrop` 回一個固定的合成 target
（controller 只在 `target !== null` 時才呼叫 `onDrop`，那個常數就是「我接受」）。
indicator 給 0×0，視覺回饋走 zone 自己的 `isOver` class。

**② 排序清單改成「整份清單一個 zone」。**
舊版每一列都是 zone，換位只看「丟在誰身上」——所以畫不出「插在兩列之間」那條線，
而且丟在列的上半 / 下半是同一個結果。
新版讓每一列標 `data-kn-dnd-item`，落點交給 `computeDropTarget(mode:'list')`。
順手處理掉那個經典的 off-by-one：`target.index` 是**移除來源之前**的插入位置，
往後搬時要 `-1`，否則「往下拖一格」會變成「原地不動」。

**③ 刻意不套 `handleProps.style`。**
`useDraggable` 回的 style 裡有 `touch-action: none` —— 套到整張卡上，
那張卡所在的欄就**不能捲**了。第十輪 BUG-50 已經把正解寫在 controller 裡了
（non-passive `touchmove`，只在 `phase === 'dragging'` 時 `preventDefault()`），
呼叫端不必、也不該再自己來。

> **同一個問題被解決兩次，就會有一次是錯的。**
> `touch-action` 是 touchstart 當下決定、之後改不動的；
> controller 的 touchmove 是「進入拖曳之後才攔」。
> 兩者同時存在時，前者會贏，而且贏的是錯的那個。

### 6-3 怎麼驗（R11-8 + R11-9 要一起看）

- R11-8：資料庫頁上**不得再有 `draggable="true"`**（舊引擎的指紋）
- R11-9：`.kn-drag-layer` 必須存在（新引擎的幽靈層）

只驗前者的話，「兩套都拔掉了」也會變綠 —— 而那正是「手機上完全沒有路徑」
的另一種寫法。**拿掉舊的與接上新的，是兩條斷言。**

---

## 7. 手機版資料庫（交辦第 5 項）+ 兩個新發現

`features/database/**` 底下原本**一條 `@media` 都沒有**（第十輪 §4 查到）。
這一輪加了 767px 斷點：

| 位置 | 改動 |
|---|---|
| `_fallback/Popover.tsx` | 新增 `sheetOnMobile`：≤767px 改成 **bottom sheet**（貼底、滿寬、有 grabber、補 `env(safe-area-inset-bottom)`） |
| `DatabaseHeader.tsx` | 篩選 / 排序 / 分組 / 屬性 / 版面 / ⋯ 六個面板都帶 `sheetOnMobile` |
| `DatabaseHeader.module.css` | 搜尋框收到 84px（focus 才展開）、工具列按鈕 28→36px 觸控目標 |
| `fallback.module.css` | 列 peek（`.dialogSide`）與置中 dialog 手機上全螢幕 |
| `TableView.module.css` | 首欄 sticky 加右側陰影、名稱欄收到 `min(160px, 46vw)`、橫捲慣性 |

**為什麼是 sheet 而不是「把 popover 縮小」**：桌機的 popover 在 390 寬時會
蓋住觸發它的那顆按鈕，而且定位演算法一旦撞到視窗下緣就翻到上面去 ——
使用者按下面的按鈕、面板出現在上面。sheet 的形狀是固定的：
永遠貼著底部、永遠滿寬、拇指構得到。

### BUG-53 · 手機上「開啟列 peek」的按鈕從來沒有出現過（**新發現**）

```css
.openButton      { display: none; }
.row:hover .openButton { display: inline-flex; }
```

**觸控裝置沒有 hover。** 所以手機上那顆按鈕不是難按，是**不存在**；
整個「打開某一列」在手機上沒有任何路徑。

第十輪 R10-8 就撞到過它：當時的紀錄是「手機寬度下找不到列 peek 的開啟鈕
（本身就是一條要查的事）」然後 `test.skip` 掉了 —— **那一行註解是對的，
但沒有人往下追一層**。追下去只要看一眼那兩行 CSS。

> **hover-only 的入口在觸控裝置上等於不存在。**
> 這是手機版走查最容易漏掉的一類缺陷：它在桌機上每一次都看得到，
> 在手機上連「難用」都算不上 —— 而走查的人通常兩邊都開著。
> 下一輪應該**掃一次全站的 `:hover` 才顯形的互動元素**（`display:none` /
> `opacity:0` + `:hover`），那是一張可以一次列完的清單。

### 新發現（**未修**）：手機上點了開啟鈕仍然沒有 peek

BUG-53 修完之後按鈕看得見、點得到，但點完 DOM 上**一個 `[role="dialog"]` 都沒有**
——`DatabaseView` 的 `setPeekRowId()` 看起來沒有讓 `RowPeek` 掛上來。
桌機同一條路是通的。

`e2e/functional-round11.spec.ts` 的 **R11-13 標成 `fixme` 並寫明現況**，
沒有調寬容值讓它變綠。
**下一輪先查「有沒有掛上來」，不要先調 CSS** ——
版面對不對是第二個問題，元件根本沒渲染是第一個。

### 新發現（**未修**）：`properties` 面板沒有任何觸發點

`DatabaseHeader.tsx` 裡 `panel?.kind === 'properties'` 有一個完整的 `<Popover>`，
但**全檔案沒有任何一處呼叫 `open('properties', …)`**。
也就是說「此視圖顯示的屬性」這個面板**打不開**
（`PropertyList` 本身是好的，第六輪 database-gaps 驗過）。
又一次「前端沒有呼叫端」，只是這次兩端都在前端。

---

## 8. 改了哪些檔案

| 檔案 | 改動 |
|---|---|
| `apps/web/src/features/editor/Editor.tsx` | 留言草稿（凍結選取範圍 + `CommentPopover`）、`PickerPopover` 的「移動到…」、`runMoveTo()` |
| `apps/web/src/features/editor/menus/BubbleMenu.tsx` | `onComment` prop；**沒給就不畫按鈕**（不要留一顆按了會說「還沒開放」的按鈕） |
| `apps/web/src/features/editor/menus/BlockMenu.tsx` | `onComment` / `onMoveTo` prop，兩顆佔位 toast 移除 |
| `apps/web/src/features/editor/PageHeader.tsx` | 「新增留言」改成打開右側面板 |
| `apps/web/src/features/search/SearchDialog.tsx` | 三顆 chip 接線（BUG-54）、`titleMatches()` |
| `apps/web/src/lib/queries.ts` | `searchPages()` 收 `createdBy` / `updatedAfter`，`type` 收斂成後端認得的兩個值 |
| `apps/web/src/features/database/dnd.ts` | **新增**：`packages/ui/src/dnd` 的轉接層 |
| `apps/web/src/features/database/_fallback/dnd.ts` | **刪除**（HTML5 DnD） |
| `apps/web/src/features/database/_fallback/index.tsx` | 不再 re-export dnd |
| `apps/web/src/features/database/views/board/BoardView.tsx` | `useCardDrag` / `useCardZone` |
| `apps/web/src/features/database/views/calendar/CalendarView.tsx` | 同上 |
| `apps/web/src/features/database/PropertyList.tsx` | `useSortableList` / `useSortableItem` |
| `apps/web/src/features/database/SortBuilder.tsx` | 同上 |
| `apps/web/src/features/database/_fallback/Popover.tsx` | `sheetOnMobile` |
| `apps/web/src/features/database/_fallback/fallback.module.css` | `.popoverSheet` + 767px 斷點 |
| `apps/web/src/features/database/DatabaseHeader.tsx` / `.module.css` | 六個面板 `sheetOnMobile`；手機工具列 |
| `apps/web/src/features/database/views/table/TableView.module.css` | BUG-53、首欄 sticky 陰影、名稱欄寬、橫捲慣性 |
| `apps/server/src/modules/blocks/move-to.ts` | **新增**：跨頁搬移（**需部署**） |
| `apps/server/src/modules/blocks/apply-transaction.ts` | `broadcastResult()` 出口（**需部署**） |
| `apps/server/src/modules/pages/routes.ts` | `POST /:id/blocks/move-to`（**需部署**） |
| `packages/shared-types/src/api.ts` | `API_ROUTES.pageBlocksMoveTo` |
| `e2e/functional-round11.spec.ts` | **新增**：13 條（9 綠 / 4 `fixme`） |
| `docs/qa/functional-round11.md` | **新增**：本文件 |

驗收：`pnpm -r typecheck` ✅ · `@kennote/web` ✅（335）
· `@kennote/server` ✅（423）· `@kennote/ui` ✅（135）
· e2e `functional-round11.spec.ts` **9 passed / 4 skipped**（本機 vite + 遠端 API）

---

## 9. 未修 / 留給第十二輪

1. **部署後解開 `functional-round11.spec.ts` 的 R11-4 / R11-5 / R11-6**
   （跨頁搬移）。照 triage §9 的教訓：解開的那一輪要**逐行看斷言**。
2. **R11-13**：手機上 `RowPeek` 沒掛上來（§7）。先查渲染，不要先調 CSS。
3. **`properties` 面板沒有觸發點**（§7）。
4. **掃一次全站 hover-only 的互動元素**（BUG-53 的一般化）。
5. O-15 仍開著：**一般 block 的觸控拖曳搬移**還是沒有替代路徑
   （這一輪換的是資料庫那四個落點，編輯器 gutter 的把手是另一條路）。
6. O-16 / O-17 / O-18（看板列選取、鍵盤替代路徑、`manualOrder`）原樣延後。
7. `permission_changed` 仍沒有發送端（連五輪）。
8. O-12（`/settings` URL 不存在）、O-14（編輯器 5 項）原樣延後。

---

## 10. 觀察

- **佔位 toast 是主動的錯誤資訊。** 「沒有入口」會讓人去找；
  「M5 才會開放」會讓人**停止尋找，而且不回報**。
  所以這一輪的做法是：接得上就接上，接不上就**不要畫那顆按鈕**
  （`BubbleMenu` 的留言鈕在沒有 `onComment` 時整顆不渲染）。
- **hover-only = 觸控上不存在。** BUG-53 在第十輪就被撞到了，
  紀錄寫著「本身就是一條要查的事」然後跳過。
  **把「要查的事」寫下來而不查，下一輪只會再抄一次。**
  第十輪自己的教訓（「『等不到』是假設，不是觀察」）在這裡以另一個形式重演。
- **量測方法錯了會長得像產品壞了。** R11-12 第一版把整份文件裡所有可捲元素
  都捲到底，於是 sticky 的首欄「移動了 406px」——那是把外層容器一起捲走。
  **量 sticky 的時候要捲的是它的捲動祖先，不是所有東西。**
  如果當下相信了那個數字，就會去「修」一個沒有壞的東西。
- **同一個問題解決兩次，就會有一次是錯的。**
  `touch-action: none`（呼叫端）與 non-passive `touchmove`（controller）
  都想擋捲動，同時存在時前者贏、而且贏的是錯的那個。
  第十輪把正解放進 controller 之後，呼叫端那一份就必須拿掉，不是「留著也沒差」。
- **「拿掉舊的」與「接上新的」是兩條斷言。** 只驗前者的話，
  「兩套都拔掉了」會變綠 —— 而那就是這一輪一開始要修的那個狀態。
