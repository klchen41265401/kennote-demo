# 功能 QA 第四輪（真實瀏覽器走查・編輯器 + 390 手機版）

- 日期：2026-09-20
- 受測站台：`http://100.74.148.92:8090`
  （開始前 `/api/health`：`status: ok`、`migrations.pending: 0`、
  `latest: 0060_timeline_view.sql`、`features: { realtime: true, ot: true, publicShare: false }`）
- 驗證修正的環境：本機 `vite --port 5303 --strictPort` + `VITE_PROXY_TARGET=http://100.74.148.92:8090`
  → **這一輪的修正全部在前端**，沒有任何一條需要 deploy server。
- 工具：`e2e/` 的 `@playwright/test`；`packages/editor-core` 的 vitest（只用來**驗證**
  undo/redo 是不是核心的問題，跑完就把探針檔刪掉，`packages/editor-core` 的程式一行都沒改）
- 範圍：第三輪 §4 的第 7 項（**編輯器**）與第 8 項（**390 手機版**）。
  第 1～6 項（資料庫細節）仍未走——那部分由「資料庫表頭修正」代理在動，本輪刻意完全不碰
  `features/database/**` 與 `apps/server/src/modules/databases/**`。

> 方法：先用一支「探索腳本」（`e2e/_round4-walk.spec.ts`，收尾時刪掉）把整份清單
> 一次刷過去，每一步都把 `.kn-editor-host` 底下的 `data-block-type` + innerText
> dump 出來比對；找到可疑的行為再寫小實驗收斂根因。
> 確認過的結論才搬進回歸測試 `e2e/functional-round4.spec.ts`。

---

## 1. 走查表

### 1.1 `/` 選單：各分組實際插入 + 重整驗證

一律走「gutter 的 `+` 插一個空段落 → 打 `/xxx` → 點選項」，
插完等 3.5 秒讓 transport 沖出去，再 `reload` 比對。

| 分組 | 項目 | 插入 | 重整後還在 | 備註 |
|---|---|---|---|---|
| 基本 | 標題 1 | ✅ `heading1` | ✅ | |
| 基本 | 待辦 | ✅ `todo` | ✅ | 勾選框畫得出來（☐/☑） |
| 基本 | 摺疊清單 | ✅ `toggle` | ✅ | ▾ 箭頭在 |
| 基本 | 表格 | ✅ `table` + 3 × `tableRow` | ✅ | 見 §5 的「表格後面接不下去」 |
| 基本 | 引用 | ✅ `quote` | ✅ | |
| 基本 | 分隔線 | ✅ `divider` | ✅ | |
| 媒體 | 圖片 | ✅ `image` | ✅ | 佔位卡：上傳／嵌入連結／選擇檔案 |
| 媒體 | 音訊 | ✅ `audio` | ✅ | 同上三個分頁 |
| 媒體 | 程式碼 | ✅ `code` | ✅ | 語言預設「純文字」 |
| 進階 | 目錄 | ✅ `tableOfContents` | ✅ | 會列出頁內標題 |
| 進階 | 頁面路徑（麵包屑）| ✅ `breadcrumb` | ✅ | ⚠️ 選單上的名稱是「**頁面路徑**」，打「麵包屑」也搜得到（keywords 有） |
| 進階 | 按鈕 | ✅ `button` | ✅ | 設定面板：標籤／插入區塊／開啟頁面／樣板 |
| 進階 | 2 欄 | ✅ `columnList` + 2 × `column` | ✅ | |
| 建議 | 書籤 | ✅ `bookmark` | ✅ | 佔位卡：嵌入連結／嵌入 |
| 建議 | 標註 | ✅ `callout` | ✅ | 預設 icon 💡，點得開 emoji picker |
| 嵌入 | PDF | ✅ `pdf` | ✅ | 佔位卡同圖片 |

**結論：`/` 選單這 16 項全部插得進去、全部撐得過重整。**
（圖片 / 音訊 / PDF 的 **URL 實際填入**沒有走完，見 §4。）

### 1.2 貼上

`page.evaluate` 派發帶 `clipboardData` 的 `paste` 事件，樣本取自
`packages/editor-core/test/clipboard/fixtures.ts`。

| 來源 | 結果 | 備註 |
|---|---|---|
| 純文字（一行） | ✅ | 併進目前段落 |
| 純文字（多行） | ✅ | `\n` 拆成三個 `paragraph` |
| Markdown | ✅（大致）／⚠️ 表格 | `# → heading1`、`- → bulletedList`、`1. → numberedList`、`> → quote`、` ``` → code`（語言 TypeScript 判得出來）。**`| a | b |` 的表格沒有轉成 `table`**，整段留在一個 paragraph 裡 → 見 §5 |
| Notion HTML | ✅ | `h2 → heading2`、`ul.bulleted-list → bulletedList`、`ul.to-do-list → todo`（而且 checked 狀態是對的 ☑）、`pre.code → code`、`p` 含 `<strong>` 與 `<a>` → paragraph |
| Word / GDocs HTML | ⚪ 未走 | fixtures 有，這一輪沒跑（見 §4） |
| 純 URL | ⚠️ | 只變成純文字，**沒有變成連結、也沒有問要不要做成書籤**（Notion 會跳「貼上為 連結／書籤／嵌入」）→ §5 |
| 全部項目重整後 | ✅ | reload 之後結構一模一樣 |

### 1.3 行內：`@` 與 `[[`

| 項目 | 結果 | 備註 |
|---|---|---|
| `@` 在行首 | ✅ | 人員（訪客）／頁面／日期（今天、明天）都列得出來 |
| `@` **緊接在文字後面** | ❌→✅ **BUG-16**（已修） | 「請教一下@」完全叫不出選單 |
| `@` 選單的「今天」日期 | ❌→✅ **BUG-13**（已修） | 用 UTC 算，台北早上 08:00 前都會少一天 |
| 選定人員後的 chip | ❌→✅ **BUG-15**（已修） | 畫面上是「**@@訪客**」 |
| `@` query 含空白 | ✅（修完） | 改由宿主維護 query 後，`@王 小明` 打得完 |
| `[[` 頁面連結 | ✅ | 列出工作區頁面，選完插入 `pageLink` atom，觸發字元有被吃掉 |

### 1.4 區塊操作

| 項目 | 結果 | 備註 |
|---|---|---|
| gutter `+`「插入區塊」 | ✅ | 在下方插空段落並把游標帶過去；Alt 是上方 |
| gutter `⠿` 區塊選單 | ✅ | 轉換成／文字／顏色／複製一份（Ctrl+D）／複製區塊連結／移動到…／留言／刪除（Del） |
| 區塊選單「複製一份」 | ✅ | 複本出現在原 block 下面 |
| **拖曳排序** | ❌→✅ **BUG-14**（已修） | 拖到目標 block 的**上緣**卻被判成「開新欄」，生出 `columnList` |
| Escape → block selection | ✅ | `data-selected="true"` + `data-block-select-mode="true"` |
| **block selection 下 Shift+↑ 擴選** | ❌→✅ **BUG-17**（已修） | 按了完全沒反應 |
| **block selection 下 Backspace 批次刪除** | ❌→✅ **BUG-17**（同一支） | 同上，鍵盤整組失聯 |
| Ctrl+Z 跨 block | ✅ | 打字／Enter／打字 都還原得回去 |
| **Ctrl+Y / Ctrl+Shift+Z 跨 block** | ❌ **BUG-18**（未修，在 editor-core） | redo 不但回不來，還會**再往前吃掉一段**；而且時有時無 |
| Ctrl+Z / Ctrl+Y 純文字（同一個 block） | ✅ | 三段打字（中間停 1.5 秒斷開 coalesce）來回都正確 |

### 1.5 390 寬手機版

| 步驟 | 結果 | 實測值 |
|---|---|---|
| 登入頁 | ✅ | 只有「登入」「不輸入，直接進入」兩顆，沒有橫向溢出 |
| 首頁 | ✅ | `scrollWidth 390 = clientWidth 390` |
| 抽屜 | ✅ | 有「開啟側邊欄」按鈕，點開後 `aside` 出得來 |
| 開頁 + 編輯 | ✅ | 編輯頁 `scrollWidth 390 = clientWidth 390`；點 block 打字正常 |
| `/` 選單 | ⚠️ **不是 bottom sheet** | 面板是一般 popover：`x 18, y 302, w 330, h 361`（視窗 390×844），能用但沒有貼底 → §5 |
| 浮動工具列 | ✅（會出現）／⚠️ | `.kn-popover--bubble`，`x 8, y 231, w 347`，寬度沒有溢出。**「吸附鍵盤上緣」那個版本沒驗到**——headless 沒有真的虛擬鍵盤，`visualViewport` 不會縮 |
| 資料庫表格橫捲 | ⚪ 未走 | 本輪不碰資料庫（並行代理施工中） |
| 設定 Dialog 全螢幕 | ⚪ 沒走完 | 手機版頂欄看不到「設定」按鈕（要先開抽屜），`/settings` 直接導覽過去也沒有 `[role="dialog"]` → §4 |
| 垃圾桶 | ✅ | `/trash` 進得去，`scrollWidth 390 = clientWidth 390` |
| **gutter（`+` / `⠿`）** | ⚠️ | 是 `mousemove` 驅動的，手機上等於沒有。插入 / 拖曳 / 區塊選單在觸控裝置上**沒有替代路徑** → §5（與第三輪對看板拖曳的觀察同一族） |

---

## 2. Bug 清單

### BUG-13｜`@` 選單的「今天」用 UTC 算，台北早上會少一天（已修）· 嚴重度：**中**

**重現**

1. 把系統時區設成 Asia/Taipei，時間調到 **00:00–08:00** 之間（實測就是這個時段）
2. 編輯器裡打 `@`
3. 選單上寫「今天（2026-09-**19**）」「明天（2026-09-**20**）」，可是今天是 **09-20**

**根因**

`apps/web/src/features/editor/menus/MentionMenu.tsx` 的 `dateItems()`：

```ts
const fmt = (d: Date): string => d.toISOString().slice(0, 10);   // ← UTC
```

`toISOString()` 是 UTC。台北是 UTC+8，所以每天早上 08:00 以前
`toISOString()` 給的還是前一天。`Editor.tsx` 的 `/日期或提醒`
（`action.inline === 'date'`）也複製了同一行，同樣錯。

**修法**

抽一個 `localDateISO()`（用 `getFullYear/getMonth/getDate` 組），
`MentionMenu` 與 `Editor.tsx` 兩邊都改用它。

**回歸測試**：`e2e/functional-round4.spec.ts` →
「BUG-13 @ 選單的「今天」用本地時區，不是 UTC」
（把選單上的日期跟瀏覽器當下的**本地**年月日對起來）

---

### BUG-14｜拖曳到區塊上緣換順序，卻被判成「開新欄」（已修）· 嚴重度：**高**

**重現**

1. 一頁裡有兩個段落「甲」「乙」
2. 抓住「乙」的 `⠿` 往上拖，放在「甲」的**上緣**（y 落在甲的最上面幾 px）
3. 放開之後不是「乙 / 甲」，而是生出一個 `columnList`：
   左欄放「乙」、右欄放原本的空段落，「甲」被擠到下面

```
columnList
  column → paragraph 乙
  column → paragraph ⏎
paragraph 甲
```

**根因**

`apps/web/src/features/editor/dnd/drop-target.ts` 的 `computeDropTarget()`
把「左右邊緣 → 開新欄」放在 before/after 之前判，而且**完全不看 Y**：

```ts
const edge = width * columnEdgeRatio;          // 預設 0.25
if (x > hit.right - edge) return { position: 'column-right' };
if (x < hit.left + edge && x >= hit.left) return { position: 'column-left' };
```

編輯區大約 600–700px 寬，左右各 25% 就是 150–175px 的「開欄帶」，
而且**整條高度都算**。使用者把指標移到兩個 block 的交界想換順序時，
X 幾乎一定落在那一帶裡 → 每一次都變成開欄。
（Notion 的開欄帶只在 block 的垂直中段生效，貼著上下緣時一律是排序。）

**修法**

多一個 `columnVerticalBand`（預設 `0.5`）：左右邊緣帶**還要同時**落在
block 的垂直中間帶（上下各留 25% 給 before / after）才算開欄。

**回歸測試**

- 單元：`apps/web/src/features/editor/__tests__/lib.test.ts` →
  「靠左 / 右邊緣但貼在上下邊界 → 還是排序，不是開欄」
- e2e：`e2e/functional-round4.spec.ts` →
  「BUG-14 拖曳到區塊上緣是換順序，不是開新欄」
  （斷言結果裡**沒有** `columnList`，而且「乙」排到「甲」前面）

---

### BUG-15｜插入 `@` 提及變成「@@訪客」（已修）· 嚴重度：**中**

**重現**

1. 打 `@` → 選「訪客」
2. 畫面上的 chip 是「**@@訪客**」

實際 DOM：

```html
<span class="kn-inline kn-atom kn-atom-mention" data-atom="mention"
      data-atom-data='{"userId":"…","text":"@訪客"}'>@@訪客</span>
```

**根因**

兩邊都加了 `@`：

- `MentionMenu.tsx` 建 atom 時 `data.text = \`@${m.user.name}\``
- `packages/editor-core/src/text/richtext.ts` 的 `defaultAtomText()`
  對 `atom.atom === 'mention'` **一律再補一個** `@`

**修法**（動宿主那一半；editor-core 不碰）

`MentionMenu.tsx` 的 `data.text` 只放名字，`@` 交給渲染層補。

**已知殘留**：**先前已經存下來的** mention（`text` 裡本來就有 `@`）
重新開頁還是會顯示「@@」。要清乾淨得寫一次性的資料修補，本輪沒做。

**回歸測試**：`e2e/functional-round4.spec.ts` → 「BUG-15 插入 @ 提及只會有一個 @」
（斷言 chip 文字符合 `/^@[^@]/`，而且整個 block 的文字裡沒有 `@@`）

---

### BUG-16｜`@` 緊接在文字後面時叫不出提及選單（已修）· 嚴重度：**中**

**重現**

1. 打「請教一下」，接著打 `@`（中間**不要**空格）
2. 什麼都沒有。`[role="option"]` 是 0 個
3. 改成「請教一下 @」（有空格）就開得出來

**根因**

`packages/editor-core/src/input/triggers.ts` 只在**行首或空白後**才開 trigger，
而且 query 裡一出現空白就把 trigger 收掉。
`/` 選單早就因為同樣的理由改成「宿主自己算」了（`Editor.tsx` 裡有註解寫明），
但 `@` 一直還掛在 editor-core 的 `mentionTrigger` 上。

Notion 的行為是：`@` 在任何位置都開，而且名字裡的空白不會把選單關掉。

**修法**（editor-core 不碰）

`Editor.tsx`：不再訂閱 `mentionTrigger`，把 `@` 併進原本 `[[` 那一支
「行內觸發」的 effect —— 開關與 query 都由宿主聽 `transaction` 自己算，
`[[` 先比（兩者不會互搶），query 超過 40 個字或出現換行才關。

**回歸測試**：`e2e/functional-round4.spec.ts` → 「BUG-16 @ 緊接在文字後面也要叫得出選單」
（含「query 有空白時選單仍然開著」）

---

### BUG-17｜Escape 進區塊選取之後，鍵盤整組失聯（已修）· 嚴重度：**高**

**重現**

1. 一頁裡有「一 / 二 / 三」三個段落，游標在「三」
2. 按 Escape → 「三」變成藍底（`data-selected="true"`），看起來是對的
3. 按 Shift+↑ → **沒反應**，還是只有「三」
4. 按 Backspace → **沒反應**，什麼都沒刪掉
5. 按 Tab / Ctrl+A 也一樣沒反應

也就是「進得去 block selection，但進去之後什麼都做不了」——
畫面上還亮著選取框，使用者只會覺得編輯器當掉了。

**根因**

`document.activeElement` 掉回 `<body>` 了：

```
before Escape  active = DIV.kn-block-content …   inRoot = true
after  Escape  active = BODY                     inRoot = false
```

editor-core 進 block 模式時會清掉原生 DOM selection，焦點就沒地方去；
可是它的 keydown listener 掛在 `view.root`（`div.kn-editor[data-kn-root]`）上
（`input/controller.ts`），焦點在 body 時事件**根本不會經過那一層**。

實測把 `keydown` 直接 `dispatchEvent` 到 `[data-kn-root]` 上，
擴選與刪除立刻就對了 —— 證明 keymap 的邏輯是好的，壞的是焦點。

**修法**（editor-core 不碰）

`Editor.tsx` 多一個 effect：只要 selection 變成 `block` 型別，就把
`[data-kn-root]` 補上 `tabindex="-1"` 並 `focus()`。
mutation guard 是 `attributes: false`，加 attribute 不會被判成非法變更。

兩個踩過的坑，程式裡也寫成註解了：

1. **不能用 `root.tabIndex !== -1` 判斷有沒有設過** —— 一般的 `div`
   讀出來本來就是 `-1`（代表「不可聚焦」），所以要看
   `hasAttribute('tabindex')`。不改這一點 `focus()` 會靜靜地失敗。
2. 要**立刻試一次 + 排到下一個 task 再試一次**：進 block 模式時
   editor-core 會在同一輪裡清 selection，只在事件當下 focus 會被洗掉。

**回歸測試**：`e2e/functional-round4.spec.ts` →
「Escape 進區塊選取 → Shift+方向鍵擴選 → Backspace 批次刪除」

---

### BUG-18｜跨 block 的 redo 會把內容再吃掉一段（**未修**）· 嚴重度：**最高（資料遺失）**

> **未修的原因：程式在 `packages/editor-core`，本輪的指示是不得改動那個套件。**

**重現**（間歇，大約三次裡兩次）

```
打字「第一段」→ Enter →「第二段」
狀態 A   [段落⏎, 第一段, 第二段]

Ctrl+Z   [段落⏎, 第一段, ⏎]      ← 對（把「第二段」的字還原掉）
Ctrl+Z   [段落⏎, 第一段]          ← 對（把 Enter 拆出來的那一塊收回去）
Ctrl+Y   [段落⏎]                  ← ❌ 應該要變回 [段落⏎, 第一段, ⏎]
                                     結果連「第一段」跟它那一塊都不見了
Ctrl+Shift+Z                       ← 再按也回不來，redo stack 空了
```

`Ctrl+Y` 與 `Ctrl+Shift+Z` 行為一樣。**undo 永遠是對的，只有 redo 會壞。**

**收斂過程**

1. 只在同一個 block 裡打字（三段，中間停 1.5 秒斷開 coalesce）
   → undo / redo 來回**完全正確**。所以問題出在**結構性**的那種 history entry。
2. 在 `packages/editor-core` 裡寫了一支臨時探針（jsdom + `createEditor`，
   `ot: { enabled: false }` 與 `{ enabled: true }` 各跑一次），
   同樣的 `打字 → insertParagraph → 打字 → undo×2 → redo×2` 序列
   → **兩種設定都是對的**。探針跑完已刪除，套件程式碼未改。
3. 在真實瀏覽器裡改變節奏就會翻面：打字之間**停 1.5 秒**時 redo 大多會過，
   一路打不停時幾乎必壞。

**根因（推測，需要 editor-core 擁有者確認）**

`packages/editor-core/src/core.ts` 的 `historyOps()`：

```ts
private historyOps(deltas, direction): Operation[] | null {
  if (!this.ot.enabled || !deltas || deltas.length === 0) return null;
  const ops: Operation[] = [];
  for (const item of deltas) {
    const block = this.doc.blocks[item.blockId];
    if (!block) return null;
    …
    ops.push({ type: 'block.update', blockId: item.blockId, patch: { content: … } });
  }
  return ops.length > 0 ? ops : null;          // ← 只回得出 block.update
}
```

`redo()` 會優先用 `historyOps(entry.deltas, 'forward')` 取代 `entry.ops`。
可是 `deltas` 只描述**內容**（OT delta），一筆 history entry 如果同時含
`block.insert`（Enter 拆出來的新 block）與內容變更，
這裡回傳的陣列就**只剩內容那一半，`block.insert` 被整個丟掉**。
redo 一個「拆段落」於是變成「把前一段的字砍掉、但不建新 block」。
coalescing 把打字跟結構操作併進同一筆時特別容易踩到，
這也解釋了為什麼「停頓一下再打」比較不會壞。

**建議修法**

`historyOps()` 不要用「只有 delta 的 ops」整批取代 `entry.ops`：
應該**逐條**處理 —— 有 delta 的 `block.update` 用 transform 過的 delta 版本，
`block.insert` / `block.remove` / `block.move` 這些結構 op 原樣保留，
再照原順序組回去。`undo()` 的 `'inverse'` 路徑有同樣的形狀，要一起改。

**回歸測試**：`e2e/functional-round4.spec.ts` →
「BUG-18 Ctrl+Z / Ctrl+Shift+Z 跨 block 可以來回還原」，
目前標成 `test.fixme`。editor-core 修好之後把 `test.fixme` 改回 `test` 就會綠。

---

## 3. 改了哪些檔案

| 檔案 | 內容 | 需部署 |
|---|---|---|
| `apps/web/src/features/editor/menus/MentionMenu.tsx` | BUG-13：新增 `localDateISO()`（本地時區）；BUG-15：mention atom 的 `text` 不再自己加 `@` | 前端 |
| `apps/web/src/features/editor/Editor.tsx` | BUG-13：`/日期或提醒` 改用 `localDateISO()`；BUG-16：`@` 改由宿主自己算觸發與 query（與 `[[` 合併成同一支 effect），不再訂閱 `mentionTrigger`；BUG-17：block selection 時把焦點放回 `[data-kn-root]` | 前端 |
| `apps/web/src/features/editor/dnd/drop-target.ts` | BUG-14：新增 `columnVerticalBand`，左右開欄帶要同時落在垂直中間帶 | 前端 |
| `apps/web/src/features/editor/__tests__/lib.test.ts` | BUG-14 的單元回歸 | — |
| `e2e/functional-round4.spec.ts` | 新增：BUG-13/14/15/16/17 + slash 插入、貼上、區塊選取、undo/redo 共 8 條（BUG-18 那條是 `fixme`） | — |

**沒有碰**：`features/database/**`、`apps/server/src/modules/databases/**`
（並行代理施工中）、`packages/editor-core`（探針檔跑完即刪）、
`lib/{sync-client,ot-client}.ts`、任何 `.css` / `.module.css`。
沒有加 runtime 套件、沒有 git commit。

### 驗收

```
pnpm -r typecheck                    ✅ 8/8 專案通過
pnpm --filter @kennote/web test      ✅ 16 檔 / 317 條（新增 1 條 drop-target）
pnpm --filter @kennote/server test   ✅ 25 檔 / 376 條（3 檔 skip：需要 DATABASE_URL_TEST）
BASE_URL=http://127.0.0.1:5303 npx playwright test functional-round4.spec.ts
                                     ✅ 7 passed / 1 fixme（BUG-18，未修）
```

**這一輪沒有後端改動，前端 deploy 之後遠端就會是綠的。**

---

## 4. 未走查（留給第五輪）

### 編輯器（這一輪沒走完的）

1. 圖片 / 音訊 / PDF / 書籤的 **URL 實際填入並確認渲染**（只驗到佔位卡出得來）
2. **圖片檔案拖放上傳**與貼上檔案（`Editor.tsx` 有 `insertFiles`，沒實際丟檔）
3. **程式碼語言切換**（`code` 插得進去，沒點開語言選單改過）
4. **待辦勾選 / 折疊收合 / 切換標題 / 標註 icon** 的實際互動（只驗到渲染與持久化）
5. **複製貼上整個 block**（Ctrl+C / Ctrl+V 在 block selection 下）
6. **匯出 Markdown / HTML、匯入 Markdown 檔**
7. **留言**（選取文字留言 / 面板回覆 / 解決）
8. **版本歷史**（列表 / 預覽 / 還原）
9. **分享彈窗邀請成員**（要第二個訪客帳號）
10. **側邊欄拖曳**（之間 / 進裡面 / 循環拒絕）
11. Word / Google Docs 剪貼簿 HTML 的貼上（fixtures 有現成的）

### 手機版

12. **設定 Dialog 全螢幕**：手機頂欄沒有「設定」入口（要先開抽屜），`/settings`
    直接導覽過去也沒有 `[role="dialog"]`。是路由設計還是缺口要先確認
13. **浮動工具列吸附鍵盤上緣**：headless 沒有虛擬鍵盤，`visualViewport` 不會縮，
    這一段要用真機或 CDP 模擬 `visualViewport` 才驗得到
14. **資料庫表格橫捲**（本輪刻意不碰資料庫）

### 前幾輪留下、仍然未走的

15. 第三輪 §4 的資料庫 1–6 項（檢視改名/複本/刪除、BUG-8 回歸、date/files 儲存格、
    看板鍵盤替代路徑、列刪除的垃圾桶歸屬、CSV 欄序）
16. 永久刪除、訪客升級、登出所有裝置

---

## 5. 觀察（不算 bug，但值得記一筆）

- **文件尾端沒有「點空白處補一段」的落點。**
  最後一個 block 如果是 `table` / `divider` / `image` 這種沒有可編輯內容的，
  想在它後面繼續打字**只剩 gutter 的 `+`**。`Editor.tsx` 的 `onWrapperClick`
  只處理 callout 的 icon，沒有 Notion 那個「點最後一塊下面的空白就補一個段落」。
  手機上連 gutter 都沒有（見下一條），等於完全走不下去。
- **gutter（`+` / `⠿`）是 `mousemove` 驅動的，觸控裝置上等於不存在。**
  `BlockHandle.tsx` 只聽 `mousemove` / `mouseleave`。
  手機上因此沒有「插入區塊 / 拖曳搬移 / 區塊選單」的入口。
  跟第三輪對看板拖曳的觀察是同一族問題（HTML5 DnD / hover 在觸控上不能用）。
- **手機版的 `/` 選單不是 bottom sheet**，是一般 popover（`x 18, y 302, w 330, h 361`）。
  能用，但跟規格寫的「bottom sheet」不一樣。
- **貼上純 URL 只會變純文字**，不會變超連結，也沒有 Notion 的
  「貼上為 連結 / 書籤 / 嵌入」選單。
- **Markdown 表格貼不進來**：`| a | b |` 整段留在一個 paragraph。
  `packages/editor-core` 的 markdown parser 沒有 table 規則（本輪不得改該套件）。
- **`/麵包屑` 搜得到但選單上寫的是「頁面路徑」**。keywords 裡有「麵包屑」所以搜得到，
  不是 bug，但寫測試時用 label 比對會撲空，記一筆。
- 本機 vite 代理時頂欄顯示「尚未連線」（WebSocket 沒跟著 proxy 過去）——
  與第三輪相同。REST 照常，所以這一輪的驗證不受影響，
  但**即時同步相關的項目在這個環境下測不了**。
- 進站第一發 `POST /api/auth/refresh` 回 401 是預期（還沒有 refresh cookie）。
