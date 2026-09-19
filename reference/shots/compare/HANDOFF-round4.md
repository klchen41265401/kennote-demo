# 第四輪視覺 QA — 交接筆記

> 寫給接手的代理。**先讀** `reference/shots/compare/README.md`（數字）與
> `NOTES-round4.md`（本輪改了什麼、為什麼）、`NOTES-round2.md`（Notion block 盒模型的全套實測值）。
> `HANDOFF-round2.md` §陷阱 與 `HANDOFF-round3.md` §4 的坑**照樣會踩**，先看一遍。
> 這一份只寫「還沒做完的事」「量到但還沒用上的數值」「第四輪新踩到的坑」。

---

## 0. 怎麼跑

```bash
cd apps/web && VITE_PROXY_TARGET=http://100.74.148.92:8090 node node_modules/vite/bin/vite.js --port 5173 &
cd e2e
BASE_URL=http://localhost:5173 npx playwright test compare --grep "建立參考頁"   # 5s
BASE_URL=http://localhost:5173 npx playwright test compare --grep "拍照"        # light+dark，1.7 分
BASE_URL=http://localhost:5173 npx playwright test compare --grep "並排"        # 產並排圖 + README，30s
```

⚠️ 要乾淨的一輪：先 `rm -f reference/shots/kennote/_fresh.json` 再兩個主題都拍。

⚠️ **遠端後端 `100.74.148.92:8090` 會間歇性重啟**（本輪開場就遇到 `ECONNREFUSED`，
等一分鐘就好了）。`:8080` 是 nginx 的靜態站，**不是 API**（POST 會回 405），不要拿它當備援。

量測工具：`reference/tools/measure.mjs`（`rows`/`cols`/`diff`/`row`/`colseg`/`ascii`/`col`/`px`），用法見 `HANDOFF-round3.md`。

### 直接打 API 數列數（本輪新寫，很好用）

`/workspaces/:id/tree` **不會列出資料庫的載體頁**（它有 `collection_id`，被 `collection_id IS NULL` 濾掉）。
要拿 `collectionId` 得繞一圈：

```js
const snap  = await call(`/pages/${refPageId}/snapshot`);      // → { recordMap: { page, block, user } }
const blocks= Object.values(snap.recordMap.block).map(x => x.value ?? x);  // ⚠ 每筆包在 { value } 裡
const cid   = blocks.find(b => b.type === 'collectionView').props.collectionId;
const db    = await call(`/databases/${cid}`);                 // → { collection, views }
for (const v of db.views) await call(`/databases/${cid}/rows?viewId=${v.id}`);
```

---

## 1. 本輪完成

| 任務 | 狀態 |
|---|---|
| 1. 數資料庫列數 / 載體頁 | ✅ **已經是對的**，六個視圖都 6 列，看板「無選取 0」。詳見 NOTES-round4 末節 |
| 2. `07n` tab 列（露 4 顆 / ＋ 收進下拉 / 標題 / 裁切原點） | ✅ 12.6/14.6 → **7.0/8.4** |
| 3. `07m` 面板上半部（50 / 28） | ✅ 上半部逐像素對齊；整體 10.5/12.2 → 10.3/12.0（剩下半部，見 B） |
| 4. `07d` / `07c` / `07b` | ❌ 沒碰（`07c` dark 只因 hover token 順便 14.2→14.0） |
| 5. 斜線選單（362 / 32 / `rgb(244,243,243)`） | ✅ 7.7/8.1 → **7.4/7.9** |
| 6. 深色專項 | 🟡 只做了 hover token 那條（見 E） |
| 7. `02b/02c/02d` | ❌ 沒碰 |
| 8. NOTES / HANDOFF | ✅ |

---

## 2. 待辦（依 CP 值排序）

### A. ⭐ `07b-db-header-hover` 13.3 / **17.9**（07 系列最高，兩輪都沒人碰）

裁切是 `{ x: box.x - 48, y: hb.y - 30 }`（`hb` ＝ 欄位標頭的 bbox）。
**先用 `measure.mjs rows 07b-db-header-hover light 0 200` 確認裁切原點**——
`07n` 的教訓是：裁切差 19px 的時候，怎麼調 CSS 都是白工。
dark 17.9 的成因八成跟 `07d`/`07c` 一樣是**選取／hover 的底色**，
現在有 `--kn-color-menu-hover` 了，先確認表格的欄頭 hover 用的是哪一顆。

### B. `07m-db-settings` 10.3 / 12.0（`-6,+6`）—— 剩下**面板下半部的列高**

上半部已經逐像素對齊（見 NOTES-round4 §根因三）。剩下的實測：

| | Notion | kennote |
|---|---|---|
| 第 1 組設定的分隔線 | y313 | y311（差 2）|
| 第 2 組設定的分隔線 | y509 | y489（差 **20**）|
| → 第 2 組的高度 | **196** | 178 |

第 2 組 ＝ 1 個 `.sectionLabel` ＋ 5 個 `.row`。`.row` 現在是 29px。
第 1 組（7 個 `.row`，無 label）Notion 是 y93..312 ＝ **220**，
kennote 是 209（`3px` × 2 內距 ＋ 7×29）。
→ 兩組一起解：`.row` 高 29 → **30**、`.section` 內距 3 → **5**
（第 1 組 10+210 ＝ 220 ✓），label 再補 ~11px 讓第 2 組湊到 196。
**先用 `node measure.mjs colseg 07m-db-settings light 160` 對一次再動手。**

dx `-6` 不是面板位置問題（面板左框線 N x13 / K x12，已經對齊），
是**列裡面的內容**（icon 欄 / 右側值）水平差，要用 `row` 逐列量。

### C. `07l-db-sort` 11.1 / 12.7（`-6,+0`）—— 第三輪就說「先開圖看一眼」，還是沒人看

`compare/07l-db-sort-light.png` 只有 199px 高，兩邊內容段落不同
（Notion 那張像是已經有一條排序條件）。本輪反而退步 0.3，**請先開圖再決定要不要調**。

### D. `07d-db-cell-edit` 13.6 / 15.4、`07c-db-row-hover` 9.2 / 14.0

`07d` 的位移是 `-3,-6`（light）/ `+2,+4`（dark）—— 兩個主題方向相反，
代表**不是版面而是內容**（選取框的顏色 / 右下角小方塊）。
`07c` dark 14.0 vs light 9.2，差在 dark 的列 hover 底色。

### E. 深色專項（README 中 dark > 8 的）

`02-page-top` 20.6（比不了）、`02c` 21.3、`03e` 9.6、`05-13-code` 6.3（14.9% 差異像素）、
`05-14-table` 7.6（16.3%）、`07-db-table` **10.9**、`07b` **17.9**、`07c` 14.0、`07d` 15.4、
`07e-full` 11.2、`07g` 11.4、`07g-full` 11.6、`07k` 11.5、`07l` 12.7、`07m` 12.0、
`06-slash-menu-full` 12.2。
用 `_tokens-raw-dark.json` 的 **`bodyVars` / `appVars` / `themeVars`** 取值，
**不要用 `rootVars` 或 `sheetVars`** —— 那兩個在 dark 檔裡放的還是 light 的值
（本輪就是照抄 `rootVars` 的 `--c-bacInt: #f4f3f3` 差點把 dark 改壞）。

### F. `02b`（6.4 / 7.9）、`02c`（22.7 / 21.3）、`02d`（23.4 / 10.5）

沒碰。用 `node measure.mjs rows 02c-page-mid2 light` 逐段對照，找出是哪一個 block 開始錯開。

### G. `-full` 整窗截圖跟著表頭變高退步了

`07f-full` 10.0→10.7、`07i-full` 9.7→10.3（light）。
表頭長高 13px 之後整頁內容往下推，而 `-full` 是**整窗截圖、沒有 padY 可調**。
要嘛接受，要嘛在拍 `-full` 之前把捲動位置補 13px。

### H. 其他沒碰的（從第三輪原樣搬過來）

* `06-slash-menu-full` 25.8（light）—— dark 只有 12.2，差在 light 的整頁內容。
* `05-01-paragraph` 5.2 / 5.5：已確認是**字身算繪差**，建議放寬目標或標註。
* `05-20-bookmark` 23：Notion 那張的縮圖是白的，**下限就是 23**。
* `05-19-subpage` / `07o-db-row-peek` / `02-page-top` / `04d`：來源不同，比不了。
* `05-14-table` 的內層 `padding-top: 8px; padding-bottom: 24px` 還沒補（NOTES-round2 §3）。
* 公式不置中、目錄縮排 24px、標題 4 的 padding —— 都還沒對（NOTES-round2 §3）。
* `07n` 的檢視名稱 Notion 是「列表」、kennote 是「清單」；Notion 有 7 個檢視（露 4 ＋「還有 3 個…」），
  kennote 只有 6 個（露 4 ＋「還有 2 個…」）。**這是資料差，不是樣式差**，不要硬湊。
* `07n` 的標題 Notion 是淺灰 placeholder「新資料庫」、kennote 是實名「參考資料庫」。
  字級已經確認**兩邊都是 24px**（字身 y 高 22），placeholder 樣式 `.titlePlaceholder` 也已經有了，
  只是那個 collection 有名字所以用不到。同樣是資料差。

---

## 3. 量到但還沒用上的數值（第四輪新量）

| 項目 | 實測 |
|---|---|
| Notion 實色互動底 `--c-bacInt` | light **`#f4f3f3`**、dark **`#262626`**（⚠ dark 的 hover 不用它，見 NOTES-round4 §根因一）|
| `06-slash-menu` dark 反白 | **`rgb(49,49,48)`** ＝ 面板底 `rgb(37,37,37)` 疊 `rgba(255,255,255,.055)` |
| `06-slash-menu` light 面板 | 上框線 y13、下框線 y373（高 **360**）；捲動區 y14..331（**318**）、footer 分隔線 y332、footer 高 **40**；第一列反白 y47..78（**32**）|
| `06-slash-menu` 捲軸 thumb | x326..334（寬 9、`rgb(211,209,203)`）—— 還沒做 |
| `07n` tab 膠囊 | x48..125（寬 **78**）、y69..100（高 **32**）、底 `rgb(244,243,243)`；內距 12、icon 16、icon→文字 10；第 2 顆 tab 的 icon 從 x141 起（膠囊間距 ~3）|
| `07n` 標題 | 字身 y29..50（font-size **24**，兩邊一致）、左緣 x49、標題下緣→tab 上緣 **19** |
| `07m` 面板 | y13..612（高 **599**）；上緣→名稱框 **49**；名稱框 y63..92（border-box **30**、填色 **28**）；分隔線 y313 / y509 |
| `07m` 第 1 組設定 | y93..312（**220**，7 列）→ 每列 ~30 ＋ 內距 ~5 |
| `07m` 第 2 組設定 | y313..508（**196**，1 label ＋ 5 列）|
| `07k`/`07l` 面板 | x13..304（寬 292）、上緣 y17；屬性列 hover 高 **28**、底 `rgb(244,243,243)` |

---

## 4. 第四輪新踩到的坑（接在第二輪九條、第三輪四條之後）

14. **位移的符號**。`fixtures/png.ts` 的 `meanAbsAt` 比的是 `kennote[y+dy]` vs `notion[y]`，
    所以 **`dy = +6` ＝ kennote 的內容比 Notion **低** 6px**，要把 `clip()` 的 **padY 調小**。
    （`clip y = box.y - padY`，padY 愈大 ＝ 裁得愈高 ＝ 內容在圖裡愈低。）
    前三輪都在猜方向，這條寫死就不會再猜。

15. **改資料庫表頭的高度，一定要同步改 `07`/`07e`~`07i` 那一行 padY。**
    本輪 tab 列長高 13px，那七張整批從 `dy 0` 掉到 `dy +6`（頂到搜尋上限、分數全部退步），
    padY 26→13 之後才回到 ≤|4| 而且比第三輪更低。它們**共用同一行 `clip()`**。

16. **`flex column` + `max-height` 會把沒有 `flex-shrink:0` 的子層壓扁。**
    `07m` 的 `.panel` 已經頂到 `max-height`，`.header` 從 34 改到 45 只長了 3px。
    **判斷方法**：改了高度，`colseg` 量到的位移卻不等於你改的量 → 就是被 flex 壓了。
    修法：補 `flex: 0 0 auto`，並確認 `max-height` 夠大（Notion 那張面板是 **599**）。

17. **`_tokens-raw-dark.json` 裡的 `rootVars` / `sheetVars` 放的是 light 的值。**
    只有 `bodyVars` / `appVars` / `themeVars` 是真正的深色值。
    照 `rootVars` 抄會把 dark 改壞（`--c-bacInt` 在那裡還是 `#f4f3f3`）。

18. **同一個「灰底」在 Notion 有兩顆變數**，半透明的 `--ca-graBacSecTra`（疊白 `rgb(240,239,237)`）
    與實色的 `--c-bacInt`（`rgb(244,243,243)`）。選單 / 浮層列 / 作用中膠囊用**實色**那顆。
    kennote 現在是 `--kn-color-surface-hover` vs **`--kn-color-menu-hover`**。

19. **遠端 `:8090` 會間歇性 `ECONNREFUSED`**（重啟）。`ping` 得通不代表 port 開著；
    用 `(echo > /dev/tcp/100.74.148.92/8090)` 探一下，等一分鐘再試。`:8080` 是靜態站不是 API。

---

## 5. 驗收狀態（本輪結束時）

```
pnpm --filter @kennote/web typecheck     ✅
pnpm --filter @kennote/web test          ✅ 14 files / 298 tests
pnpm --filter @kennote/web build         ✅ built in 4.52s
pnpm --filter @kennote/server typecheck  ✅
pnpm --filter @kennote/server test       ✅ 22 files / 348 tests（3 skipped）
```

沒有 git commit（依指示）。

---

## 6. 本輪改動的檔案

**新增**

```
reference/shots/compare/NOTES-round4.md      ← 第四輪紀錄（README 會自動接上）
reference/shots/compare/HANDOFF-round4.md    ← 這一份
```

**修改**

```
apps/web/src/styles/tokens.css                             ← 新增 --kn-color-menu-hover（light/dark ×2 處）
apps/web/src/styles/editor.css                             ← 斜線選單：捲動區 318 / 上內距 7 / 列高 32 / footer 12 / hover 換 token
apps/web/src/features/database/DatabaseHeader.tsx          ← ＋ 收進「還有 N 個…」下拉、measureTabs 不再留 28px
apps/web/src/features/database/DatabaseHeader.module.css   ← tab 膠囊 32×78、.bar 36、標題下留白 15、.tabActive 換 token、新增 .tabMoreAdd
apps/web/src/features/database/ViewSettingsPanel.module.css← max-height 600、header 45、名稱框 30、nameRow 34、flex:0 0 auto、.section + .section 才有 border-top、hover 換 token
apps/web/src/features/database/Builders.module.css         ← hover 換 --kn-color-menu-hover（5 處）
e2e/compare.spec.ts                                        ← 07n 裁切 (44,7)、07/07e~07i 的 padY 26→13
```

**沒有動**：`packages/editor-core`、`packages/ui/src/{components,dnd,overlay,positioning}`、
任何 runtime 依賴、後端程式碼（本輪對後端只有「讀 API 驗證」）。
