# ADR 0005：自建全文搜尋、資料可攜性（匯出／匯入）與維運（M6）

- 狀態：已採用（M6）
- 日期：2026-09-19
- 相關規格：01 §8（搜尋）、§9（資料生命週期）、§10（匯入匯出）；
  03 §7.4（全文搜尋）、§11.2–11.5（GC / 備份 / RLS / 監控）；
  04 §5.6（檔案）、§8 M6 第 6–12 項
- 前置決策：ADR 0001（全自研核心）、ADR 0002（RichText 模型 / pages+blocks 兩張表）、
  ADR 0004（即時協作層）

---

## 1. 背景

M6 要補齊「產品完整度」的四件事：**找得到**（搜尋）、**帶得走**（匯出）、
**搬得進來**（匯入）、**壞掉救得回來**（備份 / GC / 監控）。

四件事有一個共同約束：**不引入新的 runtime 套件**
（00-README 決策 #11、`scripts/check-deps.ts`）。具體來說：
不裝 Meilisearch / Elasticsearch、不裝 markdown 套件、不裝 ORM、
不裝 jszip / archiver、不裝 Playwright、不裝 prom-client。

本次實作**新增的 runtime 依賴數：0**。唯一新增的相依是 workspace 內部的
`@kennote/editor-core`（零依賴純 TS，見 §3.3）。

---

## 2. 搜尋

### 2.1 中文斷詞：自研 bigram，索引端與查詢端各寫一份，用測試釘住

03 §7.4 已經說清楚問題：PostgreSQL 預設 parser 把連續 CJK 當成**一個 token**，
`to_tsvector('simple', '資料庫設計')` 出來是一個詞，搜「資料庫」比不到。
方案 A（應用層斷詞）是規格的建議，但它有個實務陷阱：

> 索引端的斷詞也在應用層 → `blocks` 的寫入路徑必須**每次**都記得算 `search_text`。
> 漏算一次就是髒索引，而且沒有任何東西會告訴你。

**決定：把同一套斷詞規則寫成 IMMUTABLE 的 SQL 函式 `kn_segment()`，
索引端用 generated column（`blocks.search_tsv` / `pages.search_tsv`），
查詢端用 TypeScript 的 `modules/search/segment.ts`。**

- 索引端：generated column 由資料庫自己算，**應用層不可能漏**（與 0005 migration
  的 `plain_text` 同一個理由）。
- 查詢端：需要 token 陣列來做高亮與 tsquery 組裝，SQL 函式給不了，所以用 TS。
- 兩份實作的一致性由 `test/search-segment.test.ts` 的黃金案例釘住
  —— 那份測試同時是 `kn_segment()` 的規格書。

斷詞規則（刻意極簡，才寫得出兩份一致的實作）：

| 輸入 | token |
|---|---|
| `[0-9A-Za-z]+` | 整串小寫，一個 token |
| CJK 連續 1 字 | 該字本身 |
| CJK 連續 n≥2 字 | 全部相鄰 bigram（`資料庫` → `資料` `料庫`） |
| 其他（標點、空白、emoji） | 分隔符 |

為什麼 bigram 而不是詞典（jieba / zhparser / `Intl.Segmenter`）：

- 詞典要嘛得在 DB 主機編譯擴充（自架不保證能裝），要嘛得維護詞庫。
- bigram 召回率 100%：任何 ≥2 字的查詢一定比得到。精準度靠 `ts_rank_cd`
  的 cover density 補回來 —— 查「資料庫設計」會要求 `資料 & 料庫 & 庫設 & 設計`
  四個 token 同時命中且相鄰，體感非常好。
- `Intl.Segmenter` 沒採用的原因：**SQL 端沒有等價物**，會直接違反「索引與查詢
  用同一支斷詞器」這個前提。

代價（誠實記錄）：索引大約是原文的 2 倍；**單一中文字的查詢 tsvector 幫不上忙**
（切不出 bigram），由 pg_trgm fallback 接手。

### 2.2 兩條查詢路徑：tsvector 為主，pg_trgm 為輔

- **A（tsvector + GIN）**：`ts_rank_cd(tsv, tsq, 32)`、標題 `setweight A` 再乘 4.0、
  時間衰減 `1 + 0.5·exp(-Δt/30天)`。一頁只回一筆（`DISTINCT ON (page_id)`，
  標題命中優先）—— 使用者要的是「哪一頁」，不是「哪一段」。
- **B（pg_trgm + ILIKE）**：查詢 ≤2 字、或 A 完全沒命中時才跑。0005 建的 trgm
  索引全部保留，一行都沒動。

### 2.3 片段高亮：`ts_headline` + 應用層 fallback

`ts_headline` 用的是**同一個 parser**，所以中文內容它一個 `<mark>` 都標不出來
（文件 token 是整串 CJK，查詢 token 是 bigram，不相等）。

**決定：SQL 照樣呼叫 `ts_headline`（英數內容它做得又快又好，而且在資料庫端就切好片段），
回到應用層後若片段裡沒有我們指定的哨兵，就改用 `snippet.ts` 的 `buildSnippet()`。**
兩條路都吃同一組 token，所以高亮位置與排序永遠一致。

`ts_headline` 的輸出**不是**逸出過的 HTML，直接吐給前端就是 XSS。
做法是把 `StartSel`/`StopSel` 設成不可能出現在內容裡的控制字元哨兵，
整串逸出之後再把哨兵換回 `<mark>`。`SearchHit.snippet` 的契約因此是
「除了 `<mark>` 以外全部逸出」，前端可以安全地 `dangerouslySetInnerHTML`。

### 2.4 權限過濾：查詢層 JOIN + 候選集精算

01 §8 M7.1.5 是資安紅線：**必須在查詢層過濾，不可先撈後濾**。

- 第一層寫死在 SQL 裡：`JOIN workspace_members ON … user_id = $me`。
- 第二層（頁面層授權）依 03 §7.4 的建議走「候選集 → 應用層精算」，
  但加了一個短路：**只有 guest，或這個工作區真的有 `page_permissions` 條目時才跑**。
  沒有條目時 member 的 baseline 就是 `edit`，跑了也是白跑（03 §7.4 自己點名的效能陷阱）。

### 2.5 沒有做的：`search_documents` 聚合表與重建佇列

03 §7.4.4 的 `search_documents` + `search_index_queue` 是 P1。本次沒做，因為
generated column 已經讓索引**永遠不會髒**，而佇列反而會引入「索引落後」的新狀態。
等到以下任一條件成立再回來做：

- 需要把 select/multiSelect 的**選項標籤**展開進索引（目前只索引到 optionId，
  因為標籤存在 `collections.schema`，generated column 碰不到別張表）。
- 需要索引留言內容（`doc_kind = 'comment'`）。
- blocks 的寫入延遲因為 tsvector 重算而變得明顯（要有量測數字才算）。

壓測腳本：`apps/server/scripts/bench-search.ts`（需要 `DATABASE_URL`，不進 CI）。

---

## 3. 匯出

### 3.1 PDF 改成「瀏覽器列印」，`format=pdf` 回 501

04 §8 M6 原訂用 Playwright 的 `page.pdf()`。**不採用**，理由：

- server 映像要多裝一顆 Chromium（約 +400MB）與一堆系統字型，
  否則 CJK 會印成豆腐字。正式映像目前 180MB。
- headless Chromium 的預設字型在繁中排版上反而比使用者自己的系統字型差。
- Playwright 也在「功能型套件自研」的精神之外 —— 它是為了一個匯出格式而引入
  整個瀏覽器自動化框架。

**決定：**

- 後端提供「自包含、可列印的 HTML」（內嵌 `@media print` 規則）。
- `POST /api/pages/:id/export` 收到 `format=pdf` → `501 NOT_IMPLEMENTED`，
  訊息裡直接告訴使用者替代做法（不是空的「尚未實作」）。
- 前端 `ExportDialog` 的 PDF 選項**不打那支 API**，直接 `window.print()`；
  `apps/web/src/lib/print.css` 負責把側邊欄、選單、浮層藏起來、把 flex 版面攤平、
  把 `<details>` 全部展開（印不出來的內容等於遺失）。

結果：使用者得到的 PDF 品質更好，維運成本是 0。

### 3.2 ZIP：自寫 reader / writer（store + deflate）

`modules/export/zip.ts`，約 250 行，只用 `node:zlib` 的 `deflateRawSync` /
`inflateRawSync`。支援 method 0/8、UTF-8 檔名（general purpose bit 11）、
data descriptor（大小一律以 central directory 為準）。

**不支援 ZIP64**（單檔 > 4GB 或 > 65535 項），偵測到直接丟 `ZipError`
—— 不做半套比做壞更好。已壓縮的副檔名（png/jpg/mp4/zip/pdf/woff）自動改用 store。

### 3.3 Markdown / HTML 序列化：重用 editor-core，用**深路徑** import

匯出的行內序列化（粗體、連結、程式碼…）直接用 `editor-core` 的
`inlineToMarkdown` / `inlineToHTML`；匯入的 Markdown 解析用
`parseMarkdownToBlocks`。理由：**複製貼上與匯出匯入必須是同一套語法**，
否則「複製到 Obsidian」跟「匯出後在 Obsidian 開」會長不一樣。

實作細節（踩過的坑，寫下來免得下一個人再踩）：

> `@kennote/editor-core` 的 `exports` 指向 **TS 原始碼**，所以 server 端
> `import … from '@kennote/editor-core'`（barrel）會把**整個** editor-core
> 拉進 server 的 tsc program —— 包含需要 DOM 型別的 `view/`、`input/`、`selection/`。
> 那樣 server 的 typecheck 會被編輯器那條工作線的進行中變更連坐。
>
> **決定：server 一律用深路徑 import**
> （`@kennote/editor-core/src/clipboard/parse-markdown.js`、
> `…/src/clipboard/serialize.js`、`…/src/model/types.js`），
> 只把真正用到的純函式拉進來。`apps/server/tsconfig.json` 補上 `"lib": ["ES2022","DOM"]`
> ——**純型別層**，server runtime 完全不碰 DOM。
> `apps/server/build.mjs` 加上 `conditions: ['development']`，讓 esbuild 也從原始碼打包。

### 3.4 Markdown 方言：以「Obsidian / Typora 打得開」為驗收標準

| 結構 | 輸出 | 備註 |
|---|---|---|
| 標題 / 清單 / 待辦 / 引言 / 程式碼 / 分隔線 | 標準 Markdown | 往返無損 |
| 巢狀 | 每層 2 個空白 | 與 editor-core 的 `indentLevel()` 對齊 |
| 圖片 | `![alt](相對路徑)` | 附件在 zip 的 `files/` |
| 表格 | GFM | 往返無損 |
| 公式 | `$$ … $$` | 往返無損 |
| callout | `> 💡 內容` | Notion 自己也這樣匯出；**往返會變成 quote** |
| toggle | `<details><summary>` | 三大編輯器都吃得下；**往返會攤平** |
| 子頁面 | 相對路徑連結 | 含子頁面時才有（單檔匯出沒有對象可指） |

callout / toggle 的往返失真是**已知且接受**的：純 Markdown 沒有等價語法，
要無損請用 `format=json`（record_map 原樣）。

### 3.5 HTML：沿用 Notion 匯出的 class 名稱

`.page-body`、`.callout`、`.bulleted-list`、`.to-do-list`、`.collection-content`…
這樣使用者既有的樣式表與轉檔腳本能對得上，**而且我們自己的匯入器可以吃自己的匯出檔**。

---

## 4. 匯入

### 4.1 所有 block 一律走 `applyTransaction()`

匯入是最容易破戒的地方（「反正是批次，直接 INSERT 比較快」）。
破了戒，OT 與版本歷史就會漏掉這一整批內容（00-README §5 風險二）。

實作：`fragmentToOps()` 把解析出來的 DocFragment 前序展開成 `block.insert`，
`afterId` 串成一條鏈，再切成 **150 個 op 一批**
（`MAX_OPS_PER_TRANSACTION = 200`，且 03 §9.5 要求單一交易不要太長）。
`createPage()` 自動建的那個空 paragraph 用一個 `block.delete` 收掉。

### 4.2 伺服器端 HTML 解析：自寫 mini-DOM，不裝 jsdom

`editor-core` 的 `parseHTMLToBlocks()` 需要 `DOMParser` 或一個真的 `Document`
（瀏覽器端的正確選擇），server 沒有。選項有三：

1. 裝 jsdom（開發相依 ~40MB，且正式映像也得帶著）→ 否決。
2. 給 editor-core 一個假的 `Document`（要實作 `createElement` + `innerHTML` setter
   + `querySelector`…）→ 假物件比真解析器還難寫，而且型別上要硬轉。
3. **自寫一個只認我們要的標籤的 tokenizer + 樹**（`modules/import/mini-html.ts`，約 600 行）。

採用 3。行為與 editor-core 的白名單解析對齊（marks、清單巢狀、Word/GDocs 的
inline style、Notion 的 `<div class="checkbox checkbox-on">`），並額外認得
Notion HTML 匯出的 `figure.callout` / `pre.code` / `figure.image` / `<details>`。

安全：解析器只「讀」，永遠不把原始 HTML 放回輸出；`script`/`style` 直接丟棄；
`href` 擋掉 `javascript:` 與 `data:`。這是零依賴專案取代 DOMPurify 的做法。

### 4.3 Notion 匯出 zip：結構解析與純邏輯測試

`modules/import/notion.ts` 是**純函式**（吃一個檔名陣列，吐一棵計畫樹），
所以 `test/import-notion.test.ts` 在沒有資料庫的環境也跑得動。

規則：

- 剝掉共同根目錄（`Export-<uuid>/`）。
- 檔名 `<標題> <32 碼 hex>` → 標題去 hash，hex 留著當「連結對照」的 key。
- 同名資料夾 = 該頁的子項（`專案筆記 <hex>.md` ↔ `專案筆記 <hex>/`）。
- `X_all.csv` 優先於 `X.csv`（前者是未套用視圖篩選的完整資料）。
- database 資料夾底下「每列一個 .md」**不**各自建頁（內容以 CSV 為準），
  但會在 `warnings` 裡講清楚少了什麼。
- 其餘檔案 = 附件，先上傳拿 `fileId`，再改寫圖片 block 的相對路徑。

連結改寫分兩趟：**先把所有頁面建出來拿到 id，再灌內容**。
「整段就是一個子頁面連結」的段落會被改成 `page` block（側邊欄才會出現層級），
其餘連結改成站內路徑 `/page/<id>`。

### 4.4 CSV 欄位型別推斷

順序（從最嚴格到最寬鬆，第一個全通過的就是答案）：
`checkbox → number → date → url → email → multiSelect → select → text`。

- checkbox 認 `Yes/No`（Notion 的匯出格式）、`true/false`、`是/否`。
- date 認 ISO、`2026/10/1`、Notion 的 `January 31, 2026 9:00 AM`。
- select 的門檻刻意寬鬆（樣本 ≤8 列時短字串一律當 select）：
  猜錯的成本是使用者在 UI 一鍵改型別（M4 的 retype 會做值遷移），
  猜太保守的成本是使用者一欄一欄手動改。
- 第一欄一律是 `title`（Notion 匯出的第一欄就是 Name）。

已知限制：relation / rollup / formula 欄位在 CSV 裡只是字串，一律降級成 text。

---

## 5. 垃圾桶 GC、備份與監控

### 5.1 GC：server 內的 setInterval，不是外部 cron

單一實例部署（docker-compose.prod.yml）下，`setInterval` 是最小可行解，
且 `timer.unref()` 讓測試與 CLI 不會被它卡住。
**多實例時必須改掉**（否則每個實例都跑一次）：要嘛選 leader，
要嘛關掉排程改用外部 cron 打 `POST /api/admin/gc`。寫在 `docs/ops.md`。

刪除一律分批（03 §11.2）：一次刪光會開超長交易，卡住 autovacuum 也卡住線上寫入。
檔案先標 `deleted_at` → 刪實體檔案 → 刪資料列；反過來的話中途掛掉會留下
「資料庫說有、磁碟上沒有」的壞連結。

### 5.2 備份：`pg_dump --format=custom` + uploads tar，保留 14 份

03 §11.3 的完整方案是 `pg_basebackup` + WAL 歸檔（PITR）。本階段先做邏輯備份，
因為它跨版本可還原、單檔好搬、好驗證。PITR 等到「資料量大到 dump 要跑超過 10 分鐘」
再上。

**`scripts/restore.sh` 會在還原後自動驗 `/api/health` 並抽查各表筆數**
—— 03 §11.3 說「沒演練過的備份等於沒有備份」，所以演練步驟直接寫進腳本，
而不是寫在文件裡等人自己記得。

### 5.3 監控：自寫 80 行的 metrics registry，不裝 prom-client

我們只需要 counter / gauge / histogram 三種，`prom-client` 的其餘表面積
（pushgateway、cluster 聚合、default metrics）用不到。

標籤基數控制：路由一律用**樣板**（`/api/pages/:id`）而不是實際 URL，
否則每個 pageId 都會長出一條時間序列。

`GET /api/metrics` **刻意不要求登入**：它只吐聚合數字，沒有任何使用者內容，
而且 nginx 不會把它對外開（`docs/ops.md` 有設定範例）。

`/api/health` 多回 `migrations`（`applied` / `onDisk` / `pending`），
**pending > 0 時 status 就是 degraded** —— 部署後忘了跑 migration 是最常見的
「服務起來了但功能是壞的」情境，健康檢查就該抓到它。

---

## 6. 本次改動的既有檔案（超出 M6 代理的主要路徑，一併記錄）

| 檔案 | 改了什麼 | 為什麼 |
|---|---|---|
| `packages/shared-types/src/api.ts` | 移除 `SearchHit` / `SearchResponse`（搬到 `search.ts`）、`API_ROUTES` 補新端點、`HealthResponse` 補 `migrations` | 同名 `export *` 會衝突 |
| `apps/server/src/app.ts` | 註冊 recent / export / import / gc 路由與 metrics plugin、health 補 migration 狀態、啟動 GC 排程 | 組裝點 |
| `apps/server/package.json` | 加 `@kennote/editor-core`（workspace） | §3.3 |
| `apps/server/tsconfig.json` | 加 `"lib": ["ES2022","DOM"]` | §3.3，純型別層 |
| `apps/server/build.mjs` | 加 `conditions: ['development']` | §3.3 |
| `apps/server/Dockerfile` | deps 階段多 COPY 一個 package.json | workspace 連結 |

---

## 7. 重新評估的時機

| 決策 | 什麼時候該回來看 |
|---|---|
| bigram 斷詞 | 使用者抱怨「搜到太多不相關的」→ 評估 `pg_jieba`（介面不變，只換 `kn_segment` 的實作） |
| 不做 `search_documents` | 需要索引 select 標籤或留言內容時 |
| PDF 用列印 | 有「伺服器端排程產生 PDF 報表」的需求時（那時才值得一顆 Chromium） |
| GC 用 setInterval | 要跑多實例時（必改） |
| 邏輯備份 | dump 超過 10 分鐘，或 RPO 要求 < 24 小時時 → 上 WAL 歸檔 |
| 自寫 ZIP | 需要 ZIP64（單檔 > 4GB）時 |
