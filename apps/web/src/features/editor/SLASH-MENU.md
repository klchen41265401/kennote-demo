# `/` 斜線選單 —— Notion 7.34 還原報告

> 真值來源：`reference/notion-capture/_slash-menu-full.json`（實機把整個選單捲完抓下來的
> **164 個項目**，含分組與順序）＋ `reference/notion-capture/UI-SPEC.md` §6.1
> ＋ `06-slash-menu-*.png` / `06b-slash-filtered-*.png` / `06c-slash-scrolled-*.png`。
>
> 對照測試：`__tests__/slash.test.ts` 會**逐項**比對「名稱 + 右側提示 + 順序 + 分組」，
> 少一項、順序差一格、文案改一個字都會紅。要改指令表，先去改 Notion。

---

## 1. 選單本體

| 項目 | Notion 7.34 | kennote |
|---|---|---|
| 寬度 | 330px | 330px |
| 最大高度 | ~370px（內部捲動） | 370px（捲動區 318px + footer） |
| 列高 | 33px | 33px |
| 項目內容 | icon + 名稱 + 右側灰字縮寫，**沒有說明文字** | 同左 |
| 分組標題 | 灰色小字，捲動時 sticky | 同左（`position: sticky`） |
| 分組分隔 | 組與組之間一條細線 | 同左 |
| 底部 | 固定一列「關閉選單　esc」 | 同左 |
| 過濾中 | **攤平**成一張相關度清單，不分組；同名項目補「· 分組」 | 同左 |
| 無結果 | 「沒有結果」，再多打 2 個字自動關閉 | 同左（`CLOSE_AFTER_EMPTY_CHARS = 2`） |
| 鍵盤 | ↑↓ Enter Esc | ↑↓ **PageUp/PageDown（跳 5）Home/End** Enter Tab Esc |
| 「轉換成」分組 | 只在目前區塊有內容時出現 | 同左 |
| 「建議」分組 | 最近使用浮動 | 同左（localStorage `kennote.slash.recent`，預設是 Notion 抓到的 4 項） |

搜尋支援三種輸入：

```
/程式        中文
/code        英文
/csm         拼音首字母（lib/pinyin.ts）
/標題1       省略空白也命中
```

---

## 2. 164 項覆蓋表

圖例：**完整** = 選下去就能用；**部分** = 能用但有限制；**佔位** = 選單上標「即將推出」，點了只跳說明。

### 建議（4）

| 項目 | 狀態 | 行為 |
|---|---|---|
| AI 筆記寫手 | 佔位 | AI 尚未接（M5 之後） |
| HTML〔新〕 | 完整 | 插入 `embed` block，`props.service = 'html'` |
| 網頁書籤 | 完整 | 插入 `bookmark` block → 貼網址面板 |
| 標註 | 完整 | `setBlockType('callout')` |

### 基本區塊（14）

| 項目 | 縮寫 | 狀態 | 行為 |
|---|---|---|---|
| 文字 | | 完整 | → `paragraph` |
| 標題 1 / 2 / 3 / 4 | `#`~`####` | 完整 | → `heading1`~`heading4`（**heading4 為本次新增型別**） |
| 項目符號列表 | `-` | 完整 | → `bulletedList` |
| 編號列表 | `1.` | 完整 | → `numberedList` |
| 待辦清單 | `[]` | 完整 | → `todo` |
| 摺疊列表 | `>` | 完整 | → `toggle` |
| 頁面 | | 完整 | 插入 `page` block + `POST /api/pages` 建子頁 |
| 引用 | `"` | 完整 | → `quote` |
| 表格 | | 完整 | 插入 `table` + 預設 3 列（含標題列） |
| 分隔線 | `---` | 完整 | → `divider` |
| 連結到頁面 | | 完整 | 開頁面選擇器（`PickerPopover`）→ `page` block 指向既有頁 |

### 媒體（5）

| 項目 | 狀態 | 行為 |
|---|---|---|
| 圖片 | 完整 | 上傳 / 嵌入連結面板、拖放、寬度拖曳、對齊、說明文字 |
| 影片 | 完整 | 上傳 / YouTube・Vimeo 嵌入 |
| 音訊 | 完整 | **新型別 `audio`**：上傳 / 連結 + `<audio controls>` |
| 程式碼 | 完整 | → `code`（語言選單、複製、行號、自研高亮） |
| 檔案 | 完整 | 上傳 / 連結 + 下載列 |

### 資料庫（18）

| 項目 | 狀態 | 行為 |
|---|---|---|
| 表格 / 看板 / 圖庫 / 列表 / 日曆 瀏覽模式 | 完整 | `POST /api/databases` + 指定 view type → `collectionView` block |
| 資料庫 - 內嵌 | 完整 | 同上（table view） |
| 資料庫 - 整頁 | 完整 | 建立 `isDatabase` 子頁 → `page` block + 導頁 |
| 資料來源的連結瀏覽模式 | 完整 | 開資料庫選擇器 → 連到既有 collection 的所有 view |
| 動態 / 儀表板〔新〕/ 地圖 瀏覽模式 | 佔位 | 後端 `VIEW_TYPES` 沒有這些型別 |
| 時間軸瀏覽模式 | 佔位 | 同上（`VIEW_TYPES` 只有 table/board/list/gallery/calendar） |
| 垂直長條圖 / 水平長條圖 / 折線圖 / 環形圖 / 數字圖表 | 佔位 | 圖表引擎不在本次範圍 |
| 表單 | 佔位 | 表單填答流程不在本次範圍 |

### 進階區塊（15）

| 項目 | 縮寫 | 狀態 | 行為 |
|---|---|---|---|
| 目錄 | | 完整 | 跟著頁面 heading 自動更新，點擊捲動 |
| 方程式區塊 | | 完整 | LaTeX 子集 → MathML（`lib/mathml.ts`） |
| 按鈕 | | 完整 | **新型別 `button`**：設定面板可編標籤 + 動作（插入樣板區塊 / 開啟頁面） |
| 頁面路徑 | | 完整 | **新型別 `breadcrumb`**：由頁面樹算出祖先鏈，可點擊導頁 |
| 分頁〔新〕 | | 佔位 | Notion 7.34 的新容器型別，本次不做 |
| 同步區塊 | | 部分 | **新型別 `syncedBlock`**：原始區塊可編輯 + 複製同步連結；引用端為唯讀投影（見 §4） |
| 摺疊標題 1 / 2 / 3 | `# >`~`### >` | 完整 | `heading{n}` + `props.toggleable`，箭頭可收合子區塊 |
| 2 / 3 / 4 / 5 欄 | | 完整 | `columnList` + N 個 `column`，可拖曳調寬；少於 2 欄自動解散 |
| 程式碼 - Mermaid | | 部分 | `code` block + `language = 'mermaid'`，有專屬的 Mermaid tokenizer（圖表型別 / 箭頭 / 註解）；**不渲染圖**：那要 runtime 套件 |
| AI 區塊 | | 佔位 | AI 尚未接 |

### 行內（5）

| 項目 | 狀態 | 行為 |
|---|---|---|
| 提及人員 | 完整 | 開 `MentionMenu`（人員分頁） |
| 提及頁面或資料來源 | 完整 | 開 `MentionMenu`（頁面分頁，與 `[[` 同一套） |
| 日期或提醒 | 部分 | 插入今天的 `date` atom；**提醒（通知排程）未做** |
| 表情符號 | 完整 | 開 `EmojiPicker`，插在游標處 |
| 行內方程式 | 部分 | 開 LaTeX 輸入框 → `equation` atom；**插入後不能再點開編輯** |

### 嵌入（53）

| 項目 | 狀態 | 行為 |
|---|---|---|
| 嵌入 | 完整 | `embed` block + 網址面板 |
| HTML〔新〕 | 部分 | 走 `embed`；只接受網址，**不接受原始 HTML**（XSS 紅線） |
| PDF | 完整 | **新型別 `pdf`**：上傳 / 連結 + `<object>` 內嵌預覽 |
| Google Drive、推文、GitHub Gist、Google 地圖、Figma…（共 49 個服務） | 完整 | 全部插入 `embed` block，`props.service` 決定面板標題與 placeholder |

> ⚠️ 能不能變成 iframe 由 `lib/embed.ts` 的**白名單**決定（YouTube / Vimeo / Figma / CodePen /
> CodeSandbox / Replit / Google Maps・Docs・Drive / Loom / Miro / Spotify / SoundCloud /
> GitHub Gist）。白名單外的服務會降級成連結卡——這是 SSRF 與 clickjacking 的紅線，
> **不因為選單上列了這個服務就放寬**。選單項目仍然可用（會存下網址、可點開）。

### 匯入（11）

| 項目 | 狀態 | 行為 |
|---|---|---|
| CSV | 完整 | 檔案選擇器 → `POST /api/import` → 建一個資料庫 |
| 文字和 Markdown | 完整 | 同上 → 每個檔案一頁 |
| ZIP | 完整 | 同上 → Notion 官方匯出（Markdown & CSV / HTML） |
| Confluence、Google 文件〔新〕、Dropbox Paper、Workflowy、Monday、Quip、Evernote | 部分 | 走同一支匯入 API；請先從來源匯出成 `.html` / `.md` / `.csv`（選單說明有寫） |
| Word | 部分 | `.docx` 尚未支援，提示改用 HTML |

### 轉換成（14）

標題 1~4、項目符號列表、編號列表、待辦清單、摺疊列表、程式碼、引用、摺疊標題 1~4
→ 全部 **完整**，一律 `setBlockType`（保留內容與子節點）。只在目前區塊有內容時顯示。

### 動作（5）

| 項目 | 快捷鍵 | 狀態 |
|---|---|---|
| 複製區塊連結 | `Alt+⇧+L` | 完整（寫入剪貼簿 `…#<blockId>`） |
| 建立複本 | `Ctrl+D` | 完整（深拷貝整棵子樹） |
| 移動到 | `Ctrl+⇧+P` | 部分（跨頁搬移需要後端支援，目前跳提示） |
| 刪除 | `Del` | 完整 |
| 萬事問 AI | `Ctrl+J` | 佔位 |

### 文字顏色（10）／背景顏色（10）

全部**完整**。色名與色值照 `reference/notion-capture/tokens.md` §3.3–3.4
（預設 → 灰 → 棕 → 橘 → 黃 → 綠 → 藍 → 紫 → 粉 → 紅），light / dark 兩套都在
`styles/tokens.css`。套用方式：`props.color` → `data-color` → CSS 變數。

### 統計

| 狀態 | 數量 |
|---|---|
| 完整 | 136 |
| 部分 | 14 |
| 佔位（選單標「即將推出」） | 14 |
| **合計** | **164** |

---

## 3. 新增的 block 型別（本次）

| 型別 | 用途 | 前端 renderer | 後端 |
|---|---|---|---|
| `heading4` | 標題 4 / 摺疊標題 4 | editor-core（可編輯） | `block-types/index.ts` |
| `audio` | 音訊 | `renderers/AdvancedBlocks.tsx` | 媒體 schema |
| `pdf` | PDF 預覽 | 同上 | 媒體 schema + name/size |
| `breadcrumb` | 頁面路徑 | 同上 | 只有 color |
| `button` | 按鈕 | 同上 | label + actions（樣板遞迴有深度上限） |
| `syncedBlock` | 同步區塊 | 同上 | `syncedFrom` / `syncedFromPageId` |

三處同步更新：`packages/shared-types/src/block.ts`（BLOCK_TYPES + props）、
`apps/server/src/modules/blocks/block-types/index.ts`（zod schema）、
`apps/server/migrations/0040_block_types.sql`（放寬 `chk_blocks_type`）。
`test/block-types.test.ts` 有一條測試直接讀 0040 的 SQL，確認每個 `BLOCK_TYPES`
字串都在 CHECK 約束裡——漏改 migration 會當場紅。

> **部署注意**：截圖用的後端（`100.74.148.92:8090`）跑的是舊版建置，
> 尚未套 0040，會把這五個新型別的 op 退回（`INVALID_OPERATION`）。
> 部署新版後端 + 跑 migration 之後就正常。e2e 截圖用 `STUB_TX=1` 短路寫入通道來驗前端渲染。

---

## 4. 決策

| 決策 | 理由 |
|---|---|
| **分組與順序完全照實機抓到的 `_slash-menu-full.json`，不照任務說明裡的建議順序** | 那份 JSON 是真值。實機順序是 建議→基本區塊→媒體→資料庫→進階區塊→行內→嵌入→匯入→轉換成→動作→文字顏色→背景顏色；任務說明把「嵌入」排在「行內」前面、把「轉換成」排到最後，與實機不符。測試直接比對 JSON，以免之後有人「憑印象」改順序。 |
| **`同步資料庫` 分組沒做** | 實機抓到這個分組標題，但它底下**一個項目都沒抓到**（那一段是另一種 DOM 結構）。沒有真值就不猜，寧可少做也不要編造 4 個不存在的項目。 |
| **摺疊標題用 `props.toggleable` 而不是新的 `toggleHeading1-3` 型別** | 「標題 2 ⇄ 摺疊標題 2」互轉不該動到內容或型別；Notion 的資料模型也是 heading + toggleable。少 3 個 block type、少一條 migration，`轉換成` 的行為也自然正確。 |
| **摺疊標題的箭頭用 `data-heading-toggle`，不用 `data-toggle-arrow`** | `editor-core/src/input/controller.ts` 看到 `data-toggle-arrow` 會硬轉成 `toggle` 型別，那會毀掉標題。那支檔案屬於 OT 代理，所以換一個屬性、由宿主在 capture 階段處理。 |
| **slash 的「何時開」與 query 改由宿主自己算** | `editor-core/src/input/triggers.ts` 有兩條與 Notion 不同的規則：(1) `/` 前面不是空白就不開，(2) query 裡有任何空白就關。後者直接讓 `/標題 1`、`/2 欄`、`/Google Drive`、`/資料庫 - 內嵌` 全部打不完。那支檔案是 OT 代理的範圍，所以宿主沿用既有的 `[[` 做法：聽 `transaction` 自己維護 trigger 狀態。editor-core 的 `slashTrigger` 仍然用來開啟（它算的 anchor rect 比較準），它的「關閉」事件一律忽略。 |
| **選單不顯示說明文字** | Notion 7.34 的 `/` 選單只有 icon + 名稱 + 縮寫。說明文字仍留在 `BlockSpec.description`（給 `title` tooltip 與「轉換成」選單用）。 |
| **過濾時攤平、不分組** | 比照 `06b-slash-filtered-light.png`。只有「同名項目不只一個」時才補「· 分組」（例如「標題 1」同時在 基本區塊 與 轉換成）。 |
| **49 個第三方服務用字母 monogram，不畫品牌 logo** | 自繪 50 個品牌 SVG 成本極高且有商標疑慮。有辨識度的 8 個（HTML / Google Drive / 推文 / GitHub / Google 地圖 / Figma / PDF / 嵌入）畫了專屬 icon，其餘用「圓角方框 + 首字母」，與 Notion 的縮圖尺寸一致。 |
| **所有嵌入服務共用一個 `embed` block，只差 `props.service`** | 53 個項目如果各自一個 block type，就是 53 條 migration 與 53 個 renderer。服務差異只有面板文案與 placeholder，那是 UI 知識，放 `lib/embed-services.ts` 一張表就好。 |
| **HTML 嵌入只接受網址，不接受原始 HTML** | 接受原始 HTML 等於開一個 XSS 大門。Notion 用沙箱 iframe 跑；我們的 iframe 一律 `sandbox` 且不給 `allow-same-origin`，但渲染任意 HTML 的路徑還是不開。 |
| **圖表 / 地圖 / 儀表板 / 表單 / 時間軸 / 動態 / 分頁 / AI 標「即將推出」而不是硬做** | 這些要嘛需要後端沒有的 `VIEW_TYPES`，要嘛需要一整個圖表引擎。做半套（插進去卻不能用）比誠實標示更糟。選單上有徽章、點下去有說明，使用者不會白點。 |
| **匯入的第三方來源全部導到同一支 `POST /api/import`** | 後端靠副檔名判斷來源（md / csv / html / txt / zip）。Confluence、Quip、Workflowy 的匯出檔本來就是這幾種格式，所以「選單上有」＝「真的能用」，只是選單說明會告訴你先匯出成什麼。 |
| **拼音首字母自己列表，不裝 pinyin 套件** | 不加 runtime 依賴是硬性紀律。只需要選單會出現的那些字（`lib/pinyin.ts`），而且有一條測試掃描所有中文標籤，缺字會當場紅。查不到的字一律回空字串，**絕不猜**。 |
| **「建議」分組用 localStorage 記最近使用** | Notion 的「建議」是 MRU。純資料表（測試對照的那份）維持靜態的 4 項，MRU 只在 UI 層重排同一組內的順序，所以測試不會因為使用行為而飄。 |
| **`按鈕` 的樣板用「一行一個區塊」的 markdown 前綴語法** | 做一個巢狀 block 編輯器要再寫一個小編輯器。前綴語法（`#`、`-`、`[]`、`>`、`"`）使用者本來就熟，`parseTemplate` / `templateToText` 是純函式、好測。 |
| **同步區塊的引用端是唯讀投影** | 真正的「兩邊都能編輯、即時同步」需要 OT 層支援跨 block 的鏡像（M6 之後）。目前引用端顯示原始內容（同頁直接讀 doc，跨頁抓 snapshot）＋「前往原始區塊」，資料層用 `props.syncedFrom` 先定好，之後升級不用改資料。 |
| **少於 2 欄的 `columnList` 自動解散** | Notion 的行為。實作成純函式 `dissolveThinColumnsOps(doc)`（吃 doc 吐 ops），在 Editor 的 effect 裡跑，不會遞迴也測得動。 |
| **`/` 選單的行為測試放在 e2e 而不是單元測試** | 「選了之後真的會出現那個 block」牽涉 editor-core、React portal、同步層三層。jsdom 測不到 contenteditable 的真實行為，用 Playwright 直接驗 `data-block-type` 最誠實。 |

---

## 5. 與 Notion 還有的差異

| 差異 | 影響 | 備註 |
|---|---|---|
| 「建議」分組的預設 4 項是寫死的 | 第一次使用時與 Notion 當下的 MRU 不同 | 用過之後就會依自己的習慣浮動 |
| 第三方服務用字母 monogram | 沒有品牌 logo | 見 §4 決策 |
| Mermaid 不渲染圖 | 只有語法高亮 | 需要 runtime 套件 |
| 行內方程式插入後不能再點開編輯 | 要刪掉重插 | 繼承自 M2-B 的已知限制 |
| 「日期或提醒」只插日期 | 沒有提醒通知 | 通知排程是 M5 |
| 14 個佔位項目 | 選單上標「即將推出」 | 見 §2 覆蓋表 |
| 新的 5 個 block type 在舊後端會被退回 | 需要部署 0040 | 見 §3 部署注意 |

---

## 6. 怎麼驗

```bash
# 單元：指令表逐項對照 _slash-menu-full.json（164 項）
pnpm --filter @kennote/web test -- src/features/editor/__tests__/slash.test.ts

# e2e：每一項選下去真的產生對應 block
cd apps/web && VITE_PROXY_TARGET=<server> VITE_EDITOR_HTTP_TRANSPORT=1 npx vite --port 5174
cd e2e && BASE_URL=http://localhost:5174 STUB_TX=1 npx playwright test slash-behaviour.spec.ts

# 截圖（輸出到 reference/shots/kennote/slash/，與 reference/notion-capture/06*.png 並排看）
cd e2e && BASE_URL=http://localhost:5174 STUB_TX=1 npx playwright test slash-menu.spec.ts
```
