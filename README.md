# kennote

全自研的 Notion 類知識庫：**區塊式編輯器 + 結構化資料庫 + 多人即時協作**，
全部長在同一個「一切皆 block」的資料模型上。

> **目前進度：M1–M6 全部完成。** 能登入（含開放登入）、能寫、能協作（含自建 OT）、
> 能查、能匯出匯入、能備份還原、能監控。
> 剩下的是「已知限制」與 P2 功能，清單在 [`docs/qa/README.md`](docs/qa/README.md) §2。

| | |
|---|---|
| 規格文件 | `../spec/`（`00-README.md` 是唯一入口）；遠端機上是 `/home/ken150ken150/notion開發` |
| 決策紀錄 | [`docs/adr/README.md`](docs/adr/README.md)（ADR 0001–0006） |
| API 參考 | [`docs/api/README.md`](docs/api/README.md)（REST 總表 + WS 協定 + 權限矩陣） |
| 維運手冊 | [`docs/ops.md`](docs/ops.md)（部署 / 備份 / migration / 監控 / 常見問題） |
| QA 報告 | [`docs/qa/README.md`](docs/qa/README.md)（9 輪功能 QA + 資料庫缺口 + 回歸分診） |
| 視覺比對 | [`reference/shots/compare/`](reference/shots/compare/)（kennote ↔ Notion 逐像素） |

正式站：<http://100.74.148.92:8090>

---

## 1. 三十秒版本

```bash
corepack enable && corepack prepare pnpm@9 --activate
pnpm install
cp .env.example .env          # 填 JWT_SECRET：openssl rand -base64 48

pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm dev:local                # server(4000) + web(5173)
```

開 <http://localhost:5173>，用 `demo@kennote.local` / `demo1234` 登入
（或直接按登入——`FEATURE_OPEN_LOGIN` 預設開著）。

---

## 2. 功能清單

### M1 骨架 / 認證 / 頁面

- argon2id 密碼、JWT access（15 分鐘，記憶體）+ refresh rotation（30 天 HttpOnly cookie，**重用偵測 → 撤銷整個家族**）
- AuthProvider registry：Google / LINE 插槽已留（`GET /api/auth/providers`）
- **開放登入 `FEATURE_OPEN_LOGIN`**：登入頁不輸入或隨便輸入都能進（自動建帳號／訪客），
  訪客可用 `POST /api/auth/claim` 升級成正式帳號並保留所有資料
- 頁面 CRUD、軟刪除 / 還原 / 永久刪除、move（循環檢測）、duplicate（深拷貝，內部連結指向新複本）
- `page_transactions` append-only operation log —— 同時支撐斷線補傳、版本歷史、協作 undo

### M2 編輯器

- `packages/editor-core`：**零依賴、框架無關**的 vanilla TS 引擎
  （contenteditable 路線 C：Control-First 輸入 + IME Reconcile-After + 安全網）
- **31 種 block 型別**（`BLOCK_TYPES`），前後端各一份 registry 驗證 props
- **完整的 `/` 斜線選單：164 項**，逐項比對 Notion 7.34（名稱 + 右側提示 + 順序 + 分組），
  對照測試在 `apps/web/src/features/editor/__tests__/slash.test.ts`，
  還原報告在 [`SLASH-MENU.md`](apps/web/src/features/editor/SLASH-MENU.md)
  - 中文 / 英文 / **拼音首字母**三種輸入都能搜
  - 過濾時攤平成相關度清單、「建議」分組記最近使用、「轉換成」只在有內容時出現
- bubble menu、block handle、拖曳搬移 / 開欄、Markdown 捷徑、貼上圖片 / Markdown / HTML
- `@` 提及（人 / 頁面 / 日期）、`[[` 連結頁面

### M3 App shell

- 頁面樹側邊欄 + **自研拖曳**（`@kennote/ui` 的 dnd 引擎，不用 dnd-kit）
- 我的最愛、最近瀏覽、垃圾桶、快速尋找（Ctrl+K）、快捷鍵表（`lib/shortcuts.ts` 是唯一定義處）
- RWD：640px 以下 Dialog 自動全螢幕、bottom sheet、長按開 block 選單、鍵盤錨定工具列
- **帳號設定**（`SettingsDialog`）：顯示名稱 / 頭像 / 語言 / 主題 / 起始頁面（跟著帳號走，migration `0050`）、
  改密碼、登入裝置清單與逐一踢除、登出所有裝置、刪除帳號

### M4 Database

- **20 種欄位型別**：title / text / number / select / multiSelect / date / checkbox / url /
  person / email / phone / files / rating / createdTime / lastEditedTime / createdBy /
  lastEditedBy / relation / rollup / formula
- **6 種視圖**：table / board / list / gallery / calendar / timeline
- filter / sort / group、keyset 分頁、聚合列、欄寬、列選取與批次操作、拖曳排序
- 雙向 relation（自動建立反向欄位）、rollup、自寫 formula 引擎
- InlineDatabase（頁面內嵌）、RowPeek（列詳情裡是**完整的編輯器**）
- 改欄位型別前必須先 `preview-cast`，**絕不靜默轉換丟資料**

### M5 協作 / 留言 / 通知

- 自研 WebSocket 協定（`packages/shared-types/src/ws.ts`，前後端共用同一份型別）
- 一條連線訂閱多頁、房間管理、斷線補傳（`catchUp`）、presence 游標（永不進 PostgreSQL）
- `BroadcastAdapter`：InMemory（單機）/ 自寫 RESP 的 Redis pub-sub（`REDIS_URL` 有值就切）
- 留言（page / inline / property 三種 anchor）、`@提及`通知、頁面訂閱、收件匣
- 權限：工作區角色 × 頁面權限繼承鏈、分享給工作區外的人、
  公開分享連結（`FEATURE_PUBLIC_SHARE`，封頂 `read`）、**撤權會即時踢 WS 房間**

### M6 搜尋 / 可攜性 / OT / 維運

- **中文 bigram 斷詞全文搜尋**：`kn_segment()` 的 generated column + `ts_rank_cd`，
  短查詢 / 錯字 / 零結果退回 `pg_trgm`。索引由資料庫自己算，**永遠不會髒**
- **匯出**：markdown / html / csv / json（含子頁或附件時打包成 zip，**自寫 ZIP writer**）；
  PDF 走瀏覽器列印（server 容器沒有瀏覽器）
- **匯入**：`.md` / `.html` / `.txt` / `.csv` / **Notion 官方匯出 `.zip`**（自寫 mini-HTML 解析器）
- **自建 OT**（`FEATURE_OT`，預設關閉）：約 150 行的 retain/insert/delete，
  兩人同時改同一段文字兩人的字都保留。2 萬次 property test + 1 萬輪三方模糊測試
- **版本歷史**：從 operation log 重建任一 `seq` 的 snapshot，還原本身也走 `applyTransaction()`
- **垃圾桶 GC**（30 天）、**備份 / 還原**（`scripts/backup.sh` / `restore.sh`）、
  **`/api/metrics`**（Prometheus 文字格式，自製 registry 不裝 prom-client）

---

## 3. 架構

### 3.1 Monorepo

```
kennote/
├─ apps/
│  ├─ server/          Fastify 5 + pg（無 ORM）
│  │  ├─ src/modules/  17 個模組，每個都是 routes → service → repo 三層
│  │  ├─ src/db/       sql.ts（tagged template，防注入）/ client.ts / migrate.ts
│  │  ├─ src/plugins/  error-handler / auth / rate-limit / metrics
│  │  └─ migrations/   15 支 .sql（0001–0070），自製 runner，冪等
│  └─ web/             React 18 + Vite（runtime 依賴只有 6 個）
│     ├─ src/features/ 17 個 feature 資料夾
│     ├─ src/lib/      api-client / sync-client / ot-client / offline-queue / shortcuts
│     └─ src/stores/   自研 store（useSyncExternalStore），不裝狀態管理套件
├─ packages/
│  ├─ shared-types/    ⭐ 前後端唯一契約（richtext / block / operation / ws / api / errors / ot）
│  ├─ editor-core/     ⭐ 零依賴、框架無關的編輯器引擎 + OT 實作（前後端共用）
│  ├─ ui/              自研 primitives：定位引擎 / 浮層堆疊 / dnd / 虛擬捲動 / 80 個 icon
│  └─ config/          共用 tsconfig / prettier preset
├─ e2e/                Playwright（18 支 spec，約 101 條）
├─ scripts/            deploy.sh / remote-up.sh / backup.sh / restore.sh / check-deps.ts
├─ reference/          Notion 實機截圖與 UI 規格、kennote ↔ Notion 比對結果
└─ docs/               adr/ · api/ · qa/ · ops.md
```

### 3.2 資料流

```
                    ┌─────────────────────────────────────────────┐
                    │  apps/web（React 18 + Vite）                │
                    │                                             │
  使用者輸入 ──────▶│  editor-core（vanilla TS，不認識 React）    │
                    │      │ localOps                             │
                    │      ▼                                      │
                    │  lib/sync-client.ts ──┬── WS /ws（即時）    │
                    │  lib/ot-client.ts     └── REST /api（退路） │
                    │  lib/offline-queue.ts（IndexedDB，斷線重送）│
                    └──────────────┬──────────────────────────────┘
                                   │ 同源；dev 走 Vite proxy，prod 走 nginx
                    ┌──────────────▼──────────────────────────────┐
                    │  apps/server（Fastify 5）                   │
                    │                                             │
                    │   REST route ─┐                             │
                    │   WS handler ─┼─▶ service（不認識 HTTP/WS） │
                    │   版本還原   ─┤                             │
                    │   匯入       ─┘                             │
                    │                  │                          │
                    │                  ▼                          │
                    │        ⭐ applyTransaction()                │
                    │        （所有 block 變更的唯一入口，        │
                    │          權限守門員也掛在這裡）             │
                    │                  │                          │
                    │         ┌────────┴────────┐                 │
                    │         ▼                 ▼                 │
                    │     blocks（真值）  page_transactions（log）│
                    │                           │                 │
                    │                           ▼                 │
                    │                    RoomManager 廣播         │
                    │                 （InMemory / Redis RESP）   │
                    └──────────────┬──────────────────────────────┘
                    ┌──────────────▼──────────────────────────────┐
                    │  PostgreSQL 16                              │
                    │  users · user_identities · sessions         │
                    │  workspaces · workspace_members · invites   │
                    │  pages（樹 + sort_key + seq）· blocks       │
                    │  page_transactions ⭐ · block_deltas（OT）  │
                    │  collections · collection_views             │
                    │  files · favorites · page_permissions       │
                    │  discussions · comments · notifications     │
                    │  page_visits · user_preferences             │
                    └─────────────────────────────────────────────┘
```

### 3.3 四條不能破的紀律

1. **所有 block 變更必經 `applyTransaction()`**
   （`apps/server/src/modules/blocks/apply-transaction.ts`）。
   禁止元件或 route 直接下 `UPDATE blocks`。REST、WS、版本還原、匯入走的是同一支。
2. **service 層不認識 HTTP / WS。** 同一份商業邏輯要同時被 REST route 與 WS handler 呼叫。
3. **`packages/editor-core` 的 `dependencies` 恆為 `{}`。**
   `pnpm deps:check` 會在 CI 擋下違規（另外也擋黑名單套件與 `apps/web` 的依賴數上限）。
4. **吃 `:id` 的 route handler 一定要有權限原語。**
   `apps/server/test/route-permission-audit.test.ts` 會掃原始碼，漏掉就紅。
   真的有例外就寫進該檔的 `ALLOWLIST` 並附理由——**例外必須顯眼**。

---

## 4. 快速啟動

### 方式 A：本機開發（推薦）

```bash
pnpm install
cp .env.example .env         # 填 JWT_SECRET
pnpm db:up                   # 只起 postgres 容器（5432）
pnpm db:migrate
pnpm db:seed                 # demo@kennote.local / demo1234（可選）
pnpm dev:local               # server(4000) + web(5173) 同時起
```

### 方式 A′：本機前端 + **遠端 API**（做 UI 比對最好用）

前端有 HMR，資料是正式站的：

```bash
VITE_PROXY_TARGET=http://100.74.148.92:8090 pnpm --filter @kennote/web dev
```

`vite.config.ts` 會把 `/api` 與 `/ws` 都代理過去。
⚠️ 實務上 **WebSocket 常常不跟著 proxy**（頂欄顯示「尚未連線」），
所以即時協作要在真正的站上測，不要在這個模式測（QA 的 O-28）。

### 方式 B：全部跑在 Docker（開發）

```bash
cp .env.example .env
docker compose up            # web 5173 / server 4000 / postgres 5432
```

### 方式 C：正式部署

```bash
bash scripts/deploy.sh       # 本機 git push deploy → 遠端 scripts/remote-up.sh
```

`remote-up.sh` 會：`.env` 不存在就從範本產生（隨機 `JWT_SECRET` / `POSTGRES_PASSWORD`）→
`docker compose -f docker-compose.prod.yml build --pull` → `up -d` →
輪詢 `/api/health` 最多 120 秒。

正式環境**只對外開一個埠**：<http://主機:8090>。
postgres 與 server 都不對外開埠，server 啟動前會自動跑 migration。
詳情與回滾見 [`docs/ops.md`](docs/ops.md) §2。

---

## 5. 埠與服務

| 服務 | 容器名 | 開發 | 正式 | 對外 |
|---|---|---|---|---|
| web | `kennote-web` | 5173（Vite） | **8090** → 容器 80（nginx） | ✅ 只有這個 |
| server | `kennote-server` | 4000 | 4000（僅 compose 網路內） | ❌ |
| postgres 16 | `kennote-postgres` | 5432 | 5432（僅 compose 網路內） | ❌ |

前端一律走**同源** `/api` 與 `/ws`，所以 `VITE_API_BASE_URL` 預設是空字串，
不必處理跨網域 cookie。

> **Vite 埠跳號**：5173 被佔用時 Vite 會自動往上找（5174、5175…），
> 而 e2e 的 `BASE_URL` 是寫死的。跑 e2e 前請看 vite 實際印出來的埠。

健康檢查：

```bash
curl -s http://localhost:8090/api/health | jq
# { "data": { "status": "ok", "db": true, "version": "0.1.0", "uptime": 42,
#             "migrations": { "applied": 15, "onDisk": 15, "pending": 0, ... },
#             "features": { "realtime": true, "ot": false, "publicShare": false } } }
```

---

## 6. 環境變數重點

完整清單與說明在 [`.env.example`](.env.example)；所有變數都會過
`apps/server/src/env.ts` 的 schema，缺必填項目時 server 會**啟動失敗並印出變數名稱**。

### 必填

| 變數 | 說明 |
|---|---|
| `JWT_SECRET` | 至少 32 字元：`openssl rand -base64 48` |
| `DATABASE_URL` | postgres 連線字串 |
| `POSTGRES_PASSWORD` | 正式部署用（`docker-compose.prod.yml`） |

### 功能開關 ⭐

| 變數 | 預設 | 說明 |
|---|---|---|
| `FEATURE_OPEN_LOGIN` | **`true`** | 登入頁不輸入或隨便輸入都能進（自動建帳號／訪客）。`POST /api/auth/open`，關掉時該端點回 404。**公開對外時務必設 `false`** |
| `FEATURE_OT` | `false` | 自建 OT 的 `text.delta` 通道。關著時回 `NOT_IMPLEMENTED`，行為等同 M5 的 block 粒度 LWW。開啟步驟見 [`docs/adr/0006-ot.md`](docs/adr/0006-ot.md) §4 |
| `FEATURE_PUBLIC_SHARE` | `false` | 公開分享連結（`GET /api/public/:token`）。關著時一律 404。權限永遠封頂在 `read` |
| `FEATURE_REALTIME` | `true` | WebSocket 即時同步 |

> ⚠️ **`docker-compose.prod.yml` 目前沒有把 `FEATURE_OPEN_LOGIN` 與
> `FEATURE_PUBLIC_SHARE` 傳給 server 容器**，所以正式站吃的是 `env.ts` 的預設值
> （開放登入 **ON**、公開分享 OFF）。要關掉開放登入，得在 compose 的 `server.environment`
> 補一行 `FEATURE_OPEN_LOGIN: ${FEATURE_OPEN_LOGIN:-true}`（只改 .env 沒有用）。

### 其他常用

| 變數 | 說明 |
|---|---|
| `COOKIE_SECURE` | 走 HTTPS 時**必須** `true` |
| `DATABASE_URL_TEST` | 整合測試用；留空時需要 DB 的測試自動 skip 而不是失敗 |
| `REDIS_URL` | 有值就自動切 Redis pub-sub（多實例才需要） |
| `STORAGE_DRIVER` / `STORAGE_MAX_FILE_SIZE` | `local`（預設）或 S3/MinIO；上傳上限預設 50MB |
| `VITE_PROXY_TARGET` | 只在 dev 用：把 Vite 的 `/api` 與 `/ws` 指到遠端後端 |
| `VITE_FEATURE_OT` | `1` 強制前端走 OT 通道（伺服器也要開，否則會一直重載） |

---

## 7. 測試矩陣

### 7.1 單元 / 整合測試（`pnpm test`）

實跑 `pnpm -r test` 的結果：

| 套件 | 測試檔 | 測試數 | 重點 |
|---|---|---|---|
| `apps/server` | 31（3 支需要 DB） | **417 passed / 24 skipped** | query-builder、formula、權限解析、靜態權限稽核、OT service、歷史重建、匯入匯出、中文斷詞、SQL 注入、uuidv7 |
| `apps/web` | 17 | **335** | sync-client 狀態機、離線佇列、OT delta 通道、slash menu 逐項比對（45 條）、editor registry、database registry / filter model |
| `packages/editor-core` | 21 | **405** | **OT property test 各 2 萬次**、三方模糊測試 1 萬輪、richtext property test、Markdown 剪貼簿、grapheme / offset |
| `packages/ui` | 7 | **133** | 定位引擎、浮層堆疊、dnd 落點計算、虛擬捲動、元件 |
| `packages/shared-types` | 0 | — | 純型別（`--passWithNoTests`） |
| **合計** | **76** | **1290 passed / 24 skipped** | |

那 24 個 skipped 是需要真 PostgreSQL 的整合測試
（`auth-account` 15、`integration/ot-delta` 5、`integration/page-transactions` 4）。

```bash
pnpm test          # 全部
pnpm typecheck     # 全部 tsc --noEmit（目前全綠）
pnpm lint
pnpm deps:check    # 自研紀律檢查
pnpm check         # 以上四項，提交前跑這個
```

### 7.2 資料庫整合測試

沒設 `DATABASE_URL_TEST` 時，那 24 條會**自動 skip 而不是失敗**。要真的跑：

```bash
# 本機
pnpm db:up
docker exec -it kennote-postgres psql -U kennote -c 'CREATE DATABASE kennote_test'
export DATABASE_URL=postgres://kennote:kennote@localhost:5432/kennote_test
pnpm --filter @kennote/server migrate
DATABASE_URL_TEST=$DATABASE_URL pnpm --filter @kennote/server test
```

要打**遠端**那一顆 postgres（它不對外開埠）請走 SSH 隧道，
步驟在 [`docs/ops.md`](docs/ops.md) §10。

### 7.3 e2e（Playwright）

19 支 spec、112 條。第 1–9 輪的 **`test.fixme` 已經全部解開**；
目前只剩第十輪（進行中）有 3 條標著 `fixme` 等部署。

| spec | 內容 |
|---|---|
| `functional-round1~9.spec.ts` | 每一條對應 [`docs/qa/`](docs/qa/README.md) 裡的一個已修 bug（75 條） |
| `functional-round10.spec.ts` | 🚧 進行中：搜尋 guest 過濾正例 / 協作即時性 / 觸控手機（11 條，3 條待部署） |
| `database-gaps.spec.ts` | 資料庫缺口補完的回歸（9 條） |
| `realtime.spec.ts` | 兩個分頁同編一頁、Markdown 捷徑重整不變形（BUG-4） |
| `slash-menu.spec.ts` / `slash-behaviour.spec.ts` | `/` 選單逐項截圖 + 「選下去真的產生對應 block」 |
| `sidebar.spec.ts` | 頁面樹拖曳搬移 |
| `rwd.spec.ts` | RWD 與側邊欄收合 |
| `screenshots.spec.ts` / `compare.spec.ts` | 產出與 `reference/notion-capture/` 同名的截圖並逐像素比對 |
| `probe-r10.spec.ts` | 下一輪的探測腳本 |

```bash
cd e2e && npm i && npx playwright install chromium

BASE_URL=http://100.74.148.92:8090 npx playwright test              # 全量
BASE_URL=http://100.74.148.92:8090 npx playwright test functional-round8.spec.ts
```

量測基準刻意與 `reference/notion-capture/` 一致：**1440 × 900 @1x、`zh-TW`、
workers: 1、不平行**，否則截圖無法並排比對。

---

## 8. 腳本清單

| 指令 | 作用 |
|---|---|
| `pnpm dev` | `docker compose up`（全部跑在容器裡） |
| `pnpm dev:local` | 本機同時起 server(4000) 與 web(5173) |
| `pnpm db:up` | 只起 postgres 容器 |
| `pnpm db:migrate` | 跑 migration（自製 runner，冪等） |
| `pnpm db:seed` | 建立 `demo@kennote.local` / `demo1234` 與範例頁面 |
| `pnpm build` | server → esbuild bundle；web → `tsc --noEmit && vite build` |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | 逐套件 |
| `pnpm deps:check` | ⭐ 自研紀律檢查（黑名單 + editor-core 零依賴 + web 依賴數上限） |
| `pnpm check` | typecheck + lint + test + deps:check |
| `bash scripts/deploy.sh` | 推到遠端並重建（`--no-build` 可跳過 build） |
| `bash scripts/backup.sh` | 備份到 `backups/`（pg_dump custom + uploads tar，保留 14 份） |
| `bash scripts/restore.sh <檔>` | 還原（破壞性，需輸入大寫 `RESTORE` 確認） |

---

## 9. 目錄導覽（該去哪裡改）

| 我想改… | 去 |
|---|---|
| 一個 block 的外觀或行為 | `apps/web/src/features/editor/blocks/`（renderer）+ `packages/editor-core/src/view/` |
| `/` 選單的項目 | `apps/web/src/features/editor/menus/` + `SLASH-MENU.md`（**先去改 Notion 的對照表**） |
| 新增一種欄位型別 | `packages/shared-types/src/database.ts` → 後端 `field-types/` → 前端 `fields/`（見 `features/database/README.md` §1） |
| 新增一種視圖 | 同上 §2（enum 在 DB 裡，要加一支 migration） |
| 一支新的 REST 端點 | `apps/server/src/modules/<模組>/routes.ts`，**別忘了權限原語與 rate limit** |
| WS 訊息 | `packages/shared-types/src/ws.ts`（前後端共用）→ `modules/realtime/ws.ts` |
| 同步層接線 | `apps/web/src/lib/README-sync.md` |
| 設計 token / 顏色 | `apps/web/src/styles/tokens.css` + `packages/ui/src/styles/ui.css` |
| 權限規則 | `apps/server/src/modules/permissions/`（`resolve.ts` 是純函式，好測） |
| 部署 / 備份 / 監控 | `docs/ops.md` |

各模組都有自己的 README：

- [`apps/web/src/features/editor/README.md`](apps/web/src/features/editor/README.md) —— 編輯器宿主層
- [`apps/web/src/features/database/README.md`](apps/web/src/features/database/README.md) —— 資料庫前端
- [`apps/web/src/features/shell/README.md`](apps/web/src/features/shell/README.md) —— App shell
- [`apps/web/src/lib/README-sync.md`](apps/web/src/lib/README-sync.md) —— 同步層接線
- [`packages/editor-core/README.md`](packages/editor-core/README.md) —— 編輯器引擎
- [`packages/ui/README.md`](packages/ui/README.md) —— UI primitives

---

## 10. 文件索引

### 決策（[`docs/adr/README.md`](docs/adr/README.md)）

| # | 主題 |
|---|---|
| [0001](docs/adr/0001-self-built-core.md) | 承載產品語義的核心一律自研（+ CI 紀律檢查） |
| [0002](docs/adr/0002-richtext-model.md) | Rich Text 扁平 InlineSpan 模型 |
| [0003](docs/adr/0003-database-registry.md) | Field Type / View Registry |
| [0004](docs/adr/0004-realtime-lww.md) | 即時協作層：協定、Room、LWW、權限 |
| [0005](docs/adr/0005-search-and-portability.md) | 全文搜尋、匯出匯入、維運 |
| [0006](docs/adr/0006-ot.md) | 自建簡化版 OT（含開啟步驟） |

### QA（[`docs/qa/README.md`](docs/qa/README.md)）

9 輪功能 QA（BUG-1～46）+ `database-gaps.md` + `regression-triage-1.md`，
**第十輪進行中**（`e2e/functional-round10.spec.ts` 已在，報告還沒寫完）。
**仍然開著的限制整理在該索引的 §2**——各 feature README 的「已知限制」都指向那裡。

> 🚧 動手修 §2 裡的項目前先 `git status`：工作目錄有第十輪尚未 commit 的修正
> （`modules/files/`、`databases/service.ts`、`SharePopover.tsx`、
> `ui/src/dnd/controller.ts`、`scripts/backfill-file-pages.ts`），不要撞車。

### 視覺比對（[`reference/shots/compare/`](reference/shots/compare/)）

`README.md` 是 `e2e/compare.spec.ts` 產生的 kennote ↔ Notion 並排報告
（每個畫面代號給「平均通道差 / 明顯差異像素佔比 / 最佳對齊位移」），
`NOTES-round2~8.md` 是手寫的逐輪根因筆記。**與功能 QA 不共用 bug 編號。**

---

## 11. 下一步

| 項目 | 說明 |
|---|---|
| 把 `FEATURE_OPEN_LOGIN` 傳進 prod compose | 目前正式站的開放登入關不掉（§6） |
| 接上 `pruneBlockDeltas()` 的排程 | ADR 0006：delta log 現在會一直長 |
| 回填 `files.page_id` | migration `0070` 之前的附件仍是「工作區成員限定」（QA O-4） |
| 統一改用 `@kennote/ui` 的 dnd | 看板 / 日曆 / PropertyList 還是 HTML5 DnD，觸控全死（QA O-11） |
| 版本預覽接上 snapshot | `AppShell` 丟掉 `onPreview` 的參數，預覽看到的還是現在的內容（QA O-8） |
| 多實例部署 | GC 排程與 presence 合併都要先處理（ADR 0004 / 0005） |
