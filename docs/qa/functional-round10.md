# 功能 QA 第十輪（搜尋 guest 正例・觸控拖曳・協作即時性）

- 日期：2026-09-20
- 起點：`docs/qa/functional-round9.md` §6、`functional-round8.md` §4、
  `functional-round7.md` §4（協作 5～8、觸控 9～13）、`regression-triage-1.md` §8
- 線上站 `http://100.74.148.92:8090`（已部署到第九輪的 commit）。
  **本輪的 e2e 真的打了線上站**：8 條綠、3 條標 `fixme`（改動在後端，需部署）。
- **刻意沒碰**：`packages/editor-core`；沒有加 runtime 套件；沒有 git commit

> 這一輪先把連三輪掛著的「未驗證」那一格補成正例 —— 結果發現**它從頭到尾都是可驗證的**，
> 前兩輪「索引非同步、等不到」的判斷是錯的。
> 然後往第七輪那兩排一直沒人動的項目（協作 5～8、觸控 9～13）走，
> 在那裡撿到兩個**會默默改掉使用者資料**的洞。

---

## 1. 搜尋的 guest 過濾 —— 連三輪的「未驗證」，這一輪是正例 ✅

### 那三輪都判斷錯了

| 輪次 | 當時寫的 | 事實 |
|---|---|---|
| 第八輪 §4-2 | 「索引非同步，延遲 2.5 秒不夠」 | 索引是 **generated column**，同步 |
| 第九輪 §6-1 | 「建議直接打 repo 層，不要再等非同步索引」 | 不必，REST 就打得到 |
| triage §8-3 | 「仍未取得正例」 | 本輪取得 |

`blocks.plain_text`（`0005_search.sql`）與 `blocks.search_tsv`（`0020_search_tsvector.sql`）
都是 `GENERATED ALWAYS AS (...) STORED`：**值在同一個 `INSERT` 裡就算完了**，
`applyTransaction` COMMIT 的那一刻索引已經在。中間**沒有任何非同步的一段**。

實測（`e2e/functional-round10.spec.ts` R10-1a）：寫完 block 的**下一個請求**就搜得到，
不 sleep、不輪詢。前兩輪失敗的真正原因沒有被記錄下來，
但從症狀（「owner 自己也搜不到」）推，最可能是**沒有帶 `workspaceId`**
或關鍵字撞到斷詞規則（`kn_segment()` 對 1 個 CJK 字與英數 run 的處理不同）。

> **教訓：「等不到」是一個假設，不是一個觀察。**
> 連三輪把它當成事實抄下來，中間沒有人去看一眼那兩支 migration 的 `GENERATED` 字樣。
> **抄上一輪的結論之前，要先找到那個結論的證據在哪一行。**

### 矩陣（全部實測，R10-1a / R10-1b）

| 身分 | 標題命中 | 內文命中 | 結果 |
|---|---|---|---|
| owner（陽性對照） | ✅ | ✅ | 命中 |
| guest，**未授權** | — | — | **不命中** ✅ |
| guest，授權 `read` 後 | ✅ | ✅ | 命中 ✅ |

三格一起打是刻意的：**一格陰性夾在兩格陽性之間**才是一條完整的權限測試。
只有「guest 搜不到」會同時相容於「權限有效」與「索引壞了」兩種世界。

`search/service.ts` 的兩層（`:219` 工作區角色 + `:246` 逐列 `resolvePagePermission`）
**行為與程式碼一致，這一格結案。**

---

## 2. Bug 清單

| # | 嚴重度 | 位置 | 狀態 |
|---|---|---|---|
| BUG-47 | 中 | `SharePopover` 對 guest 顯示「可編輯」，實際是 `none` | 已修 |
| BUG-48 | **高** | rollup / CSV 讀 relation 目標時沒有再問權限 | 已修（**需部署**） |
| BUG-49 | **高** | `pointercancel` 被當成 `pointerup` → 手機上「捲動」會變成「移動」 | 已修 |
| BUG-50 | 中 | 觸控拖曳時瀏覽器會把手勢搶走（沒有 touchmove 防護） | 已修 |
| BUG-51 | 中 | 版本歷史面板對別人的編輯是瞎的 | 已修 |
| BUG-52 | **高** | 沒點進編輯器的人不會出現在 presence；資料庫頁完全沒有 presence | 已修 |
| — | 中 | 附件的 `page_id` 不跟著 block 搬家 | 已修（**需部署**，`/rebind`） |
| — | 中 | 0070 之前的附件沒有回填 | 已修（回填腳本，**需人工執行**） |

---

### BUG-47 · `SharePopover` 對 guest 顯示「可編輯」

`entryPermission()` 找不到條目就 fallback `'edit'`（第六輪 §5-14 起連四輪）。
對 guest 是**錯的**：`WORKSPACE_ROLE_BASELINE.guest === 'none'`，他其實什麼都看不到。

**為什麼比「顯示錯一個字」嚴重**：那是一個 `<select>`。
使用者看到「可編輯」→ 認為本來就給了 → **不去動它** →
**畫面上顯示的授權從來沒有被建立**。UI 說謊會讓人不去做那件事。

修法：在前端用**同一組常數**重算後端的規則（`packages/shared-types` 的
`WORKSPACE_ROLE_BASELINE` / `WORKSPACE_ROLE_CEILING` / `PAGE_PERMISSION_RANK`），
不是另外寫一份表：

1. 收集適用條目（指名這個人的 `user` 條目；非 guest 再加上 `workspace` 條目）
2. 有條目 → 取最大值；沒有 → `WORKSPACE_ROLE_BASELINE[role]`
3. 與 `WORKSPACE_ROLE_CEILING[role]` 取 min（guest 封頂 `comment`）

**刻意留下的近似**：前端只拿得到「這一頁自己的」條目，祖先鏈上的授權看不到，
所以可能顯示得比實際**低**。近似的方向是「少說」——
而原本那個 fallback 的方向是「多說」。**權限 UI 的錯誤方向必須是少說。**

---

### BUG-48 · rollup / CSV 把看不見的資料庫讀出來（**需部署**）

第八輪補的 `assertRelationTargetsReadable()` 擋的是**定義的那一刻**
（`patchSchema` / `applySchemaOps`）。但權限在定義之後會變：

- A 把 relation 指到「業績」時看得到它，**後來被撤權**
- 或 relation 是別人定義的，我只是對這張表有 `read`

這兩種情況下 `loadRollupSources()` / `loadRelationTitles()` 照樣把目標列的
**標題與數值**帶出來。**授權檢查發生在寫入時，資料卻是在讀取時流出去的。**

修法（`databases/service.ts`）：

| 改動 | 說明 |
|---|---|
| `targetCollectionIfReadable()` | 新的私有 helper：`findCollectionById` + `resolvePagePermission(read)`，帶 per-call cache |
| `loadRollupSources(schema, rows, userId, conn?)` | 多吃一個 `userId`；目標看不見 → 那個 relation 屬性的 source 留空 |
| `loadRelationTitles(..., userId)` | 目標看不見 → 那一欄整欄不解析標題（CSV 退回 pageId） |
| 6 個呼叫端 | 全部把 `userId` 接上（每一個呼叫端本來就有它） |

**看不見時回「空來源」而不是報錯**：報錯等於告訴對方「這裡有一個你看不到的資料庫」。
rollup 會算出 0 / 空字串，和「目標真的沒有列」長得一樣。

> **第九輪 §7 寫過「一份資料的出口清單要寫在一個地方」。**
> 這一輪證明那張清單還少一格：**別人資料庫的內容也會從我的資料庫流出去**。
> relation / rollup 是一條「跨物件的讀取」，它的權限不在自己身上。

---

### BUG-49 · `pointercancel` 被當成 `pointerup`（**最嚴重**）

`packages/ui/src/dnd/controller.ts` 原本：

```ts
window.addEventListener('pointerup', this.onPointerUp, true);
window.addEventListener('pointercancel', this.onPointerUp, true);   // ← 同一個 handler
```

而 `onPointerUp` 在 `phase === 'dragging'` 時走 `drop()`。

但 `pointercancel` 的語意是「**這個手勢被系統收走了**」：瀏覽器開始捲動、
來電、palm rejection。**使用者沒有放手。**

手機上的現場：側邊欄長按一頁 → 400ms 後進入拖曳 → 手指一動 →
（因為 BUG-50）瀏覽器接管捲動 → `pointercancel` →
**那一頁被搬到手指當下的位置**。使用者以為自己在捲動，頁面樹卻被改了結構，
而且沒有任何 UI 提示、沒有 undo。

修法：拆成獨立的 `onPointerCancel`，一律 `cancel()`。
（順手把 teardown 的 `removeEventListener` 也對齊 —— 註冊用哪個 handler、
哪組 options，移除就要一模一樣，否則監聽器會一直留著。）

> **拖放的錯誤方向必須是「什麼都沒發生」，不是「掉在半路」。**

---

### BUG-50 · 觸控拖曳沒有擋掉瀏覽器捲動

`useDraggable` 有回傳 `handleProps.style.touchAction = 'none'`，但：

1. 呼叫端不一定會套（`features/page-tree/TreeRow.tsx` 就**只拿了 `onPointerDown`**）
2. 就算套了，`touch-action: none` 會讓**整列都不能捲** ——
   側邊欄是一個長清單，手機上不能捲等於不能用

正確的形狀是「**平常可以捲，長按 400ms 進入拖曳之後才不能捲**」，
而 `touch-action` 是在 touchstart 當下決定、之後改不動的。

修法：掛一條 **non-passive 的 `touchmove`**，只在 `phase === 'dragging'` 時
`preventDefault()`。長按門檻之前完全不攔。

`{ passive: false }` 是關鍵 —— Chrome 對 document 層的 touchmove 預設是 passive，
`preventDefault()` 會被忽略，而且**只噴一行 console 警告**。

兩條回歸測試在 `packages/ui/src/dnd/dnd.test.tsx`（含「拖完要把監聽器拆掉」那一條 ——
一條永遠掛著的 non-passive touchmove 會讓全站的捲動變鈍）。

---

### BUG-51 · 版本歷史面板對別人的編輯是瞎的

`HistoryPanel` 的資料是 `useQuery(['page', pageId, 'history'])`。
全站只有兩個地方讓它失效：面板自己按「還原」，以及 `onResync` 的
`['page', pageId, 'snapshot']` —— 但 `invalidateQueries` 是**前綴比對**，
`...'snapshot'` **比不中** `...'history'`。

現場：兩個人開著同一頁，A 一直編輯，B 的版本歷史停在打開的那一刻，
**而且畫面上沒有任何東西說它過期了**（沒有 spinner、沒有「有新版本」）。

> **協作 UI 最糟的形狀就是「看起來是現況、其實是快照」。**

修法（`stores/sync.ts` 的 `onRemoteOps`）：遠端 op 進來時 invalidate
`['page', pageId, 'history']`，**節流 3 秒**。

節流是必要的：遠端 op 是**每一次按鍵**都來一筆，一次 invalidate = 一次 `GET /history`。
歷史的粒度是「版本」（伺服器把連續編輯折成一段），秒級的即時性完全夠用。
面板沒開時這條路是零成本的 —— `invalidateQueries` 只讓**掛載中**的元件重抓。

---

### BUG-52 · 只有「在編輯器裡點過一下」的人才在 presence 名單上

`updatePresence()` 全站**只有一個呼叫端**：`useEditorHost` 的 `selectionChange`
（`features/editor/useEditorHost.ts:344`）。
而伺服器的房間只把**送過 `{ t: 'presence' }` 的 session** 放進 `room.presence`
（`realtime/room-manager.ts`）—— `subscribe` 本身不會讓你出現在別人的頭像列上。

於是：

- 純閱讀的人（開著頁面沒點進內文）→ 別人的頭像列上**完全不存在**
- **資料庫頁**（表格 / 看板 / 日曆 / 時程表）**根本沒有編輯器** →
  一個人都不會顯示，哪怕五個人同時在改同一張表

**這就是交辦的「presence 名牌在資料庫儲存格」走不下去的真正原因：
不是名牌沒畫，是連人都還沒進名單。**

修法（`stores/sync.ts`）：attach 之後立刻 `updatePresence(pageId, null, null)`
——「我在這一頁」和「我的游標在哪」是兩件事，前者在 attach 當下就成立。
連線還沒好也沒關係：`sync-client` 會把它記進 `entry.presence`，
收到 `synced` 時照著重送一次（那條路本來就存在，是為了斷線重連寫的）。

> 第九輪 §7 寫過「基礎設施的價值常常在它第二個用途上才看得出來」。
> 這裡是同一件事的反面：**那條重送的路一直都在，只是沒有人把第一次送出去。**

---

## 3. 附件：搬家與回填（**需部署 / 需人工執行**）

### 3-1 `POST /api/files/:id/rebind`（第九輪 §6-5）

`block.move` 只能在同一頁裡搬（op 沒有 `pageId` 欄位），
所以「把圖片搬到另一頁」實際上是**剪下 → 貼上**：
原頁 `block.delete`、新頁 `block.insert`，中間那個 `props.fileId` 原封不動。
結果是新頁看得到圖、權限卻還鎖在舊頁：

| 情況 | 後果 |
|---|---|
| 舊頁比新頁**嚴** | 新頁的協作者看到破圖（**症狀是壞的**） |
| 舊頁比新頁**鬆** | 只有新頁 read 的人拿得到舊頁的附件（**安全是壞的**） |

兩個方向都錯，所以第九輪的「刻意不做」這一輪要還。

**為什麼是獨立端點、不是在 `apply-transaction` 裡掃 props**：
`apply-transaction` 是熱路徑（每一次打字），跨頁貼上是**罕見事件**。
**把成本放在罕見事件上，不要放在熱路徑上。**

**權限：兩頁都要 `edit`。**

- 新頁要 edit —— 這是一次寫入（與 `upload` 帶 `pageId` 同一條紅線）
- **舊頁也要 edit** —— 否則只要對任何一頁有 edit，
  就能把別人私密頁裡的附件「改綁」到自己的頁面上，一次繞過 0070 的全部檢查

> **放寬權限的操作，要對「放寬之前」的那一邊也有權限。**

其他紅線：不能跨工作區（儲存路徑綁 workspaceId）；
`rebindFilePage()` 帶 `page_id IS NOT DISTINCT FROM <expected>`，
兩個人同時搬同一個附件時第二個人拿到 0 列 → 回 409，不是靜默成功。

### 3-2 回填腳本 `apps/server/scripts/backfill-file-pages.ts`（第九輪 §6-4）

migration 0070 刻意沒有回填。結果是舊附件一律 `page_id IS NULL`，
退回「工作區成員限定」——**同工作區的 guest 仍然拿得到舊的私密附件**。
**0070 修的是「從今以後」，這一支修的是「在那之前」。**

```bash
export DATABASE_URL=postgres://...
pnpm --filter @kennote/server exec tsx scripts/backfill-file-pages.ts --dry-run   # 先跑這個
pnpm --filter @kennote/server exec tsx scripts/backfill-file-pages.ts
```

四條紅線（`decide()` 是純函式，`apps/server/test/files-backfill.test.ts` 釘住）：

1. **只補 NULL，永不覆蓋**
2. **被多頁引用時整個跳過，不是挑一頁** ——
   複製頁面 / 複製 block 會讓同一個 fileId 出現在好幾頁；
   隨便挑一頁 = 隨便挑一組權限，而且可能挑到比較鬆的那一組
3. **附件與頁面必須同工作區**，否則跳過
4. **可以重跑**（掃 → 決定 → `UPDATE ... WHERE page_id IS NULL`）

> 第九輪 §7 的最後一條：「**清理程式的錯誤方向必須是少做。**」
> 跳過 = 留 NULL = 維持現況（成員限定），不會比現在更差。
> 被跳過的每一筆都會印出來，人可以再看。

---

## 4. 觸控 / 手機（第七輪 §4 觸控 9～13）—— 走查結果

| # | 項目 | 結論 |
|---|---|---|
| 9a | 側邊欄樹長按拖曳 | 引擎支援（Pointer + 400ms），但被 BUG-49/50 弄壞 → **已修** |
| 9b | 看板卡片長按拖曳換組 | **觸控上沒有任何路徑**（HTML5 DnD）→ 未修，見下 |
| 9c | 日曆 / 時程表觸控拖曳 | 日曆同 9b；**時程表是 Pointer**，已因 BUG-49/50 一起受惠 |
| 11 | 手機版資料庫工具列（bottom sheet） | **沒有任何 `@media`** → 未修 |
| 12 | 手機版列 peek 全螢幕 | 同上；實測不溢出，但**不是全螢幕** |

### 9b/9c · 看板與日曆用的是 HTML5 Drag & Drop

`features/database/_fallback/dnd.ts` 的 `useDragHandle()` 回傳
`draggable: true` + `onDragStart` —— 那是 HTML5 DnD，
**行動版瀏覽器不會由 touch 觸發它**。
所以手機上「把卡片換一組」是**沒有任何路徑**的（不是難用，是不存在）。

而同一個 repo 裡已經有一套能用的引擎：`packages/ui/src/dnd`（Pointer + 長按），
時程表（`TimelineView.tsx`）用的就是它。

**沒有在這一輪動它的理由**：`_fallback/dnd.ts` 有三個呼叫端
（看板換組、欄位重排、欄寬拖曳），搬到 pointer 引擎要同時改
`BoardView` / `CalendarView` / `PropertyList` / `SortBuilder` 的落點計算，
那是一輪的量，塞進這一輪會做不完也測不到。**登記成下一輪的第一項。**

> **一個 repo 裡有兩套拖放引擎，其中一套在手機上不會動。**
> 這不是「還沒做手機版」，是**兩套實作各自定義了「可拖曳」是什麼意思**。
> 下一輪的目標不是「幫看板加觸控」，是**刪掉 `_fallback/dnd.ts`**。

### 11/12 · `features/database/**` 底下一條 `@media` 都沒有

整個資料庫模組（工具列、視圖 tab、篩選 / 排序 builder、列 peek）
**沒有任何斷點**。相對地 `shell` / `settings` / `home` / `trash` 都有 `767px` 的斷點。

實測（R10-7 / R10-8，390×844）：整頁**沒有橫向溢出**、peek **沒有比視窗寬**——
所以現況是「勉強塞得下」，不是「壞掉」。但：

- 工具列的篩選 / 排序仍是**桌機的 popover**，不是 bottom sheet
- 列 peek 是側欄寬度，不是全螢幕

這兩條的斷言在 spec 裡是**前提守門**（不溢出），不是「做對了」的正例。
真正的正例要等 bottom sheet / 全螢幕 peek 做出來才寫得出來。
**這裡明寫：未做。**

---

## 5. 協作（第七輪 §4 協作 5～8）—— 走查結果

| 項目 | 結論 | 證據 |
|---|---|---|
| 留言面板即時更新 | ✅ 通 | R10-4：B 留言 → A 的 WS 收到 `comment`；`stores/sync.ts` 的 `onComment` invalidate `discussions` |
| 通知即時 badge | ✅ 通 | R10-5：@提及 → B 的 WS 收到 `notification`（走 **user channel**，不訂閱頁面也收得到） |
| presence 名牌 | ❌ → 已修 | BUG-52 |
| presence **在資料庫儲存格** | ❌ 協定層不支援 | R10-6b |
| 版本歷史即時刷新 | ❌ → 已修 | BUG-51 |

### presence 在資料庫儲存格：協定層沒有欄位

`{ t: 'presence', pageId, blockId, selection }`（`packages/shared-types/src/ws.ts`）
**只認得 block**。資料庫的儲存格不是 block —— 它是 `pages.properties` 裡的一個 key。
所以「某人正在改這一格」在協定層**沒有辦法表達**。

要做的話得先動協定，加一個 scope：

```ts
| { t: 'presence'; pageId: string; scope:
      | { kind: 'block'; blockId: string | null; selection: [number, number] | null }
      | { kind: 'cell';  rowId: string; propertyId: string } }
```

**這一輪沒有動協定**，理由是它會同時改 `room-manager` 的 `PeerPresence`、
`PresenceAvatars`、`useEditorHost` 與所有資料庫視圖，而 BUG-52
（「連人都還沒進名單」）是它的**前置條件** —— 前置條件沒修好，
加了 scope 也只會是一個沒有人送的欄位。R10-6b 把「現在沒有 `rowId` / `propertyId`」釘住了。

---

## 6. 改了哪些檔案

| 檔案 | 改動 |
|---|---|
| `apps/web/src/features/share/SharePopover.tsx` | BUG-47：`entryPermission()` 依角色重算 |
| `apps/server/src/modules/databases/service.ts` | BUG-48：`targetCollectionIfReadable()`；`loadRollupSources` / `loadRelationTitles` 吃 userId；6 個呼叫端 |
| `packages/ui/src/dnd/controller.ts` | BUG-49：`onPointerCancel`；BUG-50：non-passive `touchmove` |
| `packages/ui/src/dnd/dnd.test.tsx` | 2 條回歸測試（取消不等於放下、只在 dragging 攔捲動且會拆監聽器） |
| `apps/web/src/stores/sync.ts` | BUG-51：`history` 節流 invalidate；BUG-52：attach 後宣告 presence |
| `apps/server/src/modules/files/routes.ts` | `POST /:id/rebind`（兩頁都要 edit） |
| `apps/server/src/modules/files/repo.ts` | `rebindFilePage()`（樂觀鎖 `IS NOT DISTINCT FROM`） |
| `apps/server/scripts/backfill-file-pages.ts` | **新增**：0070 之前的附件回填 |
| `apps/server/test/files-backfill.test.ts` | **新增**：`decide()` 的四條紅線 |
| `e2e/functional-round10.spec.ts` | **新增**：11 條（8 綠 / 3 `fixme`） |
| `docs/qa/functional-round10.md` | **新增**：本文件 |

驗收：`pnpm -r typecheck` ✅ · `pnpm --filter @kennote/web test` ✅（335）
· `pnpm --filter @kennote/server test` ✅（423）· `packages/ui` ✅（135）
· e2e `functional-round10.spec.ts` ✅（8 passed / 3 skipped）

---

## 7. 未修 / 留給第十一輪

1. **刪掉 `features/database/_fallback/dnd.ts`**，看板 / 日曆 / `PropertyList` /
   `SortBuilder` 全部搬到 `packages/ui/src/dnd`（第六輪 §5-10 起連五輪）。
   **這是下一輪的第一項** —— 它同時解掉觸控 9b/9c 與「兩套引擎」這件事本身。
2. **`features/database/**` 的手機斷點**：工具列 bottom sheet、列 peek 全螢幕。
3. **presence 的 `scope`**（資料庫儲存格名牌）。BUG-52 修完之後前置條件才成立。
4. **BUG-48 / rebind 部署後要重跑** `functional-round10.spec.ts` 的三條 `fixme`
   —— 照 triage §9 的教訓：**解開 `fixme` 的那一輪要逐行看**，不能只看變綠。
5. **回填腳本要在正式站跑一次**（先 `--dry-run`），並把
   `skippedMultiPage` 的清單人工看過。
6. `permission_changed` 仍沒有發送端（第七輪 §4-2，連四輪）。
7. 第七輪 §4 的觸控 10（`/settings` URL 不存在）、11（表格橫捲，連六輪）、
   12（編輯器 5 項）、13（`database-gaps.md` §4 的 6 項）。
8. 匯入 1000 列的耗時（第九輪 §4）部署後要量一次。

---

## 8. 觀察

- **「等不到」是假設，不是觀察。** 連三輪抄「搜尋索引非同步」，
  而那兩支 migration 上就寫著 `GENERATED ALWAYS AS ... STORED`。
  **抄上一輪的結論之前，要先找到那個結論的證據在哪一行。**
  更糟的是它讓一格權限測試掛了三輪 —— **錯誤的解釋比沒有解釋更能擋住進度**，
  因為沒有解釋的人會去查，有解釋的人不會。

- **一格陰性不是一條測試。** 「guest 搜不到」同時相容於「權限有效」與「索引壞了」。
  權限測試的最小單位是**三格**：有權限的看得到 / 沒權限的看不到 /
  **給了權限之後又看得到**。第三格才排除掉「他其實什麼都看不到」。

- **`pointercancel` 不是 `pointerup`。** 兩個事件都代表「這次指標互動結束了」，
  但一個是使用者的意圖、一個是系統的介入。共用 handler 讓「使用者想捲動」
  變成「使用者想把這一頁搬到這裡」。
  **凡是成對出現的事件，要先問「這兩個的語意一樣嗎」，不要看名字像就合併。**

- **一個能力寫在庫裡，不等於呼叫端拿得到。**
  `useDraggable` 回傳 `handleProps.style.touchAction = 'none'`，
  而 `TreeRow` 只解構了 `onPointerDown` —— 型別是對的、行為是缺的。
  **把「必須一起用」的東西拆成兩個回傳值，就是在等人只拿一個。**
  （這一輪的修法反而是把它從呼叫端**收回引擎裡**：
  引擎自己掛 touchmove，呼叫端不必知道有這件事。）

- **前綴比對的快取失效，會在「相鄰的 key」上無聲地失手。**
  `invalidateQueries(['page', id, 'snapshot'])` 看起來像「讓這一頁失效」，
  實際上只中 `snapshot` 那一支。`history` 就在隔壁，四輪沒有人發現。
  **快取 key 的設計要讓「該一起失效的」共用前綴**，
  否則每加一支 query 就是一次新的漏接。

- **「還沒做」與「做不到」要分開寫。**
  「presence 名牌在資料庫儲存格」看起來是一條 UI 工作，
  實際上卡在兩層：協定沒有欄位（做不到），以及沒有人送出第一次 presence（還沒做）。
  **把它寫成一條「未做」會讓下一輪去畫名牌，然後發現畫不出來。**

- **兩套實作各自定義同一個詞。** `_fallback/dnd.ts` 與 `packages/ui/src/dnd`
  都叫「拖放」，但一套在手機上不存在。
  下一輪的目標不是「幫看板加觸控」，是**刪掉其中一套** ——
  **能力的缺口靠補，一致性的缺口只能靠刪。**

- **修分工比修症狀便宜（第九輪 §7 的同一句，第二個現場）。**
  BUG-52 的修法是一行 `sync.updatePresence(pageId, null, null)`，
  因為「重送 presence」那條路早就存在（為了斷線重連寫的）。
  而如果照症狀修（「資料庫視圖也去呼叫 updatePresence」），
  就會在每一個視圖裡各寫一次，而且純閱讀的人仍然不見。
  **問「誰應該負責宣告這件事」，而不是「哪個畫面漏了」。**
