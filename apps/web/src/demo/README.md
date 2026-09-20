# Demo 模式（純瀏覽器後端）

`VITE_DEMO=1` 時，`apps/web` **完全不需要伺服器**也能整站操作：
登入、寫、`/` 選單、資料庫六視圖、篩選排序、搜尋、版本歷史、匯出匯入、上傳圖片。
資料存在瀏覽器的 IndexedDB，重新整理不會消失，也**不會離開這台裝置**。

線上站：<https://ken158ken.github.io/kennote-demo/>
（`.github/workflows/pages.yml`，用 `VITE_DEMO=1 VITE_BASE=/kennote-demo/` 建置）

---

## 1. 為什麼可以不要伺服器

前端與後端之間只有**兩個介面**：同源的 `/api/**`（REST）與 `/ws`（WebSocket）。
這個模組把這兩個介面在瀏覽器裡重新實作一次：

```
main.tsx
  └─ VITE_DEMO=1 → await import('./demo') → installDemoBackend()
        ├─ patch globalThis.fetch        ─┐
        ├─ patch XMLHttpRequest          ─┤→ demo/router.ts → handlers/*.ts
        ├─ globalThis.WebSocket = 假的     │      ↕
        └─ 第一次載入 → demo/seed.ts       └─ demo/core.ts（applyTransaction）
                                                  ↕
                                            demo/store.ts（記憶體 + IndexedDB）
```

**`lib/api-client.ts`、`lib/sync-client.ts`、所有 feature 一行都沒有改。**
它們以為自己在跟伺服器講話。

### 為什麼要 patch XHR

`lib/upload.ts` 用 `XMLHttpRequest` 才拿得到上傳進度條，只攔 `fetch` 的話
「上傳圖片」會打到不存在的伺服器。`demo/index.ts` 的 `patchXhr()` 補上這條路。

### 為什麼 `<img src="/api/files/:id">` 要特別處理

`<img>` 的資源載入**不走 fetch**，攔截不到。`installDemoBackend()` 會裝一個全域
掛勾 `__KENNOTE_DEMO_FILE_URL__`，`lib/upload.ts` 的 `resolveMediaUrl()` /
`fileUrl()` 先問它，把 `fileId` 換成 IndexedDB blob 的 `blob:` URL。
（這是整個 demo 唯一動到 `src/demo/` 以外程式碼的地方，約 10 行。）

---

## 2. 檔案

| 檔案 | 職責 |
|---|---|
| `index.ts` | `installDemoBackend()`：攔 fetch / XHR / WebSocket、註冊路由、第一次載入種資料、`resetDemoData()` |
| `router.ts` | `METHOD /api/pages/:id/snapshot` → handler 的極小比對器（**先註冊先比對**） |
| `store.ts` | 記憶體 state + IndexedDB 持久化（整包一個 key，debounce 150ms）＋ 檔案 blob store |
| `core.ts` | 頁面 / block / **`applyTransaction()`** / snapshot / 版本重播 |
| `rows.ts` | 純 JS 的 filter / sort / group / aggregation / 計算欄位物化 |
| `ws.ts` | 假 `WebSocket`：`authOk` / `synced` / `presence` / `txApplied` / `pong` |
| `seed.ts` | 種子資料（內容對照 `e2e/fixtures/reference-page.ts`） |
| `util.ts` | uuid、fractional index、RichText、`{ data }` / `{ error }` 回應形狀 |
| `DemoBadge.tsx` | 側邊欄底部的「Demo 模式」徽章（點一下重設資料） |
| `handlers/auth.ts` | 認證（永遠成功，只有一個 demo 使用者） |
| `handlers/pages.ts` | 工作區 / 頁面 / transaction / 歷史 / 垃圾桶 / 最愛 / 最近 |
| `handlers/databases.ts` | collection / views / rows / schema / CSV |
| `handlers/misc.ts` | health / 搜尋 / 檔案 / 留言 / 通知 / 權限 / 匯出 / 匯入 / admin |

### 與伺服器一致的地方（刻意的）

- **只有一條寫入路徑**：所有 block 變更都走 `core.ts` 的 `applyTransaction()`，
  REST 與假 WS 共用同一支（ADR 0004 的鐵則在 demo 也成立）。
- **冪等**：同一個 `txId` 重送回上次結果；同一個 `blockId` 重複 insert 是 no-op；
  已刪除的 block 再刪一次是 no-op。
- **append-only operation log**：`page_transactions` 撐起斷線補傳（`?since=`）
  與版本歷史（`rebuildSnapshotAt()` 從 log 重播，**不另存快照**）。
- **`PageSnapshot` 是 `record_map` 扁平形狀**，欄位與 `@kennote/shared-types` 一致
  （`__tests__/snapshot.test.ts` 會驗）。
- **`features.ot = false`** → 前端走 block 層級 LWW，`text.delta` 一律 501。
- **`features.realtime = true`** → 假 WS 讓連線徽章、presence、`synced` 都正常。

---

## 3. 覆蓋的端點

> `⭕` = 行為與伺服器等價　`🟡` = 簡化版（行為合理但不完全等價）　
> `🔴` = 故意回 501/404（demo 沒有伺服器就做不到）

### 系統

| 端點 | | 說明 |
|---|---|---|
| `GET /api/health` | ⭕ | `features.ot=false` / `realtime=true` / `publicShare=false`，另加 `demo: true` |
| `GET /api/metrics` | 🟡 | 回一行純文字 |
| `GET` `POST /api/admin/gc` | 🟡 | 回空結果 |

### 認證

| 端點 | | 說明 |
|---|---|---|
| `POST /api/auth/refresh` | ⭕ | **永遠成功** → 進站自動登入 |
| `POST /api/auth/login` `/register` `/open` | ⭕ | 不管輸入什麼都回同一個 demo 使用者 |
| `POST /api/auth/logout` `/logout-all` | ⭕ | 清掉 session |
| `GET` `PATCH /api/auth/me` | ⭕ | 名稱 / 頭像 / preferences（主題、語言、起始頁）都會存進 IndexedDB |
| `GET /api/auth/providers` | ⭕ | `{ providers: [], openLogin: true }` |
| `GET /api/auth/sessions`、`DELETE /api/auth/sessions/:id` | 🟡 | 只有一台「這台裝置」 |
| `POST /api/auth/password` `/claim` | 🟡 | 回成功，但 demo 沒有密碼 |
| `DELETE /api/auth/me` | 🔴 | 501（改用「重設 Demo 資料」） |

### 工作區

| 端點 | | |
|---|---|---|
| `GET` `POST /api/workspaces` | ⭕ | |
| `GET /api/workspaces/:id/tree` | ⭕ | 扁平陣列 + `parentId` + `sortKey`，database 的列不進樹 |
| `PATCH` `DELETE /api/workspaces/:id` | ⭕ | |
| `GET /api/workspaces/:id/members` | 🟡 | 只有 demo 使用者一個 owner |
| `POST /api/workspaces/:id/invites` | 🔴 | 501 |
| `PATCH` `DELETE /api/workspaces/:id/members/:userId` | 🟡 | no-op |

### 頁面

| 端點 | | |
|---|---|---|
| `POST /api/pages` | ⭕ | 自動種一個空 paragraph |
| `GET /api/pages/:id`、`GET /api/pages/:id/snapshot` | ⭕ | |
| `PATCH` `DELETE /api/pages/:id` | ⭕ | 軟刪除連子孫 |
| `POST /api/pages/:id/restore`、`DELETE /api/pages/:id/permanent` | ⭕ | |
| `POST /api/pages/:id/move` | ⭕ | 含循環檢測 → `PAGE_CYCLE` |
| `POST /api/pages/:id/duplicate` | ⭕ | 深拷貝，內部子頁連結指向新複本 |
| `POST` `GET /api/pages/:id/transactions` | ⭕ | 冪等、`seq` 遞增、`?since=` 補傳 |
| `POST /api/pages/:id/blocks/move-to` | ⭕ | 兩筆 transaction（來源刪、目標插） |
| `GET /api/pages/:id/history`、`/history/:seq`、`POST /history/:seq/restore` | ⭕ | 從 operation log 重播；還原本身也走 `applyTransaction()` |
| `GET /api/pages/favorites`、`POST` `DELETE /api/pages/:id/favorite` | ⭕ | |
| `GET /api/pages/recent`、`GET /api/recent`、`POST /api/pages/:id/visit` | ⭕ | |
| `GET /api/pages/shared-with-me` | 🟡 | 永遠 `[]`（只有一個人） |
| `GET` `DELETE /api/trash` | ⭕ | 只列「最上層」被刪的頁 |

### 資料庫

| 端點 | | |
|---|---|---|
| `GET /api/databases/field-types` | ⭕ | 20 種欄位型別的 metadata |
| `GET` `POST /api/databases` | ⭕ | `parentPageId` / `parentId` 都吃 |
| `GET /api/databases/:id` | ⭕ | `{ collection, views }` |
| `GET /api/databases/:id/rows` | ⭕ | filter / sort / group / search / 聚合 / offset 分頁 |
| `POST` `PATCH` `DELETE /api/databases/:id/rows[/:rowId]` | ⭕ | 含看板「＋」落在泳道、checkbox 預設值 |
| `POST /api/databases/:id/rows/reorder`、`/:rowId/duplicate` | ⭕ | |
| `POST` `PATCH` `DELETE /api/databases/:id/views[/:viewId]`、`/duplicate` | ⭕ | 六種視圖都支援 |
| `PATCH /api/databases/:id/schema` | 🟡 | `ops` 的 add/rename/update/retype/delete 都支援；**retype 一律清空舊值**（不做逐值轉換） |
| `POST /api/databases/:id/schema/preview-cast` | 🟡 | `lossy = affected`（配合上面的 retype 行為，不會靜默丟資料） |
| `GET /api/databases/:id/export.csv` | ⭕ | 欄序 = 視圖欄序，帶 BOM |

分頁用的是 **offset cursor**（`cursor` 就是數字字串），不是伺服器的 keyset ——
demo 的資料量下行為等價。

### 其他

| 端點 | | |
|---|---|---|
| `GET /api/search` | 🟡 | **子字串比對**（標題優先、再找第一個命中的 block），空 `q` 回最近造訪。沒有中文 bigram / `ts_rank_cd` / trigram 退回 |
| `POST /api/files/upload`、`GET /api/files/:id` | ⭕ | blob 存 IndexedDB，`<img>` 走 `blob:` URL |
| `POST /api/pages/:id/export` | 🟡 | `markdown` / `html` / `json` / `csv` 在前端組；**不支援 zip**（`includeSubpages` / `includeAttachments` 被忽略），`pdf` 照樣 501（走 `window.print()`） |
| `POST /api/import` | 🟡 | `.md` / `.markdown` / `.txt` / `.csv`；`.html` / `.zip` 會降級成純文字並回 `warnings` |
| `GET` `POST /api/pages/:id/discussions`、`/api/discussions/*`、`/api/comments/:id` | 🟡 | 最小實作（開串、回覆、解決、編輯、刪除），沒有 `@提及` 通知扇出 |
| `GET /api/notifications`、`/:id/read`、`/read-all`、`/subscriptions` | 🟡 | 收件匣永遠是空的（demo 只有一個人，沒人 @ 你） |
| `GET` `POST /api/pages/:id/permissions` | 🟡 | **永遠 `full`** |
| `POST /api/pages/:id/share`、`GET /api/public/:token` | 🔴 | 501 / 404（沒有伺服器就沒有公開連結） |

---

## 4. 未覆蓋（故意的）

- **多人協作**：presence 永遠只有自己一個；`txBroadcast` 只會在同一個分頁的
  多條 WS 之間傳，沒有跨分頁 / 跨裝置同步。
- **OT**（`text.delta`）：`/api/health` 回 `ot=false`，前端走 LWW。
- **公開分享連結**、**邀請成員**、**權限矩陣**：demo 只有一個 owner。
- **Notion `.zip` 匯入**、**含子頁 / 附件的 zip 匯出**。
- **中文 bigram 全文搜尋**（`kn_segment()` + `ts_rank_cd` + `pg_trgm` 退回）。
- **relation / rollup 跨庫**：schema 支援，但 demo 的種子資料沒有用到；
  `rows.ts` 的 rollup 只做到「同一個 collection 內」。
- **垃圾桶 GC 排程**、**備份還原**、**metrics**。
- **速率限制**（demo 沒有 rate limit 的意義）。

---

## 5. 怎麼加一個 handler

1. 在 `handlers/*.ts` 裡加一筆 `[pattern, handler]`：

   ```ts
   export const myRoutes: Array<[string, DemoHandler]> = [
     ['GET /api/things/:id', (req) => jsonOk(findThing(req.params.id!))],
     ['POST /api/things', async (req) => {
       const body = (await req.json<{ name?: string }>()) ?? {};
       // …改 db() 的 state…
       commit();              // ← 排進 IndexedDB 的 debounce 寫入
       return jsonOk(thing);
     }],
   ];
   ```

2. 在 `index.ts` 的 `registerAll()` 裡 `registerRoutes(myRoutes)`。
   **字面路徑要排在同長度的 `:param` 路徑前面**（`/api/pages/favorites`
   必須比 `/api/pages/:id` 早註冊）。

3. 回應一律 `jsonOk(data)` / `jsonOk(data, meta)` / `noContent()`；
   錯誤丟 `DemoApiError(status, code, message)`，`router.ts` 會包成
   `{ error: { code, message } }`。錯誤碼用 `shared-types/src/errors.ts` 的字串。

4. **所有 block 變更只能走 `applyTransaction()`**，不要直接改 `db().blocks`。

5. 加測試到 `__tests__/`（純邏輯，不需要瀏覽器）。

## 6. 測試與實走

```bash
pnpm --filter @kennote/web test         # 含 demo 的 37 條單元測試
pnpm --filter @kennote/web typecheck

# 本機跑一次「正式的 demo build」
cd apps/web
VITE_DEMO=1 VITE_BASE=/kennote-demo/ npx vite build
npx vite preview --base /kennote-demo/ --port 4183
```

實走截圖在 [`reference/shots/demo/`](../../../../reference/shots/demo/)。
