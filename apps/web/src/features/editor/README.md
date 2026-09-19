# features/editor —— 編輯器宿主層（M2-B 前端）

> `packages/editor-core` 是**引擎**（零依賴 vanilla TS，管 contenteditable / 選取 / transaction / undo）。
> 這個資料夾是**宿主**：把引擎接上 React、接上後端、補上所有 Notion 式的 UI。
>
> 對應規格：02 §3.4（Editor 分支）、§4.1（Block 編輯互動）、§4.4（Modal/Popover）；
> 01 §4.3–4.7；04 §8 M2-B、§10.1（Block Type Registry）。

---

## 1. 三十秒版本

```tsx
import { Editor } from './features/editor/Editor';
import { PageHeader } from './features/editor/PageHeader';

<PageHeader page={page} workspaceId={workspaceId} onLeaveTitle={focusFirstBlock} />
<Editor
  key={page.id}
  pageId={page.id}
  workspaceId={workspaceId}
  snapshot={snapshot.data}
  onNavigateToPage={(id) => navigate(`/page/${id}`)}
  onTransportState={setTransportState}   // 「儲存中 / 已儲存」用
/>
```

其餘全部自動：slash menu、bubble menu、block handle、拖曳、貼上圖片、快捷鍵、同步。

---

## 2. 架構

```
                         ┌───────────────────────────────────────────┐
  PageRoute ────────────▶│ Editor.tsx（唯一協調者，不畫 block 樣式） │
                         └──────────────┬────────────────────────────┘
                                        │
     ┌──────────────────────────────────┼──────────────────────────────────┐
     │                                  │                                  │
┌────▼─────────────┐   ┌────────────────▼──────────┐   ┌──────────────────▼────────┐
│ useEditorHost.ts │   │ blocks/                   │   │ menus/ · dnd/ · keyboard/ │
│ snapshot→doc     │   │  registry.ts   前端 spec  │   │  SlashMenu / BubbleMenu   │
│ createEditor     │   │  hostRegistry  縫 core    │   │  BlockHandle / BlockMenu  │
│ localOps→同步層  │   │  BlockPortals  React 掛載 │   │  MentionMenu / useBlockDrag│
│ 遠端 ops→core    │   │  externalReg.  給 database│   │  hostKeymap               │
└────┬─────────────┘   └───────────────────────────┘   └───────────────────────────┘
     │
┌────▼──────────────────────────────────────────────────────────────────────┐
│ stores/sync.ts → lib/sync-client.ts（WS + 離線佇列）                       │
│ 後備：transport.ts（純 HTTP，debounce 300ms + rollback）                   │
└───────────────────────────────────────────────────────────────────────────┘
```

### 兩條紅線

1. **React 的 diff 不准進 contenteditable 子樹。** `<div className="kn-editor-host" />`
   永遠是同一個空 div；裡面的一切由 editor-core 用原生 DOM 管理。
   React 只透過 `createPortal` 掛進 editor-core 給的**不可編輯容器**。
2. **所有資料變更只能走 Operation。** renderer 拿到的是 `host.updateProps()` /
   `host.applyOps()` 之類的方法，每一個都落成 `editor.applyTransaction()`。
   沒有任何 renderer 可以直接改 DOM，也沒有任何 renderer 可以直接打寫入 API
   （上傳是唯一例外，而且要走 `host.upload()`）。

---

## 3. 檔案地圖

| 路徑 | 內容 |
|---|---|
| `Editor.tsx` | 協調者：浮層狀態、slash 指令執行、貼上/拖放檔案、右鍵、`[[` 偵測 |
| `useEditorHost.ts` | 生命週期：snapshot → doc → `createEditor`、localOps → 同步層、flush、host API |
| `context.ts` | `EditorHostApi`（renderer 唯一能碰的東西）+ `BlockRendererProps` |
| `transport.ts` | HTTP 後備通道：debounce 打包、序列化送出、重試、rollback |
| `PageHeader.tsx` | 封面 / 圖示 / 標題（自給自足，shell 可直接搬走） |
| `blocks/registry.ts` | **前端 Block Type Registry**（名稱、關鍵字、icon、分組、React renderer） |
| `blocks/hostRegistry.ts` | 把前端 spec 縫到 editor-core 的 `BlockRegistry` 上 |
| `blocks/BlockPortals.tsx` | 把 React renderer portal 進 editor-core 的容器 |
| `blocks/externalRegistry.ts` | 給 `features/database` 的 runtime 擴充點 |
| `blocks/uploadStatus.ts` | 上傳進度的本機 store（不進 model、不進同步） |
| `renderers/MediaBlocks.tsx` | image / video / file / embed / bookmark |
| `renderers/AdvancedBlocks.tsx` | audio / pdf / breadcrumb / button / syncedBlock |
| `renderers/StructureBlocks.tsx` | page / column / table / toc / equation / collectionView |
| `renderers/CodeChrome.tsx` | 語言選單、複製、行號、語法高亮層 |
| `menus/SlashMenu.tsx` | `/` 指令選單（分組 sticky、過濾攤平、鍵盤導覽、最近使用） |
| `menus/slashCommands.ts` | **Notion 7.34 的 164 項指令表**（分組 / 順序 / 文案照抄，見 `SLASH-MENU.md`） |
| `menus/PickerPopover.tsx` | 「連結到頁面」「資料來源的連結瀏覽模式」的頁面 / 資料庫選擇器 |
| `lib/slash-actions.ts` | 指令的實作：多欄、表格、建資料庫、匯入、複製 / 刪除 |
| `lib/embed-services.ts` | 嵌入的 52 個服務表 + 匯入的 11 個來源表 |
| `lib/pinyin.ts` | 拼音首字母（`/csm` = 程式碼），自己列表不裝套件 |
| `menus/BubbleMenu.tsx` | 選取文字後的格式工具列 + 連結輸入 |
| `menus/BlockHandle.tsx` | 單一 gutter 實例（`+` 與 `⠿`） |
| `menus/BlockMenu.tsx` | 轉換成 / 顏色 / 複製 / 複製連結 / 移動到 / 刪除 / 留言 |
| `menus/MentionMenu.tsx` | `@` 提及（人員 / 頁面 / 日期）與 `[[` 頁面連結 |
| `dnd/drop-target.ts` | 落點計算（純函式，可單測） |
| `dnd/useBlockDrag.ts` | Pointer Events 拖曳：幽靈元素、指示線、自動捲動、拖成多欄 |
| `keyboard/hostKeymap.ts` | Ctrl+K / Ctrl+Shift+1~9 / Ctrl+Enter / Ctrl+D / Ctrl+Shift+↑↓ / Cmd+A 三段式 |
| `lib/floating.ts` | 自製定位引擎（flip + shift） |
| `lib/highlight.ts` | 自研語法高亮 tokenizer（32 種語言清單，15 種有專屬規則，含 Mermaid） |
| `lib/embed.ts` | 嵌入白名單 + URL 安全檢查 |
| `lib/mathml.ts` | LaTeX 子集 → MathML（不裝 KaTeX） |
| `lib/model-helpers.ts` | 產生 Operation 的小工具（複製子樹、插 atom、搬移…） |
| `ui/` | 本地版 Popover / MenuItem / Toast / Icon（`@kennote/ui` 補齊後可替換） |

---

## 4. 怎麼新增一個 block type

目標：**< 30 分鐘，而且只碰三個地方**。

```
1. packages/shared-types/src/block.ts  →  BLOCK_TYPES 加一個字串 + BlockPropsMap 加一行
2. apps/web/src/features/editor/blocks/registry.ts  →  加一筆 BlockSpec
3. apps/server/.../block-types/  →  註冊 validateProps
```

`BlockSpec` 的欄位：

```ts
{
  type: 'rating',
  label: '評分', labelEn: 'Rating', description: '用星星打分數',
  icon: 'sparkle',                 // ui/icons.tsx 的 IconName
  group: 'advanced',               // slash menu 分組
  keywords: ['rating', 'star', '評分', '星星'],   // ⚠️ 中英文都要有（有測試在擋）
  sortOrder: 330,                  // ⚠️ 不可重複（有測試在擋）
  defaultProps: { value: 0 },
  canHaveChildren: false,
  hasInlineContent: false,
  insertMode: 'insert',            // 'convert' = 轉換目前 block
  convertible: false,              // 是否出現在「轉換成」選單
  Renderer: RatingBlock,           // 要畫東西就給 React 元件
}
```

之後 **slash menu、轉換選單、block handle 的顏色/刪除、剪貼簿、拖放全部自動支援**。

### Renderer 怎麼寫

```tsx
export function RatingBlock({ block, host }: BlockRendererProps) {
  const value = Number(block.props.value ?? 0);
  return (
    <div>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => host.updateProps(block.id, { value: n })}>
          {n <= value ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}
```

規則：
- 只能用 `host.*` 改資料（`updateProps` / `applyOps` / `insertAfter` / `remove` / `move`）。
- 要上傳檔案用 `host.upload(file, onProgress)`，不要自己 `fetch`。
- 需要攔截指標事件時記得 `e.stopPropagation()`，否則 editor-core 會把它當成「點在不可編輯 block 上」而切到 block selection。
- 有 `chromeOnly: true` 時代表 block 仍然可編輯文字，React 只是加周邊 UI（`code` 就是這樣）。

---

## 5. 與其他模組的接點

### 5.1 sync-client（`lib/sync-client.ts` / `stores/sync.ts`）

預設路徑就是它：

```ts
const sync = usePageSync(pageId, {
  getLocalSeq: () => snapshot.seq,
  onRemoteOps: (ops) => editor.applyRemote(ops),
  onRollback: () => reload(),     // 見下方「已知限制」
  onResync: () => reload(),
});
editor.on('localOps', (ops) => sync.submit(ops));
editor.on('selectionChange', (sel) => sync.updatePresence(...));   // 游標 presence
```

`transport.ts` 是**後備**：設環境變數 `VITE_EDITOR_HTTP_TRANSPORT=1` 就改走純 HTTP
（debounce 300ms → `POST /api/pages/:id/transactions`，失敗用 inverse ops rollback）。
WS 不可用的環境（e2e、封閉內網）會用到。它的 `SyncAdapter` 介面是：

```ts
interface SyncAdapter {
  submit(ops: Operation[], meta: { txId; pageId; originSessionId }): Promise<TransactionResult>;
  onRemote?(cb: (ops: Operation[]) => void): () => void;
  destroy?(): void;
}
```

### 5.2 features/database

編輯器**不 import** database 模組（會造成循環依賴與並行開發的 typecheck 衝突）。
改用 runtime 註冊：

```ts
// apps/web/src/features/database/index.ts
import { registerInlineDatabase, registerCreateDatabase } from '../editor/blocks/externalRegistry';

registerInlineDatabase(InlineDatabase);          // (props: InlineDatabaseProps) => JSX
registerCreateDatabase(async ({ workspaceId, parentId }) => {
  const snapshot = await createDatabase({ workspaceId, parentId });
  return { collectionId: snapshot.collection.id, viewIds: snapshot.views.map((v) => v.id) };
});
```

沒註冊時 `collectionView` block 顯示佔位卡，不會壞掉。
`InlineDatabaseProps` = `{ collectionId, viewIds, blockId, onChange(patch) }`。

### 5.3 App shell

- `PageHeader` 只需要 `page` 與 `workspaceId`，可以整個搬到 shell 的版面裡。
- `Editor` 的 `onTransportState` 會回報 `{ status, pending, seq, lastError }`，
  shell 可以拿去畫「儲存中 / 已儲存 / 離線」。
- 側邊欄要「捲到某個 block」時，用 `[data-block-id="…"]` 找元素即可。

---

## 6. 決策（為什麼這樣做）

| 決策 | 理由 |
|---|---|
| **React 只畫「不可編輯的葉子」，用 portal 掛進 editor-core 的容器** | contenteditable 必須有唯一擁有者。讓 React reconcile 進去 → 每次重繪 caret 都會消失。portal 的容器節點由 editor-core 保證穩定（所有 `update()` 都回 `true`），所以 React 狀態（上傳進度、選單開關）不會被打斷。 |
| **維持兩份 registry**（editor-core 一份、前端一份） | editor-core 必須零依賴、不認識 React。前端這份只放 UI 知識（中文名、icon、React renderer），`hostRegistry.ts` 是唯一的縫合點；要換框架只要重寫那一支。 |
| **編號清單的序號用 CSS counter 算** | 01 §4.4 M3.4.4 明寫「序號由前端依同層順序計算，不要存在資料裡」。CSS counter 天然支援巢狀與「被其他型別打斷就重編號」，零 JS 成本。 |
| **程式碼高亮用「底下疊一層」而不是改 editor-core 的 inline 渲染** | 改 inline 渲染會讓 `domToModel` / `modelToDom` 的 DOM 契約變複雜（那是 IME 與對帳的命脈）。疊層方案讓 editor-core 的 DOM 完全不變，高亮層只是 `aria-hidden` 的視覺副本。 |
| **語法高亮只做詞法層、且不進 Web Worker** | 02 §8.5 要求「只做詞法層」。Worker 在 M2-B 還不划算（tokenize 一個 200 行的片段 < 1ms），規格提到的 Worker 化留到效能真的成為問題時；tokenizer 是純函式，搬進 Worker 不用改呼叫端。 |
| **公式用自寫的 LaTeX 子集 → MathML，不裝 KaTeX** | 不加 runtime 套件是硬性紀律。子集涵蓋上下標 / `\frac` / `\sqrt` / 希臘字母 / 常見運算子；**看不懂的語法一律回 `null` 並原樣顯示 `$…$`**，絕不猜測、絕不吞掉使用者的內容。 |
| **MathML 用 `innerHTML` 注入** | React 18 不支援 MathML 標籤（會用 `createElement` 建成 HTML 元素，瀏覽器不會當數學排版）。注入的字串是我們自己組的、所有文字都經過 escape，沒有任何外部 HTML 進入 DOM。 |
| **table 的儲存格用獨立的 contenteditable，不走 editor-core** | editor-core 的模型是「一個 block 一個 contentEditable」，表格儲存格是 `tableRow.props.cells`（RichText[]），塞不進那個模型。代價：儲存格只支援純文字（02 §3.4 允許「純文字或簡易 inline marks」）。MutationObserver 不會誤判，因為這些節點不在 `[data-block-content]` 裡。 |
| **columnList / column 的版面用 CSS，children 仍由 editor-core 遞迴渲染** | 欄位裡面的東西必須是「正常的可編輯 block」。只有欄寬把手是 React。欄寬存在 `props.ratio`，視覺透過 `--kn-column-ratio` CSS 變數。 |
| **bookmark 只顯示 URL 與網域** | 02 §3.4 明寫「前端**絕不**直接 fetch 外部網址」（SSRF）。`props.meta` 的欄位已經留好，後端 `GET /api/unfurl` 上線後會自動顯示標題/描述/縮圖，前端一行都不用改。 |
| **embed 走白名單 + `sandbox` 且不給 `allow-same-origin`** | 給了 same-origin 等於把我們的 storage/cookie 交給第三方頁面。白名單外一律降級成連結卡。 |
| **封面位置存成 URL fragment（`…#y=42`）** | `Page.cover` 只有一個字串欄位。加欄位要動 DB migration 與後端契約，跨代理成本太高；fragment 對後端完全透明，之後要正規化也只要改 `parseCover()`。 |
| **標題走 `PATCH /api/pages/:id` 而不是 `page.update` op** | `page.update` 是給協作廣播用的。M2-B 的標題只有單人編輯情境，REST + 去抖 500ms 最單純；要升級時把 `patch()` 換成 `sync.submit([{ type:'page.update', ... }])` 即可。 |
| **上傳進度放在獨立的小 store，不放 `block.props`** | 進度是本機 UI 狀態。放進 props 會進 undo stack、會被同步給協作者、會寫進資料庫。 |
| **自己寫 Popover / Toast / Icon / 定位引擎** | `packages/ui` 的對應元件由 UI 代理並行開發中，寫這一版時還沒 export。介面刻意對齊 02 §4.4 / §4.5，等它 export 之後改 import 即可（`ui/overlay.tsx`、`ui/toast.tsx`、`ui/icons.tsx`、`lib/floating.ts`、`dnd/drop-target.ts` 這五支是替換點）。 |
| **`features/database` 用 runtime 註冊而不是 import** | 並行開發時直接 import 一個還不存在的模組會讓整個 typecheck 掛掉。註冊表讓兩邊完全解耦。 |
| **rollback 在 WS 路徑改成「重抓 snapshot」** | `sync-client` 的 `onRollback` 只給被拒絕的 ops，沒有 inverse（inverse 只存在 editor-core 的 transaction 裡）。伺服器拒絕本來就代表有 bug，以伺服器為準重載是最保險的復原，也讓問題立刻現形。HTTP 後備路徑仍然是精準的 inverse rollback。 |
| **`/` 的觸發與 query 由宿主自己算，不用 editor-core 的 triggers** | `input/triggers.ts` 的 `/` 前面必須是空白、query 有空白就關——兩條都和 Notion 不同，會讓 `/標題 1`、`/2 欄`、`/Google Drive` 打不完。那支檔案屬於 OT 代理，所以宿主沿用 `[[` 的做法自己聽 transaction（`Editor.tsx` 的 `recomputeSlash`）。 |
| **`/` 選單的鍵盤事件掛在 `document` 的 capture 階段** | editor-core 在 trigger 開啟時會主動放行 ↑↓/Enter/Tab 給宿主，但事件仍會冒泡到編輯區。capture 讓選單先吃掉並 `stopPropagation()`。 |

---

## 7. 已知限制 / 尚未實作

### Block 型別
- **synced block 只有單向**：原始區塊可編輯，引用端是唯讀投影（見 `SLASH-MENU.md` §4）。
- **table**：儲存格只有純文字（無 inline marks、無合併儲存格、無欄寬拖曳）；
  欄的增刪只能從尾端；沒有「插入到第 N 欄」。
- **equation**：只支援 LaTeX 子集（見 `lib/mathml.ts` 開頭）。矩陣、對齊環境、
  `\begin{}` 系列一律原樣顯示。**行內公式插入後不能再點擊編輯**（要刪掉重插）。
- **bookmark**：沒有 server unfurl 之前只顯示 URL 與網域。
- **video**：自家上傳的影片直接 `<video>` 播，沒有轉檔、沒有縮圖。
- **heading 可收合已實作**：`props.toggleable` + `props.collapsed`，收合的是它的子區塊
  （與 Notion 的資料模型一致）。箭頭用 `data-heading-toggle`，理由見 `SLASH-MENU.md` §4。
- **toggle 的收合狀態存在 `props.collapsed`（會同步）**，規格建議存 localStorage；
  改成本機狀態要等 editor-core 提供「本機 props」的概念。

### 互動
- **拖曳框選**（在 block 外緣拉出選取框）未實作，editor-core 也還沒有。
- **觸控：長按已實作，拖曳搬移還沒有替代路徑。**
  `menus/BlockHandle.tsx` 只在 `event.pointerType === 'touch'` 掛長按 →
  開 bottom sheet 版的 block 選單（QA 第五輪 BUG-25），桌機滑鼠路徑一個位元都沒動。
  但**一般 block 的拖曳搬移在觸控裝置上仍然沒有替代路徑**
  （資料庫表格列另外做了最小版，見 `functional-round6.md` BUG-34）。
  → [`docs/qa/README.md`](../../../../../docs/qa/README.md) §2 D 的 O-15。
- ~~**「移動到…」只跳 toast**~~ **第十一輪已接**：
  `POST /api/pages/:id/blocks/move-to`（`modules/blocks/move-to.ts`，**需部署**）。
  協定上仍然沒有「改 block 的 pageId」這個 op —— 端點做的是
  **來源頁 `block.delete` + 目標頁 `block.insert`，同一個資料庫交易、id 不換**。
  id 不換是核心：comment mark / `#blockId` 深連結 / `files.page_id` 全部認 id。
  細節見 `docs/qa/functional-round11.md` §4。
- ~~**編輯器裡的「留言」入口仍是佔位**~~ **第十一輪已接**：
  `BubbleMenu` / `BlockMenu` / `PageHeader` 三顆都接上了
  （`Editor.tsx` 的 `openInlineComment` / `openBlockComment`）。
  ⚠️ 改這條路時要記得**選取範圍必須在按下「留言」那一刻凍起來** ——
  輸入框一 focus，`editor.getSelection()` 就沒了，`toggleMark()` 會靜靜地什麼都不做。
- **AI** 是佔位按鈕（P2）。
- **虛擬捲動未啟用**：02 §3.4 說 block 數 > 200 才需要，M2-B 的驗收是「500 block 輸入 < 50ms」，
  實測前不預先優化。`BlockPortals` 只為「有 React renderer 的 block」建 portal，
  純文字頁面完全沒有 React 節點，所以長頁面的成本主要在 editor-core。
- **文件尾端沒有「點空白處補一段」的落點**：最後一個 block 是 table / divider / image 時
  只剩 gutter 的 `+`，手機上完全走不下去（QA O-22）。
- **貼上純 URL 只做「貼上為連結」**，沒有 Notion 的「連結／書籤／嵌入」三選一選單（QA O-23）。

### 已經修掉、不要再照抄的舊限制

- ~~`sync.canEdit` 尚未接到 `editable`~~ → **已接上。**
  `PageRoute.tsx` / `DatabaseRoute.tsx` 算出
  `readOnly = layout.locked || ui.historyPreviewSeq !== null || permission.canEdit === false`，
  `useEditorHost` 再轉成 `editable: !readOnly`。
  注意 `canEdit === null`（還在載入）**不鎖**，只有明確的 `false` 才鎖 —— 否則會閃一下唯讀。
  切換 `readOnly` 會重建編輯器，第五輪 BUG-20 就是重建時把剛打的字弄丟，
  現在的重建路徑會保留 live doc 與選取。
- ~~`typecheck` 會在 `src/features/database/**` 報兩個錯~~ → **已修，`pnpm typecheck` 全綠。**
- ~~`reference/notion-capture/` 沒有 `tokens.md`~~ → **有了**
  （實機量測的 Notion 7.34 設計 token）。`styles/editor.css` 的數值請改以它為準，
  不要再用規格條文的近似值。

### 其他
- 視覺差異請對 [`reference/shots/compare/`](../../../../../reference/shots/compare/)
  的 `NOTES-round2~8.md`，那一條線與功能 QA **不共用 bug 編號**。
```
