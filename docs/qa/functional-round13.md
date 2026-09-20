# 功能 QA 第十三輪（仍開著的 O-nn 結案：`permission_changed` / O-17 / O-33 / O-20 / O-22）

- 日期：2026-09-20
- 起點：`docs/qa/README.md` §二「仍然開著的項目」與 `functional-round12.md` §7
- 線上站 `http://100.74.148.92:8090` 是 `b1fdc8e`。本輪的 e2e 打的是
  **本機 vite（`--port 5314`）+ 遠端 API**：6 條全綠。
- **刻意沒碰**：`packages/editor-core`；沒有加 runtime 套件；沒有 git commit
- **需部署**：**有**（`apps/server/src/modules/permissions/service.ts` 與
  `notifications/fanout.ts`，見 §1）

> 這一輪的主題：**「仍然開著」這張清單本身也需要被查證。**
> 第一項（`permission_changed` 沒有發送端）**從第十輪起就已經不成立了** ——
> 它在四份報告裡被連抄四次，而發送端一直好端端地待在 `permissions/service.ts:304`。
> 第十二輪剛寫下「錯誤的觀察會被歸檔，而歸檔會讓它看起來像事實」，
> 然後自己在同一份文件的 §7 抄了一條過期的待辦。

---

## 1. `permission_changed`：發送端早就在了，缺的是**另一個**出口

第十二輪 §7 第 4 項：

> `permission_changed` 仍沒有發送端（連六輪）。

`grep` 一次就結案：

```
apps/server/src/modules/permissions/service.ts:304:      void notifyPermissionChanged({
```

那是**第九輪**接上去的（`functional-round9.md` 的標題還寫著
「`permission_changed` 通知終於有發送端」），而且 `setPagePermission()` 裡
連 `page_shared` / `permission_changed` 的互斥都處理了：沒有舊條目 + 給權限
→ `page_shared`；有舊條目（升 / 降）或撤銷（`none`）→ `permission_changed`。

### 1-1 ⭐ 那為什麼四輪都寫「沒有」

因為第七、八輪寫的是**真的沒有**，第九輪修好了，而第十～十二輪
**沒有人再 grep 一次** —— 待辦清單是照抄的。

> **一份待辦只要沒有對應的測試，它就只能靠記憶維持正確。**
> 而記憶會抄。這跟第六輪「前端沒有呼叫端」是同一個病灶的兩端：
> 那一輪是**程式**沒有呼叫端，這一輪是**文件**沒有對應端 ——
> 兩者都靠「有人去走一次」才發現，而沒有人會主動去走一條看起來已知的路。

所以本輪不是只把它劃掉，而是**把它變成會紅的東西**：
`apps/server/test/notify-permission-changed.test.ts` 用
`route-permission-audit.test.ts` 的同一個模子掃原始碼，
斷言 `setPagePermission` / `changeMemberRole` / `removeMember`
三個出口都看得到發送端。下一次有人把它拿掉，測試會紅，而不是報告會錯。

### 1-2 真正缺的那一格：**工作區角色**

查證的過程中撞到一個真的洞。`changeMemberRole()` / `removeMember()` 只做了：

```ts
emitPermissionChange({ userId: targetUserId, pageId: null });
```

那是**重算 WebSocket 房間**的權限 —— 只救「現在正開著分頁的人」。
可是工作區角色是每一頁權限的 baseline / ceiling：
被從 admin 降成 guest、或整個被踢出工作區，影響範圍比任何**單一頁面**的撤權都大，
而它**一則通知都不會發**。沒開著分頁的人下次回來，只會發現東西不見了，
不知道是誰、在什麼時候動的。

> ⭐ **「即時廣播」不是「通知」。**
> `emitPermissionChange()` 與 `notify()` 長得像在做同一件事，
> 差別是**收件人不在線上時會怎樣**：前者什麼都不會留下，後者會留一筆。
> 第九輪把這件事在**頁面層**做對了，工作區層卻沿用了只有廣播的那一半。

修法：`notifyWorkspaceRoleChanged()`（`fanout.ts`），沿用 `permission_changed`
型別、`pageId` 留空（跟 `invite` 同一個形狀），`payload.scope = 'workspace'`。
收件匣據此分辨要顯示「調整了你在工作區的角色」還是「把你移出了工作區」——
共用型別但不共用句子，否則「把你移出了工作區」會顯示成
「調整了你的權限《（沒有頁面）》」。

**撤銷（`permission: 'none'`）一樣要送**：與第九輪頁面層的同一條紅線
（那是唯一一種「收件人現在沒有讀取權」仍然要送的通知）。

---

## 2. O-17：拖曳排序的鍵盤替代路徑

第十一輪把資料庫的拖放換成 Pointer Events，第十二輪讓 hover-only 的入口
在觸控上常駐 —— **兩輪都在處理指標**。而 `useSortableItem()` / `useCardDrag()`
綁的全部是 `onPointerDown`，把手還是：

```tsx
<span className={styles.dragHandle} {...handleProps} aria-hidden="true">
```

> ⭐ **`aria-hidden="true"` 的把手是「排序這件事對鍵盤不存在」的字面宣告。**
> 第十二輪修的是「看得見但摸不到」（`opacity: 0`），這一輪修的是
> 「摸得到但**宣告自己不存在**」。兩者的共同點：`toBeVisible()` 兩次都會回答「有」。

`apps/web/src/lib/keyboard-reorder.tsx` 提供兩件事，四個呼叫端共用：

| | 做什麼 |
|---|---|
| `useKeyboardReorder()` | 展開到把手上：把手變成 `<button tabindex="0">`，Alt + ↑/↓（看板是 ←/→）移動一格、Alt + Home/End 移到頭 / 尾 |
| `useReorderAnnouncer()` | 一個 `aria-live="polite"` 區域；每次移動播報「『標籤』已移到第 N 項，共 M 項」 |

接上的四處：`PropertyList`、`SortBuilder`、看板卡片（換欄）、側邊欄樹（上 / 下移，
另外在 ⋯ 選單補了「上移 / 下移」兩個項目 —— **Alt 組合鍵沒有人會自己猜到**）。

### 2-1 ⭐ 為什麼是 Alt，不是單押 ↑/↓

這些把手待在 Popover / 面板裡，方向鍵本身是 `Menu` 的 roving focus 巡覽鍵。
單押方向鍵會**同時**做兩件事。`reorderKeyTarget()` 因此有三態回傳：

- `number` → 搬到第幾個
- `'first'` / `'last'` → 已經在頭 / 尾，**要出聲但不搬**
- `null` → 不歸我管，**不要 `preventDefault()`**

第三態是重點：撞到邊界與「這個組合不是我的」在畫面上都是「沒有移動」，
但一個要吃掉事件、一個一定不能吃 —— 吃掉了，面板的巡覽就壞了。
（第十輪 BUG-50「`pointercancel` 被當成 `pointerup`」的同一個形狀：
**兩個語意不同的情況收斂成同一個外觀，就要靠額外的狀態分回來**。）

`apps/web` 沒有 `@testing-library/react`（本輪不加套件），所以把判斷抽成純函式，
`apps/web/src/lib/keyboard-reorder.test.ts` 驗 8 條；DOM 那一層交給 R13-2 / R13-3。

### 2-2 O-17 的後半：有排序條件時不該能拖

O-17 原文的第二句是「**且視圖有 `sort` 時仍可拖曳（Notion 是停用）**」。
手動順序寫的是 `pages.sort_key`，畫面順序來自 `view.query.sort` ——
兩者同時存在時，拖完放手、下一次重查就彈回去。

> 這不是「不會壞」，是**寫進去的東西看不見**。
> 使用者不會說「排序衝突」，只會說「拖曳有時候沒用」。
> 一個**不報錯的無效操作**比一個報錯的失敗更難查（第十輪「沉默的失敗」的同族）。

`TableView` 現在 `canReorderRows = !readOnly && reorderRow && !sortedByQuery`，
把手保留但停用（`data-reorder-disabled`、`title` 說明原因）——
**停用不是消失**：消失的話使用者只會覺得功能壞了，看不到原因。

---

## 3. O-33：一頁兩顆同名按鈕

`DatabaseHeader` 的 ⋯ 是 `aria-label="設定"`，側邊欄底部也是「設定」。
第十二輪的 `openDbMore()` 只好用 class 限定範圍 —— 而**螢幕閱讀器沒有 class 可以用**。

改成「資料庫設定」，同步更新 `functional-round2.spec.ts`（2 處）、
`compare.spec.ts`（`07m-db-settings` 那一列）、`functional-round12.spec.ts`
（順便把「不能用 getByRole」那段註解改掉 —— 現在可以了）。
`functional-round5/6.spec.ts` 的 `name: '設定', exact: true` **不受影響**：
它們要的本來就是側邊欄那一顆，改名之後反而變成唯一解。

R13-1 除了驗新名字打得開面板，還加一條：
`getByRole('button', { name: '設定', exact: true })` 的 count **必須 ≤ 1**。
驗「舊名字不再有兩個主人」才是這一項的重點，驗「新名字在」只是驗改了字串。

---

## 4. O-22：文件尾端的落點

最後一個 block 是 table / divider / image / 內嵌資料庫時，游標**沒有地方可以去**，
只剩 gutter 的 `+`（hover-only ——第十二輪剛修完的那一類入口）。

`Editor.tsx` 在 `kn-editor-host` 後面加一塊 96px 的落點。刻意用 `<button>`
而不是 `<div>`：跟 O-17 同一個理由，鍵盤要走得到（Tab → Enter）。

### 4-1 ⭐ 第一版的 R13-5 把「正確地沒有補」讀成「功能壞掉」

測試先 `insertBlock()` 再點落點，斷言 block 數 +1 —— 紅的（2 → 2）。
原因是 `createPage()` 本來就會種一個空段落（第九輪），
所以**最後一段已經是空的**，而「最後一段是空段落就只把游標放過去」
正是這個功能刻意的行為（不然每點一次就長一個空段落）。

> **測試的前置條件也是一種假設。** 這一條的斷言沒錯、實作也沒錯，
> 錯的是「我以為文件尾端是我插的那一段」。
> 第十二輪講的是「量錯了元素」，這一次是「量錯了**狀態**」。

改成驗兩條分支：空段落結尾 → 不補（只聚焦）；打字填滿 → 補一段；再點 → 又不補。

---

## 5. O-20（部分）：批次「加到收藏」

批次列原本只有「匯出 / 複製 / 刪除」。資料庫的**每一列就是一頁**，
所以「加到收藏」直接用側邊欄同一支 `setFavorite()` ——
不是資料庫自己的第二套收藏（第十一輪「同一個問題解決兩次，就會有一次是錯的」）。

**「移動到」仍未做**：`moveTo` overlay 一次只吃一個 `moveTargetId`，
要批次得先改那個 overlay 的形狀。O-20 因此降為「部分結案」而不是結案。

---

## 6. Bug 清單

| # | 嚴重度 | 位置 | 狀態 |
|---|---|---|---|
| BUG-61 | **中** | `changeMemberRole()` / `removeMember()` 只 `emitPermissionChange()`，**沒有任何通知**——不在線上的人完全不知道自己被降級 / 被踢出工作區（§1-2） | 已修 **需部署** |
| BUG-62 | 中 | 排序把手是 `aria-hidden="true"` 的 `<span>` + 只綁 `onPointerDown`：`PropertyList` / `SortBuilder` / 看板 / 側邊欄四處**對鍵盤完全不存在**（O-17） | 已修 |
| BUG-63 | 低 | 視圖有 `sort` 時仍可拖曳列，寫進 `sort_key` 的順序**下一次重查就消失**（O-17 後半） | 已修 |
| BUG-64 | 低 | `DatabaseHeader` 的 ⋯ 與側邊欄的「設定」同名（O-33） | 已修 |
| BUG-65 | 低 | 文件尾端沒有落點，最後一個 block 是物件型時游標無處可去（O-22） | 已修 |

**`permission_changed` 沒有發送端不計入 bug**：它從第九輪起就有發送端，
是**文件**過期，不是程式缺陷。

---

## 7. 改了哪些檔案

| 檔案 | 改動 |
|---|---|
| `apps/server/src/modules/notifications/fanout.ts` | **新增** `notifyWorkspaceRoleChanged()`（BUG-61）**需部署** |
| `apps/server/src/modules/permissions/service.ts` | `changeMemberRole` / `removeMember` 接上發送端 **需部署** |
| `apps/server/test/notify-permission-changed.test.ts` | **新增**：5 條（單元 + 掃原始碼的「有沒有呼叫端」稽核） |
| `apps/web/src/lib/keyboard-reorder.tsx` | **新增**：`useKeyboardReorder()` / `useReorderAnnouncer()` / `reorderKeyTarget()` |
| `apps/web/src/lib/keyboard-reorder.test.ts` | **新增**：8 條（純函式，含「沒有 Alt 一定要放行」） |
| `apps/web/src/features/database/PropertyList.tsx` | 把手改 `<button>` + Alt 鍵 + live region |
| `apps/web/src/features/database/SortBuilder.tsx` | 同上 |
| `apps/web/src/features/database/Builders.module.css` | `.dragHandle` 的按鈕重置 + `:focus-visible` |
| `apps/web/src/features/database/views/board/BoardView.tsx` | 新增 `BoardBody`（整個看板共用一個 live region）；卡片 Alt + ←/→ 換欄，與拖放共用 `moveRowToLane()` |
| `apps/web/src/features/page-tree/TreeRow.tsx` | `actions.reorder`、Alt + ↑/↓、⋯ 選單的「上移 / 下移」 |
| `apps/web/src/features/page-tree/Sidebar.tsx` | `reorderSibling()`（走 `movePage` 同一個出口）+ live region |
| `apps/web/src/features/database/views/table/TableView.tsx` | 有 `sort` 時停用拖曳把手（O-17 後半）；批次「加到收藏」（O-20） |
| `apps/web/src/features/database/views/table/TableView.module.css` | `.rowHandle[data-reorder-disabled]` |
| `apps/web/src/features/database/DatabaseHeader.tsx` | `aria-label` → 「資料庫設定」（O-33） |
| `apps/web/src/features/editor/Editor.tsx` | 文件尾端的落點（O-22） |
| `apps/web/src/styles/editor.css` | `.kn-editor-trailing` |
| `apps/web/src/features/notifications/InboxPanel.tsx` | `typeLabel()`：工作區層的 `permission_changed` 要講不同的句子 |
| `e2e/functional-round2.spec.ts` / `compare.spec.ts` / `functional-round12.spec.ts` | 「設定」→「資料庫設定」的選擇器 |
| `e2e/functional-round13.spec.ts` | **新增**：6 條，全綠 |
| `docs/qa/functional-round13.md` | **新增**：本文件 |
| `docs/qa/README.md` | O-17 / O-33 結案，O-20 部分、`permission_changed` 的待辦作廢 |

驗收：`pnpm -r typecheck` ✅ · `@kennote/web` ✅（343）· `@kennote/server` ✅（428）
· e2e `functional-round13.spec.ts` **6 passed**（本機 vite + 遠端 API）
· 回歸 `functional-round2.spec.ts` / `functional-round12.spec.ts` ✅（O-33 改名後）

---

## 8. 未修 / 留給第十四輪

1. **O-14**（編輯器 5 項）、**O-15**（一般 block 的觸控拖曳）原樣延後。
2. **O-16**（看板 / 圖庫 / 清單沒有列選取）、**O-18**（`manualOrder` 未接）原樣延後。
3. **O-20 只做了一半**：批次「移動到」要先讓 `moveTo` overlay 吃得下多個 id。
4. **O-19 / O-21 / O-23～O-30** 原樣延後。
5. **BUG-61 需部署**才驗得到端到端（本輪只有單元測試守著）。
6. 看板 / 側邊欄的鍵盤路徑本輪**只有手動走查 + 實作**，e2e 只釘了
   `PropertyList`（R13-2 / R13-3）。看板換欄與側邊欄上移的 e2e 留給下一輪 ——
   **這一句是明寫的「未驗證」**（第七輪的紅線）。

---

## 9. 觀察

- **一份待辦只要沒有對應的測試，它就只能靠記憶維持正確 —— 而記憶會抄。**
  `permission_changed` 的待辦跨四輪，每一輪都只是把上一輪的句子搬下來。
  第十二輪自己才寫下「錯誤的觀察會被歸檔」，然後在同一份文件裡歸檔了一條過期的。
  紅線再補一句：**「仍然開著」的清單，每一項在被引用前要重新 grep 一次**，
  或者——更好——**讓它變成一條會紅的測試**。
- **「即時廣播」不是「通知」。** `emitPermissionChange()` 與 `notify()`
  在程式碼裡看起來在做同一件事，差別只在「收件人不在線上時會怎樣」。
  頁面層兩個都做了，工作區層只做了會消失的那一半。
  **判斷一個出口完不完整，要問「離線的人會看到什麼」。**
- **`aria-hidden="true"` 是一句字面的宣告。** 第十二輪修的是「看得見但摸不到」，
  這一輪是「摸得到但宣告自己不存在」。`toBeVisible()` 兩次都回答「有」——
  a11y 的問題**沒有一條是 `toBeVisible()` 驗得出來的**，
  要量的是 tagName / tabIndex / aria-label / live region 的文字。
- **不報錯的無效操作比失敗更難查。** 有 `sort` 時拖曳會寫進 `sort_key`，
  然後被下一次查詢蓋掉 —— 沒有錯誤、沒有 log，只有「有時候沒用」。
  這類缺陷只會以「偶發」的形式被回報，而偶發的東西沒有人修得動。
- **測試的前置條件也是一種假設。** R13-5 第一版紅的原因是「我以為文件尾端
  是我插的那一段」，實際上後端種的空段落排在後面。
  第十二輪的教訓是「量錯了元素」，這一輪是「量錯了**狀態**」——
  下一句紅線：**斷言之前先把現場印一次**，不要相信自己布置的場景。
- **`.first()` 又咬了一次，而且咬在自己新加的元素上。** R13-2 第一版量
  `[data-kn-reorder-live]` 的 `.first()`，拿到的是側邊欄那個空的 live region
  （我自己在同一輪加的）。BUG-57 的形狀原封不動地重演了一次 ——
  **「這個頁面上還有誰？」這個問題，對自己剛加的元素也要問。**
