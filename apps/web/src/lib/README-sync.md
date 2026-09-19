# 即時同步層：給編輯器宿主的接線說明

> 讀者：`apps/web/src/features/editor/**` 的宿主層代理（useEditorHost / Editor.tsx）。
> 相關規格：04 §6.4（廣播時序）、§6.5（離線重連）、§5.4（樂觀更新流程）；02 §5.5。
> 設計決策：`docs/adr/0004-realtime-lww.md`。

## 0. 三十秒版本

```tsx
const snapshot = usePageSnapshot(pageId);              // 既有的 useQuery
const editor = useEditor(...);                          // editor-core

const sync = usePageSync(pageId, {
  getLocalSeq: () => snapshot.data?.seq ?? 0,
  onRemoteOps: (ops) => editor.applyRemote(ops),        // ⭐ 遠端變更
  onRollback: (tx) => editor.applyLocalInverse(tx.ops), // 伺服器拒絕 → 回滾
  onResync: () => snapshot.refetch(),                   // 落後太多 → 重抓整頁
});

useEffect(() => editor.on('localOps', (ops) => sync.submit(ops)), [editor, sync]);
```

`sync.submit(ops)` 之後的事情**全部由同步層負責**：debounce 300ms 打包、寫 IndexedDB、
WS 優先送、失敗降級 HTTP、斷線排隊、重連重送、冪等。宿主不要自己打 `POST /transactions`。

---

## 1. 檔案分工

| 檔案 | 內容 | 有沒有 React |
|---|---|---|
| `lib/sync-client.ts` | 連線狀態機、重連 backoff、補傳、pending queue、HTTP 降級 | ❌（可在 Node 測試） |
| `lib/offline-queue.ts` | IndexedDB 佇列（+ 記憶體 fallback） | ❌ |
| `lib/presence.ts` | `usePresence(pageId)`、把外框/名牌畫到 DOM 的 `decorate()` | ✅ |
| `stores/sync.ts` | 單例 client、連線狀態 store、**`usePageSync`** | ✅ |
| `stores/presence.ts` | 每頁的線上名單 | ✅ |
| `stores/notifications.ts` | 收件匣、未讀數 | ✅ |
| `components/ConnectionBadge.tsx` | 🟢 已同步 / 🟡 同步中 / 🔴 離線 + 衝突 toast | ✅ |
| `components/PresenceAvatars.tsx` | 線上頭像列 | ✅ |

---

## 2. `usePageSync(pageId, options)`

```ts
const sync = usePageSync(pageId, {
  onRemoteOps?(ops: Operation[], meta: { seq, txId, actorId, catchUp }): void;
  getLocalSeq?(): number;          // 宿主目前已套用到第幾號（通常 snapshot.seq）
  onResync?(reason: string): void; // 預設已經幫你 invalidate snapshot 快取
  onConflict?(blockIds: string[], actorId: string): void;  // 預設已經跳 toast
  onRollback?(tx: QueuedTransaction, reason: { code, message }): void;
  onComment?(msg): void;           // 預設已經 invalidate 討論串快取
});

sync.state        // 'connecting' | 'authenticating' | 'syncing' | 'ready' | 'reconnecting' | 'offline'
sync.seq          // 目前已同步到的 seq
sync.permission   // 'full' | 'edit' | 'comment' | 'read'
sync.canEdit      // permission === 'edit' | 'full'  → guest 要隱藏編輯 UI（後端也會拒絕）
sync.submit(ops)  // 樂觀更新之後呼叫
sync.flush()      // 切頁 / beforeunload 前呼叫，立刻送出還在 debounce 裡的變更
sync.updatePresence(blockId, selection)  // 游標移動時呼叫（節流由宿主決定，建議 100ms）
```

### 生命週期

1. 宿主先用 `GET /api/pages/:id/snapshot` 拿到 `recordMap` 與 `seq`
2. `usePageSync` 掛載時送 `subscribe(pageId, sinceSeq = getLocalSeq())`
3. 伺服器回 `synced{seq, permission}`；若你落後就接著送 `catchUp`
4. 之後他人的每一筆變更都以 `onRemoteOps` 進來

> **snapshot 與訂閱之間沒有空窗**：snapshot 帶著 `seq`，訂閱從那個 seq 之後開始補。
> 所以請一定要把 `getLocalSeq` 接上，否則重連後會從 0 開始而錯過中間的變更。

---

## 3. `onRemoteOps` 的三條紀律（在 editor-core 內實作，04 §6.4）

```ts
applyRemote(ops: Operation[], seq: number) {
  // ❶ IME 組字期間 → 排隊，compositionend 後再套用（驗收標準：不打斷注音）
  if (this.isComposing) { this.remoteQueue.push({ ops, seq }); return; }
  // ❷ 先存本地 selection，套用後用 rebaseSelection 還原
  const saved = this.selection.current;
  this.applyOps(ops, { source: 'remote' });     // source:'remote' → 不進 undo stack
  this.selection.write(rebaseSelection(saved, ops));
  // ❸ 通知 history 做保守清理
  this.history.onRemoteOps(ops);
}
```

### `rebaseSelection` 的期望行為（M5 驗收標準之一）

| 情境 | 期望 |
|---|---|
| 他人在我游標**前面**插入 n 個字（同一 block） | `offset += n`（游標第 10 個字、對方在第 3 個字插 5 個 → 變成 15） |
| 他人在我游標**後面**插入 | offset 不變 |
| 他人刪掉我游標**前面**的 n 個字 | `offset -= min(n, offset - deleteStart)` |
| 刪除範圍**涵蓋**我的游標 | 游標收合到刪除起點 |
| 他人整段覆寫我所在的 block（LWW） | offset 夾到新內容長度內（`min(offset, length)`） |
| 我所在的 block 被刪除 | 游標移到前一個存活的 block 尾端；沒有就移到後一個開頭 |
| 他人搬移 block（`block.move`） | offset 不變（只有結構變，文字沒變） |

MVP 的 `block.update` 是整段覆寫，拿不到字元級的 diff，所以最後一列的「夾住」是合理近似；
M6 換成 `text.delta` 之後就能做到真正的字元級 rebase（`transform` 的簡化版）。

---

## 4. 送出變更

```ts
editor.on('localOps', (ops) => sync.submit(ops));
```

- 不要自己做 debounce（同步層做了 300ms；滿 200 個 op 會提早送出）
- 不要自己產生 `txId` / `originSessionId`（同步層產生，重送時保持不變才有冪等）
- 切頁、`beforeunload` 時呼叫 `await sync.flush()`
- 失敗回滾：`onRollback(tx, reason)` 會帶回**那一筆被拒絕的 ops**，宿主套用 inverse
  （`packages/editor-core/src/transaction/invert.ts` 已經有 `invertOps`）

### 狀態對應 UI

| `sync.state` | UI |
|---|---|
| `connecting` / `authenticating` / `syncing` / `reconnecting` | 🟡 同步中（仍可編輯） |
| `ready` | 🟢 已同步 |
| `offline` | 🔴 離線（變更已暫存，重連後自動送出） |

`<ConnectionBadge />` 已經把這些狀態與衝突 toast 都畫好了，放進 TopBar 即可。

---

## 5. Presence

```tsx
const { peers, peersByBlock, decorate } = usePresence(pageId);

// 游標移動 → 廣播（不進 operation log）
useEffect(() => editor.on('selectionChange', (sel) =>
  sync.updatePresence(sel?.blockId ?? null, sel ? [sel.start, sel.end] : null)), [editor]);

// 他人所在 block 的淡色外框 + 名牌
// （`features/editor/Editor.tsx` 掛在 `.kn-editor-shell` 上，
//   文件結構一變就重畫：`useEffect(() => decorate(wrapperRef.current), [decorate, host?.rev])`）
useEffect(() => decorate(hostRef.current), [decorate]);
```

`decorate()` 會尋找 `[data-block-id]` 的元素，加上：

- class `kn-presence-block`（淡色外框，CSS 在 `lib/presence.css`）
- CSS 變數 `--kn-presence-color`（伺服器依 userId 指派，所有人看到的顏色一致）
- 子元素 `span.kn-presence-label`（名牌，`pointer-events: none`）

**宿主唯一要做的事：讓每個 block 的最外層元素帶 `data-block-id={block.id}`。**

頭像列：`<PresenceAvatars pageId={pageId} />`（同一人開兩個分頁只算一個）。

---

## 6. 留言的接線（inline comment）

```tsx
// 使用者選取文字後按「留言」
<CommentPopover
  pageId={pageId}
  blockId={selection.blockId}
  quote={selectedText}
  onCreated={(discussionId) => {
    // ⭐ 把 comment mark 套在選取範圍上，走一般的 operation 路徑
    editor.toggleMark({ t: 'comment', id: discussionId });
  }}
  onClose={close}
/>
```

`CommentsPanel` 的 `onHighlightBlock(blockId)` 會在 hover 討論串時呼叫，
宿主用 `scrollIntoView` + 暫時 class 高亮即可。

已解決 / 被刪除的討論串，其 comment mark 會變成孤兒 —— UI 直接忽略（不渲染底線）即可，
不需要回頭改文件。

---

## 7. 版本歷史預覽

`<HistoryPanel pageId onPreview={(seq, snapshot) => ...} />`

進入預覽時（`seq !== null`）宿主**必須**：

1. 把編輯器切成唯讀
2. 停止 `sync.submit`（02 §3.6 的明確要求）
3. TopBar 顯示「正在檢視歷史版本」與退出鈕（面板本身已經有一份）

還原走 `POST /history/:seq/restore`，伺服器會送出一筆新的 transaction，
所以其他人會透過 `onRemoteOps` 看到還原結果 —— 宿主不需要特別處理。

---

## 8. OT delta 通道（M6，`FEATURE_OT`）

> 設計決策與已知限制：`docs/adr/0006-ot.md`。規格：04 §6.6。

`FEATURE_OT` 打開之後多一條通道，**與既有的 tx 通道並存**：

| 通道 | 內容 | operation |
|---|---|---|
| delta | 同一個 block 內的**文字變更** | `text.delta`（走 OT，兩人的字都保留） |
| tx | 結構變更（新增／刪除／搬移／換型別／改 props） | 原本的 `block.*`（LWW） |

**它不是第二套協定**：delta 一樣包成 `Transaction` 走 WS 的 `tx` 訊息，
落到伺服器同一支 `applyTransaction()`；ack 走 `txApplied`、廣播走 `txBroadcast`。
`packages/shared-types/src/ws.ts` 一行都沒有改。

### 宿主要做的事

```tsx
// 1) 問伺服器有沒有開（或用 VITE_FEATURE_OT=1 強制打開）
const otEnabled = useOtEnabled();

// 2) 建一個 OtPageChannel，接上 sync-client 的 delta 通道
const channel = new OtPageChannel({
  submitDelta: (blockId, delta, baseRev) =>
    getSyncClient().submitDelta(pageId, blockId, delta, baseRev),
  applyRemoteDelta: (blockId, delta) => editor.applyRemoteDelta(blockId, delta),
  onDesync: () => reload('協作狀態需要重新同步'),
});
channel.setInitialRevs(snapshotRevs(snapshot));   // blocks.rev（migration 0030）

const detach = getSyncClient().attachDeltaChannel(pageId, {
  onAck: (op, txId) => channel.handleAck(op, txId),
  onRemoteDelta: (op) => channel.handleRemote(op),
  onRejected: (blockId, reason) => channel.handleReject(blockId, reason.code),
});

// 3) 編輯器用 OT 模式建立，localOps 先過 delta 通道
const editor = createEditor({ ..., ot: { enabled: true, getBaseRev: (id) => channel.getBaseRev(id) } });
// ⭐ 依原順序一組一組分流（ADR 0006 §2.9）
editor.on('localOps', (ops) => {
  for (const group of splitDeltaOps(ops)) {
    const rest = channel.submitLocalOps(group.ops);  // text.delta 被吃掉
    if (rest.length > 0) sync.submit(rest);          // 其餘走原本的 tx 通道
  }
});
```

`apps/web/src/features/editor/useEditorHost.ts` 就是照這個形狀接的，可以直接抄。

### 三件容易踩的事

1. **delta 不走 300ms debounce。** OT 規定同一個 block 一次只能有一筆 outstanding，
   打包會破壞這個不變量。`submitDelta()` 立刻送出（仍然寫 IndexedDB，斷線重送照舊）。
2. **沒註冊 delta 通道時，`text.delta` 會退回走 `onRemoteOps`。**
   舊路徑仍然可用（editor-core 的 `applyTextDelta` 會處理純文字），
   但格式與 atom 會降級 —— 開啟 `FEATURE_OT` 之後請使用者重新整理分頁。
3. **順序一致性**：同一個 block 上 delta 與 `block.update` 的相對順序由伺服器決定，
   `splitDeltaOps()` 保證分流之後順序不變，宿主照收到的順序套用就好。
4. **送出去的 `block.update` 永遠不可以帶 `content`**（ADR 0006 §2.9，QA BUG-4）。
   editor-core 在 OT 模式下已經幫你把它拆成
   `block.update{blockType, props}` + `text.delta`，宿主要做的只有
   「**依原順序**用 `splitDeltaOps(ops)` 分流」——
   一批全丟給 OT 通道、`rest` 最後才 `sync.submit()` 會讓 delta 先到伺服器
   （`BLOCK_NOT_FOUND`，或套在還沒換型別的內容上）。
   實際症狀：`> quote` 重整後變成 `quote>`。

---

## 9. 測試

```bash
pnpm --filter @kennote/web test         # sync-client 狀態機 + 離線佇列 + OT delta 通道（假 WebSocket）
pnpm --filter @kennote/server test      # room-manager 廣播、RESP、權限解析、歷史重建、receiveDelta
pnpm --filter @kennote/editor-core test # OT property test（各 2 萬次）+ 三方模糊測試（1 萬輪）
```

要自己寫同步相關的測試時，`src/lib/sync-client.test.ts` 裡的 `FakeSocket` 可以直接抄。
