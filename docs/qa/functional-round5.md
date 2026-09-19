# 功能 QA 第五輪（真實瀏覽器走查・協作 / 頁面功能 + 390 手機版）

- 日期：2026-09-20
- 受測站台：`http://100.74.148.92:8090`
  （開始前 `/api/health`：`status: ok`、`migrations.pending: 0`、
  `latest: 0060_timeline_view.sql`、`features: { realtime: true, ot: true, publicShare: false }`）
- 驗證修正的環境：本機 `vite --port 5306 --strictPort` + `VITE_PROXY_TARGET=http://100.74.148.92:8090`
- 工具：`e2e/` 的 `@playwright/test`（探索腳本 `_round5-walk*.spec.ts` / `_round5-probe.spec.ts`
  收尾時已刪除，結論搬進 `e2e/functional-round5.spec.ts`）
- 範圍：第四輪 §4 的「編輯器 6～9 項」與「手機版 12～13 項」＋ §5 的觀察。
  **刻意沒碰**：`packages/editor-core`、`e2e/functional-round4.spec.ts`
  （並行代理「editor-core BUG-18」施工中）、`lib/{sync-client,ot-client}.ts`。

> 方法：先用探索腳本把整份清單刷過去（API 一層 + UI 一層都 dump 出來比對），
> 再對可疑的行為寫小實驗收斂根因；確認過的才搬進回歸測試。

---

## 1. 走查表

### 1.1 協作：留言 / 版本歷史 / 權限

| 項目 | 結果 | 備註 |
|---|---|---|
| 建立討論串（`POST /api/pages/:id/discussions`，行內 anchor 帶 quote） | ✅ 201 | |
| 面板回覆（`POST /api/discussions/:id/comments`） | ✅ 201 | |
| 解決（`POST .../resolve`）／重開（`DELETE .../resolve`） | ✅ | `resolvedAt` 來回正確 |
| 右側「留言」面板 | ✅ | 標題「留言（1）」、顯示 anchor 引文、兩則留言、「顯示已解決」開關都在 |
| 版本歷史 `GET /api/pages/:id/history` | ✅ | 打一次字就有 `seq 1`，面板寫「seq 1・1 次變更・1 人編輯」 |
| 版本歷史面板（從 ⋯ → 版本歷史開） | ✅ | 列表、「目前 seq N」、時間都對 |
| 版本預覽 / 還原 | ⚪ 未走完 | `historyPreviewSeq` 會讓 `readOnly=true` —— 預覽本身踩到 **BUG-20**（見下），修完才有意義；還原的實際比對留給第六輪 |
| 分享彈窗：成員列表 + 權限下拉 | ✅ | full / edit / comment / read / none 五段都在 |
| 分享彈窗：邀請第二個帳號 | ⚠️ | 邀請框**寫死 `role: 'member'`**，UI 上選不了 guest（後端 `inviteSchema` 是支援的）→ §5 |
| 公開連結（`FEATURE_PUBLIC_SHARE=false`） | ❌→✅ **BUG-21**（已修） | 後端回 501，但開關長得跟能用的一樣 |
| 只有 `comment` 權限 → block 寫入 | ✅ 403 | `registerPermissionGuard` 有守住 |
| 只有 `comment` 權限 → 改標題 / 刪頁 / 搬頁 | ❌→✅ **BUG-27**（已修，**需部署**） | 全部 **200**，守門員漏了頁面 meta |
| `@` 提及 → 通知 | ⚪ 未走完 | 見 §4；`GET /api/notifications` 本身是通的（`{notifications, unread, users, nextCursor}`） |

### 1.2 匯出 / 匯入

| 項目 | 結果 | 備註 |
|---|---|---|
| ⋯ → 匯出 | ❌→✅ **BUG-19**（已修） | 原本直接下載一份「最小版」Markdown |
| ⋯ → 匯入 | ❌→✅ **BUG-19**（已修） | 原本只彈「匯入功能尚未開放，排在 M6」的 toast |
| `POST /api/pages/:id/export` markdown | ✅ 200 | `Content-Disposition` 有 `filename*=UTF-8''`（中文檔名正確） |
| 同上 html | ✅ 200 | `<!DOCTYPE html>` + 內嵌樣式 + 深色模式 media query |
| 同上 pdf | ✅ 501（預期） | 訊息指路去「匯出 HTML 或列印」（ADR 0005：容器裡沒有瀏覽器） |
| `POST /api/import` 傳 .md | ✅ 201 | `{createdPages:1, rootPageId, source:'markdown'}` |
| 匯入後的 block 型別 | ✅ | `# → heading*`、`- → bulletedList`、` ``` → code`、內文 → `paragraph` |

### 1.3 頁面功能

| 項目 | 結果 | 備註 |
|---|---|---|
| 建立複本（含子頁） | ✅ | 標題補「（複本）」；子頁一起複製（tree 上 `hasChildren: true`，`page.children` 非空） |
| 移動到 | ✅ | `POST /api/pages/:id/move`；⋯選單與 `Ctrl+Shift+P` 都進得去 MoveToDialog |
| 鎖定頁面 | ⚠️→✅ | 鎖定後整頁沒有 `contenteditable="true"`，打字進不去、重整仍然鎖著 ✅；**但鎖定的當下內容會整段消失** → **BUG-20** |
| 全寬 / 小字型 / 字體 | ✅ | 存在 `localStorage` 的 `kennote:page-layout`（per-page），重整保留 |

### 1.4 貼上（第四輪 §5 的觀察）

| 項目 | 修正前 | 修正後 |
|---|---|---|
| Markdown 表格 | ❌ 四個 paragraph，`\| a \| b \|` 原封不動 | ✅ **BUG-22** `table` + 3 × `tableRow`，第一列是表頭，重整後還在 |
| 純 URL | ❌ 純文字，沒有連結 | ✅ **BUG-23** 變成帶 `link` mark 的一段文字 |
| mention 舊資料「@@」 | ❌ 存過的 mention 重開頁還是「@@訪客」 | ✅ **BUG-28** 渲染層去重 |

### 1.5 390 手機版

| 項目 | 修正前 | 修正後 |
|---|---|---|
| `/` 選單 | ⚠️ 一般 popover（`x 18, y 198, w 330, h 361`） | ✅ **BUG-24** bottom sheet：`x 0, y 337.6, w 390, h 506.4`（＝ 844 的 **60%**，貼齊底緣，有背景遮罩、由下滑入） |
| block 的插入 / 選單（觸控） | ❌ 完全沒有路（gutter 是 `mousemove` 驅動且 720px 以下 `display:none`） | ✅ **BUG-25** 長按 400ms 開 block 選單（也是 bottom sheet），選單裡多了「在下方插入區塊」 |
| 浮動工具列吸附鍵盤 | ⚠️ 沒驗到（headless 沒有虛擬鍵盤） | ✅ **BUG-26** 接上 `visualViewport`；用假的 `visualViewport`（844 → 480）驗證工具列底緣 ≤ 480 |
| 設定 Dialog | ⚠️ 第四輪說「開不起來」 | ✅ 其實開得起來，入口在**抽屜**裡（頂欄沒有）。五個分頁（我的帳號 / 我的設定 / 通知 / 成員 / 一般）都有內容、都沒有橫向溢出；滿寬 390。**高度 742.7 / 844，不是真的滿版** → §5 |
| `/settings` 直接導覽 | ❌ 仍然沒有 dialog | 路由存在但不開 Dialog → §4 |

---

## 2. Bug 清單

### BUG-19｜匯出 / 匯入的完整 UI 寫好了卻沒人接（已修）· 嚴重度：**高**

**重現**

1. 開一頁 → ⋯ → **匯入** → 彈出 toast「匯入功能尚未開放，排在 M6」
2. ⋯ → **匯出** → 不問格式，直接下載一份 `.md`

**根因**

`apps/web/src/features/export/ExportDialog.tsx` 與
`apps/web/src/features/import/ImportDialog.tsx` **兩支都是完整實作**
（格式選擇、包含子頁面、包含附件、拖放上傳、來源卡片、錯誤處理都有），
後端 `POST /api/pages/:id/export` 與 `POST /api/import` 也都在線上跑著 ——
可是全 repo `grep` 下去，**沒有任何地方 import 它們**：

```
$ grep -rn "ImportDialog\|features/import" --include=*.tsx apps/web/src | grep -v features/import/
（沒有輸出）
```

`TopBar.tsx` 走的是 `features/shell/export.ts` 的「最小版」
（檔頭自己寫著「規格把完整的匯出排在 M6 的 `features/export`；
那個模組出現之後，這支只要改成轉呼叫它即可」——模組早就出現了，只是沒人去改），
「匯入」則是一個寫死的 toast。

於是使用者拿不到：格式選擇（HTML / PDF / CSV）、包含子頁面的 zip、附件、
以及**整個匯入功能**。

**修法**

`TopBar.tsx` 改成開真正的兩個對話框；匯入成功後 `onTreeChanged()` + 導到新頁面。

**回歸測試**：`e2e/functional-round5.spec.ts` → 「BUG-19 ⋯選單的『匯出』/『匯入』」
兩條（另外一條驗匯出內容與 501 的 PDF，一條驗匯入 .md 的 block 型別）

---

### BUG-20｜切換「鎖定頁面」會把剛打的字整段弄不見（已修）· 嚴重度：**最高（看起來就是掉資料）**

**重現**

1. 開一頁，打「原本的內容」
2. ⋯ → **鎖定頁面**
3. 內文**整段消失**，只剩一個空段落（placeholder 都回來了）
4. 重整 → 內容又回來了（其實沒有真的掉，但使用者不會知道）

實測 DOM：

```
鎖之前  ["paragraph::原本的內容"]
鎖之後  ["paragraph::\n"]   ← <div … data-empty="true"><br data-kn-ignore="true"></div>
重整後  ["paragraph::原本的內容"]
```

**根因**

`apps/web/src/features/editor/useEditorHost.ts` 建立編輯器的 `useLayoutEffect`
把 `readOnly` 放進依賴陣列：

```ts
}, [pageId, initialDoc, readOnly, initialSeq, applyRemote, applyRemoteDelta, otEnabled]);
```

`readOnly` 一變就 cleanup → `instance.destroy()` → 重建。
重建吃的 `doc` 是 `builtRef` 裡**頁面載入當下**那一份 —— 使用者在那之後打的字
全部不在裡面。

同一支檔案裡本來就有一段註解記著同一族的坑（「打完字改標題 → 內文整段消失」，
那次是用 `initialSeq` 修掉的），但 `readOnly` 這條路沒被涵蓋到。
**`layout.locked` 不是唯一的觸發點**：`ui.historyPreviewSeq !== null`（版本預覽）
與 `permission.canEdit === false`（權限變更）走的是同一個 `readOnly`
（`routes/PageRoute.tsx`），所以版本預覽也會踩到。

**為什麼不能只把 `readOnly` 從依賴陣列拿掉**：`createEditor({ editable })`
只在建立時讀一次，editor-core 沒有 `setEditable()`，拿掉就鎖不住了。
（而且 editor-core 這一輪不得改動。）

**修法**

多記一份「編輯器現在的 doc」（`liveDocRef`，在 `transaction` 事件裡更新），
重建時優先用它。不能改用 `builtRef`：`initialDoc` 在 **render 階段**就已經把
`builtRef` 讀走了，等 cleanup 再寫回去已經來不及（這一點程式裡寫成註解了）。

**回歸測試**：`e2e/functional-round5.spec.ts` →
「BUG-20 鎖定頁面不會把剛打的字弄不見，而且打字真的進不去」
（先 poll `/snapshot` 確定字沖出去了，再鎖 → 比對 DOM → 打字 → 比對 → 重整 → 比對）

---

### BUG-21｜站台關閉公開分享時，開關長得跟能用的一模一樣（已修）· 嚴重度：**中**

**重現**

1. 這個站台 `FEATURE_PUBLIC_SHARE=false`（`/api/health` 就寫著）
2. 分享彈窗 → 勾「公開連結（任何人都能檢視）」
3. 轉一圈 → 一行紅字「公開連結設定失敗（可能未啟用此功能）」
   （後端回的是 501 `公開分享功能尚未啟用（FEATURE_PUBLIC_SHARE）`）

**根因**

`SharePopover.tsx` 從來不問功能旗標，`disabled` 只看 `busy`。

**修法**

1. 新增 `apps/web/src/lib/features.ts`：整個 session 只打一次 `/api/health`
   取 `features`，**失敗會重試 3 次**（dev 代理偶爾會把 SPA 的 index.html
   當成 API 回應吐回來，打丟一次就永遠拿不到旗標 —— 實測踩過）。
2. `SharePopover` 據此把勾選框 `disabled`，並在下面寫明原因與替代作法
   （`data-public-share="disabled"`）。
3. 保險絲：真的吃到 501 時也把開關標成關閉（`ApiError.status === 501`）。

**回歸測試**：`e2e/functional-round5.spec.ts` → 「BUG-21 …公開連結開關要停用並寫明原因」
（同時驗後端確實回 501）

---

### BUG-22｜貼上 Markdown 表格不會變成表格（已修）· 嚴重度：**中**

**重現**：貼 `| 欄一 | 欄二 |\n| --- | --- |\n| a1 | b1 |` → 四個 `paragraph`。

**根因**：`packages/editor-core` 的 markdown parser 沒有 table 規則。

**修法**（editor-core 不碰）

新增 `apps/web/src/features/editor/lib/paste-extras.ts`，
在宿主的 `paste` capture handler（本來只處理檔案）裡多兩條規則。
判斷刻意嚴格 —— **沒有分隔列（`| --- |`）就不接手**，
因為 `| 一 | 二 |` 很可能只是使用者正在打字；欄數以表頭為準，短列補空、長列截掉。
有 `text/html` 時一律放行給 editor-core（它的 HTML 解析比純文字準）。

**回歸測試**：單元 `apps/web/src/features/editor/__tests__/lib.test.ts` →「貼上補丁」6 條；
e2e →「BUG-22 貼上 Markdown 表格會變成 table block」（含重整後還在）

---

### BUG-23｜貼上純 URL 只會變純文字（已修）· 嚴重度：**低**

**修法**：同一支 `paste-extras.ts`。整段剛好是**一條** `http(s)` 網址時
（有空白 / 換行 / 多條都不算，`javascript:` 也擋掉）→ 插入帶 `link` mark 的一段文字。
目前是 Notion「貼上為連結」的預設行為；「書籤 / 嵌入」的三選一選單沒做（見 §4）。

**回歸測試**：單元 6 條 + e2e「BUG-23 貼上純 URL 會變成連結」（驗 `<a href>`）

---

### BUG-24｜手機版 `/` 選單不是 bottom sheet（已實作）· 嚴重度：**中**

規格 02 §2.5 寫的是「由下滑入、佔 60% 高」，實際是一般 anchored popover
（第四輪實測 `x 18, y 302, w 330, h 361`）。

**修法**

`features/editor/ui/overlay.tsx` 的 `Popover` 加 `sheetOnMobile`：
`matchMedia('(max-width: 720px)')` 成立時改走 sheet 分支
（背景遮罩 + `.kn-popover--sheet`，`height: 60vh`、貼齊左右與底部、
`padding-bottom: env(safe-area-inset-bottom)`、項目高度拉到 44px、
`prefers-reduced-motion` 時不做動畫）。
`SlashMenu` / `MentionMenu` / `BlockMenu` 三個選單都打開這個 flag，桌機完全不受影響。

**實測**：`x 0, y 337.6, w 390, h 506.4`（視窗 390×844）→ 正好 60%、貼底、滿寬。

**回歸測試**：e2e →「BUG-24 `/` 選單是 bottom sheet：貼底、滿寬、60% 高」

---

### BUG-25｜觸控裝置上完全沒有 block 的插入 / 選單入口（已實作）· 嚴重度：**高**

gutter（`+` / `⠿`）是 `mousemove` 驅動的，而且 720px 以下 CSS 直接
`display: none`。手機上因此**沒有任何**插入區塊、搬移、開 block 選單的路
（第四輪 §5 已記，這一輪補上最小版）。

**修法**

1. `BlockHandle.tsx` 多一個 effect：`pointerdown` 且 `pointerType === 'touch'`
   時起 400ms（Android 系統長按值）的計時器，期間手指移動超過 10px、放開、
   多指或頁面捲動就取消；成立時開 block 選單（並 `navigator.vibrate?.(10)`）。
   **只看 touch**，桌機的滑鼠行為一個位元都沒動。
2. `BlockMenu.tsx` 最上面多一條「**在下方插入區塊**」——
   手機沒有 gutter 的 `+`，插入必須在選單裡有一份。

**回歸測試**：e2e 兩條（叫得出選單、而且插得進新 block）。
⚠️ 寫測試時踩到的點：Playwright 的 `touchscreen.tap()` 按不住，
要自己 `dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }))`。

---

### BUG-26｜浮動工具列不會避開虛擬鍵盤（已實作）· 嚴重度：**中**

**修法**

`overlay.tsx` 加 `keyboardAware` + `keyboardTop()`：
`visualViewport.offsetTop + height` 就是鍵盤上緣
（軟鍵盤不會改 `window.innerHeight`，只會縮 `visualViewport`；
差距小於 80px 視為網址列收合，不算鍵盤）。
成立時把浮層的 `top` 夾到「鍵盤上緣 − 高度 − 8」，並監聽 `visualViewport`
的 `resize` / `scroll` 重算。`BubbleMenu` 打開這個 flag，
另外行動版把工具列限寬 `100vw - 16px` 並允許橫捲。

**回歸測試**：e2e →「BUG-26 浮動工具列會吸在虛擬鍵盤上緣」。
headless 沒有真的鍵盤，所以在 `addInitScript` 裡**換掉 `window.visualViewport`**
成一個可控的假物件（844 → 480），再斷言工具列底緣 ≤ 480。

---

### BUG-27｜只有留言權限的人可以改標題 / 刪頁 / 搬頁（已修，**需部署 server**）· 嚴重度：**最高（權限漏洞）**

**重現**

1. A 建一頁，把 B 邀進工作區（role `guest`），頁面權限給 `comment`
2. B `POST /api/pages/:id/transactions` → **403**（正確）
3. B `PATCH /api/pages/:id` `{ title: [...] }` → **200**，標題真的被改掉
4. `DELETE /api/pages/:id`（丟垃圾桶）、`POST /api/pages/:id/move` 同樣過得去

**根因**

`apps/server/src/modules/pages/service.ts` 的 `patchPage` / `deletePage` / `movePage`
只做 `repo.findPageForUser()` —— 那支只回答「**看不看得見**」，不看權限等級：

```ts
const row = await repo.findPageForUser(pageId, userId);
if (!row) throw pageNotFound();
await repo.updatePageMeta(db, pageId, patch, userId);   // ← 沒有任何權限判斷
```

block 的寫入早就有守門員了（`permissions/service.ts` 的
`registerPermissionGuard()` 把 `requirePagePermission(…, 'edit')` 裝進
`applyTransaction`），**頁面 meta 這條路整個漏掉**。

**修法**

三支都補上 `await requirePagePermission(userId, pageId, 'edit', conn)`。
`permissions/service.ts` 沒有 import `pages/service.ts`，不會有循環相依。

**刻意沒動 `permanentlyDeletePage`**：`resolvePagePermission()` 對
`deleted_at !== null` 的頁面一律回 `none`，直接套會連擁有者都 404。
垃圾桶那條路要另外設計（列入 §4）。

**回歸測試**：`e2e/functional-round5.spec.ts` →
「BUG-27 comment 權限不該改得了頁面標題 / 刪頁 / 搬頁（需部署後端）」，
目前標成 `test.fixme`（遠端還是舊 server）。**部署後把 `test.fixme` 改回 `test` 就會綠**。

---

### BUG-28｜舊 mention 資料仍然顯示「@@」（已修）· 嚴重度：**低**

第四輪 BUG-15 修掉了「新插入的 mention 會有兩個 `@`」，但**先前已經存下來的**
（`data.text` 裡本來就有 `@`）重開頁還是「@@訪客」，當時記成「殘留、本輪沒做」。

**修法**（editor-core 不碰）

`createEditor()` 本來就有 `inline.atomText` 這個官方覆寫點。
`useEditorHost.ts` 匯出 `hostAtomText()`：拿 `defaultAtomText()` 的結果，
mention 的開頭多於一個 `@` 就收成一個，再交給 view 渲染。
純顯示層修補，不改資料庫；使用者重新編輯那一段時自然會被新格式覆蓋。

**回歸測試**：單元 `lib.test.ts` →「mention 顯示（第四輪 BUG-15 的殘留資料）」2 條

---

## 3. 改了哪些檔案

| 檔案 | 內容 | 需部署 |
|---|---|---|
| `apps/server/src/modules/pages/service.ts` | **BUG-27**：`patchPage` / `deletePage` / `movePage` 補 `requirePagePermission(…, 'edit')` | ⚠️ **後端** |
| `apps/web/src/features/shell/TopBar.tsx` | BUG-19：⋯選單接上 `ExportDialog` / `ImportDialog` | 前端 |
| `apps/web/src/features/editor/useEditorHost.ts` | BUG-20：`liveDocRef`，重建編輯器時從最新的 doc 長回來；BUG-28：`hostAtomText` | 前端 |
| `apps/web/src/features/share/SharePopover.tsx` | BUG-21：公開連結開關停用 + 原因說明 + 501 保險絲 | 前端 |
| `apps/web/src/lib/features.ts` | **新檔**：功能旗標的單次快取 + 重試 | 前端 |
| `apps/web/src/features/editor/lib/paste-extras.ts` | **新檔**：BUG-22 / BUG-23 的解析與 ops | 前端 |
| `apps/web/src/features/editor/Editor.tsx` | BUG-22 / BUG-23：`paste` handler 接上兩條規則 | 前端 |
| `apps/web/src/features/editor/ui/overlay.tsx` | BUG-24：`sheetOnMobile`；BUG-26：`keyboardAware` / `keyboardTop()` / `useVisualViewport()` | 前端 |
| `apps/web/src/features/editor/menus/{SlashMenu,MentionMenu,BlockMenu}.tsx` | BUG-24：打開 `sheetOnMobile` | 前端 |
| `apps/web/src/features/editor/menus/BubbleMenu.tsx` | BUG-26：打開 `keyboardAware` | 前端 |
| `apps/web/src/features/editor/menus/BlockHandle.tsx` | BUG-25：觸控長按 400ms 開 block 選單 | 前端 |
| `apps/web/src/features/editor/menus/BlockMenu.tsx` | BUG-25：多一條「在下方插入區塊」 | 前端 |
| `apps/web/src/styles/editor.css` | BUG-24 的 bottom sheet 樣式、BUG-26 的行動版工具列限寬 | 前端 |
| `apps/web/src/features/share/SharePopover.module.css` | BUG-21 的說明文字樣式 | 前端 |
| `apps/web/src/features/editor/__tests__/lib.test.ts` | BUG-22 / 23 / 28 的單元回歸（8 條） | — |
| `e2e/functional-round5.spec.ts` | **新檔**：18 條（1 條 `fixme` = BUG-27，等部署） | — |

**沒有碰**：`packages/editor-core`、`e2e/functional-round4.spec.ts`
（並行代理施工中）、`lib/{sync-client,ot-client}.ts`、`features/database/**`。
沒有加 runtime 套件、沒有 git commit。

### 驗收

```
pnpm -r typecheck                    ✅ 8/8 專案通過
pnpm --filter @kennote/web test      ✅ 16 檔 / 325 條（新增 8 條）
pnpm --filter @kennote/server test   ✅ 25 檔 / 376 條（3 檔 skip：需要 DATABASE_URL_TEST）
BASE_URL=http://127.0.0.1:5306 npx playwright test functional-round5.spec.ts
                                     ✅ 17 passed / 1 skipped（BUG-27，等後端部署）
```

---

## 4. 未走查（留給第六輪）

### 協作

1. **`@` 提及 → 通知 → 收件匣未讀 → 標為已讀**的完整鏈路
   （`GET /api/notifications` 本身是通的，但要先有第二個帳號被提及；
   這一輪的時間用在 BUG-20 / BUG-27 上）
2. **版本歷史的預覽與還原**（列表已驗；預覽會走 `readOnly` → 先前被 BUG-20 蓋住，
   修完才驗得準）
3. **分享給「工作區外」的使用者**：只寫頁面層級權限、沒把人加進工作區時，
   對方連 `GET /snapshot` 都 404（`resolvePagePermission` 先看 workspaceRole，
   沒有就直接 `none`）。這是設計還是缺口要先確認 —— 目前的分享彈窗只能邀進工作區。
4. **guest 角色在 UI 上的降級**（後端 `resolve.ts` 會把 guest 封頂在 comment，
   但編輯器端只有 `permission.canEdit` 一個開關，沒驗過）

### 編輯器（第四輪 §4 仍未走完的）

5. 圖片 / 音訊 / PDF / 書籤的 **URL 實際填入並確認渲染**
6. **圖片檔案拖放上傳**與貼上檔案
7. **程式碼語言切換**、**待辦勾選 / 折疊收合 / 標註 icon** 的實際互動
8. **複製貼上整個 block**（block selection 下的 Ctrl+C / Ctrl+V）
9. Word / Google Docs 剪貼簿 HTML 的貼上（fixtures 有現成的）
10. **側邊欄拖曳**（之間 / 進裡面 / 循環拒絕）

### 手機版

11. **`/settings` 直接導覽不開 Dialog**（路由在，但畫面上沒有 `[role="dialog"]`；
    入口只有抽屜裡那一顆）
12. **設定 Dialog 在 390 下高度只有 742.7 / 844**：`Dialog.module.css` 的
    `@media (max-width: 640px)` 給了 `height: 100%`，但量出來差約 100px，
    要找出是哪一層把高度吃掉了（滿寬與分頁內容都是對的，所以優先度不高）
13. **資料庫表格橫捲**（本輪仍不碰資料庫）
14. 觸控的**拖曳排序**（長按只做到「開選單」；拖曳搬移還是沒有替代路徑）

### 後端 / 其他

15. **`permanentlyDeletePage` 沒有權限檢查**（BUG-27 刻意沒補：
    `resolvePagePermission` 對已刪除的頁面一律回 `none`，直接套會連擁有者都 404）
16. **邀請框寫死 `role: 'member'`**（後端支援 admin / member / guest，UI 選不了）
17. 永久刪除、訪客升級、登出所有裝置
18. `database-gaps.md` §4 的 6 項（看板/圖庫列選取、拖曳排序的鍵盤替代路徑、
    `view.format.manualOrder`、`createDual`、批次操作、孤兒屬性清理）

---

## 5. 觀察（不算 bug，但值得記一筆）

- **`features/export` 與 `features/import` 這種「寫好了但沒人 import」的模組**
  值得全域掃一次。這一輪是靠 `grep -rn "ImportDialog"` 才發現的；
  TypeScript 不會報（它們有被 `index.ts` re-export，只是沒有上層呼叫端）。
- **分享彈窗的邀請寫死 `role: 'member'`**，所以「邀請成 guest」在 UI 上做不到。
  後端 `inviteSchema` 是 `z.enum(['admin','member','guest'])`，補一個下拉就好。
- **頁面 meta 與 block content 走的是兩套權限路徑**（BUG-27 的根源）。
  `applyTransaction` 有集中的守門員，`pages/service.ts` 則是每支自己判 ——
  建議把「這支需要什麼權限」也集中起來，不然下一個新端點很容易再漏一次。
- **`readOnly` 會重建整個編輯器**（BUG-20）。根治的作法是 editor-core 提供
  `setEditable()`，宿主就不必把 `readOnly` 放進依賴陣列；
  這一輪不得改那個套件，所以走的是「重建時用最新的 doc」的繞法。
- **dev vite 代理偶爾會把 SPA 的 `index.html` 當成 API 回應吐回來**
  （`/api/health` 實測踩過一次），前端任何「只打一次就決定 UI」的旗標
  都要能重試 —— `lib/features.ts` 就是為此加的。
- **本機 vite 代理時頂欄顯示「尚未連線」**（WebSocket 沒跟著 proxy 過去），
  與第三 / 四輪相同；REST 照常，即時同步相關的項目在這個環境下仍然測不了。
- 寫手機版測試時：`page.touchscreen.tap()` **按不住**，長按要自己
  `dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }))`；
  虛擬鍵盤則要在 `addInitScript` 裡換掉 `window.visualViewport`。
- **`getByRole('button', { name: /分享/ })` 在整頁裡會撞到 6 個按鈕**
  （側邊欄那些），測試一定要先 `page.locator('header')` 縮範圍 ——
  這一輪有兩條測試因此假性失敗，debug 花掉不少時間。
