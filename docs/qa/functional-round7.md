# 功能 QA 第七輪（權限下推到查詢層・編輯路徑的通知扇出）

- 日期：2026-09-20
- 受測站台：`http://100.74.148.92:8090`
  （開始前 `/api/health`：`status: ok`、`migrations.pending: 0`、
  `latest: 0060_timeline_view.sql`、`features: { realtime: true, ot: true, publicShare: false }`，
  `uptime` 從 10 秒開始數 —— 第六輪的後端修正**這一輪確認已經部署**）
- 驗證修正的環境：本機 `vite --port 5308 --strictPort` + `VITE_PROXY_TARGET=http://100.74.148.92:8090`
- 工具：`e2e/` 的 `@playwright/test`；探索階段照第六輪的作法用 node `fetch` 直打遠端
- 範圍：第六輪 §5 的 1～6（權限洩漏 + 協作鏈路）與能在時限內走完的走查項
- **刻意沒碰**：`packages/editor-core`

> 這一輪的方法與第六輪相同：先用 API 把每條鏈路刷過去，再回頭看前端。
> 結果是**第六輪的結論之一被推翻了**——
> §5-1 寫「guest 看得到每一頁的標題（點進去才 404）」，
> 實測**點進去是 200，而且拿得到整份 recordMap**。
> 洩漏的從來不只是標題。

---

## 1. 走查表

### 1.1 權限是否下推到查詢層（本輪主題）

| 端點 | 修正前（遠端實測） | 修正後 |
|---|---|---|
| `GET /api/pages/:id` | ❌ **200**，guest 拿得到標題與 meta | ✅ 404 |
| `GET /api/pages/:id/snapshot` | ❌ **200**，整份 recordMap（所有 block 內容） | ✅ 404 |
| `GET /api/workspaces/:id/tree` | ❌ 每一頁的標題與結構 | ✅ 只有被授權的子樹 |
| `GET /api/trash` | ❌ 所有人的已刪頁面標題 | ✅ 只有看得到 / 有權處置的 |
| `GET /api/recent` | ❌ 只要去過就列（而「去過」本來就擋不住） | ✅ 逐頁過濾 + `visit` 端點補檢查 |
| `GET /api/pages/favorites` | ❌ guest 可以收藏別人的頁面，清單就顯示標題 | ✅ 收藏端點要 `read`，清單再過濾一次 |
| `POST /api/pages/:id/duplicate` | ❌ **201**，guest 複製整棵子樹 | ✅ 403 / 404 |
| `POST /api/pages/:id/transactions` | ✅ 404（第五輪就對了） | ✅ 不變 |
| `PATCH / DELETE / move` | ✅ 403（第五輪 BUG-27） | ✅ 不變 |
| `DELETE /api/pages/:id/permanent` | ✅ 403（第六輪 BUG-29，**本輪確認已部署**） | ✅ 不變 |

### 1.2 通知（7 種型別）

| 型別 | 修正前 | 修正後 |
|---|---|---|
| `mention`（留言 body） | ✅ | ✅ |
| `mention`（**頁面 block**） | ❌ 沒有任何發送端 | ✅ **BUG-38**（差集 + 節流 + groupKey） |
| `comment_reply` | ✅ 本來就有（第六輪已驗） | ✅ |
| `comment_resolved` | ✅ | ✅ |
| `page_shared` | ❌ 沒有發送端 | ✅ **BUG-39** |
| `invite` | ❌ 沒有發送端 | ✅ 一起補（已有帳號的人才收得到） |
| `permission_changed` | ❌ | ❌ 未補（與 `page_shared` 重疊，見 §5） |
| `page_updated` | ❌ | ✅ 接上 `explicit` 訂閱者（dead code 復活） |

### 1.3 §5 走查（第六輪列的 16 項，本輪走完 5 項）

| 項目 | 結果 |
|---|---|
| 版本預覽期間不送 tx | ✅ e2e 實測：進入預覽 → 打字 → `POST /transactions` **0 次**，橫幅顯示「編輯已停用」 |
| 還原成為新版本 | ✅ `restore@3 → { newSeq: 4 }`，`currentSeq` 3 → 4，歷史 append-only |
| 清空垃圾桶 | ✅ guest `{ deleted: 0, skipped: 1 }`、owner `{ deleted: 1, skipped: 0 }`，之後垃圾桶空 |
| guest 在整頁資料庫的唯讀 | ⚠️ 前端已在第六輪接上 `usePagePermission`；**後端**的 database 端點本輪沒走完 → §5 |
| 觸控側邊欄拖曳 | ✅ 第六輪已實測（`html.kn-dragging === true`），本輪未重測 |

---

## 2. Bug 清單

### BUG-35｜baseline `none` 的 guest 讀得到工作區裡**任何**頁面的完整內容（已修，**需部署 server**）· 嚴重度：**最高**

**重現**（遠端站台實測，node `fetch` 直打 API）

1. A 開工作區、建一頁「絕密：薪資表」，在 block 裡寫「CEO 年薪 1234 萬」
2. A 把 B 邀成 **`guest`**（`WORKSPACE_ROLE_BASELINE.guest === 'none'`），
   **完全不給 B 任何頁面授權**
3. B `GET /api/pages/:id` → **200**，拿到標題
4. B `GET /api/pages/:id/snapshot` → **200**，`含機密字串? true`

```
[B guest] GET /pages/:id  -> 200 title: [{"text":"絕密：薪資表"}]
[B guest] GET /snapshot   -> 200 含機密字串? true
[B guest] 寫入            -> 404 PAGE_NOT_FOUND     ← 寫入一直是對的
```

**根因**

第六輪為了「工作區外的被授權者」加的 `findVisiblePage()`：

```ts
async function findVisiblePage(pageId: string, userId: string) {
  const row = await repo.findPageForUser(pageId, userId);
  if (row) return row;                       // ← 成員直接放行，權限**完全沒問**
  if ((await resolvePagePermission(userId, pageId)) === 'none') throw pageNotFound();
  ...
}
```

`findPageForUser()` 只 JOIN `workspace_members`，回答的是
「你是不是這個工作區的人」——與 BUG-29 的根因是**同一支查詢、同一個誤用**。
權限檢查被寫成「成員走不到的 fallback」，結果成員（含 guest）永遠跳過它。

這個洞比第六輪記的「樹洩漏標題」嚴重一個數量級：樹洩漏的是標題，
這裡洩漏的是**整份 recordMap**。第六輪之所以沒抓到，是因為報告寫的是
「點進去才 404」——那句話沒有被實測驗證過。

**修法**

`findVisiblePage()` 改成**一律先問** `resolvePagePermission()`，
成員與非成員走同一道檢查，`none` → 404。
`repo.findPageForUser()` 退回它該做的事：拿列。

**一起補的**：`POST /:id/favorite` 補 `requirePagePermission(..., 'read')`、
`recordPageVisit()` 補同一道檢查 —— 這兩支也是「只看成員身分」，
而且它們會把別人的標題複製到我的收藏 / 最近清單裡（等於繞過任何清單過濾）。

---

### BUG-36｜只有 `read`（甚至 `none`）的人可以 duplicate 整棵子樹（已修，**需部署**）· 嚴重度：**高**

第六輪 §5-13 記著「下一輪確認」。**確認了：guest 回 201。**

```
[B guest] duplicate -> 201  複製成功！
```

`duplicatePage()` 只有 `findPageForUser()`，一行權限檢查都沒有。
而且複本的 `created_by` 是複製者 → 依 `resolvePermission()` 的
「建立者視同 full」，他對複本有**完整權限**。唯讀被完全繞過，
而且原始頁面的內容就這樣長期留在他手上。

**修法**：`requirePagePermission(userId, pageId, 'edit')`。
要 `edit` 不要 `read` —— 複製會在**同一個工作區**裡長出新頁面，那是寫入動作。
「讀者也想留一份副本」應該是另一支「複製到我的工作區」，不是這一支。

---

### BUG-37｜頁面樹 / 垃圾桶 / 最近 / 收藏沒有 per-page 過濾（已修，**需部署**）· 嚴重度：**高**

第六輪 §5-1、§5-2。四支都是「只在 route 層驗成員身分，SQL 裡沒有任何 per-page 條件」：

```
[樹] guest 看到 4 個節點: ["歡迎使用 kennote","絕密：薪資表","要分享的頁","絕密的子頁"]
[B guest] recent    -> ["絕密：薪資表"]
[B guest] favorites -> ["絕密：薪資表"]
[B guest] trash     -> ["絕密：薪資表"]
```

**修法：一次查詢 + 記憶體折疊（`permissions/bulk.ts`）**

不能對每一頁呼叫 `resolvePagePermission()`：那是 2 次查詢 × N 頁
（1000 頁 = 2000 次往返）。新的 `buildPermissionIndex()` 最多 3 次查詢：

1. `workspace_members` → 我的角色。**owner / admin 直接放行**，後面兩查都省掉
2. `page_permissions`（整個工作區）→ **一條條目都沒有**時，member 的 baseline
   就是 `edit`，整個工作區直接放行（與 `search/service.ts` 的
   `workspaceNeedsRefinement` 同一個判斷，03 §7.4 的效能陷阱）
3. `pages` 的 `(id, parent_id, inherits_permissions, created_by)`

然後在記憶體裡沿祖先鏈折疊。為了不讓批次與單頁算出兩套答案，
`resolve.ts` 被重構成 **fold → resolveFold** 兩段：

```
resolvePermission(entries)  = resolveFold(role, foldEntries(entries))     ← 單頁
buildIndexFrom(nodes,entries) = 每頁 resolveFold(role, 沿鏈 combineFolds) ← 批次
```

`ChainFold` 是可結合的（`combineFolds`），所以「這一頁的條目 ⊕ 父頁的 fold」
就是「這一頁的 fold」，memoize 之後整棵樹是 **O(N)**。
baseline / ceiling / 建立者視同 full / 非成員封頂 `edit` 全都只寫在 `resolveFold()` 一個地方。

**樹的形狀**：看不見的節點整個拿掉，看得見的往上掛到**最近的可見祖先**
（沒有就掛根），`hasChildren` 依可見的子節點重算。
**刻意不做「祖先佔位節點」**：佔位還是會洩漏「這條路徑有幾層」，
標題遮掉之後在側邊欄就是一串「未命名」，比直接掛根更難用；
而且掛根不必改任何型別或前端元件（前端組樹只認 `parentId`）。

**垃圾桶**多一條規則：已刪除的頁面對任何人都是 `resolvePagePermission() === 'none'`，
所以問的是兩件事的聯集 ——「如果它還在，你看得見嗎」(`buildPermissionIndex`) ∪
「你有沒有資格處置這份殘骸」(`canControlTrashedPage`，第六輪 BUG-29 的判斷)。
少了第二條，自己建立、自己刪掉、從來沒有授權條目的頁面，guest 就再也找不回來。

**效能**：`apps/server/test/permissions-bulk.test.ts` 的最後一條量 1000 頁
（10 棵樹 × 深度約 10、40 條授權條目）：折疊 + 過濾 **< 200ms**（實測約 9ms）。

---

### BUG-38｜頁面 block 裡的 `@提及` 不會產生通知（已修，**需部署**）· 嚴重度：**中**

第六輪 §5-3。`fanOutNotifications()` 只在 `comments/service.ts` 被呼叫過，
編輯器的 `MentionMenu` 插得出正確的 mention atom —— **白插的**。

**修法**：在 `applyTransaction` 上開一個出口（`setTransactionNotifier`，
與 `setBroadcaster` / `setPermissionGuard` 同一個模式，由 `realtime/index.ts` 接上），
實作在新檔 `notifications/fanout.ts`。

**差集**是這一條的重點：`@` 不是一次性事件，而是內容的一部分，
每打一個字整段 content 都會再進來一次。所以 `applyOne()` 在三個地方
（`block.insert` / `block.update{content}` / `text.delta`）記下
「這個 block 變更前後的提及集合」，只有**新出現**的才通知：

```ts
diffMentions(blockId, before, after)   // 舊的 → null
```

`text.delta` 的 `before` 是從 `receiveDelta()` 多回傳一個 `previous` 拿的
（它本來就要讀現況才能套 delta，**沒有增加任何查詢**）。

防洗版總共三層：差集 → 行程內節流（同一「頁 × 編輯者」5 分鐘只跑一次
訂閱者扇出）→ `groupKey`（真的寫進資料庫時再由 `uq_notif_group` 去重，跨行程也成立）。

**一起接上的兩塊 dead code**（第六輪 §5-4、§5-5）：

- `listPageSubscribers()` 加上 `kinds` 篩選，扇出 `page_updated` 給
  **`explicit`** 訂閱者。刻意不通知 `auto`（「編輯 / 留言過就自動加」）——
  那等於每個協作者都被洗版（01 §6 M5.3.3 的通知風暴警告）。
  第六輪補的 TopBar「追蹤這個頁面」從這一刻起才真的有意義。
- `notificationGroupKey()` 現在有三個呼叫端（`mention` / `page_updated` / `page_shared`），
  repo 裡那條 5 分鐘去重的 `ON CONFLICT` 不再是裝飾品。

紅線與留言的扇出一致：**被 @ 的人沒有這一頁的讀取權限就不通知**
（不能靠 @ 探測私密頁面的存在）。

---

### BUG-39｜「頁面被分享給你」不會通知（已修，**需部署**）· 嚴重度：**中**

第六輪 §5-6：7 種型別只有 3 種產得出來。本輪補 `page_shared`（`setPagePermission`
成功後扇出）與 `invite`（`inviteMember` 對已有帳號的人扇出）。
兩者都 fire-and-forget：通知失敗不能讓授權本身失敗。

沒有它，被分享的人只能等別人把網址貼過來 —— 側邊欄的「與我共用」
（第六輪新增）也要等他下次重新整理才看得到。

---

## 3. 改了哪些檔案

| 檔案 | 內容 | 需部署 |
|---|---|---|
| `apps/server/src/modules/permissions/resolve.ts` | 重構成 `foldEntries` / `combineFolds` / `resolveFold`；`resolvePermission` 改走同一條路 | ⚠️ **後端** |
| `apps/server/src/modules/permissions/bulk.ts` | **新檔**：`buildPermissionIndex` / `buildIndexFrom` / `filterTree` / `canSee` | ⚠️ **後端** |
| `apps/server/src/modules/workspaces/repo.ts` + `routes.ts` | **BUG-37**：`getWorkspaceTree(workspaceId, userId, role)` | ⚠️ **後端** |
| `apps/server/src/modules/pages/service.ts` | **BUG-35** `findVisiblePage` 一律問權限；**BUG-36** `duplicatePage` 要 `edit`；**BUG-37** `listTrash` 過濾 | ⚠️ **後端** |
| `apps/server/src/modules/pages/repo.ts` | `findPageActors()`（垃圾桶批次判斷） | ⚠️ **後端** |
| `apps/server/src/modules/pages/routes.ts` | `POST /:id/favorite` 補 `read` 檢查 | ⚠️ **後端** |
| `apps/server/src/modules/pages/favorites.ts` | **BUG-37**：`listFavorites` / `listRecent` 過濾 | ⚠️ **後端** |
| `apps/server/src/modules/recent/{service.ts}` | **BUG-37**：`listRecentPages` 過濾、`recordPageVisit` 補檢查 | ⚠️ **後端** |
| `apps/server/src/modules/blocks/apply-transaction.ts` | **BUG-38**：`diffMentions` + `setTransactionNotifier` | ⚠️ **後端** |
| `apps/server/src/modules/blocks/ot-service.ts` | `ReceiveDeltaResult.previous`（差集用，不增加查詢） | ⚠️ **後端** |
| `apps/server/src/modules/notifications/fanout.ts` | **新檔**：block 提及 / `page_updated` / `page_shared` / `invite` 的扇出 | ⚠️ **後端** |
| `apps/server/src/modules/notifications/{service,repo}.ts` | `listPageSubscribers(pageId, kinds)` 接上 | ⚠️ **後端** |
| `apps/server/src/modules/permissions/service.ts` | **BUG-39**：`setPagePermission` / `inviteMember` 扇出通知 | ⚠️ **後端** |
| `apps/server/src/modules/realtime/index.ts` | 接上 `registerTransactionNotifier()` | ⚠️ **後端** |
| `apps/server/test/permissions-bulk.test.ts` | **新檔**：12 條（含 1000 頁 < 200ms） | — |
| `apps/server/test/mention-diff.test.ts` | **新檔**：6 條 | — |
| `e2e/functional-round7.spec.ts` | **新檔**：9 條（6 條 `test.fixme` = 等後端部署） | — |

**前端一行都沒改** —— 這一輪的問題全部在後端的查詢層。
沒有碰 `packages/editor-core`、沒有加 runtime 套件、沒有 git commit。

### 驗收

```
pnpm -r typecheck                    ✅ 8/8 專案通過
pnpm --filter @kennote/web test      ✅ 17 檔 / 333 條
pnpm --filter @kennote/server test   ✅ 27 檔 / 403 條（新增 18 條；3 檔 skip：需要 DATABASE_URL_TEST）

BASE_URL=http://127.0.0.1:5308 npx playwright test functional-round7.spec.ts
                                     ✅ 3 passed / 6 fixme
```

6 條 `test.fixme` 全是本輪的**後端**修正（BUG-35～39），
**部署後把 `test.fixme` 改回 `test` 就會綠**。
現在跑它們會紅 —— 斷言寫的是修好之後的行為，紅得很有價值。

寫測試時踩到的點（留給下一輪）：
- `api()` helper 不能無條件帶 `content-type: application/json`：
  fastify 對「有 content-type 卻沒有 body」一律回 400
  （第六輪的 helper 已經處理了，探索腳本重寫時又踩一次）
- `GET /snapshot` 的形狀是 `{ pageId, seq, rootBlockIds, recordMap }`，
  block id 要從 `rootBlockIds` 拿
- 版本歷史面板：`aside[aria-label="版本歷史"]`，版本是 `ul li button`，
  預覽橫幅是 `role="status"` 且含「編輯已停用」

---

## 4. 未走查 / 未修（留給第八輪）

### 權限

1. **database 端點的 per-page 權限**沒走完（`/api/databases/**`：查詢、改儲存格、
   改屬性、批次操作）。前端在第六輪已經鎖上，但後端是不是每一支都問過權限、
   還是又一次「只看成員身分」，需要照本輪的方法把每一支刷過去。
   BUG-35 / BUG-36 的型態（`findPageForUser` 被當成權限檢查）很可能還有第三個現場 ——
   **建議直接 grep `findPageForUser`，逐一確認每個呼叫端旁邊有沒有 `requirePagePermission`**。
2. `permission_changed` 通知仍沒有發送端（與 `page_shared` 的語意重疊，
   要先決定「降權 / 移除授權」要不要通知 —— 通知等於告訴對方「你被踢了」）。
3. `SharePopover` 的 `entryPermission()` 對 guest 寫死 fallback `'edit'`（第六輪 §5-14，未動）。
4. WS 的 `subscribe` 走 `resolvePagePermission()`，但**頁面權限被撤銷時不會把人踢出房間**
   ——已經連上的 guest 會繼續收到 `txBroadcast`。本輪沒走查，下一輪確認。

### 協作

5. 點通知跳頁後不會捲到討論串（第六輪 §5-7，`InboxRoute` 丟掉 `discussionId`）。
6. 版本預覽時編輯器顯示的還是現在的內容（第六輪 §5-8）—— 本輪確認
   「預覽期間不送 tx」是對的，但**畫面上的字仍然是現況**，橫幅寫「編輯已停用」
   會讓人以為看到的就是那個版本。
7. `restoreVersion` 超過 200 ops 會切成多筆 transaction，整批不是 atomic（第六輪 §5-9）。
8. `page_updated` 目前只通知 `explicit` 訂閱者，而 UI 上「追蹤這個頁面」
   藏在 ⋯ 選單第二層，實際上幾乎不會有人是 `explicit` —— 這條鏈路**通了但沒人走**。

### 觸控 / 手機 / 其他

9. 看板 / 日曆 / `PropertyList` / `SortBuilder` 的 HTML5 DnD（第六輪 §5-10）。
10. `/settings` 這個 URL 不存在（第六輪 §5-11）。
11. 資料庫表格橫捲（連續五輪沒碰）。
12. 編輯器 5 項：媒體 URL、拖放上傳、程式碼語言切換、block selection 的複製貼上、
    Word/GDocs 剪貼簿（第五輪 §4-5～9）。
13. `database-gaps.md` §4 的 6 項。

---

## 5. 觀察

- **「一支只回答成員身分的查詢」被當成權限檢查，這是第三次了。**
  第五輪 BUG-27（`patchPage` / `deletePage` / `movePage`）、
  第六輪 BUG-29（`permanentlyDeletePage`）、本輪 BUG-35 + BUG-36
  （`getPage` / `getSnapshot` / `duplicatePage`）——
  每一次的根因都是 `findPageForUser()` 的那個 INNER JOIN。
  它的名字（"forUser"）讀起來就像「這個使用者能拿到的頁面」，但它只 JOIN
  `workspace_members`。**建議直接把它改名成 `findPageInUserWorkspace()`**，
  或者讓它回傳的型別帶一個必須被消費的 `permission` 欄位，讓「忘記問權限」編不過。
- **報告裡沒有實測支撐的句子會變成下一輪的盲點。**
  第六輪 §5-1 寫「guest 看得到標題（點進去才 404）」——括號裡那句是推論，
  不是實測，而它讓一個「整份內容外流」的洞被降級成「標題洩漏」記了一輪。
  以後寫「應該會 404」這種句子時，要嘛當場打一次 API，要嘛明寫「未驗證」。
- **權限下推到查詢層需要一個共用的原語，否則每個清單端點都會各自重新發明。**
  搜尋在 M7 就做了兩層過濾，但那套邏輯埋在 `search/service.ts` 裡沒有抽出來，
  所以樹 / 垃圾桶 / 最近 / 收藏四支都是裸的。這一輪的 `permissions/bulk.ts`
  就是那個原語；**新的清單端點應該先問「我的 PermissionIndex 在哪」**。
- **把純函式拆成 fold + reduce，批次版就不會與單頁版分家。**
  `resolvePermission()` 原本是「entries → 權限」一整塊，要做批次只能整段複製 ——
  複製出來的那一份遲早會與原版不同步（而權限邏輯分家 = 安全漏洞）。
  拆成 `foldEntries` / `combineFolds` / `resolveFold` 之後，
  baseline、ceiling、建立者視同 full、非成員封頂 edit **只存在一個地方**。
- **「@提及」不是事件而是狀態，所以通知必須做差集。**
  留言的 body 是一次性提交（送出就定版），block 的 content 每個 keystroke 都會重送。
  同一個 `extractMentionedUserIds()` 在兩條路上的語意完全不同 ——
  這類「同一份資料、不同生命週期」的地方值得在程式裡寫清楚，
  否則下一個人會直接把 `fanOutNotifications()` 接上去然後洗爆收件匣。
- 測試環境：`POST /api/auth/open` 的 rate limit 這一輪又撞到，
  探索腳本的 backoff（1.5s × n，最多 6 次）是必要的；
  本機 vite 代理時頂欄仍顯示「尚未連線」（WebSocket 沒跟著 proxy），與三～六輪相同。
