# 功能 QA 第六輪（協作鏈路補完・權限 / 垃圾桶 / 觸控 / 手機滿版）

- 日期：2026-09-20
- 受測站台：`http://100.74.148.92:8090`
  （開始前 `/api/health`：`status: ok`、`migrations.pending: 0`、
  `latest: 0060_timeline_view.sql`、`features: { realtime: true, ot: true, publicShare: false }`）
- 驗證修正的環境：本機 `vite --port 5307 --strictPort` + `VITE_PROXY_TARGET=http://100.74.148.92:8090`
- 工具：`e2e/` 的 `@playwright/test`；探索階段用 node `fetch` 直接打遠端
  （`POST /api/auth/open` 開兩個帳號），比開瀏覽器快十倍
- 範圍：第五輪 §4 的 1～4（提及/通知、版本歷史、工作區外分享、guest 降級）
  與 14～16（觸控拖曳、`permanentlyDeletePage` 權限、邀請角色），加上手機版設定 Dialog。
  **刻意沒碰**：`packages/editor-core`（第五輪 BUG-20 的根治要那邊出 `setEditable()`）。

> 方法：先用 API 把每條鏈路刷過去確認「後端到底通不通」，再回頭看前端有沒有接上。
> 這一輪最大的收穫全部來自這個順序 —— 三個最嚴重的問題都是
> 「後端好好的，前端根本沒有呼叫端 / 根本沒有判斷」。

---

## 1. 走查表

### 1.1 `@` 提及 → 通知 → 收件匣

| 項目 | 結果 | 備註 |
|---|---|---|
| 留言 body 帶 mention atom → 產生通知 | ✅ | API 直送實測：`type: 'mention'`、`payload.snippet`、`pageId` 都對 |
| `GET /api/notifications` | ✅ | `{ notifications, unread, users, nextCursor }` |
| `POST /api/notifications/:id/read` | ✅ 200 | |
| `POST /api/notifications/read-all` | ✅ 200 | 回 `{ updated, unread }` |
| 收件匣 UI（`/inbox`）、未讀 badge、點擊跳頁 | ✅ | `InboxPanel` + `InboxBadge` 已接上側邊欄與 WS 推播 |
| **留言框打 `@某人` 會變成 mention** | ❌→✅ **BUG-30**（已修） | 整條鏈路**從 UI 完全走不到** |
| **頁面 block 裡的提及 → 通知** | ❌ 未修（設計缺口） | 後端只掃留言 body，不掃 block content → §5 |
| 頁面追蹤 / 靜音 | ❌→⚠️ **BUG-30**（UI 已補，扇出端仍是 dead code） | 端點從 M5 就在，但前端**零呼叫端** |
| 點通知跳頁後捲到該討論串 | ❌ 未修 | `InboxRoute` 把 `discussionId` 丟掉了 → §5 |

### 1.2 版本歷史

| 項目 | 結果 | 備註 |
|---|---|---|
| `GET /api/pages/:id/history` | ✅ | `{ pageId, currentSeq, versions[] }` |
| `GET /api/pages/:id/history/:seq`（預覽） | ✅ | recordMap 每一筆都被強制成 `role: 'reader'` |
| 預覽唯讀且不送 tx | ✅ | `historyPreviewSeq !== null` → `readOnly` → `createEditor({ editable: false })` |
| **還原後內容正確** | ✅ | `restoreVersion` 是「diff 現況 vs 重建的目標 → 送成一筆新 tx」 |
| **還原本身成為新版本** | ✅ | 實測 `restore@1 → { restoredFromSeq: 1, newSeq: 2, opCount: 1 }`，之後 `currentSeq: 2`；歷史 append-only，還原本身也還原得回去 |
| 還原按鈕要有 edit 權限 | ❌→✅ **BUG-32**（已修） | `canRestore` 預設 `true`，沒人傳過 |
| 預覽時編輯器顯示的是**現在的內容** | ⚠️ 未修 | `AppShell` 把 `onPreview` 的第二個參數（snapshot）丟掉 → §5 |

### 1.3 分享 / 權限

| 項目 | 結果 | 備註 |
|---|---|---|
| 邀請框可選 member / guest | ❌→✅ **BUG-31**（已修） | 實測下拉有「成員（可編輯）/ 訪客（只能留言）」 |
| guest 後端拒絕 tx | ✅ 403 | `registerPermissionGuard` |
| guest 後端拒絕 patch / delete / move | ✅ 403 | 第五輪 BUG-27，**已部署**，本輪回測通過 |
| **整頁資料庫沒有問過權限** | ❌→✅ **BUG-32**（已修） | `DatabaseRoute` 從來沒呼叫 `usePagePermission` |
| **留言框對 read 權限也顯示** | ❌→✅ **BUG-32**（已修） | `canComment` 預設 `true`，`AppShell` 沒傳 |
| 分享給工作區外使用者 | ❌→✅ **已實作**（設計決定見 §3） | 原本是死路：`resolvePermission` 開頭 `if (!workspaceRole) return 'none'` |
| 側邊欄「與我共用」區 | ❌→✅ **已實作** | 新端點 `GET /api/pages/shared-with-me` |

### 1.4 垃圾桶

| 項目 | 結果 | 備註 |
|---|---|---|
| **`permanentlyDeletePage` 權限檢查** | ❌→✅ **BUG-29**（已修，**需部署**） | 遠端實測：guest **200**，別人的頁面被 hard delete |
| `restorePage` 權限檢查 | ❌→✅ **BUG-29**（一起補） | 同一個洞 |
| **批次「清空垃圾桶」** | ❌→✅ **已實作** | 新端點 `DELETE /api/trash?workspaceId=`，回 `{ deleted, skipped }` |
| 垃圾桶會列出**所有人**的已刪頁面標題 | ❌ 未修 | `listTrash` 只 `assertMember` → §5 |

### 1.5 觸控拖曳

| 項目 | 結果 | 備註 |
|---|---|---|
| **側邊欄頁面樹** | ✅ 本來就能動 | `@kennote/ui` 的 dnd 是 pointer events + `TOUCH_HOLD_MS = 400`；實測 390×844 長按 700ms → `html.kn-dragging === true` |
| 資料庫表格列 | ❌→✅ **BUG-34**（已實作最小版） | 原本是 HTML5 DnD，手機不會觸發 `dragstart`，而且把手只在 `mousemove` 時浮出 |
| 看板 / 日曆 / 屬性排序 / 排序規則 | ❌ 未修 | 同樣是 HTML5 DnD → §5 |

### 1.6 手機版（390 × 844）

| 項目 | 修正前 | 修正後 |
|---|---|---|
| 設定 Dialog 滿版 | ❌ `742.7 / 844`（88vh） | ✅ **BUG-33** 實測 `x 0, y 0, w 390, h 844` —— 真的 100dvh |
| Dialog 斷點 | ⚠️ `@kennote/ui` 用 640px、web app 用 767px（641～767 之間錯位） | ✅ 統一成 767px |
| 垃圾桶 footer（新增清空按鈕） | — | ✅ `flex-wrap`，手機下按鈕 36px 高 |

---

## 2. Bug 清單

### BUG-29｜任何工作區成員（含 guest）都能永久刪除別人的頁面（已修，**需部署 server**）· 嚴重度：**最高（不可逆的資料破壞 + 權限漏洞）**

**重現**（遠端站台實測，node `fetch` 直打 API）

1. A 開一個工作區、建一頁
2. A `POST /api/workspaces/:ws/invites` 把 B 邀成 **`guest`**，
   **完全不給 B 任何頁面授權**
3. A `DELETE /api/pages/:id`（丟垃圾桶）
4. B `DELETE /api/pages/:id/permanent` → **200**

```
invite guest -> 201 {"status":"joined","member":{"role":"guest",...}}
A delete -> 200
B PERMANENT DELETE -> 200 {"data":{"ok":true}}
B restore -> 404 PAGE_NOT_FOUND     ← 已經 hard delete，A 也救不回來了
```

`hardDeleteSubtree()` 是真正的 `DELETE FROM blocks / pages`，**沒有回頭路**。
`restorePage` 有同一個洞（破壞性較低）。

**根因**

兩支都只做 `repo.findPageForUser(pageId, userId, tx, { includeDeleted: true })`，
而那支只 JOIN `workspace_members`：

```sql
FROM pages p
JOIN workspace_members m
  ON m.workspace_id = p.workspace_id AND m.user_id = $2 AND m.deleted_at IS NULL
```

它只回答「**你是不是這個工作區的人**」，不看任何權限等級。

第五輪 BUG-27 把 `patchPage` / `deletePage` / `movePage` 都補上
`requirePagePermission(…, 'edit')` 了，**刻意跳過**這兩支，理由寫在當時的報告裡：
`resolvePagePermission()` 對 `deleted_at !== null` 的頁面一律回 `'none'`，
直接套會連擁有者都 404。理由是對的，但「先不補」留下來的是一個更嚴重的洞。

**修法**

已刪除的頁面沒有「現在的權限」可言，所以不能問 `resolvePagePermission()`，
要換一個問題：**誰有資格處置這份殘骸**。新增
`requireTrashedPageControl()` / `canControlTrashedPage()`（`permissions/service.ts`）：

1. 工作區 `owner` / `admin`
2. 頁面的建立者（`created_by`）
3. 把它丟進垃圾桶的人 —— schema 沒有 `deleted_by`，
   但 `softDeleteSubtree()` 軟刪除時會把 `updated_by` 設成操作者，用它當代理欄位

其他人 → 403；完全不是工作區成員 → 404（維持不洩漏存在性的慣例）。
另外 `permanentlyDeletePage` 補了「不在垃圾桶裡就不給永久刪除」
（原本可以繞過軟刪除，直接 hard delete 一個還活著的頁面）。

**一起補的：批次「清空垃圾桶」**

後端完全沒有批次端點（`gc/` 裡也沒有），UI 只能一頁一頁按。
新增 `DELETE /api/trash?workspaceId=` → `emptyTrash()`：逐頁套用同一組判斷，
**刪不了的跳過**而不是整批失敗（不然只要垃圾桶裡有一頁別人的東西，
member 就永遠清不掉），回 `{ deleted, skipped }`，
前端據此提示「N 頁不是你的，已保留」。一頁一個 transaction，
中途出錯不會把已刪的拖回來。

**回歸測試**
- 單元：`apps/server/test/permissions-resolve.test.ts` →「垃圾桶裡的頁面該由誰處置」4 條
- e2e：`e2e/functional-round6.spec.ts` → BUG-29 兩條，目前 `test.fixme`
  （遠端還是舊 server）。**部署後改回 `test` 就會綠**。

---

### BUG-30｜「@提及 → 通知」整條鏈路從 UI 完全走不到（已修）· 嚴重度：**高**

**重現**

1. 在留言框打「請 @小明 看一下」→ 送出
2. 小明的收件匣**永遠是空的**（`unread: 0`）

**根因**

三層都對得上，只差中間那一塊：

- 後端 `extractMentionedUserIds(body)` 只認 `atom === 'mention'` 的節點，讀 `data.userId`
- `fanOutNotifications()` 照著它扇出 `type: 'mention'` 的通知 —— **是好的**
  （本輪用 API 直送一個 mention atom 實測，B 的收件匣立刻收到）
- 但留言框送出去的 body 來自 `features/comments/api.ts` 的：

```ts
/** 把輸入框的純文字轉成 RichText；`@name` 之後會由編輯器版的 mention atom 取代 */
export function plainToBody(text: string): RichText {
  const trimmed = text.trim();
  return trimmed.length > 0 ? [{ text: trimmed }] : [];
}
```

那個「之後」沒有來。留言框**永遠**只送得出一個純文字節點，
`mentionedUserIds` 永遠是空陣列。

編輯器裡的 `MentionMenu` 倒是插得出正確的 atom，但**後端只掃留言的 body，
不掃 block 的 content**，所以那條路也不會產生通知（見 §5）。
結論：整個提及功能在產品上是不存在的。

**修法**

`plainToBody(text, members)` 改成會解析 `@某人`：`@` 之後的字串**完整等於**
某個成員的顯示名稱或 email 本地部分（大小寫不計）才換成 atom，
比不到就原樣留成文字 —— 刻意保守，不能把使用者打的「@下午三點開會」吃掉。
**長名字優先比**，避免「小明」先吃掉「小明華」的前綴。
`CommentsPanel`（面板與每個討論串的回覆框）與 `CommentPopover`（行內留言框）
都接上 `useWorkspaceMembers()`。

**一起補的：頁面追蹤 / 靜音**

`POST /api/notifications/subscriptions` 從 M5 就在，但全 repo `grep` 下去
**前端沒有任何呼叫端** —— 「追蹤這一頁 / 不要再通知我」在 UI 上做不到。
`TopBar` 的 ⋯ 選單補了兩項，並在 `stores/notifications.ts` 加上
`setPageSubscription()`。
⚠️ 後端目前只是把 `kind` 存起來：`listPageSubscribers()` 至今**沒有任何呼叫端**，
扇出只看「被提及的人 + 討論串參與者」，所以 `explicit` 還不會讓你收到別人的編輯通知，
`muted` 也還沒被讀到（§5）。

**回歸測試**：單元 `apps/web/src/features/comments/__tests__/mention.test.ts` 8 條；
e2e「提及 → 通知 → 標為已讀 → 全部已讀」。

---

### BUG-31｜分享彈窗邀不了 guest，一按邀請就把人放進整個工作區（已修）· 嚴重度：**中**

**重現**：分享彈窗 → 輸入 email → 邀請 → 對方變成 `member`。

**根因**：`SharePopover.tsx` 的 `invite()` 寫死 `role: 'member'`
（`SettingsDialog.tsx` 也有一份）。而 `member` 的 baseline 是
**對這個工作區的每一頁都 `edit`** —— 「我只想讓他看這一頁」在 UI 上做不到，
`WORKSPACE_ROLE_CEILING.guest = 'comment'` 那整套邏輯從產品上**完全碰不到**。
後端 `inviteSchema` 一直是 `z.enum(['admin','member','guest'])`。

**修法**：加一個 `[data-invite-role]` 下拉（成員 / 訪客）＋一行說明
（選訪客時寫「訪客只能留言，看不到你沒有明確分享的頁面」）。

**實測**：390 與桌機都正常，選項文字 `['成員（可編輯）', '訪客（只能留言）']`。

---

### BUG-32｜guest / 唯讀使用者看得到完整的編輯 UI（已修）· 嚴重度：**中**

三處都是「後端會 403，但使用者是按下去才發現不行」：

1. **整頁資料庫完全沒有問過權限** —— `DatabaseRoute.tsx` 從來沒呼叫
   `usePagePermission()`，`<DatabaseView>` 的 `readOnly` 一直是預設的 `false`。
   `features/database/**` 底下所有 `!readOnly` 的 gate（新增列、改儲存格、
   改屬性、刪列、批次操作…）對 read / comment 權限的人**全開**。
   修法：照 `PageRoute.tsx` 的算法接上
   （`canEdit === false` 才鎖，`null`＝還在載入時不鎖，免得閃一下唯讀）。
2. **留言框對只有 `read` 權限的人也顯示** —— `CommentsPanel` 的
   `canComment` 預設 `true`，`AppShell` 沒傳。
3. **「還原成這個版本」對沒有 edit 權限的人也能按** —— `HistoryPanel` 的
   `canRestore` 預設 `true`，同樣沒人傳。

---

### BUG-33｜手機版設定 Dialog 不是真的滿版（已修）· 嚴重度：**低**

第五輪量到 `742.7 / 844`，當時只記「要找出是哪一層把高度吃掉了」。

**根因**：不是 `Dialog.module.css`（它的 `@media (max-width: 640px)` 給了
`.panel { height: 100% }`），而是 `SettingsDialog.module.css` 的
`.dialog { height: min(800px, 88vh) }` —— **兩者特異度相同 `(0,1,0)`**，
而 app 端的 CSS module chunk 排在 `@kennote/ui` 之後，所以 `.dialog` 永遠贏。
88vh × 844 = **742.7px**，數字對得上。

順手修掉同一族的另外兩個：

- **斷點不一致**：`Dialog.module.css` 用 640px，`SettingsDialog` 與 shell
  其他地方全用 767px → 641～767px 之間會拿到
  「堆疊的手機 nav + 桌機的置中圓角面板」。統一成 767px。
- `vh` 改 `100dvh`（`vh` 留作 fallback）：行動瀏覽器的網址列會吃掉 `vh` 的底部。

**實測**：390×844 下 `[role="dialog"]` 的 box = `x 0, y 0, w 390, h 844`。

---

### BUG-34｜資料庫表格在觸控下完全沒有排序的路（已實作最小版）· 嚴重度：**中**

側邊欄的頁面樹用的是 `@kennote/ui` 的 dnd（pointer events + `TOUCH_HOLD_MS = 400`），
**觸控本來就能動**（本輪實測確認）。但 `features/database/**` 完全沒用那一套，
走的是自己的 `_fallback/dnd.ts`（原生 HTML5 DnD）。兩個問題疊在一起：

1. 行動瀏覽器**不會**從觸控觸發 `dragstart`
2. 把手 `[data-row-handle]` 只在 `onMouseMove` 時才浮出來 —— 手機上連把手都看不到

**修法（最小版）**：`TableView` 的列補一條**只看 touch** 的路，
語意對齊 `@kennote/ui`：長按 400ms 啟動、期間移動超過 5px 視為想捲動就取消；
啟動後用 `elementFromPoint` 找目前指在哪一列，沿用既有的 `dropAfter` 指示線與
`commitDrop()`。滑鼠行為一個位元都沒動。

**正解**是整個 database 改用 `useDraggable` / `useDroppable`，
但那是跨 5 個 view 的改動；看板 / 日曆 / 屬性排序 / 排序規則仍然是觸控死的（§5）。

---

## 3. 設計決定：分享給「工作區外」的使用者

第五輪 §4-3 留下來要先確認「這是設計還是缺口」。**結論：是缺口，本輪實作最小版。**

原本 `resolvePermission()` 第一行就是：

```ts
if (!workspaceRole) return 'none';   // 不是成員 → 一律看不到
```

配合 `findPageForUser()` 的 INNER JOIN，**只寫頁面層級授權、沒把人加進工作區時，
對方連 `GET /snapshot` 都 404**。所以分享彈窗只好在邀請時把人塞進整個工作區當
`member`（baseline = 對每一頁都 `edit`）—— 這正是 BUG-31 的成因。
`page_permissions` 實質上只是「已經在工作區裡的人」的加值，
真正的「分享給外人」只剩匿名公開連結一條路（而這個站台 `FEATURE_PUBLIC_SHARE=false`）。

**決定**：非成員也能被頁面層級授權，但範圍收到最緊：

| 規則 | 理由 |
|---|---|
| 只有**直接指名他**的 `subject_type = 'user'` 條目算數 | `workspace` 條目的語意是「給成員的」；`public` 條目走 `resolvePublicPermission` |
| **沒有 baseline**：沒被指名 → `none` | 其他頁面照樣 404 |
| **封頂在 `edit`**，永遠拿不到 `full` | 外人不能再分享出去、不能改這一頁的權限 |
| 「建立者視同 full」不適用 | 非成員本來就不可能是建立者 |
| tree / search / trash / favorites **完全不動** | 它們都先 `assertMember` 或 INNER JOIN `workspace_members`，非成員天生不在裡面 —— 這就是「只看得到那一頁」的保證 |
| `getPage` / `getSnapshot` 加一層 fallback（`findVisiblePage()`） | 成員照舊走原路；非成員再問一次 `resolvePagePermission()` |
| 新端點 `GET /api/pages/shared-with-me` + 側邊欄「與我共用」區 | 不然被分享的人在側邊欄什麼都看不到，只能靠別人把網址貼給他 |

`shared-with-me` 只列**直接**的 user 條目（不展開繼承鏈），
而且排除「我已經是那個工作區成員」的頁面（那些本來就在私人樹裡，不重複列）。
子頁面照樣點得進去（`getPage` 的 fallback 會沿繼承鏈解析），只是不佔側邊欄的位置。

WS 訂閱不必動：`ws.ts` 本來就是問 `resolvePagePermission()`，跟著一起通。

---

## 4. 改了哪些檔案

| 檔案 | 內容 | 需部署 |
|---|---|---|
| `apps/server/src/modules/permissions/service.ts` | **BUG-29** `requireTrashedPageControl` / `canControlTrashedPage`；§3 非成員往下走 | ⚠️ **後端** |
| `apps/server/src/modules/permissions/resolve.ts` | §3：`workspaceRole === null` 的分支（只認直接 user 條目，封頂 edit） | ⚠️ **後端** |
| `apps/server/src/modules/permissions/repo.ts` | `findPageMetaWithActor`（多帶 `updated_by`） | ⚠️ **後端** |
| `apps/server/src/modules/pages/service.ts` | **BUG-29**：`permanentlyDeletePage` / `restorePage` 補檢查、`emptyTrash()`；§3：`findVisiblePage()` fallback | ⚠️ **後端** |
| `apps/server/src/modules/pages/repo.ts` | `findPageActorMeta`（`emptyTrash` 逐頁判斷用） | ⚠️ **後端** |
| `apps/server/src/modules/pages/favorites.ts` | §3：`listSharedWithMe()` | ⚠️ **後端** |
| `apps/server/src/modules/pages/routes.ts` | §3：`GET /api/pages/shared-with-me` | ⚠️ **後端** |
| `apps/server/src/app.ts` | **BUG-29**：`DELETE /api/trash`（清空垃圾桶） | ⚠️ **後端** |
| `apps/web/src/features/comments/api.ts` | **BUG-30**：`plainToBody(text, members)` 解析 `@某人` | 前端 |
| `apps/web/src/features/comments/{CommentsPanel,CommentPopover}.tsx` | BUG-30：接上 `useWorkspaceMembers()` | 前端 |
| `apps/web/src/features/share/SharePopover.tsx` + `.module.css` | **BUG-31**：邀請角色下拉 + 說明 | 前端 |
| `apps/web/src/routes/DatabaseRoute.tsx` | **BUG-32**：整頁資料庫接上 `usePagePermission` | 前端 |
| `apps/web/src/features/shell/AppShell.tsx` | BUG-32：`canComment` / `canRestore` 接上權限 | 前端 |
| `apps/web/src/features/shell/TopBar.tsx` | BUG-30：⋯選單補「追蹤 / 靜音這個頁面」 | 前端 |
| `apps/web/src/stores/notifications.ts` | BUG-30：`setPageSubscription()` | 前端 |
| `apps/web/src/features/trash/TrashPopover.tsx` + `.module.css` | 清空垃圾桶按鈕（含 skipped 的提示） | 前端 |
| `apps/web/src/features/page-tree/Sidebar.tsx` | §3：「與我共用」區 | 前端 |
| `apps/web/src/lib/queries.ts` | `emptyTrash()` / `useSharedWithMe()` / `SHELL_ROUTES.sharedWithMe` | 前端 |
| `apps/web/src/lib/api-client.ts` | `api.delete` 支援 query（`DELETE /api/trash?workspaceId=`） | 前端 |
| `apps/web/src/features/database/views/table/TableView.tsx` | **BUG-34**：列的觸控長按拖曳 | 前端 |
| `apps/web/src/features/settings/SettingsDialog.module.css` | **BUG-33**：手機 100dvh + 斷點 767px | 前端 |
| `packages/ui/src/components/Dialog.module.css` | BUG-33：斷點 640 → 767px、`100dvh` | 前端 |
| `apps/server/test/permissions-resolve.test.ts` | 第六輪 9 條（非成員授權 5 + 垃圾桶處置 4） | — |
| `apps/web/src/features/comments/__tests__/mention.test.ts` | **新檔**：BUG-30 的 8 條 | — |
| `e2e/functional-round6.spec.ts` | **新檔**：11 條（3 條 `test.fixme` = 等後端部署） | — |

**沒有碰**：`packages/editor-core`、`packages/ui/src/dnd/**`、
`lib/{sync-client,ot-client}.ts`、前幾輪的 e2e 檔。
沒有加 runtime 套件、沒有 git commit。

### 驗收

```
pnpm -r typecheck                    ✅ 8/8 專案通過
pnpm --filter @kennote/web test      ✅ 17 檔 / 333 條（新增 8 條）
pnpm --filter @kennote/server test   ✅ 25 檔 / 385 條（3 檔 skip：需要 DATABASE_URL_TEST）
```

前端修正在本機 vite（`:5307`，proxy 指向遠端）實測通過：
手機設定 Dialog `390×844`、邀請角色下拉兩個選項、
側邊欄觸控長按 700ms 後 `html.kn-dragging === true`。

```
BASE_URL=http://127.0.0.1:5307 npx playwright test functional-round6.spec.ts
                                     ✅ 8 passed / 3 skipped
```

3 條 `skipped` = `test.fixme`，全是本輪的**後端**修正（BUG-29 兩條 + §3 一條），
**部署後把 `test.fixme` 改回 `test` 就會綠**。

寫測試時踩到的三個點（留給下一輪）：
- `bucketVersions()` 會把短時間內同一個人的 tx **併成同一個版本**，
  所以不能斷言「改兩次 = 兩個版本」
- `[aria-label="通知"]` 會撞到兩個（側邊欄入口鈕 + 面板），要鎖 `aside`
- 分享彈窗用 `goto('/page/:id')` 進去時**開不起來**（頂欄按鈕點得到，
  但 popover 不出現），走點側邊欄的正常導覽路徑才穩 —— 這本身可能是個 bug，
  但沒有穩定重現，先記著

---

## 5. 未走查 / 未修（留給第七輪）

### 權限洩漏（優先）

1. **側邊欄的頁面樹洩漏整個工作區的標題**。`getWorkspaceTree(workspaceId)`
   **連 `userId` 都沒收**，只在 route 層驗成員身分，SQL 裡沒有任何 per-page 過濾。
   結果：`WORKSPACE_ROLE_BASELINE.guest === 'none'` 的 guest 也看得到
   **每一頁的標題與樹狀結構**（點進去才 404）。
   搜尋有兩層過濾（SQL 的 JOIN + 應用層的 `filterByPagePermission`），
   樹完全沒有 —— 這是目前最大的「權限沒有下推到查詢層」缺口。
2. **垃圾桶同樣洩漏**：`listTrash(workspaceId)` 沒收 `userId`，
   guest 看得到工作區裡每一個已刪頁面的標題。
   BUG-29 讓他刪不掉了，但還是看得到。

### 協作

3. **頁面 block 裡的 `@提及` 不會產生通知** —— `fanOutNotifications` 只在
   `comments/service.ts` 被呼叫，`applyTransaction` 那條路沒有扇出。
   編輯器的 `MentionMenu` 插得出正確的 atom，白插的。
   （`e2e/functional-round6.spec.ts` 有一條測試把這個現況釘住，修好之後要把斷言反過來。）
4. **`listPageSubscribers()` 是 dead code**（全 repo 零呼叫端）：
   追蹤 / 靜音存得進去但沒有人讀 → `explicit` 收不到編輯通知、`muted` 靜不了音。
5. **`notificationGroupKey()` 也沒人用**：`fanOutNotifications` 從不傳 `groupKey`，
   所以 repo 裡那條 `ON CONFLICT (recipient_id, group_key) … DO NOTHING`
   的 5 分鐘去重形同虛設。
6. `Notification` 的 7 種型別裡，**只有 3 種產得出來**
   （`mention` / `comment_reply` / `comment_resolved`）。
   `page_shared` / `invite` / `permission_changed` / `page_updated` 沒有任何發送端。
7. **點通知跳頁後不會捲到那個討論串**：`InboxRoute` 只用 `pageId`，
   把 `discussionId` 丟掉了。
8. **版本預覽時編輯器顯示的還是現在的內容**：`AppShell` 把
   `onPreview(seq, snapshot)` 的第二個參數丟掉，歷史內容只在右側面板以純文字列出。
   使用者看到「編輯已停用」的橫幅卻看到現在的字，很容易誤會。
9. **`restoreVersion` 超過 200 ops 會切成多筆 transaction**，每筆各自 atomic，
   **整批不是**。中途失敗會留下半還原的狀態。

### 觸控 / 手機

10. 看板卡片、日曆、`PropertyList`、`SortBuilder` 的拖曳仍是 HTML5 DnD → 觸控全死。
    正解是統一改用 `@kennote/ui` 的 dnd。
11. **`/settings` 這個 URL 不存在**（第五輪 §4-11 記成「路由存在但不開 Dialog」，
    實際上 `App.tsx` 根本沒宣告，會掉到 `NotFoundRoute`）。
    設定是 store 裡的 overlay，不支援深連結。
12. 資料庫表格橫捲（連續四輪沒碰）。

### 其他

13. `duplicatePage` 只有 `findPageForUser`，沒有權限檢查 —— 只有 `read` 權限的人
    可以把整棵子樹複製成自己的頁面（等於繞過唯讀）。**本輪沒改**，下一輪確認。
14. `SharePopover` 的 `entryPermission()` 在成員沒有條目時寫死 fallback `'edit'`，
    對 guest 是錯的（他實際上是 `none`）。
15. 第五輪 §4 的編輯器 5～9 項（媒體 URL、拖放上傳、程式碼語言切換、
    block selection 的複製貼上、Word/GDocs 剪貼簿）仍未走。
16. `database-gaps.md` §4 的 6 項。

---

## 6. 觀察

- **這一輪三個最嚴重的問題型態一模一樣：後端是好的，前端沒有呼叫端 / 沒有判斷。**
  第五輪 §5 已經記過「`features/export` 寫好了沒人 import」，這一輪又中三次
  （`plainToBody` 不做 mention、`/subscriptions` 零呼叫端、`DatabaseRoute` 不問權限）。
  建議把「每個後端端點至少有一個前端呼叫端」做成一次性的掃描 ——
  TypeScript 完全不會報這種洞。
- **「預設值是寬鬆的」是 BUG-32 的共同根因**：`canComment = true`、
  `canRestore = true`、`readOnly = false`。權限相關的 prop 預設值應該一律取嚴的那一邊，
  讓「忘記傳」變成顯而易見的壞掉，而不是靜默的漏洞。
- **「先不補」會留下比原本更糟的洞**：BUG-29 的成因是第五輪判斷
  「`resolvePagePermission` 不適用，先跳過」—— 判斷是對的，但跳過之後那條路
  一點保護都沒有。下次遇到「這支不適用現有的守門員」應該當場設計替代判斷，
  不要只記進 TODO。
- **`resolvePagePermission()` 的兩個 early return 撐起了一堆隱性行為**
  （`deleted_at !== null` → none、`!workspaceRole` → none）。
  第五輪被第一個絆到、這一輪被第二個絆到。這種「一個純函式的前兩行決定了
  整個產品能不能分享」的地方值得在程式裡寫得更顯眼。
- **`@kennote/ui` 的 dnd 是對的，database 自己另外做了一套** ——
  `_fallback/dnd.ts` 的檔頭寫「不需要任何套件」，但套件就在同一個 monorepo 裡，
  而且觸控支援得好好的。`TableView.tsx` 的註解甚至寫著
  「與側邊欄 / 看板同一套」，那是錯的。
- **CSS module 的跨套件特異度衝突**（BUG-33）沒有任何工具會警告：
  `@kennote/ui` 的 `.panel` 與 app 的 `.dialog` 都是 `(0,1,0)`，誰贏完全看 chunk 順序。
  元件庫想讓呼叫端覆寫得動就該明確一點（例如用 `:where()` 降特異度，
  或提供 CSS 變數）。
- 測試環境：`POST /api/auth/open` 有 rate limit，探索腳本開帳號要有 backoff；
  本機 vite 代理時頂欄仍然顯示「尚未連線」（WebSocket 沒跟著 proxy），與三～五輪相同。
