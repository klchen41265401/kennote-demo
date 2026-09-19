# 回歸分診第一輪（全量 e2e 的 4 條紅燈）

- 日期：2026-09-20
- 受測站台：`http://100.74.148.92:8090`（已部署到 `e2f1b2b` ＝第八輪的後端）
- 起點：一次**無干擾的全量 e2e**（`npx playwright test`，78 條）
  → **73 passed / 4 failed / 1 skipped**（34.1 分鐘）
- 驗證環境：本機 `vite --port 5310 --strictPort` + `VITE_PROXY_TARGET=http://100.74.148.92:8090`
  （`http://localhost:5310/`），加上 node `fetch` 直打遠端 API
- **刻意沒碰**：`packages/editor-core`；沒有加 runtime 套件；沒有 git commit

> 這一輪只回答一個問題：**哪幾條是產品回歸，哪幾條是測試沒跟上新行為？**
> 結論是 **2 條產品缺陷（前端，都會讓使用者打的字消失）＋ 3 條測試過時**
> —— 第 2 條是修完第 1 條、把測試改成「等條件」之後才**露出來**的。
> 而那 1 條回歸**不是第七 / 八輪造成的** —— 那兩輪 `apps/web` 與 `packages/editor-core`
> 一行都沒改（`git diff --stat 99dba87..HEAD -- apps/web packages/editor-core` 是空的）。
> 它是第五 / 六輪那批「重建編輯器不要掉字」的修正一起帶進來的**時序競態**，
> 只在「一個 block 都沒有的頁面」上才看得見 —— 全量 e2e 是第一次把它照出來。

---

## 1. 分診表

| # | 失敗的測試 | 判定 | 根因所在 | 需部署 |
|---|---|---|---|---|
| 1 | `functional-round3.spec.ts:231` 資料庫列以整頁開啟後可以加 block，重整後還在 | ❌ **產品回歸**（掉資料） | `apps/web`：sync 的 attach 晚於編輯器建立 | ⚠️ **前端** |
| 1b | 同上（修完 1 之後仍間歇紅） | ❌ **產品缺陷**（打字沒進編輯器） | `apps/web`：OT 探測回來 → 編輯器重建 → 焦點掉回 `<body>` | ⚠️ **前端** |
| 2 | `functional-round4.spec.ts:163` BUG-13 `@` 選單的今天用本地時區 | 🧪 測試過時（固定秒數不夠） | `e2e/functional-round4.spec.ts` 的 `openPage()` | — |
| 3 | `functional-round6.spec.ts:423` 提及 → 通知 → 標為已讀 → 全部已讀 | 🧪 測試過時（第七輪多了 `invite` 通知） | `e2e/functional-round6.spec.ts` | — |
| 4 | `functional-round7.spec.ts:163` BUG-35 guest 讀不到未被授權的頁面 | 🧪 測試自己寫錯（404 沒有 `data`） | `e2e/functional-round7.spec.ts` 的 `api()` helper | — |

**後端一行都沒改**，第七 / 八輪已部署的修正全部維持原狀。

---

## 2. #1 — 產品回歸：資料庫「列」頁打的字會整段消失（已修，**需部署前端**）· 嚴重度：**高**

### 重現（100%）

```
BASE_URL=http://127.0.0.1:5310 npx playwright test functional-round3.spec.ts \
  -g "資料庫列以整頁開啟後可以加 block"
→ Expected substring: "列頁新增的段落" / Received string: ""
```

手動路徑：建一個資料庫 → 新增一列 → 在列上「以整頁開啟」（`/page/:rowId`）
→ 在內文打字 → 重整 → **打的字不見，頁面是空的**。

### 先排除後端

直打遠端 API，後端從頭到尾是對的：

```
POST /api/pages                       201  children: [1 個 block]   ← 一般頁面有種子 block
POST /api/databases/:id/rows          201
GET  /api/pages/:rowId/snapshot       200  rootBlockIds: []         ← 列頁本來就 0 個 block
POST /api/pages/:rowId/transactions   200  block.insert → seq 1
GET  /api/pages/:rowId/snapshot       200  rootBlockIds: [那一個]    ← 寫得進去、讀得回來
```

`createRow()` 只 `insertPage()`，**不會建任何 block** —— 列頁天生 `rootBlockIds: []`。
這是既有設計，第七輪的 `buildPermissionIndex` 與第八輪的 `findPageInUserWorkspace`
改名都沒有碰到它（列頁的 `resolvePagePermission` 回 `full`，snapshot 是 200）。

### 根因（前端的 mount 時序競態）

把瀏覽器的 WebSocket 與 `fetch` 都攔下來看，鏈路是這樣的：

```
GET /snapshot → rootBlockIds: []
useEditorHost 的 useLayoutEffect 建編輯器
  └─ 「空頁面：補一個段落」→ instance.insertBlockAfter(null, { type: 'paragraph' })
     └─ localOps → syncRef.current.submit([block.insert …])
        └─ SyncClient.submit(): this.pages.get(pageId) === undefined → return  ⛔ ops 靜悄悄消失
（很久以後）usePageSync 的 useEffect 才跑 → attachPage() → WS subscribe
使用者打字 → OT 通道送 text.delta（blockId ＝那個伺服器不認識的 block）
  ← txRejected { code: "BLOCK_NOT_FOUND" }
     └─ onRollback → reload() → 重抓 snapshot（還是 []）→ 換 reloadToken → 整頁重建
        └─ 又補一個空段落 …（剛打的字全部丟掉）
```

兩個獨立的缺陷疊在一起：

1. **effect 順序**：`useEditorHost()` 先呼叫 `usePageSync()`（它註冊的是 `useEffect`），
   後面才用 `useLayoutEffect` 建編輯器。React 的 layout effect **一律**排在 passive
   effect 之前 —— 所以「建編輯器並送出第一批 op」永遠早於 `attachPage()`。
2. **`SyncClient.submit()` 對還沒 attach 的頁面直接 `return`**：沒有 log、沒有佇列、
   沒有錯誤，ops 就這樣不見了。這是一條**靜默掉資料**的路徑。

為什麼只有列頁看得到：一般頁面 `createPage()` 會種一個 block，
`startDoc.rootIds.length === 0` 不成立，編輯器在 mount 當下**不送任何 op**，
競態就沒有東西可以掉。列頁是這個 repo 裡唯一 0 個 block 的頁面。

為什麼第三輪是綠的：第五輪 BUG-20 為了「切換鎖定不要掉字」加了 `liveDocRef`、
第六輪把 `usePagePermission` 接進 `PageRoute`（`readOnly` 進了 effect 依賴陣列），
mount 當下的重建次數與時序都變了，這條競態才穩定地踩下去。
**第七 / 八輪沒有動過前端**，純粹是這一輪的全量 e2e 第一次跑到它。

### 修法（兩層，都在 `apps/web`）

1. `stores/sync.ts`：`usePageSync()` 的 attach 從 `useEffect` 改成 **`useLayoutEffect`**。
   同一個元件裡 effect 依**呼叫順序**執行，`usePageSync()` 在 `useEditorHost()` 的
   編輯器 layout effect **之前**被呼叫，所以 attach 保證先發生。
2. `lib/sync-client.ts`：`submit()` 遇到「這一頁還沒 attach」**不再丟掉**，
   改成收進 `preAttach` 佇列（每頁上限 200 個 op），`attachPage()` 時照原順序補送。
   第 1 點修的是這一個現場，第 2 點修的是**這一類**現場
   （宿主的 mount 順序再變一次也不會掉資料）。

修完之後同一條鏈路：

```
[WS->] subscribe
[WS->] tx { block.insert }      ← 種子段落真的送出去了
[WS<-] txApplied seq 1
[WS->] tx { text.delta }        ← 打字打在伺服器認得的 block 上
[WS<-] txApplied seq 2, 3
GET /snapshot → rootBlockIds: [1 個]，content: [{ "text": "列頁新增的段落" }]
```

### 釘住它

`apps/web/src/lib/sync-client.test.ts` 新增 1 條：
**「attach 之前送進來的 ops 不會被丟掉，attach 後照原順序補送」**。
把 `submit()` 改回 `if (!entry) return;` 這一條就紅 —— 已實測確認過。

### 連帶挖出來的第二個缺陷（#1b）：OT 探測回來會把編輯器砸掉，焦點跟著不見

把 #1 修好、再把測試從「等 3 秒」改成「poll 到伺服器真的有那段字」之後，
同一條測試還是**間歇性**紅，而且錯誤訊息變得很清楚：

```
seq: 1, rootBlockIds: [一個 block], content: []
```

種子段落**存進去了**（seq 1），但打的字**一個 byte 都沒送出去**。
不是掉資料，是編輯器根本沒收到鍵盤事件。

根因在 `useOtEnabled()`：

```ts
const [enabled, setEnabled] = useState(() => getCachedOtFlag() ?? false);
useEffect(() => { … resolveOtEnabled(GET /api/health).then(setEnabled) }, []);
```

它是「**先回 false → 探測回來 → setState(true)**」，而 `otEnabled` 在
`useEditorHost` 那個 `useLayoutEffect` 的依賴陣列裡 ——
所以**每個 session 的第一個編輯器一定會被 destroy 再重建一次**，
時機是開頁後 0.5～2 秒（站台忙的時候更晚）。

第五輪的 `liveDocRef` 讓**內容**活過了重建，但**焦點**沒有：
舊的 `contenteditable` 被 destroy，焦點掉回 `<body>`，
使用者在那之後敲的鍵一個都不會進編輯器。
使用者看到的是「開頁後馬上打字，前幾個字或整段沒出現」。

**修法**：`useEditorHost` 在重建時把 selection 一起接回去 ——
`selectionChange` 時記下最後一個非 `none` 的 selection（`liveSelRef`，
與 `liveDocRef` 同一個 `docKey` 機制），新實例建好後 `instance.setSelection()` 接回。
**只有同一個 `docKey` 的重建才接**，所以第一次開頁不會被搶焦點
（開頁自動 focus 不是現在的行為，不能順便改掉）。
`setSelection` 包在 `try/catch` 裡：那個 block 可能已經不在了，接不回去也不能讓整頁建不起來。

修完之後同一條測試跑 4 次全綠，而且**從 18 秒掉到 7.6 秒** ——
原本那 10 秒是 poll 在等一筆永遠不會來的 delta。

> 這一條是「把固定秒數換成等條件」的直接收益：
> 原本 `waitForTimeout(3000)` 把這個缺陷蓋掉了一半（有時候剛好等到重建之後才打字），
> 換成 poll 之後它才穩定地現形。**測試等得越準，缺陷藏得越少。**

---

## 3. #2 — 測試過時：`openPage()` 等固定 3.5 秒不夠

```
Error: 文件裡至少要有一個 block
expect(received).toBeTruthy()   Received: null
```

`lastTopBlockId()` 拿到 `null` 不是「頁面沒有 block」，而是
**`.kn-editor-host` 這個節點還不存在** —— snapshot 還沒回來時 `PageRoute` 畫的是 `Skeleton`。

實測：同一條測試**單獨**跑，本機 vite **11.5 秒**、遠端站台 **1.2 分鐘**（6 倍）。
全量 e2e 連續打 34 分鐘的情況下，`await page.waitForTimeout(3500)` 就不夠了。
這不是產品回歸（單跑一直是綠的，後端 snapshot 也一直是對的），是**測試用牆鐘計時**。

**修法**：`openPage()` 改成等「編輯器真的畫出第一個 block」
（`page.locator('.kn-editor-host [data-block-id]').first().waitFor({ state: 'visible', timeout: 45_000 })`），
畫出來之後再給同步層 800ms 安定。round4 的 9 個 `openPage()` 呼叫端一起受惠。

**同一類的另外三處**（都在本輪的重跑中真的紅過，紅法都是「看起來像掉資料」）：

| 位置 | 原本 | 改成 |
|---|---|---|
| `functional-round3.spec.ts` 列整頁那一條 | 打完字 `waitForTimeout(3000)` 就重整；重整後 `waitForTimeout(4000)` | 先 poll `GET /snapshot` 直到**伺服器真的有那段字**，重整後等 block 畫出來 |
| `functional-round4.spec.ts` slash 那一條 | 重整後 `waitForTimeout(5000)` 就比對整份結構 | 等第一個 block + `expect.poll(blockDump).toEqual(before)` |
| `realtime.spec.ts` 兩分頁收斂那一條 | 雙方打完 `waitForTimeout(2500)` 就嚴格相等 | poll「兩邊都看得到三段字」之後才嚴格相等 |

列整頁那一條特別值得說：把「等 3 秒」換成「poll 到伺服器有」之後，
測試斷言的東西**變強了** —— 它現在先證明「真的存進去了」，再證明「重整後讀得回來」。
原本那 3 秒同時在測兩件事，忙的時候先倒在第一件，錯誤訊息卻指向第二件。

---

## 4. #3 — 測試過時：第七輪的 `invite` 通知讓未讀數多 1

```
expect(received).toBe(expected)   Expected: 0   Received: 1
```

測試的流程是「A 邀 B 當 member → A 在留言裡 @B → B 把**那一則** mention 標成已讀
→ 斷言未讀數 == 0」。

**第七輪 BUG-39** 之後 `inviteMember()` 會對「已經有帳號的受邀者」多發一則
`invite` 通知（同一輪還接上了 `page_shared` 與 `page_updated`）。
所以 B 的收件匣裡本來就不只 mention 那一則 —— 把 mention 標成已讀之後，
未讀數是 **1（那一則 invite）**，不是 0。

第六輪寫「未讀 == 0」時 `invite` 根本沒有發送端，所以那是**巧合成立**的斷言。
**通知數量增加是這一輪的新行為，不是 bug** → 測試跟著改。

**修法**：這一段釘的是「標為已讀真的生效」，所以改成只看那一則本身
（poll `readAt !== null`）＋「`mention` 型別沒有任何未讀」。
「全部已讀 → 未讀 0」那一段原封不動 —— 那裡才是真正該斷言未讀歸零的地方。
順手加了 `inboxOf()` helper。

---

## 5. #4 — 測試自己寫錯：404 的回應沒有 `data`

```
expect(received).not.toContain(expected)
Matcher error: received value must not be null nor undefined
Received has value: undefined
```

第 180 行 `expect(snapshotRes.status).toBe(404)` 是**過的** ——
**BUG-35 的修正在遠端是好的**。紅的是下一行：

```ts
expect(JSON.stringify(snapshotRes.data), '內容一個字都不能外流').not.toContain('1234');
```

`api()` helper 回的是 `JSON.parse(text).data`，而錯誤的 envelope 是
`{ error: { code, message } }` —— **404 沒有 `data`**，於是 `data === undefined`，
`JSON.stringify(undefined)` 也是 `undefined`（不是字串），matcher 直接噴掉。

這一條在第七輪是 `test.fixme`、第八輪沒有重跑，所以這行斷言**從來沒有真的跑過**。

**修法**：`api()` 多回一個 `raw`（整份回應原文），洩漏斷言改打 `raw`。
這樣比原本**更嚴格** —— 連錯誤訊息裡夾帶內容都會被抓到。

---

## 6. 順手修的測試穩定性（不改任何斷言）

全量 e2e 的干擾源之一是 `POST /api/auth/open` 的 write rate limit
（第六～八輪的報告都記過）。第八輪只在 `functional-round8.spec.ts` 的 `signIn()`
補了 backoff，第六 / 七輪沒有 —— 而這兩支**每一條都開兩個帳號**，最容易撞到。
撞到的症狀是停在 `/login`、接著 `/api/auth/me` 回 401、
錯誤訊息變成「第二個帳號要登得進去」，看起來像權限 bug。

- `signIn()` 換成第八輪那一套 backoff（1.5s × n，最多 5 次）。
  一開始只補 `functional-round6/7`，後來 `database-gaps.spec.ts` 也在護欄重跑時
  被同一件事擋在 `/login`，所以**同一個形狀的 `signIn()` 一次補齊**：
  `database-gaps` / `functional-round2` / `3` / `4` / `5`。
  （`functional-round1` 與 `realtime` 的 `signIn()` 是另一種形狀 ——
  先試 email/password 再退到訪客 —— 這一輪刻意沒動它們。）
- 再加一個小防護：guest 按鈕點下去的瞬間頁面可能已經在導頁
  （`element was detached from the DOM`）—— 那不是失敗，判準是 URL，
  所以把 `click()` 的例外吞掉。

（這兩條都在本輪的重跑中實際發生過，各紅一次。）

另外三處固定 `waitForTimeout` 也在重跑中紅過（見 §3 的表）。
其中 `realtime.spec.ts` 的收斂那一條值得留個紀錄，因為它最容易被誤判成同步層的 bug：

```
Expected: "BBBBAAAACCCC"   Received: "BBBBAAAA"
```

接在 `database-gaps` 的 1000 列測試後面跑時，2.5 秒不夠讓最後一筆 delta 傳到另一個分頁。
單跑 4 次全綠，**與這一輪同步層的改動無關**（改動只影響「attach 之前送出的 op」）。

---

## 7. 改了哪些檔案

| 檔案 | 內容 | 需部署 |
|---|---|---|
| `apps/web/src/stores/sync.ts` | **#1**：`usePageSync()` 的 attach 改 `useLayoutEffect`（要早於編輯器的 layout effect） | ⚠️ **前端** |
| `apps/web/src/lib/sync-client.ts` | **#1**：`submit()` 對未 attach 的頁面改成進 `preAttach` 佇列，`attachPage()` 補送 | ⚠️ **前端** |
| `apps/web/src/features/editor/useEditorHost.ts` | **#1b**：重建編輯器時把 selection 接回去（`liveSelRef`） | ⚠️ **前端** |
| `apps/web/src/lib/sync-client.test.ts` | 新增 1 條釘住 `preAttach`；`setup()` 多一個 `attach: false` 選項 | — |
| `e2e/functional-round3.spec.ts` | **#1 的測試**：重整前 poll `GET /snapshot` 確認已存檔，重整後等 block 畫出來 | — |
| `e2e/functional-round4.spec.ts` | **#2**：`openPage()` 等編輯器畫出第一個 block，不等固定秒數；slash 那一條重整後改 poll | — |
| `e2e/functional-round6.spec.ts` | **#3**：已讀斷言只看那一則 / `mention` 型別；新增 `inboxOf()`；`signIn()` backoff | — |
| `e2e/functional-round7.spec.ts` | **#4**：`api()` 多回 `raw`，洩漏斷言改打 `raw`；`signIn()` backoff | — |
| `e2e/realtime.spec.ts` | 收斂斷言改成 poll，不等固定 2.5 秒（護欄重跑時紅過一次） | — |
| `e2e/database-gaps.spec.ts`、`functional-round2/5.spec.ts` | `signIn()` 補同一套 backoff（rate limit） | — |
| `docs/qa/regression-triage-1.md` | 本報告 | — |

**後端一行都沒改。** 沒有碰 `packages/editor-core`、沒有加 runtime 套件、沒有 git commit。

### 驗收

```
pnpm -r typecheck                    ✅ 8/8 專案通過
pnpm --filter @kennote/web test      ✅ 17 檔 / 334 條（新增 1 條）
pnpm --filter @kennote/server test   ✅ 28 檔 / 410 條（3 檔 skip：需要 DATABASE_URL_TEST）

BASE_URL=http://127.0.0.1:5310 npx playwright test \
  functional-round3.spec.ts functional-round4.spec.ts     ✅ 12 passed
BASE_URL=http://127.0.0.1:5310 npx playwright test \
  functional-round6.spec.ts functional-round7.spec.ts     ✅ 19 passed / 1 skipped
BASE_URL=http://127.0.0.1:5310 npx playwright test \
  realtime.spec.ts database-gaps.spec.ts \
  functional-round1.spec.ts functional-round2.spec.ts     ✅ 16 passed（同步層改動的風險面）
BASE_URL=http://127.0.0.1:5310 npx playwright test realtime.spec.ts       ✅ ×5（收斂那一條）
```

`#1` / `#1b` 的修正在**本機 vite 立刻生效**；遠端站台要等**前端**重新部署才會好
（這是第五輪以來第一次有「需部署前端」的項目）。**後端不必動。**

---

## 8. 未修 / 留給下一輪

1. **`GET /api/files/:id` 只做到工作區成員限定**（第八輪 §4-1，仍是最優先的洞）。
2. **WS 房間在權限被撤銷後不會把人踢出去**（第七輪 §4-4、第八輪 §4-3，連兩輪未走查）。
3. **搜尋的 guest 過濾仍未取得正例**（第八輪 §4-2，明寫「未驗證」）。
4. `permission_changed` 沒有發送端；`SharePopover` 的 `entryPermission()` 對 guest
   寫死 fallback `'edit'`（第六輪 §5-14）。
5. **列頁的種子段落應該由後端建，而不是前端補。**
   這一輪是把前端的掉資料補起來，但「`createRow()` 不建 block、前端進來再補一個並寫回去」
   本身就是一個奇怪的分工：任何一個讀 snapshot 的客戶端都會各補一個，
   多人同時開同一列就會長出多個空段落（本輪重現時實際看到伺服器上留了 **2 個**空 block）。
   建議第九輪評估在 `createRow()` 裡種一個段落，前端那段 fallback 就能退成純防禦。
6. **`SyncClient.submitDelta()` 也有同一個 early return**（`if (!entry) return txId;`）。
   這一輪沒有動它：delta 只會在編輯器 mount 之後由使用者打字觸發，
   而 attach 現在保證早於編輯器建立，所以構不成現場。
   但它和 `submit()` 是同一個形狀的洞 —— 第九輪要嘛一起接上 `preAttach`，
   要嘛至少讓它在 dev build 噴一聲。
7. 第七輪 §4 的協作 5～8、觸控 9～13 全部仍未動。

---

## 9. 觀察

- **「靜默丟掉」比「丟出錯誤」危險得多。**
  `SyncClient.submit()` 的 `if (!entry) return;` 只有一行、看起來像防禦性程式，
  實際上是一條掉資料的路：沒有 log、沒有佇列、沒有 rollback，
  使用者看到的是「我打的字重整後不見了」。
  **寫入路徑上的 early return 一律要問「這些資料去哪了」** ——
  丟不掉的東西要嘛排隊、要嘛炸掉，不能吞。
- **layout effect 與 passive effect 的順序是 API 的一部分。**
  「宿主在 layout effect 裡建編輯器、同步層在 passive effect 裡 attach」
  這個順序沒有寫在任何地方，卻決定了第一批 op 會不會活下來。
  兩個 hook 在同一個元件裡的話，**有寫入副作用的那一邊必須先註冊**。
- **只有一種資料形狀踩得到的 bug，要靠那一種形狀的測試守著。**
  這條競態只在 `rootIds.length === 0` 時成立，而整個 repo 只有資料庫的「列」
  是這種頁面。`functional-round3` 那條看起來很邊緣的走查測試是唯一會紅的東西 ——
  **「邊緣」的測試往往守著唯一的那條分支。**
- **固定 `waitForTimeout` 在「單跑」與「全量跑」之間不等價。**
  同一條測試單跑 11 秒、全量跑 70 秒以上（遠端站台被連續打）。
  用牆鐘計時的測試會在**最忙的時候**紅，而那正是最難判讀的時候
  —— #2 的錯誤訊息是「文件裡至少要有一個 block」，讀起來像掉資料。
  **等條件，不要等時間。**
- **`test.fixme` 的斷言從來沒有被執行過。**
  #4 那一行是第七輪寫下、第八輪沒重跑、這一輪第一次真的跑 —— 它自己就是錯的。
  解開 `fixme` 的那一輪要**逐行**看一次，不能只看「變綠了嗎」：
  第 180 行綠、第 181 行紅，代表**修正是好的、測試是壞的**，兩者要分開判讀。
- **新增一種通知就是改變所有「數未讀」的測試的前提。**
  #3 的 `expect(unread).toBe(0)` 在第六輪是對的、在第七輪變成錯的，
  而中間沒有任何人改過那一行。**計數型斷言要綁型別 / 綁那一筆，不要綁總數。**
- **修好一個缺陷，會讓下一個缺陷露出來。**
  #1b（焦點）一直都在，但 #1（ops 被丟掉）比它更早倒，錯誤訊息永遠停在第一個。
  而且原本那個 `waitForTimeout(3000)` 有時候剛好等到重建之後才打字，
  把 #1b 蓋掉了一半。**紅燈是排隊的**：修完第一個要再跑幾次，不要看到綠就收工。
- **重建 UI 元件時，狀態不是只有資料。**
  第五輪已經想到「重建時內容不能掉」（`liveDocRef`），但焦點 / 游標同樣是狀態。
  「這個元件被 destroy 再建一次，使用者會失去什麼？」——
  內容、游標、捲動位置、IME 組字中的字，每一項都要點名。
- **全量跑才照得出來的東西，值得固定跑。**
  這一輪處理到的問題裡有一半（#1b 的重建時機、#2 的等待時間、§6 的 rate limit
  與三處 `waitForTimeout`）只有在「連續跑幾十分鐘」的壓力下才會現形。
  逐檔跑是開發迴圈，**全量跑是驗收迴圈**，兩者不能互相取代。
