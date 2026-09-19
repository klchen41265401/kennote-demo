# ADR 索引

> ADR = Architecture Decision Record。**記錄「為什麼」，不是「怎麼做」。**
> 想知道某個看起來很怪的設計為什麼長這樣，先來這裡。
>
> 依賴鏈：`0001` → `0002` → `0003` / `0004` → `0005` / `0006`。
> 全部狀態都是「已採納」，日期 2026-09-19（`0006` §2.9 另含 09-20 的 QA 修正）。

| # | 標題 | 里程碑 | 一句話 |
|---|---|---|---|
| [0001](0001-self-built-core.md) | 承載產品語義的核心一律自研 | 全程 | 編輯器 / rich text / 同步 / 搜尋 / database 引擎 / 公式 / 權限 / 拖放 / 浮層 / UI primitives 全部自己寫，語言與協定用現成的 |
| [0002](0002-richtext-model.md) | Rich Text 採扁平 InlineSpan 模型 | M2 | `InlineSpan { text, marks? }` 而非 Notion 式 `annotations`；`props` 合一、`pages` 獨立成表、欄位名 camelCase、樣式用原生 CSS 變數 |
| [0003](0003-database-registry.md) | Field Type Registry 與 View Registry | M4 | 用「前後端兩份 registry + shared-types 一組 key」取代 `switch (type)` |
| [0004](0004-realtime-lww.md) | 自研即時協作層：協定、Room、LWW 與權限 | M5 | 自寫 WS 協定與房間管理，衝突走 block 粒度 LWW，權限守門員掛在 `applyTransaction()` |
| [0005](0005-search-and-portability.md) | 全文搜尋、資料可攜性與維運 | M6 | 中文 bigram 斷詞 + tsvector（零新增依賴）、自寫 ZIP / mini-HTML 解析器、PDF 走瀏覽器列印 |
| [0006](0006-ot.md) | 自建簡化版 OT | M6 | 約 150 行的 retain/insert/delete OT，只滿足 TP1；**預設關閉（`FEATURE_OT=false`）** |

---

## 0001 —— 承載產品語義的核心一律自研

**判準**：「三年後我想改它的行為，改得動嗎？」改得動才可以用現成的。

**主要結論**：換來零黑箱與完全可客製，代價是工時約 +49%（MVP 由 5–6 個月變成 9–13 個月），
風險高度集中在 contenteditable / IME 的編輯器核心。

**紀律寫成程式碼**：`scripts/check-deps.ts`（`pnpm deps:check`）在 CI 擋三件事——

1. 黑名單套件命中數恆為 **0**
2. `packages/editor-core` 的 `dependencies` 恆為 **`{}`**
3. `apps/web` 的 runtime 依賴 **≤ 8**（目前 6：react / react-dom / react-router-dom + 三個 workspace 套件）

要引入黑名單套件的正式流程是「**先寫一篇 ADR，再把它從黑名單移除**」——摩擦力是刻意的。
退場方案：編輯器真的撐不住時，允許在 editor-core 內部局部引入 ProseMirror 當 view 層，
但保留自己的 model 與 operation 設計。

---

## 0002 —— Rich Text 採扁平 InlineSpan 模型

**主要結論**：`normalize()` 的唯一表示（canonical form）得以成立，而
**OT transform 的正確性就依賴這個不變量**。Operation 形狀與規格 04 §5.4 一字不差，
M6 接 OT 時協定不必改。

**代價**：與規格 03 的多個 JSON 範例不一致（讀 03 要對照本 ADR）；
日後匯入 Notion 官方匯出檔需要一支 `annotations → marks` 轉換器。

**附帶記錄的實作坑（很容易再踩）**：

- `uuid_generate_v7()` 用 `set_byte` 而非 `set_bit`（後者會產生錯誤的 version nibble）
- `pages.sort_key` 必須加 `COLLATE "C"`（fractional index 依賴位元組字典序）
- 連 app shell 都不裝 Tailwind，全部 CSS Modules + 原生 CSS 變數

---

## 0003 —— Database 的兩份 Registry

**主要結論**：新增一種欄位型別／視圖型別的成本降到「**一個資料夾 + 一行 import**」。
實證：新增 `rating` 時 Table / Board / List / Gallery / Calendar / 篩選 / 排序 / 聚合 / CSV 匯出
**一行都沒改**。代價是兩份 registry 要靠 `FIELD_TYPES` 完整性測試同步把關。

**維運重點**：

- formula / rollup 的 filter / sort 走記憶體路徑，`MEMORY_SCAN_LIMIT = 2000`，超過會截斷（UI 提示尚未做）
- `MAX_MIGRATION_ROWS = 10000`，超大 collection 的型別轉換要改走匯出／匯入
- 改欄位型別前 UI **必須**先打 `POST /api/databases/:id/schema/preview-cast`（絕不靜默轉換丟資料）
- 相對日期在產生 SQL 時才展開；日期用 ISO 文字比較；keyset 分頁展開成 OR 鏈

---

## 0004 —— 自研即時協作層（M5）

**主要結論**：HTTP、WS、版本還原三條路徑共用同一支 `applyTransaction()`，
**沒有第二條寫入路徑**；單機部署不需要 Redis。

**但仍是 block 粒度 LWW**——兩人同時改同一段文字，後送的會覆蓋前者。
這正是 ADR 0006 要解決的問題。

**維運重點**：

- `REDIS_URL` 有值就自動切 Redis pub-sub（自寫 RESP client），水平擴充只改一個環境變數
- 公開分享連結由 `FEATURE_PUBLIC_SHARE` 控制、**預設 false**，權限硬性封頂在 `read`
- 房間最後一人離開後延遲 30 秒銷毀；`PRESENCE_TTL_MS = 45s`；presence **永不進 PostgreSQL**
- 已知限制：`duplicatePage()` 直接 INSERT、沒過 operation log，複本在被編輯前沒有可重建的歷史

---

## 0005 —— 搜尋、可攜性與維運（M6）

**主要結論**：索引是 `kn_segment()` 的 **generated column**，由資料庫自己算，
應用層不可能漏算，**搜尋索引永遠不髒**。匯入的所有 block 一律走 `applyTransaction()`
（否則 OT 與版本歷史會漏掉整批內容）。

**代價**：索引約為原文 2 倍；單一中文字查詢靠 pg_trgm fallback；
callout / toggle 的 Markdown 往返失真是已知且接受的（要無損請用 `format=json`）。

**維運重點**（詳見 [`docs/ops.md`](../ops.md)）：

- `format=pdf` 一律回 **501**，前端 PDF 選項直接 `window.print()`
- GC 用 server 內的 `setInterval`，**多實例部署時必改**（關掉排程改外部 cron 打 `POST /api/admin/gc`）
- 備份 `pg_dump --format=custom` + uploads tar，保留 14 份
- `GET /api/metrics` 刻意不要求登入（靠 nginx 不對外開）；`/api/health` 的 `migrations.pending > 0` 即 `degraded`
- **server 引用 editor-core 一律用深路徑 import**（barrel import 會把 DOM 相關的 view/input/selection 拉進 server 的 tsc program）
- §7「重新評估的時機」列出每個決策該回頭檢視的觸發條件（例：dump 超過 10 分鐘 → 上 WAL 歸檔）

---

## 0006 —— 自建簡化版 OT（M6）⭐ 預設關閉

**主要結論**：三種原子操作（retain / insert / delete）、atom 以 U+FFFC 佔位、
只需滿足 TP1 不需 TP2，核心演算法約 150 行。delta **不另開協定**，
當成既有 tx 通道上的 `text.delta` operation；transform 前後端共用同一份 `@kennote/editor-core`。

打開之後：兩人同時編輯同一段文字兩人的字都保留、A undo 不再吃掉 B 的字、
游標用 `transformCursor` 精確推算。真值仍是 `blocks.content`，
搜尋／filter／匯出／版本歷史全部照舊。

### 開啟 `FEATURE_OT` 的步驟

```bash
# 1. 跑 migration（新增 blocks.rev 與 block_deltas）
pnpm --filter @kennote/server migrate

# 2. 後端 .env 設 FEATURE_OT=true，重啟；確認：
curl -s http://主機:8090/api/health | jq '.data.features.ot'   # → true

# 3. 前端不用做任何事（會自己問 /api/health）
#    開發／e2e 想強制打開：VITE_FEATURE_OT=1

# 4. 驗證：兩個分頁開同一頁、游標放同一段文字同時打字，
#    兩人的字都應保留；A 按 Cmd+Z 不應吃掉 B 的字
```

**關掉**：`FEATURE_OT=false` 重啟即可，`text.delta` 回 `NOT_IMPLEMENTED`，
前端自動退回 M5 的 LWW；`block_deltas` 資料留著不影響任何東西。

> ⚠️ **前後端必須一致。** 伺服器關著而前端用 `VITE_FEATURE_OT=1` 強制打開，
> `text.delta` 會被拒絕、前端一直重載（不會壞資料，但沒人能用）。

### 開啟後要知道的

- **建議請使用者重新整理分頁**：舊版前端收到 `text.delta` 時，
  `MarkPatch` 與 atom 會降級（格式不套用、atom 變成一個 U+FFFC 佔位字元）。
- `/api/health` 的 feature 探測**每個分頁只做一次**，線上切換 `FEATURE_OT` 該分頁不會跟著切。
- **`pruneBlockDeltas(7)` 已寫好但還沒接排程** → delta log 會一直長
  （真值不受影響，只是磁碟變大）。`gcRoutes` / `startGcScheduler` 已存在，接上去即可。
- 全專案固定約定：**已被伺服器套用的那一邊 `priority = true`，還在飛行中的本地 delta `priority = false`**，
  寫在 `ot/client.ts`、`ot/transform.ts`、`ot-service.ts` 三處，方向不一致就永遠不會收斂。
- 改動 `transform` / `compose` **一定要重跑 2 萬次 property test**
  （`pnpm --filter @kennote/editor-core test`）。
- 其他已知限制：undo stack 深層紀錄的 transform 是近似值；OT 只作用於單一 block 內的文字
  （結構操作仍 LWW）；離線久了的 delta 一定會被拒絕、需重載；
  IME 組字期間遠端 delta 會排隊（組字 10 秒對方的字就晚 10 秒出現）。

> §2.10 曾記錄兩個資料遺失級的伺服器／宿主 bug（`block.insert` 撞主鍵、
> `reload()` 拿到快取舊 snapshot）。**兩者都已修掉**
> （`blocks/repo.ts` 的 `ON CONFLICT … deleted_at = NULL` 復活路徑 +
> 宿主 reload 先抓新 snapshot），對應的 `e2e/functional-round4.spec.ts`
> 已經沒有 `test.fixme`。
