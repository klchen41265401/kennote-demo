# kennote API 參考

> 這一份是**掃原始碼產生**的總表：`apps/server/src/modules/*/routes.ts`（REST）、
> `apps/server/src/modules/realtime/ws.ts`（WebSocket）、
> `packages/shared-types/src/{ws,errors,permissions}.ts`（契約）。
>
> 規則：**前端只走同源 `/api` 與 `/ws`**（開發由 Vite proxy、正式由 nginx 反向代理），
> 所以沒有跨網域 cookie 問題。Access token 放記憶體（15 分鐘），
> refresh token 放 HttpOnly cookie（30 天滑動）。

- 路由註冊與 prefix：`apps/server/src/app.ts`
- 權限原語：`apps/server/src/modules/permissions/service.ts`
- 靜態權限稽核測試：`apps/server/test/route-permission-audit.test.ts`（新端點漏檢查會直接紅）

---

## 1. 回應形狀

成功一律：

```jsonc
{ "data": T, "meta": { "cursor": "…", "total": 12, "hasMore": true } }   // meta 可選
```

失敗一律：

```jsonc
{ "error": { "code": "PAGE_NOT_FOUND", "message": "頁面不存在或已被刪除", "details": { } } }
```

`code` 是**可列舉的機器可讀字串**，完整清單在 `packages/shared-types/src/errors.ts`：

| 分類 | 錯誤碼 |
|---|---|
| 通用 | `BAD_REQUEST` `VALIDATION_FAILED` `UNAUTHORIZED` `FORBIDDEN` `NOT_FOUND` `CONFLICT` `RATE_LIMITED` `PAYLOAD_TOO_LARGE` `INTERNAL_ERROR` `NOT_IMPLEMENTED` |
| 認證 | `EMAIL_TAKEN` `INVALID_CREDENTIALS` `SESSION_EXPIRED` `SESSION_REUSED` `REFRESH_TOKEN_MISSING` `PROVIDER_NOT_ENABLED` |
| 工作區 / 頁面 | `WORKSPACE_NOT_FOUND` `PAGE_NOT_FOUND` `PAGE_CYCLE` `PAGE_ALREADY_DELETED` |
| Block / transaction | `BLOCK_NOT_FOUND` `INVALID_OPERATION` `INVALID_BLOCK_TYPE` `INVALID_BLOCK_PROPS` `TRANSACTION_TOO_LARGE` `VERSION_CONFLICT` |
| Database | `COLLECTION_NOT_FOUND` `VIEW_NOT_FOUND` `ROW_NOT_FOUND` `INVALID_FIELD_TYPE` `INVALID_FIELD_VALUE` `INVALID_FILTER` |
| 檔案 | `FILE_NOT_FOUND` `FILE_TOO_LARGE` `UNSUPPORTED_FILE_TYPE` `UPLOAD_FAILED` |

`AUTH_ERROR_CODES`（`UNAUTHORIZED` / `SESSION_EXPIRED` / `SESSION_REUSED` /
`REFRESH_TOKEN_MISSING`）是前端「該跳登入頁了」的判斷依據。

### 兩條重要的錯誤慣例

1. **看不見的東西一律回 404，不回 403。**
   `requirePagePermission()` 在權限是 `none` 時丟 `PAGE_NOT_FOUND`，
   權限不足（看得到但不夠）才丟 `FORBIDDEN` —— 不洩漏頁面是否存在。
2. **資料庫的 404 會被翻譯成 `COLLECTION_NOT_FOUND`**（同樣是 404，
   只是訊息對得上端點）。

---

## 2. 權限模型

### 2.1 兩個維度

| 維度 | 值 | 來源 |
|---|---|---|
| 工作區角色 `WorkspaceRole` | `owner` / `admin` / `member` / `guest` | `workspace_members.role` |
| 頁面權限 `PagePermission` | `none` < `read` < `comment` < `edit` < `full` | `page_permissions` 繼承鏈 + 角色基準 |

`PAGE_PERMISSION_RANK`（`packages/shared-types/src/ws.ts`）讓權限可以直接比大小，
前後端共用同一組常數與 `permissionAtLeast()`。

### 2.2 角色 → 頁面權限

```
WORKSPACE_ROLE_BASELINE   沒有任何 page_permissions 條目時的預設
  owner  → full     admin → full     member → edit     guest → none

WORKSPACE_ROLE_CEILING    不論授權多高，封頂在這裡
  owner  → full     admin → full     member → full     guest → comment
```

- `owner` / `admin` 對工作區內任何頁面**直接** `full`（不查繼承鏈）。
- `member` 預設 `edit`，可以被 `page_permissions` 調升到 `full` 或調降。
- **`guest` 預設看不到任何頁面**，必須被明確授權，而且**封頂在 `comment`（永遠不能編輯）**。
- **工作區外的人**也可以被指名授權（第六輪），但只認直接指名他的 `user` 條目，封頂在 `edit`。
- 頁面**建立者**視同 `full`（僅限工作區成員）。
- 公開分享連結（`FEATURE_PUBLIC_SHARE`）**永遠封頂在 `read`**。

資料庫的 `page_role` enum 與對外的 `PagePermission` 對照（`shared-types/src/permissions.ts`）：
`owner↔full`、`editor↔edit`、`commenter↔comment`、`reader↔read`、`none↔none`。

### 2.3 角色 × 動作矩陣

驗收來源：[`docs/qa/functional-round8.md`](../qa/functional-round8.md)（權限總掃）
與 [`functional-round9.md`](../qa/functional-round9.md)（附件 / WS 撤權）。
每一格都有對應的 e2e：`e2e/functional-round8.spec.ts` / `round9.spec.ts`。

| 動作 | 需要的頁面權限 | guest（預設 none） | guest（被授權 comment） | member | admin / owner |
|---|---|---|---|---|---|
| 讀頁面 meta / snapshot | `read` | 404 | ✅ | ✅ | ✅ |
| 下載該頁附件 `GET /api/files/:id` | `read`（依 `files.page_id`） | 404 | ✅ | ✅ | ✅ |
| 匯出頁面 / 子樹 | `read` | 404 | ✅ | ✅ | ✅ |
| 讀版本歷史 / 讀 transaction log | `read` | 404 | ✅ | ✅ | ✅ |
| 讀留言串 | `read` | 404 | ✅ | ✅ | ✅ |
| 新增 / 編輯 / 解決留言 | `comment` | 403 | ✅ | ✅ | ✅ |
| 提交 block transaction（REST 或 WS） | `edit` | 403 | **403** | ✅ | ✅ |
| 改標題 / icon / cover、刪除、搬移、複製 | `edit` | 403 | **403** | ✅ | ✅ |
| 上傳附件到某頁 | `edit` | 403 | **403** | ✅ | ✅ |
| 還原版本 | `edit` | 403 | 403 | ✅ | ✅ |
| 讀資料庫（views / rows / CSV 匯出） | 載體頁 `read` | 404 | ✅ | ✅ | ✅ |
| 改 schema / 改列 / 改視圖 / 排序 | 載體頁 `edit` | 403 | **403** | ✅ | ✅ |
| 設定頁面權限 / 公開分享連結 | `full` | 403 | 403 | 視授權 | ✅ |
| 垃圾桶：還原 / 永久刪除 | `requireTrashedPageControl`（建立者 / 刪除者 / admin / owner） | ❌ | ❌ | 只限自己的 | ✅ |
| 工作區改名 / icon / slug | — | ❌ | ❌ | ❌ | ✅ |
| 刪除工作區 | — | ❌ | ❌ | ❌ | 只有 owner |
| 邀請成員 / 改成員角色 / 移除成員 | — | ❌ | ❌ | ❌ | ✅ |
| 手動觸發 GC | — | ❌ | ❌ | ❌ | 只有 owner |

> ⭐ **垃圾桶是特例。** `resolvePagePermission()` 開頭就是
> 「頁面已刪除 → 對任何人都回 `none`」，所以已刪除的頁面**不能**用
> `requirePagePermission()` 判斷（否則擁有者連自己的東西都還原不了）。
> 還原 / 永久刪除走 `requireTrashedPageControl()`；垃圾桶列表走
> `buildPermissionIndex()`（忽略 `deleted_at` 的批次解析）+ `canControlTrashedPage()`。

### 2.4 守門員掛在哪裡

- **所有 block 變更**（REST `POST /:id/transactions`、WS `tx`、版本還原、匯入）
  都經過同一支 `applyTransaction()`，權限守門員是
  `registerPermissionGuard()` → `requirePagePermission(..., 'edit')`，
  掛在 `apply-transaction.ts` 而不是 route（ADR 0004）。**沒有第二條寫入路徑。**
- **REST 的權限檢查管不到已經連上的 WebSocket。** 撤權時
  `permissions/service.ts` 發 `PermissionChangeNotifier` 事件 →
  `realtime/index.ts` → `RoomManager.publishPermissionChanged()` →
  房間重新 `resolvePagePermission()` 決定踢人或降級（第九輪）。

---

## 3. REST 端點總表

`權限` 欄位的意思：
`—` = 不需登入；`登入` = 只要通過 `requireAuth`；
`read`/`comment`/`edit`/`full` = 該頁（或資料庫載體頁）的 `PagePermission`；
`owner`/`admin` = 工作區角色。

### 3.1 系統（`app.ts`）

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/health` | — | `{ status, db, version, uptime, migrations, features }`；`migrations.pending > 0` → `status: "degraded"` |
| GET | `/api/metrics` | — | Prometheus 文字格式（自製 registry，不裝 prom-client）。**正式環境請用 nginx 擋住對外**，見 `docs/ops.md` §1 |
| GET | `/api/trash?workspaceId=` | 登入 | 垃圾桶列表（只回「還在的話你看得見」且「你有資格處置」的頁面） |
| DELETE | `/api/trash?workspaceId=` | 登入 | 清空垃圾桶；刪不掉的（別人的）會被跳過而不是整批失敗 |

### 3.2 認證 `/api/auth`

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| POST | `/api/auth/register` | — | 註冊（argon2id）；順便建立預設工作區與第一頁。10 次/分 |
| POST | `/api/auth/login` | — | 登入。10 次/分 |
| POST | `/api/auth/open` | — | **開放登入**：不輸入或隨便輸入都能進（自動建帳號／訪客）。`FEATURE_OPEN_LOGIN=false` 時回 404 |
| POST | `/api/auth/refresh` | cookie | 輪替 refresh token；**重用偵測 → 撤銷整個家族**。失敗一律清 cookie。60 次/分 |
| POST | `/api/auth/logout` | cookie | 撤銷這一條 session |
| GET | `/api/auth/providers` | — | 已啟用的外部登入方式（Google / LINE 插槽）+ `openLogin` 旗標 |
| GET | `/api/auth/me` | 登入 | 目前使用者 + 工作區清單 |
| PATCH | `/api/auth/me` | 登入 | 帳號設定：`name` / `avatarUrl` / `preferences{locale,theme,startPage}`。60 次/分 |
| DELETE | `/api/auth/me` | 登入 | 刪除帳號（軟刪 + 撤銷所有 session）；必須帶 `confirm=DELETE` |
| POST | `/api/auth/password` | 登入 | 改密碼；撤銷**除了目前這一台以外**的所有 session 家族 |
| POST | `/api/auth/claim` | 登入 | 訪客帳號升級成正式帳號（保留所有資料） |
| POST | `/api/auth/logout-all` | 登入 | 登出所有裝置（含目前這一台） |
| GET | `/api/auth/sessions` | 登入 | 我的登入裝置清單 |
| DELETE | `/api/auth/sessions/:id` | 登入 | 踢掉「我自己的」某一條 session 家族（`WHERE user_id` 收斂） |

### 3.3 工作區 `/api/workspaces`

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/workspaces` | 登入 | 我的工作區 |
| POST | `/api/workspaces` | 登入 | 建立工作區（自己成為 owner）。10 次/分 |
| GET | `/api/workspaces/:id/tree` | 成員 | 頁面樹：扁平陣列 + `parentId` + `sortKey`，前端自己組樹。**依使用者過濾**（第七輪） |
| PATCH | `/api/workspaces/:id` | owner / admin | 改名稱 / icon / slug |
| DELETE | `/api/workspaces/:id` | owner | 軟刪除工作區 |
| GET | `/api/workspaces/:id/members` | 成員 | 成員清單 |
| POST | `/api/workspaces/:id/invites` | admin+ | 邀請成員（已存在的使用者直接加入，否則發 invite token） |
| PATCH | `/api/workspaces/:id/members/:userId` | admin+ | 改成員角色 |
| DELETE | `/api/workspaces/:id/members/:userId` | admin+ | 移除成員 |

### 3.4 頁面 `/api/pages`

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| POST | `/api/pages` | 父頁 `edit` | 建立頁面（**自動建立一個空 paragraph block**） |
| GET | `/api/pages/:id` | `read` | 頁面 meta |
| GET | `/api/pages/:id/snapshot` | `read` | ⭐ meta + 整頁 blocks（`record_map` 扁平形狀 + sync `seq`），HTTP 載入與 WS 訂閱之間沒有空窗 |
| PATCH | `/api/pages/:id` | `edit` | 改 title / icon / cover / 版面設定 |
| DELETE | `/api/pages/:id` | `edit` | 軟刪除（子孫一併） |
| POST | `/api/pages/:id/restore` | 垃圾桶控制權 | 還原（子孫一併） |
| DELETE | `/api/pages/:id/permanent` | 垃圾桶控制權 | 永久刪除 |
| POST | `/api/pages/:id/move` | `edit` | 搬移（含循環檢測 → `PAGE_CYCLE`） |
| POST | `/api/pages/:id/duplicate` | `edit` | 深拷貝（內部連結指向新複本） |
| POST | `/api/pages/:id/transactions` | `edit` | ⭐ 提交一批 operation（冪等、原子、`seq` 遞增）。600 次/分 |
| GET | `/api/pages/:id/transactions?since=N` | `read` | 斷線補傳 / operation log |
| GET | `/api/pages/favorites?workspaceId=` | 登入 | 我的最愛 |
| POST | `/api/pages/:id/favorite` | `read` | 加入我的最愛 |
| DELETE | `/api/pages/:id/favorite` | 登入 | 取消**我自己的**收藏（`(page_id, user_id)` 收斂，白名單例外） |
| GET | `/api/pages/shared-with-me?workspaceId=` | 登入 | 別人分享給我的頁面 |
| GET | `/api/pages/recent?workspaceId=` | 登入 | 最近瀏覽（等同 `/api/recent`） |

### 3.5 資料庫 `/api/databases`

權限一律是**載體頁**的權限（第八輪 BUG-40）：`loadCollection(collectionId, userId, need)`。

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/databases/field-types` | 登入 | 20 種欄位型別的 metadata（label / icon / group / computed） |
| GET | `/api/databases?workspaceId=` | 登入 | 工作區裡的資料庫清單（relation 欄位的「目標資料庫」下拉用） |
| POST | `/api/databases` | 父頁 `edit` | 建立 database（頁面 + collection + 預設 table 視圖） |
| GET | `/api/databases/:id` | `read` | collection schema + views |
| PATCH | `/api/databases/:id/schema` | `edit` | 改欄位 schema（新欄位會 append 到所有視圖） |
| POST | `/api/databases/:id/schema/preview-cast` | `read` | ⭐ 改欄位型別前**必須**先打這支：預覽會丟失哪些值（ADR 0003，絕不靜默轉換） |
| GET | `/api/databases/:id/rows?viewId=&cursor=` | `read` | 查詢列（filter / sort / group，keyset 分頁） |
| POST | `/api/databases/:id/rows` | `edit` | 新增列（伺服器端種一個 paragraph block，第九輪） |
| PATCH | `/api/databases/:id/rows/:rowId` | `edit` | 改列屬性 |
| DELETE | `/api/databases/:id/rows/:rowId` | `edit` | 刪除列（進垃圾桶） |
| POST | `/api/databases/:id/rows/reorder` | `edit` | 拖曳排序（寫 `pages.sort_key`）。`afterId: null` = 移到最前 |
| POST | `/api/databases/:id/rows/:rowId/duplicate` | `edit` | 複製一列 |
| POST | `/api/databases/:id/views` | `edit` | 新增視圖（6 種：table / board / list / gallery / calendar / timeline） |
| PATCH | `/api/databases/:id/views/:viewId` | `edit` | 改視圖（filter / sort / group / 外觀 / 欄寬） |
| DELETE | `/api/databases/:id/views/:viewId` | `edit` | 刪除視圖 |
| POST | `/api/databases/:id/views/:viewId/duplicate` | `edit` | 複製視圖 |
| GET | `/api/databases/:id/export.csv` | `read` | 匯出 CSV（欄序 = 視圖欄序） |

### 3.6 留言 `/api/pages` `/api/discussions` `/api/comments`

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/pages/:id/discussions` | `read` | 這一頁的所有留言串（含已解決） |
| POST | `/api/pages/:id/discussions` | `comment` | 開一個留言串（`anchor` 可以是 `page` / `inline`（帶 quote）/ `property`） |
| POST | `/api/discussions/:id/comments` | `comment` | 回覆 |
| POST | `/api/discussions/:id/resolve` | `comment` | 標記已解決 |
| DELETE | `/api/discussions/:id/resolve` | `comment` | 重新開啟 |
| PATCH | `/api/comments/:id` | `comment` + 作者 | 編輯自己的留言 |
| DELETE | `/api/comments/:id` | `comment` + 作者 | 刪除自己的留言 |

留言內文是 rich text 陣列，`@提及`會產生通知（第六／七輪：block 層級的提及也會）。

### 3.7 通知 `/api/notifications`

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/notifications?limit=&before=&unreadOnly=` | 登入 | 收件匣（順便回未讀數，側邊欄 badge 不必再打一支） |
| POST | `/api/notifications/:id/read` | 登入 | 標記已讀（`WHERE user_id` 收斂，白名單例外） |
| POST | `/api/notifications/read-all` | 登入 | 全部已讀 |
| POST | `/api/notifications/subscriptions` | `read` | 追蹤 / 取消追蹤某一頁 |

通知種類：`@提及`、`page_shared`、`workspace_invite`、`permission_changed`、留言回覆。

### 3.8 權限與分享

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/pages/:id/permissions` | `read` | SharePopover 的授權清單（誰、什麼權限、從哪一頁繼承） |
| POST | `/api/pages/:id/permissions` | `full` | 設定頁面權限（`subjectType: user \| workspace`）。用 POST 不用 PUT（前端 api-client 只有 get/post/patch/delete） |
| POST | `/api/pages/:id/share` | `full` | 開關公開分享連結（可設密碼與到期）。`FEATURE_PUBLIC_SHARE` 控制 |
| GET | `/api/public/:token` | — | ⭐ **唯一不需登入的資料端點**。token 本身是憑證，另驗密碼（query 或 `X-Share-Password` 標頭）與到期，**權限永遠封頂在 `read`**；`FEATURE_PUBLIC_SHARE=false` 時一律 404 |

### 3.9 歷史 / 最近瀏覽

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/pages/:id/history` | `read` | 版本清單（從 `page_transactions` 聚合成時間段） |
| GET | `/api/pages/:id/history/:seq` | `read` | 重建到某個 `seq` 的 snapshot（唯讀預覽） |
| POST | `/api/pages/:id/history/:seq/restore` | `edit` | 還原到某個版本（**走 `applyTransaction()`**，所以還原本身也進 operation log） |
| POST | `/api/pages/:id/visit` | 登入 | 記一次瀏覽（204 No Content）。600 次/分 |
| GET | `/api/recent?workspaceId=` | 登入 | 最近瀏覽（側邊欄「最近」與搜尋預設清單） |

### 3.10 檔案 `/api/files`

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| POST | `/api/files/upload` | 目標頁 `edit` | multipart 上傳。**magic number 白名單驗證**（不信 `Content-Type`），上限 `STORAGE_MAX_FILE_SIZE`（預設 50MB）。30 次/分 |
| GET | `/api/files/:id` | 依 `files.page_id` 的 `read` | 下載。第九輪（migration `0070`）之前只做到「工作區成員限定」，同工作區 guest 拿得到私密頁的附件 |

`StorageAdapter` 目前有 `local`（預設）與 S3/MinIO 插槽（`STORAGE_DRIVER`）。

### 3.11 搜尋 `/api/search`

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/search?q=&workspaceId=&type=&createdBy=&updatedAfter=&limit=&cursor=` | 登入 | 中文 bigram 斷詞 → tsvector + `ts_rank_cd` 相關性排序，短查詢／錯字／零結果退回 `pg_trgm`。`q` 是空字串合法（代表「還沒打字」，回最近瀏覽） |

`type` = `page \| database`。結果依使用者權限過濾。

### 3.12 匯出 / 匯入

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| POST | `/api/pages/:id/export` | `read` | `format`: `markdown` / `html` / `csv` / `json` / `pdf`；`includeSubpages` / `includeAttachments`。含子頁或附件時一律回 `.zip`（自寫 ZIP writer）。**`pdf` 一律回 501**，前端改走 `window.print()`（ADR 0005）。20 次/分 |
| POST | `/api/import` | 目標父頁 `edit` | multipart。支援 `.md` / `.markdown` / `.txt` / `.html`（單檔）、`.csv`（一個資料庫）、`.zip`（Notion 官方匯出）。所有 block **一律走 `applyTransaction()`**。回應帶 `warnings[]`。10 次/分 |

上限（`import/service.ts`）：500 頁 / 500 個附件 / 單一 CSV 2000 列；
匯出上限：500 頁、附件總量 200MB。

### 3.13 維運 `/api/admin`

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| POST | `/api/admin/gc` | 工作區 **owner** | 手動觸發垃圾回收（`retentionDays`、`dryRun`）。5 次/分 |
| GET | `/api/admin/gc?workspaceId=` | 工作區 **owner** | 上一次 GC 的結果 |

---

## 4. WebSocket 協定 `/ws`

型別定義：`packages/shared-types/src/ws.ts`（**前後端共用同一份**，
DevTools 的 WS 分頁可以直接讀懂每一則訊息）。
實作：`apps/server/src/modules/realtime/ws.ts` + `room-manager.ts`。

### 4.1 連線與握手

1. 連上 `/ws`（同源；正式環境 nginx 帶 `Upgrade` 標頭）。
2. 認證：query 帶 access token，或送第一則 `auth` 訊息。**10 秒內沒認證就斷線。**
3. 成功 → `authOk`；失敗 → `authError` 後關閉連線。
4. 一條連線可以訂閱**多頁**（`subscribe` / `unsubscribe`）。

### 4.2 Client → Server

| `t` | 欄位 | 說明 |
|---|---|---|
| `auth` | `token`, `sessionId` | 握手 |
| `subscribe` | `pageId`, `sinceSeq?` | 訂閱一頁；帶 `sinceSeq` 會補傳 |
| `unsubscribe` | `pageId` | 退訂 |
| `tx` | `tx: Transaction` | 提交 operation —— 與 `POST /api/pages/:id/transactions` **走同一支 `applyTransaction()`** |
| `presence` | `pageId`, `blockId`, `selection` | 游標 / 選取範圍 |
| `ping` | — | 心跳 |

### 4.3 Server → Client

| `t` | 欄位 | 說明 |
|---|---|---|
| `authOk` | `userId`, `sessionId` | |
| `authError` | `code` | 接著會關連線 |
| `synced` | `pageId`, `seq`, `permission` | 訂閱成功，順便告訴你在這一頁的權限 |
| `txApplied` | `result` | **自己**的 tx 成功（ack） |
| `txRejected` | `txId`, `code`, `message` | 自己的 tx 被拒 |
| `txBroadcast` | `result` | **他人**的 tx |
| `catchUp` | `pageId`, `results[]`, `toSeq` | 斷線補傳 |
| `presence` | `pageId`, `peers[]` | 房間內所有人的游標 |
| `resync` | `pageId`, `reason` | 落後太多 → 叫你重抓 snapshot |
| `notification` | `notification`, `unread` | 即時通知 |
| `comment` | `pageId`, `event`, `discussion`, `comment?` | `created` / `updated` / `resolved` / `reopened` / `deleted` |
| `error` | `code`, `message`, `pageId?` | 非致命錯誤（致命的走 `authError`） |
| `pong` | — | |

### 4.4 協定常數（前後端引用同一份，不要各寫各的）

| 常數 | 值 | 為什麼 |
|---|---|---|
| `WS_CLIENT_PING_INTERVAL_MS` | 25s | 必須短於 Nginx / Cloudflare 的 60s 閒置逾時 |
| `WS_SERVER_HEARTBEAT_MS` | 30s | server 掃死連線 |
| `WS_DEAD_CONNECTION_MS` | 60s | 超過就當死連線 |
| `WS_MAX_CATCHUP` | 500 | 落後超過這個量就不補傳，改叫 client 重抓 snapshot |
| `WS_ROOM_LINGER_MS` | 30s | 房間空了延遲銷毀，避免切頁抖動 |
| `PRESENCE_TTL_MS` | 45s | presence **永遠不進 PostgreSQL** |

`PRESENCE_COLORS` 是 8 色票，伺服器依 `userId` 雜湊指派
（`presenceColorFor()`），同一個人在所有客戶端顏色一致。

### 4.5 前端連線狀態機

`SyncConnectionState`：`idle` → `connecting` → `authenticating` → `syncing` →
`ready`，斷線時 `reconnecting` / `offline`。`syncing` 期間 UI 顯示「同步中」。
接線方式見 [`apps/web/src/lib/README-sync.md`](../../apps/web/src/lib/README-sync.md)。

### 4.6 OT delta 通道（`FEATURE_OT`）

**不是第二套協定。** `text.delta` 一樣包成 `Transaction` 走 WS 的 `tx` 訊息，
落到同一支 `applyTransaction()`，ack 走 `txApplied`、廣播走 `txBroadcast`，
`ws.ts` 一行都沒有改。

| 通道 | 內容 | operation |
|---|---|---|
| delta | 同一個 block 內的**文字變更** | `text.delta`（OT，兩人的字都保留） |
| tx | 結構變更（新增／刪除／搬移／換型別／改 props） | `block.*`（block 粒度 LWW） |

- `FEATURE_OT=false`（預設）時 `text.delta` 回 `NOT_IMPLEMENTED`，行為完全等同 M5。
- 前端自己問 `/api/health` 的 `data.features.ot` 決定要不要切換，
  **每個分頁只探測一次**；開發／e2e 可用 `VITE_FEATURE_OT=1` 強制打開。
- **送出的 `block.update` 永遠不可以帶 `content`**（ADR 0006 §2.9 / QA BUG-4）。
- 開啟步驟與已知限制：[`docs/adr/0006-ot.md`](../adr/0006-ot.md) §4。

---

## 5. 速率限制一覽

全域 `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`（預設 100 / 1 分鐘）**不是全域開啟**的
（`global: false`），而是逐端點指定：

| 端點群 | 上限 |
|---|---|
| 認證寫入（register / login / open / password / claim / logout-all / 刪帳號 / 撤 session） | 10 / 分 |
| `/api/auth/refresh`、帳號資料邊改邊存、工作區 PATCH | 60 / 分 |
| 一般寫入（pages / databases / permissions） | 60 / 分（部分 10 / 分） |
| 留言寫入 | 120 / 分 |
| `POST /api/pages/:id/transactions`、`POST /api/pages/:id/visit` | 600 / 分 |
| 檔案上傳 | 30 / 分 |
| 匯出 | 20 / 分 |
| 匯入、清空垃圾桶 | 10 / 分 |
| `POST /api/admin/gc` | 5 / 分 |
| `GET /api/public/:token` | 60 / 分 |

---

## 6. 新增端點時的檢查清單

1. **service 層不認識 HTTP**（ADR 0004 鐵則 1）—— 同一份邏輯要能被 REST route 與 WS handler 同時呼叫。
2. 吃 `:id` / `:rowId` / `:viewId` 的 handler **一定要有權限原語**，否則
   `apps/server/test/route-permission-audit.test.ts` 會紅。真的有例外就寫進該檔的
   `ALLOWLIST` 並附理由（例外必須顯眼）。
3. 所有 block 變更走 `applyTransaction()`，禁止直接 `UPDATE blocks`。
4. 回應形狀一律 `{ data }` / `{ error }`，新錯誤碼要加進 `shared-types/src/errors.ts`。
5. 寫入端點要給 `config.rateLimit`。
