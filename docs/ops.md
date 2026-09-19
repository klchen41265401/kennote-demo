# kennote 維運手冊

部署、備份、還原演練、監控、埠位、常見問題。
決策背景在 [`docs/adr/0005-search-and-portability.md`](adr/0005-search-and-portability.md)。

> 讀這份文件的人可能是**半年後的你**，而且多半是因為東西壞了。
> 所以每一節都盡量寫成「可以直接複製貼上的指令」。

---

## 1. 埠位與服務

| 服務 | 容器名 | 開發 | 正式 | 對外 |
|---|---|---|---|---|
| web（nginx） | `kennote-web` | 5173（vite） | 8090 → 容器 80 | ✅ 只有這個 |
| server（Fastify） | `kennote-server` | 4000 | 4000（僅 compose 網路內） | ❌ |
| postgres 16 | `kennote-postgres` | 5432 | 5432（僅 compose 網路內） | ❌ |

前端一律走**同源** `/api` 與 `/ws`：開發時 Vite proxy 轉到 4000，
正式時 `apps/web/nginx.conf` 反向代理到 `server:4000`（WS 帶 Upgrade 標頭）。

### 不要對外開的路徑

`/api/metrics` 沒有登入保護（它只吐聚合數字，沒有使用者內容），
但也**不該**讓外面看到。在 `apps/web/nginx.conf` 裡擋掉：

```nginx
location = /api/metrics {
  allow 127.0.0.1;
  allow 10.0.0.0/8;      # 監控主機所在網段
  deny all;
  proxy_pass http://server:4000;
}
```

`/api/admin/gc` 有登入保護且要求工作區 owner，可以對外。

---

## 2. 部署

### 首次部署（遠端 Linux）

```bash
git clone <repo> kennote && cd kennote
cp .env.example .env
# 必改：JWT_SECRET（openssl rand -base64 48）、POSTGRES_PASSWORD
#      走 HTTPS 的話把 COOKIE_SECURE 設為 true
docker compose -f docker-compose.prod.yml up -d --build
```

server 啟動前會自動跑 migration（冪等）。開 <http://主機:8090>。

### 更新

```bash
bash scripts/deploy.sh              # 本機推 + 遠端重建
bash scripts/deploy.sh --no-build   # 只重啟（沒改程式碼時）
```

或在遠端：

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

### 兩支部署腳本到底做了什麼

**`scripts/deploy.sh`（在你的機器上跑）** —— 只有三行：

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push deploy "$BRANCH":main                        # 推到遠端工作樹
ssh ken150ken150@100.74.148.92 "bash /home/ken150ken150/kennote/scripts/remote-up.sh ..."
```

> ⭐ **它推的是 commit，不是你的工作目錄。**
> 沒 `git add` / `git commit` 的檔案**不會**上去 —— 這是遠端 build 失敗的頭號原因（見 §9）。

**`scripts/remote-up.sh`（在遠端跑）**：

1. `.env` 不存在 → 從 `.env.example` 產生，並填入隨機 `JWT_SECRET`、
   隨機 `POSTGRES_PASSWORD`、`NODE_ENV=production`、
   `PUBLIC_BASE_URL=http://100.74.148.92:8090`、`CORS_ORIGINS=`（同源不需要）、`LOG_LEVEL=info`。
   **`.env` 已存在時一個字都不動**，所以改設定要自己上去改。
2. `docker compose -f docker-compose.prod.yml build --pull`（除非帶 `--no-build`）
3. `up -d --remove-orphans`
4. 輪詢 `http://127.0.0.1:8090/api/health`，**最多 60 次 × 2 秒 = 120 秒**。
   逾時會印 `compose ps` 與 server 的最後 50 行 log 然後以非 0 結束。

> ⚠️ `docker-compose.prod.yml` 的 `server.environment` **只列了部分開關**
> （`FEATURE_REALTIME` / `FEATURE_OT`）。
> **`FEATURE_OPEN_LOGIN` 與 `FEATURE_PUBLIC_SHARE` 沒有被傳進容器**，
> 所以它們吃的是 `apps/server/src/env.ts` 的預設值（開放登入 **ON**、公開分享 OFF）。
> 光改 `.env` 沒有用，要先在 compose 檔裡補上那一行。

### Migration 清單（0001–0070）

15 支，自製 runner（`apps/server/src/db/migrate.ts`），**冪等**，
server 啟動前自動跑。已套用的記在 `schema_migrations`。

| 檔名 | 里程碑 | 一句話 |
|---|---|---|
| `0001_init.sql` | M1 | 身分層：`users` / `user_identities`（OIDC 插槽）/ `sessions` / `workspaces` / `workspace_members`。也定義 `uuid_generate_v7()` |
| `0002_pages_blocks.sql` | M1 | 頁面樹 `pages`（`sort_key COLLATE "C"`）、內容 `blocks`，以及整個系統最關鍵的資產 `page_transactions`（append-only operation log） |
| `0003_collections.sql` | M4 骨架 | Database 定義層：`collections`（欄位 schema）+ `collection_views`（filter/sort/group + 外觀）。**視圖型別是 enum**，所以新增一種視圖一定要動 schema |
| `0004_files_favorites.sql` | M2/M3 | `files`（附件）、`favorites`（我的最愛）、`page_permissions` 最小版（權限引擎的擴充點） |
| `0005_search.sql` | M1 | 搜尋第一階段：`pg_trgm` extension + ILIKE 用的索引。不引入 Meilisearch / Elasticsearch |
| `0006_database_m4.sql` | M4 | 補上「查詢得動、關聯得起來」需要的東西（relation 對照、屬性索引、列的排序鍵） |
| `0010_comments_notifications.sql` | M5 | 留言系統（`discussions` / `comments`）與通知中心（`notifications`）的資料層 |
| `0011_share_invites.sql` | M5 | 公開分享連結（token / 密碼 / 到期）與工作區邀請 |
| `0020_search_tsvector.sql` | M6 | 搜尋第二階段：`kn_segment()` 中文 bigram 斷詞 + `blocks.search_tsv` / `pages.search_tsv` **generated column** + GIN 索引。⚠️ **整表重寫，請在離峰部署** |
| `0021_page_visits.sql` | M6 | `page_visits`：側邊欄「最近」與搜尋建議 |
| `0030_block_deltas.sql` | M6 | OT：`blocks.rev` + `block_deltas` 表。**`FEATURE_OT` 要打開之前必須先跑這一支** |
| `0040_block_types.sql` | M2-C | 放寬 `chk_blocks_type`，補上 `/` 斜線選單完整還原需要的新 block 型別（如 `heading4`、`audio`、`pdf`、`breadcrumb`、`button`、`syncedBlock`） |
| `0050_user_preferences.sql` | M3 | 帳號設定的偏好（語言 / 主題 / 起始頁面）跟著帳號走，換裝置登入也是同一組 |
| `0060_timeline_view.sql` | M4 | `collection_view_type` enum 加上 `'timeline'`（時程表 / 甘特圖） |
| `0070_files_page.sql` | 第九輪 | `files.page_id`：附件改依**所在頁面**的權限判斷，堵住「同工作區 guest 拿得到私密頁附件」。**刻意沒有回填舊資料**（見 §9「舊附件還是成員限定」） |

檢查目前狀態：

```bash
curl -s http://localhost:8090/api/health | jq '.data.migrations'
docker exec -it kennote-postgres psql -U kennote -d kennote \
  -c 'SELECT name, applied_at FROM schema_migrations ORDER BY name'
```

### 部署後一定要看的兩件事

```bash
curl -s http://localhost:8090/api/health | jq
```

```jsonc
{
  "data": {
    "status": "ok",          // ← 不是 ok 就別走開
    "db": true,
    "version": "0.1.0",
    "uptime": 42,
    "migrations": { "applied": 15, "onDisk": 15, "pending": 0, "latest": "0070_files_page.sql" },
    "features": { "realtime": true, "ot": false, "publicShare": false }
  }
}
```

`features` 是**前端據以決定要不要走 OT delta 通道**的依據
（`docs/adr/0006-ot.md`）。前後端必須一致：伺服器關著而前端強制打開，
`text.delta` 會被回 `NOT_IMPLEMENTED`，使用者會看到頁面不斷重載。

**`migrations.pending > 0` → `status` 會是 `degraded`。**
這是最常見的「服務起來了但功能是壞的」情境（部署了新程式碼但 migration 沒跑），
所以健康檢查直接把它當成不健康。手動補跑：

```bash
docker exec -it kennote-server node dist/db/migrate.js
```

> ⚠️ M6 的 `0020_search_tsvector.sql` 會對 `blocks` 與 `pages` 加 STORED generated column，
> 這是**整表重寫**。10 萬個 block 大約 10–30 秒，期間該表會被鎖住。
> 請在離峰時間部署。

---

## 3. 備份

```bash
bash scripts/backup.sh
# → backups/kennote-20260919-0315.tar.gz
#   內含 MANIFEST / database.dump（pg_dump custom）/ uploads.tar
```

| 環境變數 | 預設 | 說明 |
|---|---|---|
| `BACKUP_DIR` | `<repo>/backups` | 建議指到 NAS 或另一顆磁碟 |
| `KEEP` | `14` | 保留幾份 |
| `PG_CONTAINER` | `kennote-postgres` | |
| `SERVER_CONTAINER` | `kennote-server` | 拿它的 volume 備份 uploads |

### 排程（每天 03:15）

```cron
15 3 * * * cd /home/ken/kennote && BACKUP_DIR=/mnt/nas/kennote bash scripts/backup.sh >> /var/log/kennote-backup.log 2>&1
```

### 異地

03 §11.3：**至少一份落在不同站點**。最簡單的做法是在備份後 rsync：

```bash
rsync -az --delete /mnt/nas/kennote/ backup-host:/srv/kennote-backups/
```

---

## 4. 還原

```bash
bash scripts/restore.sh backups/kennote-20260919-0315.tar.gz
```

腳本會：印出 MANIFEST → **要你輸入大寫 `RESTORE` 確認** → 停 server/web →
DROP 並重建資料庫 → `pg_restore` → 還原 uploads volume → `docker compose up -d` →
等 `/api/health` 變 ok → 抽查各表筆數。

排程演練可以用 `FORCE=1` 跳過確認。

---

## 5. 還原演練（每月一次，30 分鐘）

> 03 §11.3：**沒演練過的備份等於沒有備份。**
> 04 §8 M6 的驗收標準也是「從乾淨環境完整還原成功 —— 實際演練一次」。

在**另一台機器**（或同一台的另一個 compose project）做，不要動正式環境：

```bash
# 1. 乾淨環境
git clone <repo> kennote-drill && cd kennote-drill
cp /path/to/prod/.env .env            # 同一組 POSTGRES_PASSWORD / JWT_SECRET
sed -i 's/WEB_PORT=.*/WEB_PORT=8091/' .env   # 換個埠，避免撞到正式

# 2. 只起資料庫
docker compose -f docker-compose.prod.yml up -d postgres

# 3. 還原
scp prod:/mnt/nas/kennote/kennote-20260919-0315.tar.gz .
FORCE=1 bash scripts/restore.sh kennote-20260919-0315.tar.gz

# 4. 人工驗收（腳本驗不到的部分）
#    □ 用正式環境的帳號登入得進去
#    □ 側邊欄的頁面樹跟正式一樣
#    □ 隨便開一頁，圖片顯示得出來（= uploads 還原成功）
#    □ Ctrl+K 搜尋一個中文詞，搜得到（= tsvector 索引跟著 dump 回來了）
#    □ 打開一個 database，欄位型別與資料都在

# 5. 收工
docker compose -f docker-compose.prod.yml down -v
```

演練結果請記在這份文件底下的「演練紀錄」，包含**實際花的時間**
（那就是你的 RTO）。

### 演練紀錄

| 日期 | 備份檔 | 耗時 | 結果 | 備註 |
|---|---|---|---|---|
| _（待第一次演練填寫）_ | | | | |

---

## 6. 垃圾桶 GC

- **自動**：server 內每日跑一次（啟動後 5 分鐘首跑）。
  永久刪除 `deleted_at` 超過 30 天的頁面與其 blocks、回收沒人引用且超過 24 小時的檔案、
  清掉 180 天前的瀏覽紀錄。
- **手動**：

```bash
# 先空跑看看會刪多少（不會真的刪）
curl -X POST http://localhost:8090/api/admin/gc \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"workspaceId":"<你的工作區 id>","dryRun":true}'

# 真的跑
curl -X POST http://localhost:8090/api/admin/gc \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"workspaceId":"<id>","retentionDays":30}'
```

需要該工作區的 **owner** 身分。

> ⚠️ **要跑多個 server 實例時，一定要關掉內建排程**（否則每個實例都跑一次），
> 改用外部 cron 打上面那支 API。目前的關法是拿掉 `app.ts` 裡的
> `startGcScheduler()`；之後要做多實例時應該改成看環境變數。

---

## 7. 監控

### `GET /api/metrics`（Prometheus 文字格式）

| 指標 | 型別 | 用途 |
|---|---|---|
| `kennote_http_requests_total{method,route,status}` | counter | 流量與錯誤率 |
| `kennote_http_errors_total{…}` | counter | 4xx / 5xx |
| `kennote_http_request_duration_seconds{method,route}` | histogram | p95 延遲 |
| `kennote_transactions_total{status}` | counter | block transaction 提交數 / 衝突率 |
| `kennote_ws_connections` / `_rooms` / `_users` | gauge | 即時協作在線狀況 |
| `kennote_db_pool_total` / `_idle` / `_waiting` | gauge | 連線池是否吃緊 |
| `kennote_uptime_seconds` / `kennote_memory_rss_bytes` | gauge | 重啟偵測 / 記憶體洩漏 |

### 建議告警（門檻取自 03 §11.5）

```promql
# submitTransaction 的 409 衝突率 > 2%
sum(rate(kennote_transactions_total{status="409"}[5m]))
  / sum(rate(kennote_transactions_total[5m])) > 0.02

# 頁面載入 p95 > 300ms
histogram_quantile(0.95,
  sum by (le) (rate(kennote_http_request_duration_seconds_bucket{route="/api/pages/:id/snapshot"}[5m]))
) > 0.3

# 搜尋 p95 > 500ms（M6 驗收門檻）
histogram_quantile(0.95,
  sum by (le) (rate(kennote_http_request_duration_seconds_bucket{route="/api/search/"}[5m]))
) > 0.5

# 連線池排隊
kennote_db_pool_waiting > 0

# 5xx 比率 > 1%
sum(rate(kennote_http_errors_total{status=~"5.."}[5m]))
  / sum(rate(kennote_http_requests_total[5m])) > 0.01
```

### 資料庫層要自己看的（03 §11.5）

```sql
-- blocks 的 dead tuple 比例 > 20% → 調 autovacuum
SELECT relname,
       n_dead_tup,
       n_live_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct
  FROM pg_stat_user_tables
 WHERE relname IN ('blocks', 'pages', 'page_transactions')
 ORDER BY dead_pct DESC NULLS LAST;

-- GIN pending list 持續成長 → 調 gin_pending_list_limit 或加 vacuum 頻率
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS size
  FROM pg_stat_user_indexes
 WHERE indexrelname LIKE '%search_tsv%' OR indexrelname LIKE '%trgm%'
 ORDER BY pg_relation_size(indexrelid) DESC;
```

### 日誌

pino 結構化 JSON（正式環境），每個請求一行：

```json
{"level":30,"reqId":"req-3","method":"POST","route":"/api/pages/:id/transactions","statusCode":200,"durationMs":12,"msg":"request completed"}
```

```bash
docker logs -f kennote-server | jq 'select(.durationMs > 300)'   # 找慢請求
docker logs kennote-server | jq 'select(.level >= 50)'           # 只看 error 以上
```

已遮蔽欄位：`authorization`、`cookie`、`set-cookie`、`*.password`、
`*.passwordHash`、`*.refreshToken`（`lib/logger.ts`）。

---

## 8. 搜尋維運

```bash
# 壓測（需要 DATABASE_URL，會寫入資料）
export DATABASE_URL=postgres://kennote:kennote@localhost:5432/kennote_bench
pnpm --filter @kennote/server migrate
pnpm --filter @kennote/server exec tsx scripts/bench-search.ts --blocks 10000
# 驗收門檻：最差 p95 < 500ms
```

索引是 **generated column**，不需要、也沒有「重建索引佇列」——
`blocks.search_tsv` 與 `pages.search_tsv` 永遠跟內容同步。

真的要重建（例如改了 `kn_segment()` 的斷詞規則）：

```sql
-- 改規則 = 新增一支 migration 重新定義 kn_segment()，然後強制重算
ALTER TABLE blocks ALTER COLUMN search_tsv DROP EXPRESSION;   -- PG17+
-- PG16 沒有 DROP EXPRESSION，作法是 DROP COLUMN 再 ADD COLUMN（會整表重寫）
REINDEX INDEX CONCURRENTLY idx_blocks_search_tsv;
ANALYZE blocks;
```

**改斷詞規則時，`apps/server/src/modules/search/segment.ts` 與
`migrations/00xx` 的 `kn_segment()` 必須一起改**，
`test/search-segment.test.ts` 的黃金案例會擋住只改一邊的情況。

---

## 9. 常見問題

### 遠端 web build 失敗（`tsc` 在 `apps/web` 報一堆型別錯）

**九成是 `packages/shared-types` 的改動沒有 commit。**

`scripts/deploy.sh` 推的是 **commit**，不是你的工作目錄；
`apps/web/Dockerfile` 的 build 階段跑的是 `tsc --noEmit && vite build`，
所以「本機綠、遠端紅」的典型情境就是：你在 `shared-types` 加了一個欄位／型別，
`apps/web` 用了它，但只 commit 了 `apps/web`。

```bash
git status --short          # ⭐ 部署前先看這個
git status --short -- packages/   # 特別注意 packages/shared-types
```

同一個模子的其他變形：`packages/ui`、`packages/editor-core` 漏 commit；
只改了 `.env.example` 卻以為遠端 `.env` 會跟著變（不會，見 §2）。

### 「容器重啟一下就好」——不，那其實是重新部署

遠端的 image 是 **build 進去的**（`apps/web/Dockerfile` 把 `dist/` COPY 進 nginx、
`apps/server/Dockerfile` 把 esbuild bundle COPY 進去），**沒有掛原始碼 volume**
（那是 `docker-compose.yml` 開發環境才有的）。

所以：

| 你想做的事 | 正確指令 |
|---|---|
| 只是想讓服務重來一次（記憶體 / 連線池） | `docker compose -f docker-compose.prod.yml restart server` |
| **讓新的程式碼生效** | `bash scripts/deploy.sh`（會 build） |
| 只改了 `.env` | 在遠端改完 `.env` 後 `... up -d`（restart 不會重讀 env） |

`docker restart kennote-server` **不會**讓新 commit 生效，只會用同一個舊 image 再跑一次。
遇到「我明明修好了，站上還是舊的」先確認是不是這一條。

### Vite 埠不是 5173

5173 被佔用時 Vite 會**自動往上找**（5174、5175、5199、5304…），
而 e2e 的 `BASE_URL` 是手動帶的。

```bash
pnpm --filter @kennote/web dev
#   ➜  Local:   http://localhost:5174/     ← 以這一行為準
```

QA 報告裡看到 `BASE_URL=http://127.0.0.1:5199` / `:5304` 這種奇怪的埠，
就是當時 vite 跳號的結果，不是打錯。
另外：**本機 vite 代理時 WebSocket 常常不跟著 proxy**（頂欄顯示「尚未連線」），
即時協作請直接在正式站測。

### 舊附件還是「工作區成員限定」

`0070_files_page.sql` 只修「從今以後」：它加了 `files.page_id`，
但**刻意沒有回填**（反查 `block.props` 在大工作區太慢，不該塞進會鎖表的 migration）。
0070 之前上傳的附件 `page_id IS NULL`，退回舊行為，
同工作區的 guest 仍然拿得到舊的私密附件。

回填腳本（**先跑 dry-run**）：

```bash
export DATABASE_URL=postgres://kennote:<pw>@127.0.0.1:5432/kennote
pnpm --filter @kennote/server exec tsx scripts/backfill-file-pages.ts --dry-run
pnpm --filter @kennote/server exec tsx scripts/backfill-file-pages.ts --workspace <uuid>
```

它的紅線：**只補 `NULL` 永不覆蓋**、**一個附件被多頁引用時整個跳過**（不挑一頁 ——
挑錯方向可能是放寬）、**跨工作區跳過**。跳過的會印成 `skippedMultiPage` / `skippedCrossWorkspace`，
人再逐一看。

### 健康檢查是 degraded

看 `migrations.pending`：> 0 就是 migration 沒跑（見 §2）。
`db: false` 則是連不到 postgres：

```bash
docker logs kennote-postgres --tail 50
docker exec -it kennote-postgres pg_isready -U kennote
```

### 搜尋搜不到中文

1. 確認 0020 有跑：`SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 3;`
2. 確認斷詞函式在：`SELECT kn_segment('資料庫設計');` → 應該回 `資料 料庫 庫設 設計`
3. 確認索引有值：`SELECT search_tsv FROM blocks WHERE plain_text LIKE '%資料庫%' LIMIT 1;`
4. **單一中文字**（例如只打「我」）本來就不走 tsvector，會走 pg_trgm fallback；
   這是設計，不是 bug（ADR 0005 §2.1）。

### 匯入 Notion zip 只進來一部分

看回應的 `warnings[]`，常見原因：

- 頁面數超過 500 / 附件超過 500 個 / 單一 CSV 超過 2000 列（上限，寫在 `import/service.ts`）
- database 資料夾底下的「每列一個 .md」不會各自建頁（內容以 CSV 為準）
- 圖片格式不在 magic number 白名單（`files/storage/types.ts`）

### 匯出很慢 / 記憶體飆高

匯出會掃整棵子樹 + 讀所有附件。目前上限：500 頁、附件總量 200MB。
真的要匯出整個工作區，請分次（一次匯出一棵子樹）。

### PDF 匯出回 501

**這是預期行為。** server 容器沒有瀏覽器（ADR 0005 §3.1）。
請在匯出對話框選「PDF（用列印）」，它會開瀏覽器的列印視窗，
在「目的地」選「另存為 PDF」。

### 磁碟滿了

```bash
du -sh backups/                                   # 備份（調 KEEP）
docker system df                                  # 映像與 volume
docker exec -it kennote-postgres psql -U kennote -d kennote -c "
  SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
    FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;"
```

`page_transactions` 是 append-only 的 operation log，會一直長。
它同時支撐斷線補傳、版本歷史與協作 undo，**不要隨便刪**；
真的要縮，請按頁面保留最近 N 筆（目前還沒有這個工具，需要時再寫）。

### 想把某個使用者誤刪的頁面救回來

先別還原整個資料庫（03 §11.3：「不要為了救一頁去還原整個資料庫」）：

1. 垃圾桶（`GET /api/trash?workspaceId=`）→ 30 天內都還在。
2. 超過 30 天被 GC 掉了 → 用版本歷史（`GET /api/pages/:id/history`）。
3. 兩者都沒有 → 才從備份還原到**另一個環境**，把那一頁匯出成 Markdown 再匯入回正式。

---

## 10. 資料庫整合測試（SSH 隧道）

`apps/server` 有 **24 條需要真 PostgreSQL 的測試**
（`test/auth-account.test.ts` 15 條、`test/integration/ot-delta.test.ts` 5 條、
`test/integration/page-transactions.test.ts` 4 條）。
沒設 `DATABASE_URL_TEST` 時它們**自動 skip 而不是失敗**，所以 CI 永遠是綠的 ——
真的要驗那一層，必須自己接一顆資料庫。

### 10.1 本機（最簡單）

```bash
pnpm db:up
docker exec -it kennote-postgres psql -U kennote -c 'CREATE DATABASE kennote_test'

export DATABASE_URL=postgres://kennote:kennote@localhost:5432/kennote_test
pnpm --filter @kennote/server migrate           # migrate 看的是 DATABASE_URL

DATABASE_URL_TEST=$DATABASE_URL pnpm --filter @kennote/server test
```

> `migrate` 讀 `DATABASE_URL`，測試讀 `DATABASE_URL_TEST`。
> **兩個都要指到同一顆測試庫**，不然測試會對著沒有 schema 的空庫跑。

### 10.2 打遠端那一顆 postgres

正式環境的 postgres **不對外開埠**（只在 compose 網路內），
所以要用 SSH 把它的容器位址映射到本機。

```bash
# 1) 問出容器在 docker bridge 網路上的 IP（在遠端跑）
ssh ken150ken150@100.74.148.92 \
  "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' kennote-postgres"
# → 例如 172.19.0.2

# 2) 開隧道（前景執行，-N = 不開 shell；要背景加 -f）
ssh -N -L 15432:172.19.0.2:5432 ken150ken150@100.74.148.92

# 3) 另開一個終端機：拿遠端的密碼
ssh ken150ken150@100.74.148.92 "grep '^POSTGRES_PASSWORD=' /home/ken150ken150/kennote/.env"
```

`-L 15432:172.19.0.2:5432` 的意思是「本機 15432 → **由遠端主機**連到 172.19.0.2:5432」，
目標位址是在遠端解析的，所以容器 IP 可以直接用。

```bash
# 4) 建一個獨立的測試庫（⚠️ 絕對不要指向 kennote 正式庫）
export PGPASSWORD='<剛剛拿到的密碼>'
psql -h 127.0.0.1 -p 15432 -U kennote -d postgres -c 'CREATE DATABASE kennote_test'

# 5) 跑 migration + 測試
export DATABASE_URL="postgres://kennote:$PGPASSWORD@127.0.0.1:15432/kennote_test"
pnpm --filter @kennote/server migrate
DATABASE_URL_TEST="$DATABASE_URL" pnpm --filter @kennote/server test

# 6) 收工
psql -h 127.0.0.1 -p 15432 -U kennote -d postgres -c 'DROP DATABASE kennote_test'
# 然後 Ctrl+C 關掉隧道（或 kill 掉 -f 的那個 ssh）
```

### 10.3 紅線

1. **`DATABASE_URL_TEST` 絕對不能指向 `kennote` 這個正式資料庫。**
   整合測試會建 / 刪使用者、工作區、頁面與 block。名字一律用 `kennote_test`，
   而且是自己新建的那一顆。
2. **容器 IP 會變。** 每次 `docker compose up -d --build` 之後都要重問一次（步驟 1）。
   要穩定一點可以改用 `docker exec` 在遠端直接跑 psql，或暫時在 compose 加一個
   只綁 `127.0.0.1` 的 port mapping —— **但用完務必拿掉**。
3. **測試庫也要跑 migration。** 少一支 migration 的症狀是一堆
   「relation does not exist」，不是測試本身壞了。
4. 壓測腳本 `apps/server/scripts/bench-search.ts` 同樣吃 `DATABASE_URL`、
   **會真的寫入資料**，請一樣指到獨立的 `kennote_bench`（見 §8）。
