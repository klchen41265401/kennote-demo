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
bash scripts/deploy.sh          # 本機推 + 遠端重建（見 scripts/remote-up.sh）
```

或在遠端：

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
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
    "migrations": { "applied": 21, "onDisk": 21, "pending": 0, "latest": "0021_page_visits.sql" }
  }
}
```

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
