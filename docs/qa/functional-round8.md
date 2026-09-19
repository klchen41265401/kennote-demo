# 功能 QA 第八輪（權限總掃・資源 × 角色 × 動作）

- 日期：2026-09-20
- 受測站台：`http://100.74.148.92:8090`
  （開始前 `/api/health`：`status: ok`、`migrations.pending: 0`、
  `latest: 0060_timeline_view.sql`、`features: { realtime: true, ot: true, publicShare: false }`，
  `uptime` 從 12 秒開始數 —— **第七輪的後端修正這一輪確認已經部署**：
  guest 的 `GET /api/workspaces/:id/tree` 與 `GET /api/trash` 都回 `[]`，
  `GET /pages/:id` 與 `/snapshot` 都是 404）
- 工具：探索階段 node `fetch` 直打遠端（`POST /api/auth/open` 開兩個帳號，A 邀 B 當 guest）；
  回歸用 `e2e/functional-round8.spec.ts`（`@playwright/test`）
- 範圍：第七輪 §4「權限」1～4 + 交辦的資源清單（databases / files / comments / history /
  search / public share / workspaces / auth sessions / notifications / export / import）
- **刻意沒碰**：`packages/editor-core`

> 這一輪只做一件事：**把第七輪的方法（實測每一支，不推論）套到剩下的每一個資源上**。
> 第七輪 §4-1 的猜測是對的 —— `findPageForUser` 的誤用**還有第四、第五、第六個現場**，
> 而且最大的那一個（整個 `databases` 模組）比 BUG-35 更嚴重：
> BUG-35 洩漏的是**讀**，databases 連**寫**都是敞開的。
> guest 可以刪掉別人資料庫裡的列與視圖，而且刪得掉 = 資料真的不見。

---

## 1. 權限矩陣（資源 × 角色 × 動作）

角色定義：**owner** = 工作區擁有者（也是所有測試資料的建立者）、
**guest** = 被邀進同一個工作區但**沒有拿到任何頁面授權**的成員
（`WORKSPACE_ROLE_BASELINE.guest === 'none'`）。
「期待」欄寫的是修好之後應有的行為；「實測」是**遠端站台跑出來的實際回應碼**。

### 1.1 資料庫（`/api/databases/**`）— ❌ **全滅**

載體頁（`collections.page_id`）對 guest 是 404（第七輪已修），
但資料庫本身**一道檢查都沒有**：

| 端點 | 動作 | owner 期待/實測 | guest 期待 | guest 實測 | 修後 |
|---|---|---|---|---|---|
| `GET /api/databases/:id` | 讀 | 200 / ✅200 | 404 | ❌ **200（含 schema）** | ✅ |
| `GET /api/databases?workspaceId=` | 讀（清單） | 200 / ✅200 | `[]` | ❌ **列出每個資料庫的名字** | ✅ |
| `GET /:id/rows` | 讀 | 200 / ✅200 | 404 | ❌ **200（整份列資料）** | ✅ |
| `GET /:id/export.csv` | 讀 | 200 / ✅200 | 404 | ❌ **200（整張表 CSV）** | ✅ |
| `POST /:id/schema/preview-cast` | 讀 | 200 / ✅200 | 404 | ❌ **200（回筆數統計）** | ✅ |
| `POST /:id/rows` | 寫 | 201 / ✅201 | 403 | ❌ **201** | ✅ |
| `PATCH /:id/rows/:rowId` | 寫 | 200 / ✅200 | 403 | ❌ **200（改掉別人的儲存格）** | ✅ |
| `DELETE /:id/rows/:rowId` | 寫 | 204 / ✅204 | 403 | ❌ **204（別人的資料真的不見）** | ✅ |
| `POST /:id/rows/reorder` | 寫 | 200 / ✅200 | 403 | ❌ **200** | ✅ |
| `POST /:id/rows/:rowId/duplicate` | 寫 | 201 / ✅201 | 403 | ❌ **201** | ✅ |
| `PATCH /:id/schema` | 寫 | 200 / ✅200 | 403 | ❌ **200（回應還附整份 schema）** | ✅ |
| `POST /:id/views` | 寫 | 201 / ✅201 | 403 | ❌ **201** | ✅ |
| `PATCH /:id/views/:viewId` | 寫 | 200 / ✅200 | 403 | ❌ **200** | ✅ |
| `DELETE /:id/views/:viewId` | 寫 | 204 / ✅204 | 403 | ❌ **204（視圖真的不見）** | ✅ |
| `POST /:id/views/:viewId/duplicate` | 寫 | 201 / ✅201 | 403 | ❌ **201** | ✅ |
| `POST /api/databases`（`parentId` = 別人的頁） | 寫 | 201 | 403 | ❌ **只驗成員身分** | ✅ |
| relation 目標 collection | 讀 | — | 404 | ❌ **完全沒問** | ✅ |

> **探索腳本的副作用就是證據**：guest 的那一輪跑完之後，
> owner 再打同一批端點拿到一串 404 —— 因為**列和視圖已經被 guest 刪掉了**。

### 1.2 頁面（第七輪修過的 + 這一輪新發現的漏網）

| 端點 | 動作 | guest 期待 | guest 實測 | 修後 |
|---|---|---|---|---|
| `GET /api/pages/:id` | 讀 | 404 | ✅ 404（第七輪已部署） | ✅ |
| `GET /api/pages/:id/snapshot` | 讀 | 404 | ✅ 404 | ✅ |
| `GET /api/workspaces/:id/tree` | 讀 | `[]` | ✅ `[]` | ✅ |
| `GET /api/trash` | 讀 | `[]` | ✅ `[]` | ✅ |
| `POST /api/pages/:id/favorite` / `visit` | 寫 | 403/404 | ✅ 擋下 | ✅ |
| **`GET /api/pages/:id/transactions`** | 讀 | 404 | ❌ **200，op log 裡就是原文** | ✅ |
| **`POST /api/pages/:id/export`** | 讀 | 404 | ❌ **200，整頁 Markdown/HTML** | ✅ |
| **`POST /api/pages/:id/export`（`includeSubpages`）** | 讀 | 只含看得見的 | ❌ **整棵子樹＋附件** | ✅ |
| `POST /api/pages/:id/transactions`（寫入） | 寫 | 403 | ✅ 403（`permissionGuard`） | ✅ |

### 1.3 其他資源 — 大致正確

| 資源 | 動作 | guest 期待 | guest 實測 | 結論 |
|---|---|---|---|---|
| `GET /api/pages/:id/discussions` | read | 404 | ✅ 404 | ✅ |
| `POST /api/pages/:id/discussions` | comment | 404（無授權）/ 403（只有 read） | ✅ 兩者都對 | ✅ |
| `PATCH/DELETE /api/comments/:id` | comment ＋（作者 or edit） | — | ✅ 程式碼確認 | ✅ |
| `POST /api/discussions/:id/resolve` | comment | — | ✅ 程式碼確認 | ✅ |
| `GET /api/pages/:id/history` | read | 404 | ✅ 404；給 read 後 200 | ✅ |
| `POST .../history/:seq/restore` | edit | 404/403 | ✅ 給 read 後仍 403 | ✅ |
| `GET /api/search` | read（兩層） | 搜不到 | ✅ 程式碼兩層過濾；e2e 索引落後**未取得正例** | ⚠️ 見 §4-2 |
| `GET /api/public/:token`（flag off） | — | 404 | ✅ 404 | ✅ |
| `POST /api/pages/:id/share`（flag off） | — | 501 | ✅ 501 `NOT_IMPLEMENTED` | ✅ |
| `PATCH /api/workspaces/:id` | admin | 404 | ✅ 404 | ✅ |
| `DELETE /api/workspaces/:id` | owner | 404 | ✅ 404 | ✅ |
| `DELETE /api/workspaces/:id/members/:ownerId` | 永不 | 403 | ✅ 403 | ✅ |
| `PATCH .../members/:ownerId`（降 owner） | 永不 | 403 | ✅ 403 | ✅ |
| `GET /api/auth/sessions` | 只有自己 | 只列自己 | ✅ 兩帳號零交集 | ✅ |
| `DELETE /api/auth/sessions/:id` | 只有自己 | 打不到別人 | ✅ | ✅ |
| `GET /api/notifications` | 只有自己 | 只列自己 | ✅ | ✅ |
| **`POST /api/notifications/subscriptions`** | read | 404 | ❌ **200，追蹤得起來任何一頁** | ✅ 已修 |
| `POST /api/import` | 工作區成員 | — | ✅ `getMemberRole` | ✅ |
| **`GET /api/files/:id`** | 至少成員 | 成員限定 | ⚠️ **只到成員限定**（達最低標，未依頁面權限） | §4-1 |

### 計分

| | 格數 |
|---|---|
| 掃過的格子 | 47 |
| **失敗** | **21** |
| **已修** | **21** |
| 已知缺口（未修，有理由） | 1（`GET /api/files/:id`） |

---

## 2. Bug 清單

### BUG-40｜整個 `databases` 模組沒有任何頁面權限（已修，**需部署**）· 嚴重度：**最高**

**重現**（遠端站台，node `fetch` 直打）

```
[guest] 200  LEAK  GET /api/databases/:id
[guest] 200  LEAK  GET /api/databases/:id/rows
[guest] 201        POST /api/databases/:id/rows
[guest] 200        PATCH /rows/:rowId
[guest] 204        DELETE /rows/:rowId          ← 別人的資料真的不見
[guest] 200  LEAK  PATCH /:id/schema
[guest] 204        DELETE /views/:viewId        ← 視圖真的不見
[guest] 200        GET /:id/export.csv
```

**根因** —— 同一支查詢，第四個現場：

```ts
async function loadCollection(collectionId, userId) {
  const row = await repo.findCollectionForUser(collectionId, userId);  // JOIN workspace_members
  if (!row) throw new AppError('COLLECTION_NOT_FOUND');
  return row;                                    // ← 權限，完全沒問
}
```

`findCollectionForUser()` 與 `findPageForUser()` 是同一個模子刻出來的：
唯一的 JOIN 是 `workspace_members`。整個模組的 15 支端點全部只呼叫它。
前端在第六輪已經用 `usePagePermission` 把 UI 鎖上了 —— 那是**純裝飾**。

**修法**

1. `loadCollection(collectionId, userId, need)`：`findCollectionById()` 取列，
   再 `requirePagePermission(userId, row.page_id, need)`。
   **資料庫的權限就是它載體頁的權限**，inline database 也因此自動吃到父頁的繼承。
   `PAGE_NOT_FOUND` 轉成 `COLLECTION_NOT_FOUND`（都是 404，訊息對得上端點）。
2. 讀取端點（`getDatabase` / `queryRows` / `exportCsv` / `previewCast`）用預設的 `read`；
   11 支寫入端點明寫 `'edit'` —— **guest / 只有 comment 的人一律拒寫**。
3. `listDatabases()` 接上第七輪的 `buildPermissionIndex()` 逐頁過濾
   （原本連資料庫的名字都列給 guest 看）。
4. `createDatabase(parentId)` 從「只驗成員」改成 `requirePagePermission(parentId, 'edit')`
   —— 在別人的頁面底下長出新資料庫是寫入。
5. relation 的**目標** collection 要 `read`（`assertRelationTargetsReadable`）。
   不擋的話：對自己的資料庫有 edit 就能把 relation 指到看不見的資料庫，
   再靠 rollup / CSV 匯出把對方的標題讀出來。
6. **`repo.findCollectionForUser()` 整支刪掉**。留著等於把地雷留在原地；
   移除入口比加檢查可靠（新端點不可能「忘記」呼叫一個不存在的函式）。

### BUG-41｜op log 是第二條內容外流管道（已修，**需部署**）· 嚴重度：**高**

`GET /api/pages/:id/transactions`（斷線補傳）旁邊只有 `findPageForUser()`。
第七輪把 `/pages/:id` 與 `/snapshot` 鎖上之後，**整份內容還是流得出去** ——
`block.update` 的 patch 裡就是原文，`since=0` 一次拿全部。

```
[guest] 200  LEAK  GET /api/pages/:id/transactions   ← 含「CEO 年薪 1234 萬」
```

**修法**：`requirePagePermission(user.id, id, 'read')`。

> 這一條是第七輪盲點的直接後果：報告只檢查了「文件說得出名字的那兩支」。
> **鎖一個資源要把它所有的出口都列出來**，op log 也是出口。

### BUG-42｜`POST /api/pages/:id/export` 把整棵子樹交出去（已修，**需部署**）· 嚴重度：**高**

```
[guest] 200  LEAK  POST /api/pages/:id/export   ← 整頁 Markdown
```

`export/doc.ts` 的 `loadPageTree()` 註解寫著「含權限檢查」，
但那個「檢查」就是 `JOIN workspace_members`。而且 `includeSubpages: true` 會
沿 `parent_id` 遞迴 20 層、最多 500 頁，**一頁都沒有過濾**，
附件也一起打包 —— 這是單一請求能拿走最多資料的端點。

**修法**：根頁面 `requirePagePermission(..., 'read')`；
子樹用 `buildPermissionIndex()` 逐頁過濾，看不見的整棵拿掉
（父頁不可見時子頁一併拿掉，不留孤兒）。

### BUG-43｜用「追蹤這個頁面」把標題洩漏從收件匣繞回來（已修，**需部署**）· 嚴重度：**中**

`POST /api/notifications/subscriptions` 只問「這一頁存在嗎」。
baseline `none` 的 guest 追蹤得起來**任何一頁**，兩個後果：

1. 200 就直接確認了「這個 pageId 存在」（存在性洩漏）
2. 之後每次有人編輯，第七輪 BUG-38 新接上的 `page_updated` 扇出就送一則
   **帶頁面標題**的通知到他的收件匣 —— 第七輪堵住的標題洩漏，從通知重新流出來

**修法**：`requirePagePermission(userId, pageId, 'read')`。

> 值得記一筆：**BUG-43 是第七輪的修正自己打開的**。
> 補一條通知鏈路等於替資料開一個新出口，
> 而扇出端（`fanout.ts`）的紅線（沒讀取權不通知）擋得住「被 @」，
> 擋不住「自己訂閱」—— 訂閱端要有自己的檢查。

### BUG-44｜`findPageForUser()` → `findPageInUserWorkspace()`（已改名，**需部署**）· 嚴重度：**流程**

第七輪 §5 的建議。名字是這串 bug 的共犯：`forUser` 讀起來像
「這個使用者拿得到的頁面」，四輪下來被當成權限檢查誤用了**六次**
（BUG-27 ×3、BUG-29、BUG-35、BUG-36、BUG-41）。

新名字把語意寫死在呼叫端：**「在使用者的工作區裡」≠「使用者能看」**。
9 個呼叫端全部改完、doc comment 重寫成「⚠️ 這不是權限檢查」。

**但名字擋不住下一個人**，所以配一條靜態測試（下一節）。

---

## 3. `apps/server/test/route-permission-audit.test.ts`（新檔，7 條）

逐 bug 補測試只能證明「這一支修好了」，下一支新端點照樣裸奔。
這一條反過來 —— **掃原始碼**，任何一個吃路徑參數的 route handler，
如果它（或它呼叫的 service，深度 3 層）身上找不到權限原語，測試就紅：

```
requirePagePermission / resolvePagePermission / requireTrashedPageControl /
requireWorkspaceRole / getMemberRole / getWorkspaceRole / buildPermissionIndex /
canControlTrashedPage / resolvePublicAccess / permissionGuard
```

七條分別釘住：

1. 掃得到 > 40 條路由（**防止 regex 失效之後整條測試變成空跑** —— 沒有這一條，
   稽核測試哪天會安靜地永遠綠）
2. 每個吃 `:id` / `:rowId` / `:viewId` 的 handler 都問過權限
3. `ALLOWLIST` 不能留下已經不存在的路由（例外不准變化石）
4. `findPageInUserWorkspace()` 的**每一個**呼叫端，同一個函式作用域裡要找得到權限原語
5. `registerPermissionGuard()` 真的有被 `realtime/index.ts` 接上
   （`permissionGuard` 預設是 no-op，被列進 PRIMITIVES 就必須有這顆保險絲）
6. `loadCollection()` 走 `requirePagePermission`，且 `findCollectionForUser` 已從整個 src 消失
7. 11 支寫入端點都要 `'edit'`、4 支讀取端點不准要求 `'edit'`

**白名單（4 條，每條都寫了理由）**：

| 路由 | 理由 |
|---|---|
| `DELETE /:id/favorite` | 取消「我自己的」收藏，WHERE 帶 `user_id`，不回任何頁面資料 |
| `POST /:id/read` | 通知已讀，`markRead(user.id, id)` 以 user_id 收斂 |
| `DELETE /sessions/:id` | 踢自己的 session family，同樣以 user_id 收斂 |
| `GET /api/public/:token` | 匿名分享，token 即憑證；另驗 feature flag / 密碼 / 到期，封頂 read |
| `GET /:id`（files） | ⚠️ **已知缺口**，見 §4-1 —— 寫進白名單是為了讓它**顯眼**，不是為了讓它過關 |

---

## 4. 未修 / 未走查（留給第九輪）

1. **`GET /api/files/:id` 只做到工作區成員限定。**
   `files` 表沒有 `page_id`，附件與頁面之間只有 `block.props` 裡的 URL 可循，
   所以「依頁面權限」得先補一張 `file → page` 的關聯表（或在 block 寫入時登記）。
   現況：**同工作區的 guest 拿得到私密頁面裡的附件**（實測 200）。
   達到交辦的最低標（成員限定），但這是這一輪唯一沒補上的洞，**建議第九輪優先**。
2. **搜尋的 guest 過濾沒有取得正例。** 程式碼有兩層（`search/service.ts:219` 的
   工作區角色 + `:246` 的逐列 `resolvePagePermission`），但 e2e 打的時候
   **owner 自己也搜不到剛寫進去的字**（索引非同步，延遲 2.5 秒不夠）——
   所以「guest 搜不到」這件事**這一輪沒有實測支撐**。
   照第七輪 §5 的紅線，這裡明寫：**未驗證**。第九輪要嘛等索引、要嘛直接打 repo 層。
3. **WS 房間在權限被撤銷後不會把人踢出去**（第七輪 §4-4，本輪仍未走查）。
   已經連上的 guest 繼續收 `txBroadcast` —— 上面所有 REST 的修正對他無效。
4. `permission_changed` 通知仍沒有發送端（第七輪 §4-2）。
5. `SharePopover` 的 `entryPermission()` 對 guest 寫死 fallback `'edit'`（第六輪 §5-14）。
6. `loadRollupSources` / `loadRelationTitles` 讀目標 collection 的列時沒有再問一次權限 ——
   這一輪是在**定義**relation 時擋（`assertRelationTargetsReadable`），
   既有的舊 relation 若指向看不見的資料庫，rollup 仍讀得到標題。
7. 第七輪 §4 的協作 5～8、觸控 9～13 全部未動。

---

## 5. 改了哪些檔案

| 檔案 | 內容 | 需部署 |
|---|---|---|
| `apps/server/src/modules/databases/service.ts` | **BUG-40**：`loadCollection(…, need)` 走載體頁權限；11 支寫入端點要 `edit`；`listDatabases` 過濾；`createDatabase(parentId)` 要 `edit`；`assertRelationTargetsReadable` | ⚠️ **後端** |
| `apps/server/src/modules/databases/repo.ts` | **BUG-40**：`findCollectionForUser()` **整支刪除** | ⚠️ **後端** |
| `apps/server/src/modules/pages/routes.ts` | **BUG-41**：`GET /:id/transactions` 補 `read` | ⚠️ **後端** |
| `apps/server/src/modules/export/doc.ts` | **BUG-42**：`loadPageTree` 根頁面要 `read` + 子樹逐頁過濾 | ⚠️ **後端** |
| `apps/server/src/modules/notifications/service.ts` | **BUG-43**：`setSubscription` 補 `read` | ⚠️ **後端** |
| `apps/server/src/modules/pages/repo.ts` | **BUG-44**：`findPageForUser` → `findPageInUserWorkspace`，doc comment 重寫 | ⚠️ **後端** |
| 另 6 個呼叫端檔案 | 同上改名（apply-transaction / pages service+routes / recent / databases service） | ⚠️ **後端** |
| `apps/server/test/route-permission-audit.test.ts` | **新檔**：7 條靜態稽核 | — |
| `e2e/functional-round8.spec.ts` | **新檔**：12 條（7 條 `test.fixme` = 等後端部署） | — |

**前端一行都沒改**（第七輪也是）—— 兩輪的問題全部在後端的查詢層。
沒有碰 `packages/editor-core`、沒有加 runtime 套件、沒有 git commit。

### 驗收

```
pnpm -r typecheck                    ✅ 8/8 專案通過
pnpm --filter @kennote/web test      ✅ 17 檔 / 333 條
pnpm --filter @kennote/server test   ✅ 28 檔 / 410 條（新增 7 條；3 檔 skip：需要 DATABASE_URL_TEST）

npx playwright test functional-round8.spec.ts     ✅ 5 passed / 7 fixme
```

7 條 `test.fixme` 全是本輪的後端修正（BUG-40～43），**部署後改回 `test` 就會綠**。

---

## 6. 觀察

- **「一支只回答成員身分的查詢」被當成權限檢查，這是第四輪連莊。**
  第五輪 BUG-27、第六輪 BUG-29、第七輪 BUG-35/36、本輪 BUG-40/41/42。
  第七輪已經寫下「建議改名」，這一輪照做了 —— 但真正有效的不是改名，
  是**那條掃原始碼的測試**。改名只讓下一個人「比較可能」注意到；
  靜態稽核讓他「編不過 CI」。**安全要靠機制，不能靠自律。**
  更進一步的機制（第九輪可以考慮）：讓型別擋住它 ——
  回傳 `{ row, permission }` 且 `permission` 必須被消費，忘記問權限就 type error。
- **前端鎖上 UI 不是修正，是遮蔽。** databases 在第六輪就「接上 `usePagePermission`」了，
  報告因此把它記成半綠。實際上後端 15 支全裸，而 15 支裡有 3 支是**破壞性**的
  （`DELETE /rows/:rowId`、`DELETE /views/:viewId`、`PATCH /:id/schema`）。
  **只要 API 是公開的，前端的鎖就只是建議。**
  以後「前端已鎖上」不能出現在走查表的結果欄，只能出現在備註欄。
- **鎖一個資源，要把它所有的出口都列出來。**
  第七輪鎖了 `/pages/:id` 與 `/snapshot`，同一份內容卻還有兩個出口
  ——`/transactions`（op log）與 `/export`（Markdown/HTML/zip）。
  「頁面內容」這份資料的出口清單應該寫在一個地方，新增出口時對照一次。
- **新功能會替舊資料開新出口。** BUG-43 是第七輪 BUG-38 的直接副作用：
  補上 `page_updated` 通知之後，「訂閱」這個原本無害的動作變成了讀取管道。
  **每次接一條新的扇出，都要回頭問訂閱端有沒有權限檢查。**
- **探索腳本的副作用就是最好的證據。** guest 那一輪跑完，owner 再打同一批端點
  拿到一串 404 —— 因為列和視圖已經被 guest 刪了。
  讀取的洞要解釋才嚇人，**寫入的洞自己會說話**。
  下一輪的探索腳本建議固定「guest 跑完 → owner 再跑一次」，差異本身就是報告。
- **沒有實測支撐的句子要明寫「未驗證」**（第七輪的教訓，這一輪照辦）：
  §4-2 的搜尋就是這樣的一格 —— 程式碼看起來對，但 owner 自己都搜不到，
  所以它在矩陣裡是 ⚠️ 不是 ✅。
- 測試環境：`POST /api/auth/open` 的 rate limit 這一輪又撞到
  （一條測試開兩個帳號時特別容易），e2e 的 `signIn()` 補了 backoff（1.5s × n，5 次）
  才穩定；第七輪的探索腳本經驗在這一輪一字不差地重演了一次。
