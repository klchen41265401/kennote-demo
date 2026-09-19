# 功能 QA 第九輪（附件權限・WS 撤權・列頁種子）

- 日期：2026-09-20
- 起點：`docs/qa/functional-round8.md` §4「留給第九輪」＋ `docs/qa/regression-triage-1.md` §8
- **線上站 `http://100.74.148.92:8090` 這一輪一個請求都沒打** —— 它正在跑全量回歸。
  驗證一律用單元測試（vitest）與靜態推理；e2e 全部先標 `test.fixme`。
- **刻意沒碰**：`packages/editor-core`；沒有加 runtime 套件；沒有 git commit

> 前兩輪把 **REST** 的每一個出口都鎖上了，但「一份資料的出口清單」還有兩格空著：
> **附件**（`GET /api/files/:id`，第八輪自己寫進白名單當成已知缺口）與
> **WebSocket**（撤權之後房間不會把人踢出去，第七、八輪連兩輪掛著）。
> 這一輪把這兩格填滿，順手把「列頁的種子段落」從前端搬回後端
> —— 那是第一輪分診裡唯一一條「修了症狀、沒修分工」的項目。

---

## 1. 附件依頁面權限（BUG-45，**需部署**）· 嚴重度：**高**

### 缺口

第八輪實測：**同工作區的 guest 拿得到私密頁面裡的附件**（`GET /api/files/:id` → 200）。
根因是 `files` 表沒有 `page_id`，附件與頁面之間只有 `block.props.fileId` 這條**反查**關係，
所以那一輪只做到「工作區成員限定」（`findFileForUser()` = JOIN `workspace_members`），
並且把 `GET /:id` 寫進 `route-permission-audit` 的 ALLOWLIST，理由欄明寫「⚠️ 不是做對的事」。

> 這是第八輪 §6「前端鎖上 UI 不是修正，是遮蔽」的同一個形狀：
> 第七輪把 `/pages/:id`、`/snapshot`、`/transactions`、`/export` 全鎖了，
> 附件卻是**另一個出口** —— 一張私密頁面裡的薪資表截圖，URL 一貼就繞過全部。

### 修法：補正向關聯，上傳當下就記住

| 層 | 改動 |
|---|---|
| migration `0070_files_page.sql` | `files.page_id uuid NULL REFERENCES pages(id) ON DELETE SET NULL` ＋ 部分索引 |
| `POST /api/files/upload` | 多收一個 `pageId` 欄位；**帶了就要有那一頁的 `edit`**（把附件塞進別人的頁面本身就是寫入） |
| `GET /api/files/:id` | `page_id` 有值 → `resolvePagePermission(read)`；`NULL` → 維持工作區成員（退路） |
| `files/repo.ts` | `findFileForUser()` → **`findFileInUserWorkspace()`**（第八輪 BUG-44 的命名紅線：`...ForUser` 讀起來像權限檢查） |
| `export/service.ts` | `collectAttachments(nodes, userId)`：打包前逐檔問一次同樣的權限（同一頁只問一次） |
| `apps/web/src/lib/upload.ts` | `UploadOptions.pageId`，`FormData` 多一欄 |
| 呼叫端 | 編輯器圖片 / 檔案（`useEditorHost.upload`）、封面（`PageHeader`）帶 `pageId`；**頭像（`uploadAvatar`）刻意不帶** |

**為什麼 `page_id` 可以是 NULL、而且不回填**：

1. 回填要反查 `block.props`，大工作區上太慢，而且會在 migration 裡跑一段掃描
2. 頭像、匯入暫存檔本來就不屬於任何頁面 —— 強制 NOT NULL 等於逼它們說謊
3. NULL 的行為 = 第八輪的行為（成員限定），**不會比現在更差**

沒權限一律回 `FILE_NOT_FOUND`（404）而不是 403 —— 403 等於承認「這個 fileId 存在」。

**ALLOWLIST 少了一條**：`GET /:id`（files）已經從 `route-permission-audit.test.ts` 的白名單拿掉，
它現在靠 `resolvePagePermission` 通過稽核，不是靠例外。

---

## 2. WS 房間撤權踢人（BUG-46，**需部署**）· 嚴重度：**高**

### 缺口

第七輪 §4-4 提出、第八輪 §4-3 重複記錄，**連兩輪沒有人走查**：

> 已經連上的 guest 繼續收 `txBroadcast` —— 上面所有 REST 的修正對他無效。

房間只認「`subscribe` 當下算過的那一次權限」。撤權之後：

- **讀**是通的（`txBroadcast` 會把每一次編輯的 op 原文送過去）
- **寫**被 `permissionGuard` 擋（第五輪就裝上了），所以這是一個**純讀取**的洞
- 對方只要不關分頁，撤權等於沒發生

### 修法：授權一變動就發事件，房間重新解析

```
permissions/service ──setPermissionChangeNotifier──▶ RoomManager.publishPermissionChanged()
                                                        │
                       BroadcastAdapter（user / page channel，跨實例）
                                                        ▼
                     RoomManager 重新 resolvePagePermission（注入的 resolver）
                       none → error{FORBIDDEN} + unsubscribe（踢出房間）
                       降級 → synced{permission}（前端 sync.canEdit 切唯讀）
```

照既有的架構紀律走（04 §7.3 鐵則 1：**service 層不認識 WS**）：

- `permissions/service.ts` 只**發事件**（`setPermissionChangeNotifier`，預設 no-op）
- `realtime/index.ts` 是唯一的組裝點（與 `registerPermissionGuard` 並排的第 5 條掛勾）
- `room-manager.ts` **仍然不認識資料庫** —— 權限解析是注入的 `PagePermissionResolver`，
  所以 7 條新測試不需要 DB 也不需要 WebSocket

**事件有兩種目標**（權限是繼承的，這一點決定了設計）：

| 來源 | channel | 重算範圍 |
|---|---|---|
| `setPagePermission`（`user` 主體） | `user:{userId}` | 這個人**所有訂閱中的頁面** —— 改父頁會影響子頁，逐頁重算比爬樹可靠 |
| `setPagePermission`（`workspace` 主體） | `page:{pageId}` | 這一頁房間裡的**每一個人** |
| `setPageShare({ enabled: false })` | `page:{pageId}` | 同上（關閉公開分享 = 撤權） |
| `removeMember` / `changeMemberRole` | `user:{userId}` | 工作區角色是每一頁的 baseline / ceiling → 全部重算 |

**三條紅線**（都有測試）：

1. `resolver` 拋例外 → **不踢人**。一次資料庫抖動不該讓所有協作者掉線。
2. 沒有注入 resolver（CLI / 單元測試）→ 完全不動作。
3. 重檢查**依序**跑（`recheckChain`）：同一個房間同時來兩則事件不會互相打架；
   測試也靠 `settlePermissionChecks()` 等結果，不用 sleep。

`subscribe` 本身早就在 `ws.ts` 用 `resolvePagePermission()` 算最新權限（第五輪就有），
這一輪確認過，不需要改。

### 順手：`permission_changed` 終於有發送端（第 7 種通知型別）

七種 `NotificationType` 裡最後一種一直沒有人送（第七輪 §4-2、第八輪 §4-4）。
`notifyPermissionChanged()` 接在 `setPagePermission()` 上，與 `page_shared` **互斥**：

- 沒有舊條目 ＋ 給權限 → `page_shared`（「有人把一頁分享給你」）
- 有舊條目（升 / 降）或撤銷（`none`）→ `permission_changed`

判斷靠「寫入**之前**先查一次 `listPageEntries`」—— 寫完就分不出來了。

**撤銷也要通知**，而這是唯一一種「收件人現在對那一頁沒有讀取權」仍然要送的通知，
所以刻意**不**套扇出的那條紅線（`resolvePagePermission !== 'none'`）；
payload 只帶頁面標題（他本來就看得到過），不帶任何內容片段。

---

## 3. `SyncClient.submitDelta()` 的 silent early return（**前端**）

第一輪分診 §8-6 留下來的：

```ts
const entry = this.pages.get(pageId);
if (!entry) return txId;     // ← 與 submit() 一模一樣的洞，只是還沒有現場
```

分診那一輪的理由是「delta 只會在編輯器 mount 之後觸發，而 attach 現在保證早於編輯器建立」
—— 成立，但那是**依賴另一個模組的 effect 順序**。宿主的 mount 順序再變一次就掉資料，
而且掉得跟 §2 的 BUG 一樣安靜。

改成走同一條 `preAttach` 佇列（delta 本來就是 `Operation`，交給 `submit()` 即可）。

**釘住它**：`sync-client.test.ts` 新增 1 條。
實測把它改回 `return txId;` → 這一條立刻紅（`sent` 長度 0 ≠ 1），改回來就綠。

---

## 4. 列頁的種子段落改由後端建（**需部署**）

第一輪分診 §8-5：

> 「`createRow()` 不建 block、前端進來再補一個並寫回去」本身就是一個奇怪的分工：
> 任何一個讀 snapshot 的客戶端都會各補一個，多人同時開同一列就會長出多個空段落
> （本輪重現時實際看到伺服器上留了 **2 個**空 block）。

### 三處一起改

**(a) `createRow()` 種一個 paragraph**（與 `createPage()` 完全同一段程式碼形狀，
`originSessionId: 'server:row-create'`）。列頁從此不再是「整個 repo 裡唯一 0 個 block 的頁面」
—— 分診 §9 說「只有一種資料形狀踩得到的 bug」，這一輪直接把那種形狀消滅掉。

**(b) 前端的 fallback 退成純防禦**（`useEditorHost.ts`）：

```ts
const snapshotHasNoBlock = Object.keys(snapshot?.recordMap.block ?? {}).length === 0;
if (startDoc.rootIds.length === 0 && snapshotHasNoBlock && !readOnly) { … }
```

多的那道條件不是多餘的：`snapshotToDoc()` 有一道防禦會把「指到不存在 block 的 rootId」濾掉，
所以**「snapshot 有 block、但 `rootBlockIds` 壞掉」也會讓 `rootIds.length === 0` 成立** ——
只看 rootIds 的話，這種頁面每開一次就再補一個空段落。
（這正是伺服器上會長出一串空 block 的第二條路。）

**(c) 一次性 GC**：`pruneDuplicateSeedParagraphs()` 接在 `runGarbageCollection()` 的第 5 段，
清掉既有資料。**四條紅線**（誤刪一次就是使用者的內容不見）：

1. **只在這一頁沒有任何非空 block 時才動手**。只要有一個有內容的 block，整頁跳過
   —— 空段落在有內容的頁面裡是使用者刻意留的空行。
2. 「空」定義得很窄：`parent_id IS NULL` ＋ `paragraph` ＋ `content = []` ＋
   `children = {}` ＋ `props = {}`。有 props（顏色 / 縮排）就不算空。
3. 一定**留下第一個**（`ORDER BY id`，uuidv7 = 建立順序），頁面不會變成 0 個 block。
4. 刪完把 id 從 `pages.children` 拿掉 —— 排序真值在那個陣列上，留著就是孤兒，
   而孤兒正是 (b) 那條路的來源。

`GcResult` 多一個 `prunedSeedParagraphs`，`dryRun` 支援（只數不刪）。

`apply-transaction` **沒有**特別處理「同 page 多個空種子 block」—— 交辦說不必，
而且那裡是熱路徑，加一條全頁掃描的檢查只會讓每一次打字變慢。

> ⚠️ **注意**：`import/service.ts` 的 CSV 匯入是 `createRow()` 的迴圈呼叫端，
> 每一列現在多一次 `applyTransaction`（一個 block insert）。
> 匯入 1000 列的成本會上升（`database-gaps.spec.ts` 有這條測試）。
> 這是正確性換效能的取捨，部署後值得看一眼匯入耗時。

---

## 5. 改了哪些檔案

| 檔案 | 內容 | 需部署 |
|---|---|---|
| `apps/server/migrations/0070_files_page.sql` | **新檔**：`files.page_id` ＋ 索引 | ⚠️ **後端 / migration** |
| `apps/server/src/modules/files/routes.ts` | 上傳收 `pageId`（要 `edit`）；`GET /:id` 依頁面權限 | ⚠️ **後端** |
| `apps/server/src/modules/files/repo.ts` | `FileRow.page_id`、`insertFile({ pageId })`、`findFileForUser` → `findFileInUserWorkspace` | ⚠️ **後端** |
| `apps/server/src/modules/export/service.ts` | `collectAttachments(nodes, userId)` 逐檔問權限 | ⚠️ **後端** |
| `apps/server/src/modules/realtime/broadcast.ts` | `BroadcastEnvelope.permissionChanged` | ⚠️ **後端** |
| `apps/server/src/modules/realtime/room-manager.ts` | `setPermissionResolver` / `publishPermissionChanged` / `recheck*` / `settlePermissionChecks` | ⚠️ **後端** |
| `apps/server/src/modules/realtime/index.ts` | 第 5 條掛勾：注入 resolver ＋ 接上撤權事件 | ⚠️ **後端** |
| `apps/server/src/modules/permissions/service.ts` | `setPermissionChangeNotifier`；4 個現場發事件；`permission_changed` vs `page_shared` 分流 | ⚠️ **後端** |
| `apps/server/src/modules/notifications/fanout.ts` | **新增** `notifyPermissionChanged()`（第 7 種通知型別的發送端） | ⚠️ **後端** |
| `apps/server/src/modules/databases/service.ts` | `createRow()` 種一個 paragraph | ⚠️ **後端** |
| `apps/server/src/modules/gc/service.ts` | `pruneDuplicateSeedParagraphs()` ＋ `GcResult.prunedSeedParagraphs` | ⚠️ **後端** |
| `packages/shared-types/src/api.ts` | `FileMeta.pageId?` | ⚠️ 前後端 |
| `apps/web/src/lib/upload.ts` | `UploadOptions.pageId` → `FormData` | ⚠️ **前端** |
| `apps/web/src/features/editor/useEditorHost.ts` | `upload()` 帶 `pageId`；空頁種子多一道 `snapshotHasNoBlock` | ⚠️ **前端** |
| `apps/web/src/features/editor/PageHeader.tsx` | 封面上傳帶 `pageId` | ⚠️ **前端** |
| `apps/web/src/lib/sync-client.ts` | `submitDelta()` 的 early return 改走 `preAttach` | ⚠️ **前端** |
| `apps/server/test/realtime-room.test.ts` | **新增 7 條**（撤權 / 降級 / 繼承 / 房間層 / 頁面已刪 / resolver 例外 / no-op） | — |
| `apps/server/test/route-permission-audit.test.ts` | ALLOWLIST 拿掉 `GET /:id`（files） | — |
| `apps/web/src/lib/sync-client.test.ts` | **新增 1 條**：delta 的 preAttach | — |
| `e2e/functional-round9.spec.ts` | **新檔**：9 條，全部 `test.fixme`（等部署） | — |
| `docs/qa/functional-round9.md` | 本報告 | — |

### 驗收

```
pnpm -r typecheck                    ✅ 8/8 專案通過
pnpm --filter @kennote/server test   ✅ 28 檔 / 417 條（新增 7 條；3 檔 skip：需要 DATABASE_URL_TEST）
pnpm --filter @kennote/web test      ✅ 17 檔 / 335 條（新增 1 條）

npx playwright test --list functional-round9    ✅ 9 tests（全部 test.fixme）
```

**沒有對線上站發任何請求**（它正在跑全量回歸）。
9 條 e2e **一條都還沒真的跑過** —— 依第一輪分診 §9 的教訓，
解開 `fixme` 的那一輪要**逐行**看，不能只看「變綠了嗎」。

---

## 6. 未修 / 留給下一輪

1. **搜尋的 guest 過濾仍未取得正例**（第八輪 §4-2，連三輪明寫「未驗證」）。
   建議直接打 repo 層，不要再等非同步索引。
2. `SharePopover` 的 `entryPermission()` 對 guest 寫死 fallback `'edit'`（第六輪 §5-14）。
3. `loadRollupSources` / `loadRelationTitles` 讀目標 collection 的列時沒有再問一次權限
   （第八輪 §4-6）：舊 relation 指向看不見的資料庫時，rollup 仍讀得到標題。
4. **`files.page_id` 的既有資料沒有回填**。0070 之前上傳的附件維持成員限定。
   要不要寫一支離線回填腳本（反查 `block.props.fileId`）是下一輪可以決定的事。
5. **附件的 `page_id` 不會跟著 block 搬家**。把圖片 block 剪下貼到另一頁之後，
   權限仍綁在原本那一頁。這是刻意的取捨（`apply-transaction` 是熱路徑），
   但方向是「收緊」還是「放寬」要看貼過去的是誰 —— 值得一條專門的走查。
6. 第七輪 §4 的協作 5～8、觸控 9～13 全部仍未動。
7. 匯入 1000 列的耗時（見 §4 的注意）部署後要量一次。

---

## 7. 觀察

- **一份資料的出口清單要寫在一個地方。** 第八輪自己寫過這句話
  （鎖了 `/pages/:id` 才發現還有 `/transactions` 與 `/export`），
  這一輪證明那張清單當時還少了兩格：**附件**與 **WebSocket**。
  「頁面內容」的出口至少有六個：snapshot / transactions / export / files /
  search / WS 房間。**新增出口時要對照一次，撤權時也要對照一次。**
- **權限檢查是一個時間點，不是一個狀態。** REST 的每一支都在「請求進來的那一刻」問權限，
  所以每一次請求都是新鮮的。WebSocket 不是 —— 它問過一次就連著幾小時。
  **任何長連線都要有一條「狀態變了」的回頭路**，否則所有請求層的檢查對它都無效。
  這一條適用於未來任何 SSE / 長輪詢 / 快取。
- **撤權比授權難。** 授權只要寫一列；撤權要回答「誰現在正拿著這份資料」。
  這一輪能做得乾淨，唯一的理由是 `BroadcastAdapter` 早就有 user channel
  ——**當初為了推播通知接的那條線，這一輪變成了撤權的通道**。
  基礎設施的價值常常在它第二個用途上才看得出來。
- **命名的紅線要一輪一輪還。** `findFileForUser()` 與第八輪刪掉的
  `findPageForUser()` / `findCollectionForUser()` 是同一個模子。
  第八輪改了兩個、漏了第三個 —— 因為靜態稽核只掃 route handler，
  而 `files/routes.ts` 當時在 ALLOWLIST 裡，整支被跳過。
  **例外清單會讓稽核在那一格失明**，所以例外必須有到期日，不能只有理由。
- **「還沒有現場」不是不修的理由。** `submitDelta()` 的 early return 在分診那一輪
  被判定為「構不成現場」，理由是另一個模組的 effect 順序。
  依賴別人的順序來保證自己不掉資料，是把正確性外包出去。
  **寫入路徑上的 early return 一律要問「這些資料去哪了」** —— 這一句第一輪分診就寫過了。
- **修分工比修症狀便宜。** 列頁的種子段落：分診那一輪修的是「前端補的那一筆不要掉」
  （加了 preAttach 佇列＋改 effect 型別，兩個檔案的時序推理）。
  這一輪把它搬回後端之後，**那條競態根本沒有東西可以掉** ——
  三行 SQL 之外的所有複雜度都是前一輪為了繞過這個分工而生的。
  遇到「每個客戶端都要各做一次同樣的初始化」時，先問一句**為什麼不是建立者做**。
- **刪除型的 GC 要有「整頁跳過」的開關，不是「逐筆判斷」。**
  `pruneDuplicateSeedParagraphs` 最重要的一條紅線不是「怎麼認出空段落」，
  是「**只要這一頁有任何非空 block 就整頁不碰**」。
  逐筆判斷會在邊界上出錯，整頁跳過只會少刪 —— **清理程式的錯誤方向必須是少做。**
