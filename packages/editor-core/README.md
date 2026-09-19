# @kennote/editor-core

kennote 的 block 編輯器引擎：**零 runtime 依賴、框架無關的 vanilla TypeScript**。

React（或任何框架）只是渲染宿主：它提供一個空的 `<div>`，其餘由 editor-core 用原生 DOM API 管理。
`package.json` 的 `dependencies` 永遠是 `{}` —— 這行就是紀律。

對應規格：`spec/04-技術架構與建構計畫.md` §3.5 / §4 / §8（M2-A）、`spec/02-UI架構.md` §4.0 / §4.1。

---

## 1. 架構

```
                    ┌──────────────────────────────────────────┐
  宿主（React）─────▶│  Editor（src/core.ts）                   │
   container: div    │  唯一的公開門面                           │
   events: on(...)   └───────────────┬──────────────────────────┘
                                     │
   ┌─────────────────────────────────┼─────────────────────────────────┐
   │                                 │                                 │
┌──▼───────────┐  ┌──────────────┐ ┌─▼────────────┐ ┌──────────────┐ ┌─▼─────────────┐
│ model/       │  │ text/        │ │ transaction/ │ │ selection/   │ │ view/         │
│ 純資料       │  │ 8 個純函式   │ │ 唯一變更入口 │ │ DOM ↔ model  │ │ 增量渲染      │
│ Block / Doc  │◀─│ normalize    │ │ applyOps     │ │ dom-mapper   │ │ dom-view      │
│ 樹操作       │  │ slice/insert │ │ invertOps    │ │ manager      │ │ block-view    │
│              │  │ toggleMark   │ │ Transaction  │ │ block-select │ │ freeze()      │
│              │  │ grapheme     │ │ Tx.* builders│ │ caret        │ │               │
└──────────────┘  └──────────────┘ └──────┬───────┘ └──────┬───────┘ └───────┬───────┘
                                          │                │                 │
        ┌─────────────────────────────────┼────────────────┴─────────────────┤
        │                                 │                                  │
   ┌────▼─────────┐  ┌──────────────┐ ┌───▼──────────┐ ┌──────────────┐ ┌────▼────────┐
   │ input/       │  │ history/     │ │ clipboard/   │ │ plugins/     │ │ ot/         │
   │ before-input │  │ HistoryStack │ │ serialize    │ │ BlockRegistry│ │ 型別骨架    │
   │ composition  │  │ coalesce     │ │ parse-html   │ │ EditorPlugin │ │ （M6 實作） │
   │ keymap       │  │              │ │ parse-md     │ │              │ │             │
   │ input-rules  │  │              │ │ clipboard    │ │              │ │             │
   │ mutation-... │  │              │ │              │ │              │ │             │
   └──────────────┘  └──────────────┘ └──────────────┘ └──────────────┘ └─────────────┘
```

### 兩條核心原則

1. **Model 是唯一真相，DOM 是投影。** 永遠不讀 `innerHTML` 當資料。
   唯一的例外是 IME 組字結束時（見下），那是規格允許的「Reconcile-After」。
2. **所有變更都經過 `editor.applyTransaction()`。** 沒有任何路徑可以偷改 doc，
   所以 undo、協作同步、對帳只有一個接點。

### contenteditable 策略（04 §4.1 路線 C）

- 每個文字 block 一個獨立的 `contenteditable="true"`（重繪與 selection 的影響範圍限在單一 block）。
- 非文字 block 天然不是 editable，沒有「挖洞」問題。
- 跨 block 選取不做精細的部分文字選取，而是切到 **Block Selection 模式**（整塊反白，對齊 Notion）。

---

## 2. 事件流

### 一般輸入（Control-First）

```
使用者按鍵
  └─ beforeinput（原生事件，不經框架合成事件層）
       └─ input/before-input.ts 依 inputType 分派 → preventDefault()
            └─ input/commands.ts 算出新 model
                 └─ transaction/builders.ts 產生 Operation[]
                      └─ editor.applyTransaction()
                           ├─ transaction/apply.ts（純函式、原子性）→ 新 doc
                           ├─ view.updateBlock()（key 化增量渲染，不重建節點）
                           ├─ selection.write()（存 → 改 → 還原三步走）
                           ├─ history.record()（同一句話合併成一筆 undo）
                           ├─ emit('transaction')
                           └─ emit('localOps')  ← 同步層的出口
```

### IME 組字（Reconcile-After）

```
compositionstart
  ├─ isComposing = true
  ├─ 記錄組字前的 content 快照
  └─ view.freeze(blockId)   ← 最重要的一行：期間任何 model 變更都不得碰這個 block 的 DOM
compositionupdate
  └─ 什麼都不做（讀 DOM / 改 model / 動 selection 都會讓候選字視窗錯位或組字中斷）
compositionend
  └─ requestAnimationFrame（Safari 此刻 DOM/selection 尚未穩定）
       ├─ domToRichText() 從 DOM 讀回真實內容
       ├─ view.unfreeze()
       ├─ dispatch({ skipRender: true, source: 'ime' })   ← DOM 已經對了，不重繪
       └─ flushRemoteQueue()   ← 組字期間排隊的協作變更，現在才套用
```

期間：不套 markdown 捷徑、不觸發 slash menu、不處理 `selectionchange`、不 emit `localOps`。

### 安全網

`MutationObserver` 監看整棵編輯區。我們自己造成的變更會在同一個同步任務內用
`takeRecords()` 丟掉，所以**正常操作下觸發次數應為 0**。一旦觸發代表輸入管線有漏洞：
會 emit `reconcile` 事件（開發期請當成錯誤看待），並把 model 對帳到 DOM 的現況。

---

## 3. 宿主整合（React，約 20 行）

```tsx
import { useLayoutEffect, useRef } from 'react';
import { createEditor, type Editor, type EditorDoc } from '@kennote/editor-core';
import '@kennote/editor-core/styles.css';

export function KennoteEditor({ doc, onLocalOps }: { doc: EditorDoc; onLocalOps(ops: unknown[]): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);

  useLayoutEffect(() => {
    const editor = createEditor({ container: ref.current!, doc });
    editorRef.current = editor;
    const off = editor.on('localOps', onLocalOps);
    return () => { off(); editor.destroy(); };   // ⭐ 必須有 cleanup，否則 StrictMode 會掛載兩次
  }, []);                                        // ⭐ 空依賴：container 是框架禁區，只掛載一次

  // ⭐ 永遠回傳同一棵（空的）JSX，React 的 diff 進不去子樹
  return <div ref={ref} className="kn-editor-host" />;
}
```

其餘宿主工作：

- **Slash menu**：監聽 `slashTrigger`（帶 `query` 與 `rect`）畫選單，使用者選定後呼叫
  `editor.setBlockType(...)` 或 `editor.insertBlockAfter(...)`。`editor.registry.search(query)` 直接給你選項（中英文關鍵字）。
- **浮動工具列**：監聽 `selectionChange`，用 `editor.getSelectionRect()` 定位，
  用 `editor.getActiveMarks()` 決定按鈕 active 狀態，點擊時呼叫 `editor.toggleMark(...)`。
- **協作**：`editor.on('localOps', ops => sync.submit(ops))` 與 `sync.onRemote(ops => editor.applyRemote(ops))`。

`playground/main.js` 是一份完整可跑的宿主範例（含 slash menu）。

---

## 4. 公開 API

```ts
const editor = createEditor({
  container,            // HTMLElement，唯一必填
  doc?,                 // EditorDoc；省略時會建立一個空段落
  blockRegistry?,       // BlockRegistry；省略時用 createDefaultRegistry()
  plugins?, editable?, history?, inline?,
  newId?, now?,         // 可注入假 id / 假時鐘（測試用）
});
```

| 方法 | 說明 |
|---|---|
| `getDoc()` / `getBlock(id)` | 唯讀取得目前文件狀態 |
| `applyTransaction(tx)` | **唯一的變更入口**；不合法的批次整批不套用 |
| `dispatch({ ops, selectionAfter?, kind?, source? })` | 從 ops 建 transaction 並套用 |
| `applyRemote(ops)` | 套用遠端 ops：不進 undo stack、不 emit `localOps`；IME 組字中會排隊 |
| `undo()` / `redo()` | 自建 command stack（連續輸入合併） |
| `focusBlock(id, offset?)` | 把游標放進某個 block |
| `getSelection()` / `setSelection(sel)` | model selection（`text` / `block` / `none`） |
| `getSelectionRect()` | 浮動工具列定位用的 `DOMRect` |
| `getActiveMarks()` | 選取範圍共同擁有的 marks |
| `toggleMark(mark)` | 對選取範圍 toggle 格式 |
| `setBlockType(ids, type, props?)` | 轉換 block 型別 |
| `insertBlockAfter(afterId, opts?)` | 插入新 block，回傳新 id |
| `deleteBlocks(ids)` / `moveBlock(id, parentId, afterId)` | 結構操作 |
| `getSelectedFragment()` / `insertFragment(fragment)` | 剪貼簿片段 |
| `on(event, cb)` → `() => void` | 訂閱事件，回傳 unsubscribe |
| `destroy()` | 卸載並清除所有監聽 |

事件：`transaction`、`localOps`、`selectionChange`、`compositionChange`、`slashTrigger`、
`mentionTrigger`、`blockMenu`、`reconcile`。

除了門面之外，所有純函式（`normalize` / `slice` / `insertText` / `deleteRange` / `toggleMark` /
`marksAt` / `length` / `toPlainText`、`applyOps` / `invertOps`、`domToModel` / `modelToDom`、
HTML 與 Markdown 解析器…）都從 package 根 export，可單獨使用與測試。

---

## 5. 開發

```bash
pnpm --filter @kennote/editor-core typecheck
pnpm --filter @kennote/editor-core test
pnpm --filter @kennote/editor-core build
pnpm --filter @kennote/editor-core playground   # http://localhost:5174/playground/
```

> playground 只用 Node 內建模組 + tsc，不需要 vite/esbuild。
> **中文輸入法必須在這裡實測**：macOS 注音、Windows 微軟注音、Android GBoard 各一次。

測試分三層：純函式單元測試、fast-check property test（每條 1000 次）、jsdom 下的 DOM 與端到端測試。

---

## 6. 決策（為什麼這樣做）

| 決策 | 理由 |
|---|---|
| **在 editor-core 內自己定義一份資料模型**，不 import `@kennote/shared-types` | 保持零依賴與可獨立發布。型別與 shared-types 的契約逐欄位對齊，改動時兩邊必須同步（見 `src/model/types.ts` 開頭的註記）。 |
| **扁平 inline span 陣列**，不用樹狀 marks | 套用格式 = 切割 + 重貼 marks + 合併相鄰同格式，約 150 行；樹狀模型要處理節點分裂/合併/巢狀正規化。 |
| **每個 inline node 渲染成剛好一個元素 + 一個文字節點**（marks 用 class / style，不用巢狀標籤） | 讓 `domToModel` / `modelToDom` 保持簡單且可窮舉測試。對外的語義化 HTML 由 `clipboard/serialize.ts` 另外產生。 |
| **`data-marks` 屬性存 marks 的 JSON** | IME 與 MutationObserver 對帳時可以無損讀回格式；瀏覽器自己塞的節點則退回用標籤名推導。 |
| **未知的 `inputType` 一律 `preventDefault()`** 並 emit `reconcile` | 遵循 02 §4.0.3（比 04 §4.4.1 的「放行」保守）。model 保持唯一真相，同時讓漏掉的 inputType 在開發期立刻現形。 |
| **Undo coalescing 視窗 1000ms** | 規格裡 04 §4.5.2 寫 600ms、02 §4.0.5 寫 800ms，M2-A 驗收標準寫「停頓 1 秒」。以驗收標準為準，值集中在 `history/coalesce.ts` 的 `COALESCE_WINDOW_MS`。 |
| **貼上時第一段是否併進目前 block，取決於它的型別** | 第一段是普通段落 → 併入（多段文字接在游標處）；第一段是標題/清單/程式碼 → 另開新 block，否則型別資訊會被吃掉。 |
| **不引入 DOMPurify** | editor-core 是零依賴 package。改用**白名單式解析**：只讀我們認得的標籤與屬性，來源 HTML 從不放回 DOM；所有 `href` 過 `safeUrl()`（只允許 http/https/mailto/tel/相對路徑）。應用層若要額外 sanitize，可在宿主端加。 |
| **協作 undo 用保守做法** | 收到影響 undo stack 的遠端 ops 時丟掉受影響的紀錄（M1–M5）。M6 導入 OT 後改成正式 transform，介面已預留在 `src/ot/`。 |
| **`text.delta` 型別先定、apply 先實作、transform 留空** | 讓 M6 的接點明確，但現在不寫沒被驗證的 OT 演算法。 |
| **playground 不用 vite** | 連手測頁都不需要打包器，證明 `dist/` 是可直接被瀏覽器 import 的原生 ESM。 |

---

## 7. 已知限制 / 尚未實作

### Block 型別

- 已實作（可編輯）：`paragraph`、`heading1-3`、`bulletedList`、`numberedList`、`todo`、
  `toggle`、`quote`、`callout`、`divider`、`code`。
- 註冊為**不可編輯的佔位 renderer**：`image`、`file`、`bookmark`、`video`、`embed`、`equation`、
  `tableOfContents`、`page`、`columnList`、`column`、`table`、`tableRow`、`collectionView`。
  它們可以被選取、刪除、搬移、序列化，但不能編輯內容（M2-B 之後逐一補上）。
- `toggle` 的收合目前只反映在 DOM 屬性與 CSS；真正的「收合時不渲染子樹」留給宿主的虛擬化決定。

### 輸入 / 快捷鍵

- **已處理的 inputType**：`insertText`、`insertReplacementText`、`insertParagraph`、`insertLineBreak`、
  `deleteContentBackward/Forward`、`deleteWordBackward/Forward`、`deleteSoftLineBackward/Forward`、
  `deleteHardLineBackward/Forward`、`deleteByCut`、`insertFromPaste`、`insertFromDrop`、
  `formatBold/Italic/Underline/StrikeThrough/Code`、`historyUndo/Redo`。
- **未處理（會被 preventDefault 並回報 reconcile）**：`insertOrderedList`、`insertUnorderedList`、
  `formatIndent/Outdent`、`formatJustify*`、`formatFontColor`、`insertLink`、`insertHorizontalRule`、
  `insertTranspose` 等瀏覽器選單觸發的 rich-text 指令。需要時在 `before-input.ts` 補 case。
- **未實作的快捷鍵**：`Cmd+K`（連結 / 快速尋找）、`Cmd+Shift+1~9`（快速轉型別）、
  `Cmd+Enter`（型別相依動作）、`Cmd+D`（複製一份）、`Cmd+\`、`Cmd+P` ——
  這些都牽涉宿主 UI（浮層、面板），由宿主註冊 plugin 的 `onKeyDown` 接手較合理。
- `Cmd/Ctrl+A` 目前是兩段式（全選 block 內文 → 整頁 block selection），規格的三段式
  （當前層級）尚未實作。

### 選取 / 導航

- 跨 block 的「部分文字選取」不支援（產品決策：改用 Block Selection 整塊反白）。
- 上下鍵的 goal column 依賴 `caretPositionFromPoint`；jsdom 沒有這個 API，所以單元測試走的是
  「退回首尾」的 fallback 路徑，真實水平位置保持只能在瀏覽器實測。
- 拖曳框選（在 block 外緣拉出選取框）尚未實作；目前只有「拖過 block 邊界自動切換成整塊選取」。

### 剪貼簿

- **貼上圖片/檔案不在 editor-core 處理**：本 package 不知道後端存在、不呼叫 `fetch`。
  宿主自行監聽 `paste` 的 `dataTransfer.files` 走上傳流程。
- Markdown 解析器只支援我們自己的子集：不支援 `***粗斜體***`（三連星號）、表格語法、
  註腳、參考式連結、HTML 內嵌。
- HTML 貼上時，`<table>` 會降級成「每列一個段落，儲存格用 `|` 分隔」（table block 尚未實作）。
- Word 的 `mso-list` 階層資訊未解析，深層巢狀清單可能被攤平成同一層。

### 其他

- `ot/transform.ts` 尚未實作（M6）。`applyRemote` 目前的 selection rebase 只處理
  「同一個 block 內的文字變更」，那是協作時 99% 的情況。
- 沒有虛擬化：500+ block 的頁面效能尚未驗證（M2-B 的驗收項目）。
- 沒有 `readonly` 模式的完整驗證（`editable: false` 只讓 contenteditable 不掛上去）。
