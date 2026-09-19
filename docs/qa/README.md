# QA 報告索引

> 兩條**互相獨立**的 QA 線：
>
> - **功能 QA**（這個資料夾）—— 真實瀏覽器走查 + 後端權限稽核，bug 編號是 `BUG-nn`（1–46，**沒有 12**）。
> - **視覺 QA**（[`reference/shots/compare/`](../../reference/shots/compare/)）—— kennote ↔ Notion 逐像素比對，
>   `NOTES-round2~8.md` 是逐輪根因筆記。**不共用 BUG 編號**，遺留項目走 `KNOWN_GAPS`。
>
> 每一輪都有對應的回歸測試 `e2e/functional-roundN.spec.ts`
> ——「每一條對應報告裡的一個已修 bug」。目前 18 支 spec、約 101 條 e2e，
> **`test.fixme` 已經全部解開**（等部署的那些都部署完了）。

| 報告 | 主題 | 結論一句話 |
|---|---|---|
| [functional-round1.md](functional-round1.md) | 認證 / 側邊欄 / 編輯器 / 頁面 | 4 個 bug 全修，其中 2 個是資料遺失級（改標題清空內文、Markdown 捷徑前綴跑到字尾） |
| [functional-round2.md](functional-round2.md) | 資料庫（建立、6 視圖、20 欄位型別）+ `/` 選單盤點 | 一進門就撞到把整個資料庫設定面板擋死的巢狀浮層 bug（BUG-5） |
| [functional-round3.md](functional-round3.md) | formula / relation / rollup / 篩選排序分組 / CSV / 效能 | 計算欄位後端大致正確，但表格預設把第 6 個以後的欄位藏起來（BUG-10） |
| [functional-round4.md](functional-round4.md) | 編輯器（`/` 選單插入、貼上、`@`/`[[`、undo/redo）+ 390 手機版 | `/` 選單 16 項全部插得進去也撐得過重整；抓到跨 block redo 會再吃掉一段（BUG-18） |
| [functional-round5.md](functional-round5.md) | 協作 / 頁面功能（留言、版本、分享、匯出匯入、鎖定）+ 手機版 | 抓到「只有留言權限者可改標題／刪頁／搬頁」的權限洞，與「模組寫好了卻沒人 import」型態 |
| [functional-round6.md](functional-round6.md) | 提及→通知→收件匣 / 垃圾桶權限 / 工作區外分享 / 觸控 | 三個最嚴重的問題型態一樣：**後端是好的，前端根本沒有呼叫端**；另有 guest 可永久刪除別人頁面的洞 |
| [functional-round7.md](functional-round7.md) | 權限**下推到查詢層**（樹 / 垃圾桶 / 最近 / 收藏 / snapshot / duplicate） | 推翻第六輪的推論：guest 實測拿得到整份 recordMap。本輪**前端一行都沒改** |
| [functional-round8.md](functional-round8.md) | **權限總掃**（資源 × 角色 × 動作，47 格） | 47 格中 21 格失敗；最大的是整個 `databases` 模組 15 支端點零權限檢查 |
| [functional-round9.md](functional-round9.md) | 附件權限 / WS 撤權踢人 / 列頁種子段落 | 補完「一份資料的出口清單」最後兩格；`permission_changed` 通知終於有發送端 |
| [database-gaps.md](database-gaps.md) | 資料庫功能缺口補完（relation 反向欄位、RowPeek、垃圾桶、CSV、欄寬、列選取） | 7 項全部做完；§4 另列 6 項未做 |
| [regression-triage-1.md](regression-triage-1.md) | 第一次全量 e2e（78 條）之後的紅燈分診 | 4 條紅燈 = 2 條產品缺陷（前端時序競態，只在 0 block 的列頁看得見）+ 3 條測試過時 |

---

## 一、為什麼值得整輪讀一次

這 11 份的價值不在「修了哪些 bug」，而在**四條反覆出現的主線**。
新進來的人看懂這四條，比看懂任何一支程式碼都有用：

1. **同一支查詢被當成權限檢查，連四輪。**
   `findPageForUser()` 只 JOIN `workspace_members`，回答的是「你是不是這個工作區的人」，
   卻被當成「你能不能看這一頁」。BUG-27（3 支）→ BUG-29 → BUG-35/36 → BUG-40/41/42。
   第八輪改名為 `findPageInUserWorkspace()`（讓誤用一眼看得出來）並加上
   **掃原始碼的靜態稽核測試** `apps/server/test/route-permission-audit.test.ts`。
   第九輪又在 `findFileForUser()` 發現同一個模子。
2. **「前端沒有呼叫端」型態。** 後端寫好了、型別也對，就是沒人叫它：
   `ExportDialog` / `ImportDialog`（BUG-19）、mention 扇出（BUG-30）、
   `/subscriptions` 零呼叫端、`listPageSubscribers()` dead code。
3. **前端鎖上 UI 不是修正，是遮蔽。** 第六輪把 database 的 UI 鎖上被記成半綠，
   第八輪實測後端 15 支全裸、其中 3 支是破壞性的。
4. **未經實測的句子會變成下一輪的盲點。** 第六輪「點進去才 404」是推論，
   害一個「整份 recordMap 外流」的洞被降級記了一輪。
   第七輪起的紅線：**沒實測就明寫「未驗證」**。

---

## 二、仍然開著的項目

下面是跨所有輪次**明確標為未修 / 延後 / 已知限制**的清單。
各 feature README 的「已知限制」段落指向這裡。

> 🚧 **第十輪正在進行中。** `e2e/functional-round10.spec.ts` 已經在
> （主題：**搜尋 guest 過濾正例**、協作即時性、觸控 / 手機），
> `docs/qa/functional-round10.md` 還沒寫完。
> 工作目錄裡另有尚未 commit 的修正（`modules/files/`、`modules/databases/service.ts`、
> `SharePopover.tsx`、`ui/src/dnd/controller.ts`、`scripts/backfill-file-pages.ts`），
> 看起來正是衝著下面的 **O-1 / O-2 / O-3 / O-4 / O-11** 來的。
> **本節反映的是已 commit 的狀態**；動手修之前先 `git status` 看一眼，不要撞車。

### A. 有編號但從未結案

| Bug | 一句話 | 出自 | 元件 |
|---|---|---|---|
| `BUG-7` | 檢視分頁列溢位時選中的檢視會被收起來，檢視選單（改名／複本／刪除）打不開 | round2 §2 | database |
| `BUG-8` | 新增欄位不排在最後（順序是 jsonb key 序）；server 已有 `alignViewProperties()` 但**沒有回歸驗證** | round2 §2 / round3 §4-2 | database |

> `BUG-18`（跨 block redo 再吃一段）在報告裡仍記為未修，但**實際已經修好**
> （`editor-core` 的 per-op history deltas + `blocks/repo.ts` 的軟刪除復活），
> `e2e/functional-round4.spec.ts` 也已經沒有 `test.fixme`。讀到報告時請以本節為準。

### B. 權限 / 後端

| # | 一句話 | 出自 |
|---|---|---|
| O-1 | **搜尋的 guest 過濾始終沒有取得正例**（程式碼有兩層過濾，但索引非同步，owner 自己都搜不到剛寫的字）——連三輪明寫「未驗證」 | round8 §4-2 → triage §8-3 → round9 §6-1 |
| O-2 | `SharePopover` 的 `entryPermission()` 對「沒有條目的成員」寫死 fallback `'edit'`，對 guest 是錯的（實際是 `none`） | round6 §5-14 → round9 §6-2 |
| O-3 | `loadRollupSources` / `loadRelationTitles` 讀目標 collection 的列時**沒再問權限**——舊 relation 指向看不見的資料庫時 rollup 仍讀得到標題 | round8 §4-6 → round9 §6-3 |
| O-4 | `files.page_id` 既有資料**沒有回填**，`0070` 之前上傳的附件維持「工作區成員限定」 | round9 §6-4 |
| O-5 | 附件的 `page_id` **不會跟著 block 搬家**（圖片剪貼到別頁，權限仍綁原頁）——刻意取捨 | round9 §6-5 |
| O-6 | 匯入 1000 列的耗時要在部署後量一次（`createRow()` 每列多一次 `applyTransaction`） | round9 §6-7 |

### C. 協作鏈路（第七輪 §4-5～8，之後每輪原樣延後）

| # | 一句話 | 元件 |
|---|---|---|
| O-7 | 點通知跳頁後不會捲到該討論串（`InboxRoute` 把 `discussionId` 丟掉） | shell |
| O-8 | **版本預覽時編輯器顯示的還是現在的內容**（`AppShell` 丟掉 `onPreview` 的 snapshot 參數），橫幅寫「編輯已停用」會誤導 | shell / editor |
| O-9 | `restoreVersion` 超過 200 ops 會切成多筆 transaction，**整批不是 atomic**，中途失敗留下半還原狀態 | server / sync |
| O-10 | `page_updated` 只通知 `explicit` 訂閱者，而「追蹤這個頁面」藏在 ⋯ 選單第二層——鏈路通了但沒人走 | shell |

### D. 觸控 / 手機 / 未走查

| # | 一句話 | 元件 |
|---|---|---|
| O-11 | 看板卡片、日曆、`PropertyList`、`SortBuilder` 仍是 HTML5 DnD → **觸控全死**（正解是統一改用 `@kennote/ui` 的 dnd） | database / ui |
| O-12 | **`/settings` 這個 URL 根本不存在**（`App.tsx` 沒宣告，會掉到 NotFound）；設定是 store 裡的 overlay，不支援深連結 | shell |
| O-13 | **資料庫表格橫捲**（手機版）連續五～六輪沒走查 | database |
| O-14 | 編輯器 5 項未走：媒體 URL 實際填入、圖片檔案拖放上傳、程式碼語言切換、block selection 的複製貼上、Word/GDocs 剪貼簿 HTML | editor |
| O-15 | 觸控的**拖曳排序**只做到「長按開選單」與表格列（最小版），一般 block 的拖曳搬移仍無替代路徑 | editor / ui |

### E. `database-gaps.md` §4 的 6 項

| # | 一句話 |
|---|---|
| O-16 | **看板 / 圖庫 / 清單沒有列選取**（勾選框與批次列只有表格有） |
| O-17 | 拖曳排序只在表格、**沒有鍵盤替代路徑**；且視圖有 `sort` 時仍可拖曳（Notion 是停用） |
| O-18 | **`view.format.manualOrder` 這條既有路徑仍未接**，目前走 `pages.sort_key` |
| O-19 | `createDual` 關掉開關時**不會刪對方的欄位**（刻意），UI 也沒有「順便刪掉」選項 |
| O-20 | 批次操作沒有「移動到」「加到收藏」，也沒有批次改屬性值 |
| O-21 | 既有資料裡**已經寫出去的孤兒屬性沒有清理腳本**（新的寫入已擋住） |

### F. 缺口 / 觀察（不算 bug）

| # | 一句話 | 元件 |
|---|---|---|
| O-22 | **文件尾端沒有「點空白處補一段」的落點**：最後一個 block 是 table / divider / image 時只剩 gutter 的 `+` | editor |
| O-23 | 貼上純 URL 只實作「貼上為連結」，沒有 Notion 的「連結／書籤／嵌入」三選一選單 | editor |
| O-24 | **資料庫的列刪掉後該進哪個垃圾桶**規格面未定案（目前進工作區垃圾桶） | database |
| O-25 | `/` 選單各分組「各挑 3 個實際插入」只完成 16 項；嵌入（52 個第三方）、匯入分組未實際插入 | editor |
| O-26 | 永久刪除（UI 路徑）、**訪客升級**、**登出所有裝置**三項從第一輪掛到第六輪都沒走 | shell |
| O-27 | `date` 儲存格是輸入框不是月曆格；`files` 儲存格**沒有實際上傳檔案**走完 | database |
| O-28 | 本機 vite 代理時 **WebSocket 不跟著 proxy**，頂欄顯示「尚未連線」——即時同步在該環境測不了 | 環境限制 |
| O-29 | 分享彈窗用 `goto('/page/:id')` 直接進去時開不起來，沒有穩定重現 | ui / shell |
| O-30 | `POST /api/auth/open` 的 rate limit 在每一輪探索腳本／e2e 都撞到，需 backoff | 測試環境 |

---

## 三、怎麼跑回歸

```bash
cd e2e
npm i && npx playwright install chromium

# 打遠端正式站
BASE_URL=http://100.74.148.92:8090 npx playwright test

# 打本機 vite（前端 HMR + 遠端 API）；注意 WS 不跟著 proxy（O-28）
VITE_PROXY_TARGET=http://100.74.148.92:8090 pnpm --filter @kennote/web dev
BASE_URL=http://127.0.0.1:5173 npx playwright test functional-round8.spec.ts
```

`playwright.config.ts` 的量測基準刻意與 `reference/notion-capture/` 一致：
**1440 × 900 @1x、`zh-TW`、workers: 1、不平行**，否則截圖無法並排比對。

> ⚠️ **`test.fixme` 的斷言從來沒被執行過。** 解開任何一條時要逐行看——
> `regression-triage-1.md` §9 就抓到 round7 有一條斷言自己寫錯
> （404 回應沒有 `data` 欄位）。
