# ADR 0001：承載產品語義的核心一律自研

- 日期：2026-09-19
- 狀態：已採納
- 權威來源：`spec/00-README.md` 決策 #1–#3、`spec/04-技術架構與建構計畫.md` §1

## 情境

kennote 要做的是「一個自己能一直改的 Notion」，不是「最快做出一個 Notion」。
市面上的做法是拼裝現成套件：ProseMirror / TipTap 當編輯器、Yjs 當同步、dnd-kit 當拖放、
Radix 當 UI、TanStack Table 當資料庫視圖。這條路 M1–M4 只要約 80 點（5–6 個月），
但代價是：

- 每個套件都是黑箱。想改一個行為，要先讀完它的內部模型。
- 產品語義被套件的抽象綁架。「三年後我想改它的行為，改得動嗎？」答案常常是「改不動」。
- 套件棄養（`react-beautiful-dnd` 已經發生過）時，整塊功能要重寫。

## 決策

**承載產品語義的一律自研；語言／協定／工具鏈／密碼學用現成的。**

判斷準則就是那句話：**「三年後我想改它的行為，改得動嗎？」** 改得動就用現成，改不動就自己寫。

### 必須自研（🔴）

區塊編輯器與 contenteditable 層、rich text 模型、selection／caret 對映、IME 管線、
undo/redo、即時同步引擎、全文搜尋與中文斷詞、database 查詢引擎、公式引擎、權限引擎、
拖放引擎、浮層定位引擎、虛擬捲動、UI primitives、程式碼 tokenizer、Markdown 解析器、
fractional indexing。

### 直接用（🟢）

React 18 + React Router、Fastify 5、`pg` driver、PostgreSQL 16+、Vite / TypeScript /
ESLint / Vitest / Playwright、`argon2` + `jsonwebtoken`（**密碼學絕不自研**）、`zod`、
`pino`、`dompurify`。

### 本次（M1）落實的具體選擇

| 項目 | 選擇 | 理由 |
|---|---|---|
| 後端框架 | Fastify 5 | 極薄、原生 TS、plugin 封裝是天然模組邊界（04 §5.1） |
| 資料存取 | `pg` + 手寫 SQL + 自製 migration runner | database 引擎的動態查詢本來就得手組 SQL，不用 ORM（04 §5.2） |
| 驗證 | `zod` | 前後端同一套 schema 心智模型；不自研（工具鏈） |
| 密碼 | `argon2`（argon2id） | 密碼學絕不自研。Windows 與 alpine 都有 prebuilt binary |
| 狀態管理 | 自研 `createStore`（`useSyncExternalStore`，約 60 行） | zustand / redux 在黑名單；React 18 已內建正確的訂閱原語 |
| 資料抓取 | 自研 `useQuery`（約 250 行） | react-query / swr 在黑名單；我們只需要快取 + 去重 + invalidate |
| 拖放 / 浮層 / 虛擬捲動 | 尚未實作，之後自研（M3 / M4） | `@dnd-kit`、`@floating-ui`、`@tanstack/react-virtual` 全在黑名單 |
| 樣式 | 原生 CSS 變數 + CSS Modules | 見 ADR 0002「樣式系統」一節 |

### 紀律的可執行化

光寫在文件裡的紀律會在趕工的半夜被破壞，所以寫成程式：

`scripts/check-deps.ts` 在 CI 擋下三件事：

1. 全專案不得出現黑名單套件（編輯器、CRDT、拖放、UI 元件庫、狀態管理、資料抓取、
   ORM、外部搜尋服務…）
2. `packages/editor-core` 的 `dependencies` 必須是 `{}`
3. `apps/web` 的 runtime dependencies 不得超過 8 個（目前 6 個）

> 要引入黑名單上的套件，流程是：先寫一篇 ADR 說明為什麼，再把它從黑名單移除。
> 這個摩擦力是刻意設計的。

## 理由

1. **零黑箱。** `console.log(sql)` 就是最終真相；WS DevTools 分頁一眼看懂每一則訊息。
2. **完全可客製。** 產品語義的每一個決定都在我們自己的程式碼裡。
3. **不受棄養影響。** 依賴數量本身就是健康指標（04 §9.6），`deps:check` 會盯著它。
4. **風險是可控且已知的。** 最高風險集中在編輯器核心（contenteditable / IME），
   04 §11.2 已經備好退場方案（editor-core 內部局部引入 ProseMirror 當 view 層，
   保留自己的 model 與 operation 設計）。

## 後果

### 正面

- M1 的後端沒有任何 ORM、沒有任何 middleware 魔法；整條請求路徑可以一路讀到底。
- `packages/shared-types` 是前後端唯一契約，改 API schema 時前端立刻標紅。
- `applyTransaction()` 是所有 block 變更的唯一入口，M6 的 OT 不需要重寫編輯器。

### 負面

- 工時約 +49%（MVP 從 5–6 個月變成 9–13 個月）。
- 技術風險高度集中在編輯器核心，且該風險只在真實輸入法下才會暴露。
- 很多「別人早就做好的小工具」要自己寫（fractional index、uuidv7、magic number 偵測…）。
  M1 已經寫掉其中一批，並且**每一支都有單元測試**。

### 需要持續盯的指標

- `apps/web` runtime 依賴數量（上限 8，目前 6）
- `packages/editor-core` 的 `dependencies`（必須恆為 `{}`）
- 全專案黑名單命中數（必須恆為 0）
