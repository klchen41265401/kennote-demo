# kennote

全自研的 Notion 類知識庫：區塊式編輯器 + 結構化資料庫 + 多人即時協作，
全部長在同一個「一切皆 block」的資料模型上。

規格文件在 `spec/`（`00-README.md` 是唯一入口）。決策紀錄在 `docs/adr/`。

> **目前進度：M1（骨架 + 認證 + 頁面 CRUD）完成。**
> 能登入、能建立／瀏覽／刪除頁面，block transaction 管線與 database 骨架都已到位，
> 但編輯器本身還沒接上（M2-A / M2-B）。

---

## 快速啟動

### 方式 A：只用 Docker 跑資料庫，前後端跑本機（推薦，開發最快）

```bash
corepack enable && corepack prepare pnpm@9 --activate   # 本機若還沒有 pnpm
pnpm install
cp .env.example .env
# 編輯 .env：填上 JWT_SECRET（openssl rand -base64 48）

pnpm db:up          # docker compose up -d postgres
pnpm db:migrate     # 跑 migration
pnpm db:seed        # 建立 demo 帳號與範例頁面（可選）
pnpm dev:local      # 同時起 server(4000) 與 web(5173)
```

打開 <http://localhost:5173>，用 `demo@kennote.local` / `demo1234` 登入。

### 方式 B：全部跑在 Docker（開發）

```bash
cp .env.example .env    # 填 JWT_SECRET
docker compose up
```

### 方式 C：正式部署（遠端 Linux 主機）

```bash
cp .env.example .env
# 必改：JWT_SECRET、POSTGRES_PASSWORD；走 HTTPS 的話把 COOKIE_SECURE 設為 true
docker compose -f docker-compose.prod.yml up -d --build
```

正式環境只對外開一個埠：<http://主機:8090>。
postgres 與 server 都不對外開埠，server 啟動前會自動跑 migration。

---

## 埠與服務

| 服務 | 開發 | 正式 | 說明 |
|---|---|---|---|
| web | 5173 | **8090**（nginx → 80） | Vite dev server / nginx 靜態託管 |
| server | 4000 | 不對外 | Fastify；`/api/*` 與 `/ws` |
| postgres | 5432 | 不對外 | PostgreSQL 16 |

前端一律走**同源** `/api` 與 `/ws`：開發時由 Vite proxy 轉到 4000，
正式時由 `apps/web/nginx.conf` 反向代理到 `server:4000`（WS 帶 Upgrade 標頭）。
因此 `VITE_API_BASE_URL` 預設是空字串，不必處理跨網域 cookie。

健康檢查：`GET /api/health` → `{ "data": { "status": "ok", "db": true, ... } }`

---

## 架構

```
┌──────────────────── apps/web（React 18 + Vite）────────────────────┐
│  routes/            LoginRoute / WorkspaceRoute / PageRoute        │
│  features/auth      登入註冊                                        │
│  features/page-tree 側邊欄（M1 扁平列表 → M3 換成樹 + 自研拖曳）      │
│  lib/api-client.ts  fetch wrapper：自動 refresh、401 重試一次        │
│  stores/auth.ts     自研 store（useSyncExternalStore）              │
│  styles/tokens.css  設計 token（原生 CSS 變數，light/dark）          │
│  #editor-host       ⭐ editor-core 的掛載點（M2-B 接上）             │
└────────────────┬───────────────────────────────────────────────────┘
                 │ REST（/api）＋ WebSocket（/ws，M5 才接）
┌────────────────▼──── apps/server（Fastify 5 + pg，無 ORM）──────────┐
│  plugins/     error-handler（統一錯誤形狀）/ auth / rate-limit        │
│  modules/     每個模組 routes → service → repo 三層                  │
│    auth/        argon2id、JWT 15m、refresh rotation + 重用偵測       │
│                 AuthProvider registry（Google / LINE 插槽已留）      │
│    workspaces/  list / tree（遞迴 CTE）/ members                     │
│    pages/       CRUD、軟刪除、還原、move（循環檢測）、duplicate（深拷貝）│
│    blocks/      ⭐ apply-transaction.ts ＝ 所有 block 變更的唯一入口   │
│                 block-types/ registry（25 種型別的 props 驗證）       │
│    databases/   collection / view 骨架、field-types registry（8 種） │
│                 query-builder.ts（filter/sort → 參數化 SQL）         │
│    files/       multipart 上傳、magic number 驗證、StorageAdapter    │
│    search/      pg_trgm ILIKE（第二階段中文斷詞排在 M6）             │
│  db/          sql.ts（tagged template，防注入）/ client.ts / migrate  │
└────────────────┬───────────────────────────────────────────────────┘
                 │
┌────────────────▼──── PostgreSQL 16 ────────────────────────────────┐
│  users / user_identities / sessions / workspaces / workspace_members│
│  pages（樹 + sort_key + seq）/ blocks（真值來源）                    │
│  page_transactions（append-only operation log ⭐ 關鍵資產）          │
│  collections / collection_views / files / favorites / page_permissions│
└────────────────────────────────────────────────────────────────────┘

packages/
  shared-types/   ⭐ 前後端唯一契約（richtext / block / operation / ws / api / errors）
  editor-core/    ⭐ 零依賴、框架無關的編輯器引擎（另一條工作線）
  ui/             自研 primitives（M1 只有 store.ts 與 useQuery.ts）
  config/         共用 tsconfig / prettier preset
```

### 三條最重要的紀律

1. **所有 block 變更必經 `applyTransaction()`**（`apps/server/src/modules/blocks/apply-transaction.ts`）。
   禁止元件或 route 直接下 `UPDATE blocks`。漏做這件事＝ M6 的 OT 階段等於重寫編輯器。
2. **service 層不認識 HTTP。** 同一份商業邏輯要同時被 REST route 與 WS handler 呼叫。
3. **`packages/editor-core` 的 `dependencies` 恆為 `{}`。** `pnpm deps:check` 會在 CI 擋下違規。

---

## 腳本清單

| 指令 | 作用 |
|---|---|
| `pnpm dev` | `docker compose up`（全部跑在容器裡） |
| `pnpm dev:local` | 本機同時起 server 與 web |
| `pnpm db:up` | 只起 postgres 容器 |
| `pnpm db:migrate` | 跑 migration（自製 runner，冪等） |
| `pnpm db:seed` | 建立 demo 帳號 `demo@kennote.local` / `demo1234` 與範例頁面 |
| `pnpm build` | 全部 build（server → esbuild bundle；web → vite build） |
| `pnpm typecheck` | 全部 `tsc --noEmit` |
| `pnpm lint` | eslint |
| `pnpm test` | 全部單元測試（**沒有資料庫時需要 DB 的測試會 skip 而不是失敗**） |
| `pnpm deps:check` | ⭐ 自研紀律檢查（黑名單 + editor-core 零依賴 + web 依賴數上限） |
| `pnpm check` | typecheck + lint + test + deps:check（提交前跑這個） |

### 整合測試（需要真的 PostgreSQL）

```bash
export DATABASE_URL_TEST=postgres://kennote:kennote@localhost:5432/kennote_test
pnpm db:migrate
pnpm --filter @kennote/server test
```

沒設 `DATABASE_URL_TEST` 時，`test/integration/` 底下的測試會自動 skip。

---

## API 端點

成功回應一律 `{ "data": T, "meta"?: {...} }`；失敗一律
`{ "error": { "code": "PAGE_NOT_FOUND", "message": "頁面不存在或已被刪除", "details"?: {...} } }`。
`code` 的完整列舉在 `packages/shared-types/src/errors.ts`。

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | `{ status, db, version, uptime }` |
| POST | `/api/auth/register` | 註冊（順便建立預設工作區與第一頁） |
| POST | `/api/auth/login` | 登入 |
| POST | `/api/auth/refresh` | 輪替 refresh token（重用偵測 → 撤銷整個家族） |
| POST | `/api/auth/logout` | 撤銷這一條 session |
| GET | `/api/auth/me` | 目前使用者 + 工作區清單 |
| GET | `/api/auth/providers` | 已啟用的外部登入方式（Google / LINE 插槽） |
| GET | `/api/workspaces` | 我的工作區 |
| GET | `/api/workspaces/:id/tree` | 頁面樹（扁平陣列 + parentId + sortKey） |
| GET | `/api/workspaces/:id/members` | 成員清單 |
| POST | `/api/pages` | 建立頁面（**自動建立一個空 paragraph block**） |
| GET | `/api/pages/:id` | 頁面 meta |
| GET | `/api/pages/:id/snapshot` | ⭐ meta + 整頁 blocks（record_map 形狀 + sync seq） |
| PATCH | `/api/pages/:id` | 改 title / icon / cover |
| DELETE | `/api/pages/:id` | 軟刪除（子孫一併） |
| DELETE | `/api/pages/:id/permanent` | 永久刪除 |
| POST | `/api/pages/:id/restore` | 還原（子孫一併） |
| POST | `/api/pages/:id/move` | 搬移（含循環檢測） |
| POST | `/api/pages/:id/duplicate` | 深拷貝（內部連結指向新複本） |
| POST | `/api/pages/:id/transactions` | ⭐ 提交一批 operation（冪等、原子、seq 遞增） |
| GET | `/api/pages/:id/transactions?since=N` | 斷線補傳 / 版本歷史 |
| GET | `/api/trash?workspaceId=` | 垃圾桶 |
| POST | `/api/databases` | 建立 database |
| GET | `/api/databases/:id` | collection + views |
| PATCH | `/api/databases/:id/schema` | 改欄位 schema |
| GET | `/api/databases/:id/rows?viewId=` | 查詢列（filter / sort） |
| POST | `/api/databases/:id/rows` | 新增列 |
| PATCH | `/api/databases/:id/rows/:rowId` | 改列 |
| POST | `/api/databases/:id/views` | 新增視圖 |
| PATCH | `/api/databases/:id/views/:viewId` | 改視圖 |
| POST | `/api/files/upload` | multipart 上傳（magic number 驗證、50MB 上限） |
| GET | `/api/files/:id` | 下載（經權限檢查） |
| GET | `/api/search?q=` | 搜尋（pg_trgm） |
| WS | `/ws` | 訊息協定型別已定，M5 才接實作 |

---

## 決策（詳見 `docs/adr/`）

- **[ADR 0001](docs/adr/0001-self-built-core.md)** —— 承載產品語義的核心一律自研，
  並用 `scripts/check-deps.ts` 把紀律變成 CI 檢查。
- **[ADR 0002](docs/adr/0002-richtext-model.md)** —— rich text 採用 04 §4.2 的扁平
  InlineSpan 模型（03 §6.1 的 Notion API 式 annotations 不採用）；
  `properties`/`format` 合併成 `props`；`pages` 獨立成表；欄位型別一律 camelCase；
  連 app shell 都用 CSS Modules，不裝 Tailwind。

M1 過程中的其他小決定（都記在 ADR 0002 末尾）：

- `uuid_generate_v7()` 改用 `set_byte` 實作（03 §3.1 的 `set_bit` 版本會產生錯誤的 version nibble）
- `pages.sort_key` 加 `COLLATE "C"`，確保 fractional index 依位元組字典序排列
- 搜尋第一階段只做 `pg_trgm` + ILIKE；中文斷詞 + tsvector 排在 M6
- `text.delta` operation 型別已就緒，但目前明確回 `NOT_IMPLEMENTED`（等 M6 的自建 OT）

---

## 下一步

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| M1 | 骨架 + 認證 + 頁面 CRUD | ✅ |
| M2-A | 編輯器核心引擎（`packages/editor-core`） | 進行中 |
| M2-B | Block 系統與編輯互動（接上 `#editor-host`） | 後端管線已就緒 |
| M3 | 頁面樹 + 自研拖曳 | 後端 tree / move / duplicate / trash 已就緒 |
| M4 | Database 系統 | 骨架已就緒（registry + query-builder） |
| M5 | 協作 / 留言 / 即時（WS） | 協定型別已定，`/ws` 是空 handler |
| M6 | 搜尋 / 分享 / 匯出 + 自建 OT | `text.delta` 型別已留 |
