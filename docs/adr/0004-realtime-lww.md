# ADR 0004：自研即時協作層（M5）—— 協定、Room、LWW 與權限

- 狀態：已採用（M5）
- 日期：2026-09-19
- 相關規格：04 §5.4、**04 §6 全部**、04 §8 M5；01 §6；03 §4.9–4.12、§8；02 §3.6、§5.5
- 前置決策：ADR 0001（全自研核心）、ADR 0002（pages/blocks 兩張表 + 04 §4.2 的 RichText）

---

## 1. 背景

M1–M4 已經把「所有 block 變更都經過單一 `applyTransaction()`」這條紀律建立起來，
`page_transactions` 也已經是 append-only 的 operation log。M5 要在**不改動 service 層**的前提下，
把同一條路徑接上 WebSocket，並補上留言、通知、權限、分享、版本歷史。

禁用清單（00-README 決策 #11 / `scripts/check-deps.ts`）：socket.io、Yjs、Automerge、ShareDB、Liveblocks。
本次實作**沒有新增任何 runtime 依賴**（`ws` 隨 `@fastify/websocket` 而來，只負責 RFC 6455 的 frame 解析）。

---

## 2. 決策

### 2.1 訊息協定沿用 04 §6.3 的名稱，不改叫 `txResult` / `remoteTx`

M5 的交付清單用了比較口語的名字（`txResult`、`remoteTx`、`cursor`、`ack`），
但 04 §6.3 的型別已經在 M1 就定死並寫進 `packages/shared-types/src/ws.ts`。
**以 §6.3 為準**，對照如下：

| 口語名稱 | 實際型別 |
|---|---|
| `ack` / `txResult` | `txApplied`（自己的 tx 成功） |
| `remoteTx` | `txBroadcast`（他人的 tx） |
| `cursor` | `presence` 的 `blockId` / `selection` 欄位（不另開訊息） |
| `error` | `error`（非致命）；認證失敗仍用 `authError`（會接著關連線） |

新增（協定的擴充點，不影響既有訊息）：`notification`（通知推播）、`comment`（留言事件）、
`error`；`synced` 多帶一個 `permission`，前端據此決定要不要顯示編輯 UI。

### 2.2 一條 WS 連線訂閱多頁；房間空了延遲 30 秒銷毀

瀏覽器對同網域的連線數有上限（約 6 條），所以**連線是 per-tab，不是 per-page**。
房間在最後一人離開後延遲 30 秒銷毀，避免使用者切頁抖動時反覆建房拆房。

### 2.3 `BroadcastAdapter`：InMemory + Redis pub/sub，Redis 客戶端自己寫

`env.REDIS_URL` 有值就用 Redis（channel = `page:{pageId}` / `user:{userId}`），否則 InMemory。
業務碼只認 `BroadcastAdapter` 介面。

**Redis 客戶端用 node 內建 `net`/`tls` 自寫最小 RESP 實作（`realtime/resp.ts`，約 200 行），
沒有安裝 `ioredis` 或 `redis`。** 理由：

- 我們只用兩個指令：`PUBLISH` 與 `SUBSCRIBE`。RESP 是行導向文字協定，解析器 80 行、可單元測試。
- 一個帶 cluster / sentinel / Lua / 連線池的函式庫，對這個需求是 95% 的未使用表面積。
- 與「功能型套件自研、基礎設施型才外購」一致：Redis **服務**仍然是外購，只是不外購它的客戶端框架。

代價（誠實記錄）：沒有 pipeline、沒有 cluster 支援、沒有 RESP3。若哪天需要 Redis Streams 或
cluster，再回頭評估引入 `ioredis`，屆時只需要換掉 `resp.ts` 與 `RedisBroadcast`。

跨實例的 presence 合併方式：每個實例只廣播「自己這一筆」peer，其他實例併進自己的表，
超過 `PRESENCE_TTL_MS`（45 秒）沒更新就清掉。presence **永遠不進 PostgreSQL**（03 §8.2）。

### 2.4 WS 的 `tx` 與 HTTP 的 `POST /transactions` 走同一支 `applyTransaction()`

`realtime/ws.ts` 只做「訊息 → service 呼叫 → 訊息」的翻譯。廣播由 `setBroadcaster()` 掛勾在
**commit 之後**觸發（03 §9.3：不要在交易中廣播，否則 rollback 了還是送出去），
因此不論變更是從 HTTP 還是 WS 進來，其他人都會收到 `txBroadcast`。

### 2.5 衝突策略：階段二「LWW + 社交式避讓」

照 04 §6.6：伺服器仍然 LWW（後到者覆蓋同一個 block），但
① presence 顯示誰在哪個 block、② `baseVersion` 不符時回 `conflicts: [blockId]` 讓前端 toast、
③ 遺失的內容可從版本歷史還原。**階段三（自建 OT）留給 M6**，協定已經預留 `text.delta`。

### 2.6 前端狀態機與離線佇列

`lib/sync-client.ts` 不 import React、不 import store，因此可以在 Node 用假 WebSocket 測完整路徑。

- backoff：1,2,4,8,16,30 秒，每次 ±20% jitter（伺服器重啟時不會驚群）
- 漏收偵測：`decideSeq(localSeq, incomingSeq)` → `apply` / `duplicate` / `gap`；gap 時送
  `subscribe(sinceSeq)` 讓伺服器補傳（落後 > 500 筆時伺服器回 `resync`，前端重抓 snapshot）
- 送出：debounce 300ms 打包 → **先寫 IndexedDB** → WS 優先 → 失敗或 10 秒沒 ack 降級 HTTP POST
- 重連：先 `subscribe(sinceSeq)` 補齊他人的變更，**再**依 `order` 重送自己的佇列（txId 不變 → 伺服器冪等）
- 4xx 的拒絕不重試，直接呼叫 `onRollback` 讓宿主套用 inverseOps

### 2.7 權限：workspace 角色 × page_permissions 繼承，守門員裝在 `applyTransaction`

`resolvePagePermission(userId, pageId) → 'full' | 'edit' | 'comment' | 'read' | 'none'`。

規則照 03 §4.12：沿父頁面鏈往上收集條目，遇到 `inherits_permissions = false` 就停，
取最大值，最後與工作區角色上限取 min。補充兩條本專案的決定：

1. **頁面建立者視同 `full`**，否則自己開的頁面可能被別人的條目綁住。
2. **沒有任何適用條目時採工作區 baseline**（member → `edit`、guest → `none`）；
   一旦有適用條目就以條目為準（這讓 `workspace → reader` 這種「限制整個工作區」的條目真的生效）。

「Guest 只能留言不能編輯」是驗收標準，所以檢查點**不在 route**，而是在
`applyTransaction()` 的 `setPermissionGuard()` 掛勾 —— HTTP、WS、內部呼叫三條路徑一體適用。
`apply-transaction.ts` 只加了「一個掛勾 + 一行呼叫」，與既有的 `setBroadcaster` 同形狀。

### 2.8 留言錨點用 comment mark，不用字元位移

03 §4.9 自己就警告位移會漂掉。前端先產生 `discussionId`，把 `{ t:'comment', id }` mark 套在選取範圍上
（走 `applyTransaction`，因此會被廣播、會進歷史、會被 undo），再用同一個 id 建立討論串。
`anchor.quote` 只是「討論串被孤立時要顯示什麼」的備援快照。

### 2.9 版本歷史 = 重播 operation log，不另存快照表

`GET /history` 把 transaction 依「每 20 筆或每小時」聚合成版本點；
`GET /history/:seq` 重播到該 seq；`POST /history/:seq/restore` 把
「目前狀態（來自 blocks 表）→ 目標狀態（重播結果）」的 diff 當成**一筆新的 transaction** 送出。
歷史因此永遠 append-only，還原本身也能被還原、也會被廣播給其他人。

**已知限制：** `duplicatePage()` 是直接 INSERT 的（M3 既有實作），沒有經過 operation log，
所以複本在被編輯之前沒有可重建的歷史。要修的話應該讓 duplicate 也走 `applyTransaction`，
列入 M6 的清理項目。

### 2.10 公開分享連結：永遠唯讀，且預設關閉

`public_links` 存不透明 token（不是 slug），密碼用 argon2 雜湊（密碼學不自研，00-README 決策 #3）。
`resolvePublicPermission()` 把公開權限**硬性封頂在 `read`**，即使有人在資料庫塞了 `editor` 條目。
由 `FEATURE_PUBLIC_SHARE` 控制，預設 false。

---

## 3. 替代方案與否決理由

| 方案 | 否決理由 |
|---|---|
| socket.io | 40KB client、自有協定、與自研方針衝突（04 §6.1 的比較表） |
| Yjs / Automerge | 真值會搬進二進位 doc，`blocks` 退化成投影，所有查詢要等投影（03 §8.4.4） |
| 安裝 `ioredis` | 只為了 PUBLISH/SUBSCRIBE 兩個指令，95% 表面積用不到 |
| presence 存 PostgreSQL | 每秒數十次游標更新會製造大量 dead tuple，拖垮 autovacuum（03 §8.2） |
| 權限檢查放在 route | 會有漏網的寫入路徑；guest 只要換一條 API 就能繞過 |
| 版本歷史另存 snapshot 表 | operation log 已經是完整真值，另存快照等於兩套真值 |

---

## 4. 後果

**好處**

- DevTools 的 WS 分頁一眼就看懂每一則訊息（協定完全是自己的）
- 單機部署不需要 Redis；要水平擴充時只改一個環境變數
- 同一支 `applyTransaction` 同時服務 HTTP / WS / 歷史還原，沒有第二條寫入路徑

**代價**

- 重連、補傳、佇列、心跳這些「socket.io 內建」的東西要自己維護（約 600 行，已有測試覆蓋）
- 自寫 RESP 客戶端沒有 cluster / pipeline
- 仍然是 block 粒度 LWW：兩人同時改同一段文字，後送的會覆蓋前者（release note 必須寫明）

**M6 的接手點**

- `text.delta` 已在 `Operation` 型別中；`applyTransaction` 目前對它丟 `NOT_IMPLEMENTED`
- `sync-client` 的 pending queue 之後要換成 OT 的三狀態機（Synchronized / AwaitingConfirm / AwaitingWithBuffer），
  `attachPage` 與 `submit` 的對外介面不需要改
