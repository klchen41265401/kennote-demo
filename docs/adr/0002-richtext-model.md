# ADR 0002：Rich Text 採用 04 §4.2 的扁平 InlineSpan 模型（並連帶的資料模型取捨）

- 日期：2026-09-19
- 狀態：已採納
- 影響範圍：`packages/shared-types`、`apps/server/migrations`、`packages/editor-core`、`apps/web`

## 情境

兩份規格對「一段文字在資料庫裡長什麼樣」給了**兩種不相容的答案**：

**03 §6.1（Notion API 風格）**

```jsonc
{ "type": "text", "plain_text": "Hello",
  "text": { "content": "Hello", "link": null },
  "annotations": { "bold": false, "italic": false, "strikethrough": false,
                   "underline": false, "code": false, "color": "default",
                   "comment_ids": [] } }
```

**04 §4.2（扁平 InlineSpan）**

```jsonc
[ { "text": "Hello " },
  { "text": "world", "marks": [{ "t": "b" }] } ]
```

`00-README.md` §3 明確規定：**「editor-core 與同步協定的實作規格，全部以 04 為準」**。
rich text 模型正是 editor-core 的核心資料結構，因此適用這條規則。

## 決策

### 1. Rich text 採用 04 §4.2，03 §6.1 的格式不採用

```ts
// packages/shared-types/src/richtext.ts
export interface InlineSpan { text: string; marks?: Mark[] }
export type Mark =
  | { t: 'b' } | { t: 'i' } | { t: 'u' } | { t: 's' } | { t: 'code' }
  | { t: 'link'; href: string }
  | { t: 'color'; fg?: string; bg?: string }
  | { t: 'comment'; id: string };
export interface InlineAtom { atom: 'mention'|'date'|'pageLink'|'equation'; data: Record<string, unknown>; marks?: Mark[] }
export type InlineNode = InlineSpan | InlineAtom;
export type RichText = InlineNode[];
```

**理由：**

- **`normalize()` 的 canonical form 需要 marks 可比較。** 04 §4.2 規定「所有核心函式的結尾
  都必須呼叫 `normalize()`，讓同一份語義內容永遠有唯一表示，可以直接 `JSON.stringify` 比較」。
  03 的 `annotations` 是一個「每個欄位都有預設值」的物件，`{bold:false,...}` 與省略欄位
  在語義上相同但字面不同，破壞唯一表示，而 **OT transform 的正確性依賴這個不變量**。
- **`marks?: Mark[]` 是 discriminated union，TypeScript 可以完美表達。**
  `{ t: 'link'; href: string }` 這種「帶參數的格式」在 `annotations` 的扁平 boolean 物件裡
  沒有位置（Notion 只好把 link 塞進 `text.link`，color 用字串，comment 用另一個陣列 —— 三種
  格式表達同一件事）。
- **體積。** 03 的格式每個 span 固定帶 7 個欄位的 annotations；一段 100 字、3 種格式的
  段落，03 格式約 900 bytes，04 格式約 120 bytes。gzip 後差距縮小但仍有 3–4 倍。
- **可讀性。** debug 時直接看得懂，不必先在腦中過濾 6 個 `false`。

**不採用 Notion 的元組格式 `[["text", [["b"]]]]` 的理由**（04 §4.2 已載明）：
具名欄位可讀性高 10 倍，gzip 後體積差異幾乎為零，「好改」永遠優先於「省 3KB」。

### 2. `properties` / `format` 合併成單一 `props`

03 §4.4 把 block 的資料拆成 `properties`（內容）與 `format`（外觀），理由是
「搜尋只需掃 properties」與「版本 diff 更乾淨」。

**本專案合併成單一 `props`**，因為：

- 04 §5.4 的 `Operation` 只有 `props` 一個欄位，拆兩個會讓每個 op 多一個維度，
  transform 規則表（04 §6.6）跟著變複雜 —— 而 OT 的複雜度是本專案第二高的風險。
- 「搜尋只掃 properties」這個好處不存在了：本專案的行內文字住在**獨立的 `content` 欄位**
  （`RichText`），不在 `props` 裡。搜尋索引（`blocks.plain_text`，generated column）
  只從 `content` 萃取，天然就掃不到顏色代碼。
- 版本 diff 的乾淨度靠 op 粒度解決（`block.update` 的 patch 本來就只帶改動的欄位），
  不需要靠欄位切分。

對應關係：03 的 `format.block_color` → `props.color`；`format.page_icon` → `props.icon`
（callout）；`format.column_ratio` → `props.ratio`。

### 3. `pages` 獨立成表，不是「頁面就是 type='page' 的 block」

03 §4.5 主張「沒有 pages 表」。本專案改成 `pages` + `blocks` 兩張表，因為：

1. **04 §5.4 的 transaction 模型以 page 為鎖與序號的單位**：
   `SELECT seq FROM pages WHERE id = $1 FOR UPDATE` 是整個同步引擎的序列化點，
   `pages` 需要一個 `seq` 欄位，而它不屬於任何 block 的語義。
2. **側邊欄的遞迴 CTE 只掃 pages**，不必在千萬筆 block 裡過濾 `type='page'`。
3. 「一切皆 block」真正重要的兩個性質都保留了：
   **真值來源是 `blocks` 表**、**排序真值是父節點的 `children` 陣列**（03 §5.1 方案 A）。
   database 的一列仍然是 `pages` 的一列（03 §4.6 的槓桿點），欄位值存
   `pages.properties`，可以點開變成頁面、有子 block、可被搜尋。

### 4. 欄位型別一律 camelCase

`BlockType` 用 `bulletedList` / `tableOfContents`，`FieldType` 用 `multiSelect`，
不用 03 的 `bulleted_list` / `multi_select`。理由：TypeScript union 與 JSON 欄位名
在前後端之間直接流動，一套命名風格比較不容易在序列化邊界出錯。
SQL 欄位名仍然是 snake_case（03 §3.2 的命名慣例）。

### 5. 樣式：連 app shell 都用 CSS Modules，不裝 Tailwind

00-README 決策 #10 允許「Tailwind 僅限 app shell 的版面拼裝」。本專案**連 app shell 都不用**：

- 為了一個側邊欄 + 一個內容區的版面，引入一整條 PostCSS 工具鏈與 build 期掃描，划不來。
- 混用兩套樣式系統，日後「這個間距是 token 還是 utility class？」會變成常態問題。
- Tailwind 已經在 `scripts/check-deps.ts` 的黑名單裡；少一個例外就少一個破口。

設計 token 一律原生 CSS 變數（`apps/web/src/styles/tokens.css`，light / dark 兩套，
dark 走 `:root[data-theme="dark"]` 並在 `prefers-color-scheme: dark` 下自動跟隨系統）。

## 後果

### 正面

- `shared-types` 的 `RichText` 可以直接餵給 `editor-core` 的 8 個純函式，中間零轉換。
- `blocks.plain_text` 是 generated column（`kn_richtext_plain(content)`），
  應用層忘記更新也不會有髒資料，搜尋索引永遠同步。
- Operation 的形狀與 04 §5.4 一字不差，M6 接 OT 時不需要改協定。

### 負面

- **與 03 §6.1 / §6.2 / §4.4 / §4.5 的 JSON 範例不一致。** 讀 03 時要記得對照本 ADR。
  （03 的 §4.6 collections / §4.7 collection_views / §6.3–6.6 的 schema 與 view 規格
  則**完全照用**，只是欄位名改成 camelCase。）
- 若日後要匯入 Notion 的官方匯出檔，需要寫一支 `annotations → marks` 的轉換器。
  這支轉換器本來就跑不掉（Notion 的格式是它的私有格式），只是落點從「資料層」
  移到「匯入器」——而 Importer registry 是 04 §10.4 已經規劃好的擴充點。

## 附帶記錄：M1 實作時的其他小決定

| 決定 | 說明 |
|---|---|
| `uuid_generate_v7()` 改用 `set_byte` | 03 §3.1 的 fallback 用 `set_bit(bytea, 52/53, 1)` 設定 version，但 PostgreSQL 的 `set_bit(bytea, n)` 是「第 n/8 個 byte 的第 n%8 個**最低位**位元」，會產生錯誤的 version nibble。改用 `set_byte` 明確覆寫 version(0111) 與 variant(10) |
| `pages.sort_key` 加 `COLLATE "C"` | fractional index 依賴**位元組字典序**；不指定 collation 時 `'A'` 與 `'a'` 的相對順序會跟前端算的不一樣 |
| 搜尋第一階段只做 `pg_trgm` | PostgreSQL 預設 parser 不斷中文，`to_tsvector('simple')` 對中文等於沒用。trgm 切 3-gram 不看語言，中文立刻可用。第二階段（應用層斷詞 + tsvector + `ts_rank_cd`）排在 M6，再加一支 migration 即可，查詢介面不變 |
| `text.delta` 目前回 `NOT_IMPLEMENTED` | 型別與驗證都已就緒，等 M6 的 OT。這樣前端送錯時會得到明確訊息，而不是靜默忽略 |
