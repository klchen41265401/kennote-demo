# 功能 QA 第十二輪（O-31 / O-32 的反轉・hover-only 的一般化・`/settings`）

- 日期：2026-09-20
- 起點：`docs/qa/functional-round11.md` §9 的第 2、3、4 項（O-31 / O-32 / hover-only 掃描）
  與 README「仍然開著」的 **O-12**
- 線上站 `http://100.74.148.92:8090` 已是第十一輪的 commit（`ac3b70a`）。
  本輪的 e2e 打的是**本機 vite（`--port 5313`）+ 遠端 API**：11 條全綠。
- **刻意沒碰**：`packages/editor-core`；沒有加 runtime 套件；沒有 git commit
- **需部署**：**無**（本輪沒有後端改動）

> 這一輪的主題只有一句：
> **第十一輪交出的兩個「產品缺陷」，兩個都不是產品缺陷。**
> O-31 死在測試的 locator 上，O-32 死在 grep 的字串上。
> 兩個都被寫進報告、寫進 README 的「仍然開著」、各配了一條 `fixme` 或一段警語 ——
> 然後在下一輪被當成起點。**錯誤的觀察會被歸檔，而歸檔會讓它看起來像事實。**

---

## 1. O-31：手機上的列 peek 從頭到尾都是好的

第十一輪 §7 的結論是：

> BUG-53 修完之後按鈕看得見、點得到，但點完 DOM 上**一個 `[role="dialog"]` 都沒有**
> ——`DatabaseView` 的 `setPeekRowId()` 看起來沒有讓 `RowPeek` 掛上來。

而且還補了一條方法論：「**下一輪先查「有沒有掛上來」，不要先調 CSS**」。
那句話是對的，只是它假設了一件沒有被查證的事：**那一下點到的是列上的「開啟」鈕。**

R11-13 的寫法是：

```ts
await b.p2.getByRole('button', { name: /開啟|展開/ }).first().click();
```

390×844 的頁面上，DOM 第 0 個按鈕是**側邊欄的收合鈕**：

```
{ i: 0, aria: "開啟側邊欄", rect: { x: 8, y: 6, w: 28, h: 28 } }
...
{ i: 24, text: "開啟", cls: "_openButton_…", rect: { x: 99, y: 318, w: 54, h: 20 } }
```

`「開啟側邊欄」.includes(「開啟」)` —— 模糊比對先抓到它，`.first()` 定案。
於是那一下把側邊欄拉開了，當然不會有 `[role="dialog"]`。

改成 `name: '開啟', exact: true` 之後，同一份 commit、同一個 390×844：

```
DIALOGS AFTER CLICK: [{ cls: "_dialogSide_…", w: 390, h: 844, x: 0, vw: 390 }]
```

**滿版、貼齊、內容是對的那一列。** 第十一輪加的 `.dialogSide` 斷點一直都是對的。

### 1-1 ⭐ 同一個 locator 還製造了兩盞假綠燈

比「O-31 是誤判」更嚴重的是：**同一行寫法在別的地方是綠的，而那些綠燈也是假的。**

| 測試 | 原本的斷言 | 它實際量到的東西 |
|---|---|---|
| `functional-round11.spec.ts` R11-11 | 「手機上列 peek 的開啟鈕必須看得見（BUG-53）」 | 側邊欄的收合鈕——手機上它**一定**看得見 |
| `functional-round10.spec.ts` R10-8 | `test.skip(!opened, '手機寬度下找不到列 peek 的開啟鈕')` | 同上，所以 **skip 永遠不會觸發**，後面「沒有東西比視窗寬」在畫面上根本沒有 peek 的情況下白白變綠 |

R10-8 裡甚至寫著「第一輪分診 §9 的教訓：**沒有被執行到的斷言不算綠**」——
那個防護是對的，但它防的是 `skip`，而 `skip` 的條件本身量錯了元素。
**守門員站對了位置，看的卻是另一個球。**

> **可及名稱只要是別人的前綴，模糊比對就會指錯人。**
> `/開啟/` 會吃掉「開啟側邊欄」「開啟設定」「開啟連結」——
> 而指錯人的那一次**不會報錯**：按鈕存在、點得下去、不會 timeout。
> 它只是回答了另一個問題。
>
> 這是第十輪「沉默的失敗會被讀成資料」在**測試程式碼**裡的版本：
> 第十輪講的是前端把 400 吞成「找不到」，這一輪是測試把「點錯按鈕」
> 吞成「元件沒渲染」。兩者都是**一個看起來合理的錯誤答案**。

R12-1 現在把三件事分開驗：按鈕看得見 → 點下去有 dialog → **dialog 裡是那一列**
（最後一條用 `toHaveValue`，因為 peek 的標題是 `<input>`，`getByText` 對 value 永遠找不到東西）。

---

## 2. O-32：properties 面板一直都有兩個入口

第十一輪 §7 的原句：

> `DatabaseHeader.tsx` 裡 `panel?.kind === 'properties'` 有一個完整的 `<Popover>`，
> 但**全檔案沒有任何一處呼叫 `open('properties', …)`**。

這句話**逐字都是對的**，而結論是錯的。入口不長那個樣子：

```
⋯（toolButton aria-label="設定"）→ open('more', e)
  → <ViewSettingsPanel onOpen={(kind) => setPanel({ kind, anchor: panel.anchor })}>
      · Row「屬性能見度  4 ›」 → onOpen('properties')
      · Row「編輯屬性      ›」 → onOpen('properties')
```

`open()` 是 `DatabaseHeader` 內部的小工具（`setPanel({ kind, anchor: e.currentTarget })`），
子面板拿不到那顆按鈕的 `MouseEvent`，所以走的是 `onOpen` → `setPanel` 這條。
實測（桌機 1440）：

```
PANEL TEXT: 瀏覽模式設定表格 版面配置 表格 / 屬性能見度 4 / 篩選 / 排序 / 分組 /
            條件式顏色 / 拷貝瀏覽模式連結 / 資料來源設定 / 編輯屬性 / 自動化 …
AFTER EDIT: 此視圖顯示的屬性 Aa名稱 ≡標籤 ▾狀態 ▤日期 新增屬性
addProp 1 · hideBtn 4
```

顯示／隱藏、排序、新增屬性**全部都在**，而且 `sheetOnMobile` 在 390 上量到
滿寬、貼底的 bottom sheet（R12-4）。

> ⭐ **grep 找的是實作的寫法，不是使用者的路徑。**
> `open('properties'` 找不到，是因為這個入口**跨了一層元件**——
> 一邊是 `onOpen(kind)`、另一邊是 `setPanel({ kind, … })`，
> 字串 `'properties'` 在中途變成了一個叫 `kind` 的變數。
>
> 這跟第六輪「前端沒有呼叫端」是**相反**的錯誤：
> 那一輪是「grep 到了、但沒人真的呼叫」，這一輪是「grep 不到、但路是通的」。
> 兩個都只能靠**走一次使用者的路**來分辨。

R12-2 / R12-3 把它釘住，而且刻意分成兩條：**面板打得開**與**面板上的動作有作用**。
只驗前者的話，一個渲染得出來但 `onChangeFormat` 沒接的面板也會變綠
（第十一輪 §6-3 才剛講過同一件事）。R12-3 因此去數表格的欄位標頭：隱藏一個屬性 → 少一欄。

---

## 3. hover-only 的一般化（第十一輪 §9 第 4 項）

第十一輪 BUG-53 的原話是「**hover-only 的入口在觸控裝置上等於不存在**」，
並且交代下一輪「掃一次全站 `:hover` 才顯形的互動元素，那是一張可以一次列完的清單」。

掃完是 **22 條**規則，其中 **16 條**是「基底隱藏 + `:hover` 才顯形」的入口：

| 檔案 | 入口 | 觸控上原本的狀態 |
|---|---|---|
| `styles/editor.css` | 頁面標題上方「新增圖示 / 封面 / 留言」 | 不存在 |
| | 封面的「變更 / 重新定位 / 移除」 | 不存在 |
| | 圖片影片的工具列、調整大小把手、「新增說明文字」 | 不存在 |
| | 表格 block 的加列 / 加欄、button block 設定、synced block 來源列 | 不存在 |
| `features/page-tree/Sidebar.module.css` | 工作區箭頭、分段的「+ / ⋯」、展開三角、每一列的「+ / ⋯」 | 不存在（側邊欄等於唯讀） |
| `features/database/views/calendar/CalendarView.module.css` | 格子裡的 `+`（在某一天新增一筆） | 不存在 |
| `features/database/views/table/TableView.module.css` | 「開啟」鈕、列勾選框 | 見下 |

### 3-1 ⭐ 斷點選錯了一個維度

第十一輪的修正全部寫在 `@media (max-width: 767px)` 裡。**那個判準是錯的。**

會撞到 hover-only 的條件是**沒有滑鼠**，不是**螢幕很窄**：

| 裝置 | 寬度 | 有 hover？ | 767px 斷點救得到？ |
|---|---|---|---|
| iPhone 直立 | 390 | ✗ | ✅ |
| iPad 橫置 | 1180 | ✗ | ❌ **漏掉** |
| 觸控筆電 | 1440 | ✗ | ❌ **漏掉** |
| 桌機視窗縮到 700 | 700 | ✓ | 多此一舉（有滑鼠，不需要常駐） |

正解是 `@media (hover: none)`，而且 repo 裡**早就有一份寫對的**：
`styles/shell.css` §4 的頂欄動作列從一開始就是 `@media (hover: hover)`，
註解甚至直接寫著「觸控裝置沒有 hover，直接常駐顯示」。
`Sidebar.module.css` 第 85 行也有一份 —— 只是**只套到了收合鈕那一顆**。

> **同一個判準在同一個 repo 裡有兩種寫法，就一定有一種在漏東西。**
> 這是第十一輪「同一個問題解決兩次，就會有一次是錯的」的變體：
> 那一輪是兩份實作打架，這一輪是兩份實作**涵蓋範圍不一樣**，
> 而涵蓋少的那一份不會壞、只會安靜地少救幾台裝置。

本輪把四個檔案統一成 `(hover: none)`，`TableView` 的 767px 區塊**保留不動**
（它還管首欄陰影與名稱欄寬，那兩條真的是寬度問題），只把「開啟鈕 / 勾選框」
這兩條輸入方式的規則搬進 `(hover: none)`。

`.rowCheckbox` 要**連同** `.titleCell > :first-child` 的 20px 讓位一起放：
那條 padding 本來就是為了避開勾選框寫的，只放出勾選框會讓它壓在名稱文字上。
**成對出現的規則就要成對搬。**

### 3-2 ⭐ 為什麼這十幾條躲過了前十一輪

BUG-53 是 `display: none`，所以第十輪一撞就撞到了（按鈕點不到、Playwright 直接 timeout）。
**其餘的全部是 `opacity: 0`** —— 而 `opacity: 0` 的元素在 Playwright 眼中
**仍然是 `visible`**（它有盒模型、沒有 `display: none`、沒有 `visibility: hidden`）。

所以：

> **`toBeVisible()` 驗不出 hover-only。**
> 走查的人用桌機看，每一次都看得見；自動化用 `toBeVisible()`，每一次都是綠的。
> 兩條路都回答「有」，而使用者的手指拿不到它。

R12-5 / R12-6 因此**量 `getComputedStyle().opacity`**，R12-7 量 `display`，
而且 R12-6 / R12-7 刻意跑在 **1180×820 + `hasTouch`**（iPad 橫置）——
在舊的 767px 斷點下，這兩條會紅。

---

## 4. O-12：`/settings` 這個網址

`App.tsx` 沒有宣告 `/settings`，所以它掉到 `NotFoundRoute`：書籤失效、
「到 `/settings/members` 邀請成員」這句話講不通、重新整理會丟掉正在填的分頁。

做法是**讓網址驅動既有的 overlay**，不是再做一份設定畫面
（設定 UI 只有 `SettingsDialog` 一份，`AppShell` 在 `overlay === 'settings'` 時渲染它）。
新增 `routes/SettingsRoute.tsx`：網址 → `openOverlay('settings', { settingsTab })`，
關閉 → 網址離開 `/settings`；底下照樣畫 `HomeRoute`
（redirect 到 `/` 會把網址丟掉，那就等於沒修）。

### 4-1 ⭐ 兩個 effect 讀的是同一張快照

第一版 R12-8 是紅的：`/settings` 進去一瞬間就跳回首頁。

```tsx
useEffect(() => { openOverlay('settings', …); }, [tab]);
useEffect(() => { if (ui.overlay === null) navigate('/'); }, [ui.overlay]);  // ← 掛載當下就跑
```

兩個 effect 是在**同一次 render 之後**依序跑的，第二個讀到的 `ui.overlay`
還是那一次 render 的快照 —— 也就是 `null`。於是它在掛載的瞬間
「偵測到使用者關掉了設定」。

> **「狀態還沒被設起來」與「使用者把它關掉了」在同一個值上長得一模一樣。**
> 要分開就得記住自己曾經看過它是開的（一個 `useRef` 旗標）。
> 這和第十輪 BUG-50「`pointercancel` 被當成 `pointerup`」是同一個形狀：
> **兩個語意不同的事件收斂成同一個值，就一定要靠額外的狀態把它們分回來。**

不認得的分頁名（`/settings/nope`）導回預設分頁而不是 404：
使用者要的是「設定」，分頁名打錯不該變成「找不到這個頁面」。

---

## 5. Bug 清單

| # | 嚴重度 | 位置 | 狀態 |
|---|---|---|---|
| BUG-57 | **中** | `e2e` 三處 `name: /開啟|展開/` + `.first()` 指到側邊欄收合鈕，**造成一個誤判（O-31）與兩盞假綠燈**（R11-11、R10-8） | 已修 |
| BUG-58 | 中 | 全站 16 個 hover-only 入口在**任何**觸控裝置上不存在；第十一輪的修正用 `max-width: 767px`，漏掉 768px 以上的觸控裝置 | 已修 |
| BUG-59 | 中 | `/settings`、`/settings/:tab` 掉到 404（O-12） | 已修 |
| BUG-60 | 低 | `SettingsRoute` 的關閉偵測在掛載當下誤觸發（見 §4-1，本輪自產自修） | 已修 |

**O-31 / O-32 不計入 bug**：實測下來它們不是缺陷，是前一輪的觀察錯誤。

---

## 6. 改了哪些檔案

| 檔案 | 改動 |
|---|---|
| `apps/web/src/routes/SettingsRoute.tsx` | **新增**：`/settings`、`/settings/:tab`（O-12） |
| `apps/web/src/App.tsx` | 掛上兩條 settings 路由 |
| `apps/web/src/styles/editor.css` | `@media (hover: none)`：標題工具列 / 封面 / 媒體 / 表格 / button / synced / 說明文字 |
| `apps/web/src/features/page-tree/Sidebar.module.css` | `@media (hover: none)`：工作區箭頭、分段動作、三角、列動作 |
| `apps/web/src/features/database/views/calendar/CalendarView.module.css` | `@media (hover: none)`：格子裡的 `+` |
| `apps/web/src/features/database/views/table/TableView.module.css` | `@media (hover: none)`：開啟鈕 + 列勾選框（連同 `.titleCell` 的 20px 讓位） |
| `e2e/functional-round11.spec.ts` | R11-11 / R11-13 的 locator 改 `exact`；**R11-13 解開 `fixme` 並跑綠** |
| `e2e/functional-round10.spec.ts` | R10-8 同一個 locator 修正 |
| `e2e/functional-round12.spec.ts` | **新增**：11 條，全綠 |
| `docs/qa/functional-round12.md` | **新增**：本文件 |
| `docs/qa/README.md` | O-12 / O-31 / O-32 結案，新增 O-33 |

驗收：`pnpm -r typecheck` ✅ · `@kennote/web` ✅（335）· `@kennote/server` ✅（423）
· e2e `functional-round12.spec.ts` **11 passed**（本機 vite + 遠端 API）
· `functional-round11.spec.ts` 的 R11-11 / R11-13 ✅（**`fixme` 全部解開**）

---

## 7. 未修 / 留給第十三輪

1. **O-16 / O-17 / O-18** 原樣延後（看板列選取、拖曳排序的鍵盤替代路徑、`manualOrder`）。
   其中 **O-17 應該提前**：本輪讓觸控看得到列勾選框與排序清單，
   但**鍵盤**仍然沒有排序的替代路徑（`PropertyList` / `SortBuilder` 只有 pointer）。
2. **O-15**：一般 block 的觸控拖曳搬移仍無替代路徑。
3. **O-33（新）**：`DatabaseHeader` 的 ⋯ 按鈕用 `aria-label="設定"`，
   與側邊欄底部的「設定」**同名**。一個頁面上兩顆可及名稱相同、功能完全不同的按鈕
   —— 螢幕閱讀器分不出來，`getByRole('button', { name: '設定' })` 也分不出來
   （本輪的 `openDbMore()` 只好用 class 限定範圍）。
   Notion 那一顆是「⋯ 更多選項」。**改名會動到 `functional-round2.spec.ts`
   與 `compare.spec.ts` 的既有選擇器，所以本輪沒動**，留成獨立一項。
4. `permission_changed` 仍沒有發送端（連六輪）。
5. O-14（編輯器 5 項）、O-19～O-30 原樣延後。

---

## 8. 觀察

- **錯誤的觀察會被歸檔，而歸檔會讓它看起來像事實。**
  O-31 / O-32 各自被寫進報告 §7、README 的「仍然開著」、以及一條 `fixme` 的長註解。
  三個地方互相引用，讀起來像三份證據，其實是同一次沒有查證的推論抄了三遍。
  第七輪立的紅線是「沒實測就明寫『未驗證』」—— 這兩項**有實測**，
  只是**實測量錯了對象**。紅線要再補一句：**寫下結論前先確認自己動到的是哪個元素。**
- **可及名稱的前綴關係是測試的沉默殺手。** `/開啟/` 吃掉「開啟側邊欄」時
  不會 timeout、不會報錯，只會回答另一個問題。
  凡是 `getByRole(..., { name: /短詞/ })` + `.first()`，都要問一句
  「這個頁面上還有誰的名字以它開頭」。
- **`toBeVisible()` 驗不出 hover-only。** `opacity: 0` 在 Playwright 眼中是 visible。
  這解釋了為什麼 16 個入口躲過了十一輪：走查的人用桌機看得見，
  自動化用 `toBeVisible()` 也說看得見。**要量的是 `opacity` / `display`，不是「可見」。**
- **判準選錯維度，不會壞，只會少救幾台裝置。** `max-width: 767px` 修對了手機、
  漏掉 iPad 橫置與觸控筆電，而漏掉的部分**沒有任何測試會紅**。
  同一個 repo 裡 `shell.css` 早就寫著 `(hover: hover)` ——
  **正解就在隔壁檔案，只是沒有人去對一次。**
- **兩個語意不同的狀態收斂成同一個值，就要靠額外狀態分回來。**
  `SettingsRoute` 的「還沒開」與「被關掉」都是 `overlay === null`；
  第十輪 BUG-50 的 `pointercancel` 與 `pointerup` 也都走到同一個 handler。
  形狀一樣，修法也一樣：記住前一個狀態。
