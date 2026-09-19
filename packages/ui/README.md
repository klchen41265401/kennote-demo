# @kennote/ui

kennote 的自研 UI primitives。**零 runtime 依賴**（只有 `react` / `react-dom` peer），
不使用任何元件庫、floating-ui、dnd-kit、react-virtual、Tailwind。

規格來源：`spec/02-UI架構.md` §2.6（浮層層級）、§4.4（Modal/Popover 體系）、§4.5（定位引擎）、
§4.6（拖放引擎）、§4.7（浮層體系）、§6（設計系統）、§8.4（虛擬捲動）。

```bash
pnpm --filter @kennote/ui typecheck   # tsc --noEmit
pnpm --filter @kennote/ui test        # vitest（119 個測試）
pnpm --filter @kennote/ui playground  # vite 展示頁（light / dark）
```

## 安裝到 app

```tsx
// apps/web/src/main.tsx
import '@kennote/ui/styles.css'; // 要放在 tokens.css 之後
import { OverlayRoot, DndProvider, ToastRegion } from '@kennote/ui';

createRoot(root).render(
  <OverlayRoot>
    <DndProvider>
      <App />
      <ToastRegion />
    </DndProvider>
  </OverlayRoot>,
);
```

`index.html` 建議先寫死掛載點（沒寫也會自動建立）：

```html
<div id="root"></div>
<div id="kn-overlay-root"></div>
```

---

## 1. 定位引擎 `positioning/`

取代 floating-ui。純函式 + 輕量訂閱，約 300 行。

### `computePosition(options): PositionResult`

| 參數 | 型別 | 預設 | 說明 |
|---|---|---|---|
| `anchor` | `Element \| RectLike` | — | 錨點。**可以是 DOMRect**，供 caret / 選取範圍錨定（浮動工具列、slash menu）。 |
| `floating` | `HTMLElement \| { width, height }` | — | 浮層元素或已知尺寸（測試可直接餵尺寸）。 |
| `placement` | `'top' \| 'bottom' \| 'left' \| 'right'` + `-start` / `-end` | `'bottom-start'` | |
| `offset` | `number` | `6` | 錨點與浮層的間距。 |
| `flip` | `boolean` | `true` | 主軸空間不足且反向更大時翻轉。 |
| `shift` | `boolean` | `true` | 沿**次軸**推回邊界內（主軸不足交給 flip / maxHeight）。 |
| `boundary` | `RectLike \| null` | viewport | 可用邊界。 |
| `padding` | `number` | `8` | 與邊界的最小距離。 |
| `matchWidth` | `boolean` | `false` | 浮層寬度對齊錨點（下拉選單）。 |
| `arrow` | `boolean \| { size, radius, padding }` | — | 箭頭位置（夾在圓角之內）。 |

回傳 `{ x, y, placement, side, align, maxHeight, maxWidth, width?, arrow?, anchorRect }`，
座標一律 `Math.round`（非整數座標會讓中文字渲染模糊）。

```ts
const pos = computePosition({
  anchor: getCaretRect()!,        // 或任何 Element
  floating: menuEl,
  placement: 'bottom-start',
  offset: 6,
});
applyPosition(menuEl, pos);       // position:fixed + translate3d + max-height
```

### `autoUpdate(anchor, floating, cb, options?): () => void`

| 選項 | 預設 | 說明 |
|---|---|---|
| `scroll` | `true` | capture 階段監聽 scroll，涵蓋所有祖先捲動容器。 |
| `resize` | `true` | window resize。 |
| `observeSize` | `true` | ResizeObserver 監看錨點與浮層。 |
| `animationFrame` | `false` | rAF 迴圈追蹤錨點 rect（只在真的變了才回呼）。**inline 工具列與 slash menu 必須開**。 |

### 其他

- `getCaretRect()` / `getSelectionRect()` — caret 與選取範圍的錨點（含零寬空格探針 fallback）。
- `makeRect(x, y, w, h)`、`toRect(elementOrRect)`、`rectsEqual`、`clamp`。
- `useFloating({ open, anchor, placement, ... })` — React 包裝，回傳 `{ setFloating, position, style }`。

---

## 2. 浮層體系 `overlay/`

### `overlayStack`（純 TS 單例）

全域 `keydown` / `pointerdown` **只在這裡註冊一次**，各浮層元件不得自行綁 document 事件。

| 方法 | 說明 |
|---|---|
| `open(init)` | 登記一層，回傳 id。`init`：`{ level, closeOnOutside, closeOnEsc, trapFocus, lockScroll, getAnchor?, onClose }` |
| `setElement(id, el)` | 回填浮層根元素（外部點擊判定用）。 |
| `close(id)` | 關閉該層**與其上所有層**（避免孤兒浮層）。 |
| `remove(id)` | 只移除，不呼叫 `onClose`（元件卸載用）。 |
| `closeTop()` | Esc 用；只關最上層。 |
| `handleOutsidePointer(target)` | 找出「包含 target 的最上層浮層」，關掉它之上的層 → **點父選單只關子選單**。 |
| `subscribe` / `getSnapshot` | 給 `useSyncExternalStore`。 |
| `reset()` | 測試用。 |

z-index（§2.6，`OVERLAY_Z_INDEX`）：`dropdown 300 / toolbar 400 / modal 500 / toast 600 / tooltip 700`。

### 其他匯出

| API | 說明 |
|---|---|
| `<OverlayRoot>` | 提供唯一掛載點（`#kn-overlay-root`）。沒渲染時各元件會自行建立。 |
| `<OverlayPortal>` | portal 到掛載點。 |
| `useOverlay({ open, level, onClose, closeOnOutside, closeOnEsc, trapFocus, lockScroll, anchor })` | 回傳 `{ id, zIndex, setFloating, isTop, close }`。 |
| `useOverlayStack()` | 訂閱整個堆疊。 |
| `<FocusTrap active initialFocus restoreFocus inertRoot>` | §4.7.3 的 React 包裝。 |
| `createFocusTrap(container, options)` | 框架無關版本；回傳 cleanup（**會還原焦點**）。內容若已自行聚焦（例如 MenuList）就不搶。 |
| `getFocusable(container)` | 可聚焦元素清單。 |
| `useScrollLock(enabled)` | 鎖 `body` 捲動 + 補捲軸寬度，多浮層以計數管理。 |
| `useDismiss({ enabled, outsidePress, escape, referencePress, floating, reference, onDismiss })` | 獨立的關閉行為；用原生 document 監聽（React 合成事件會沿 React 樹冒泡，portal 出去的浮層會誤判成外部）。 |

---

## 3. 元件

所有元件樣式走 CSS Modules + `--kn-*` token，深色模式自動跟著 `tokens.css` 走。

### `<Button>`

| Prop | 型別 | 預設 |
|---|---|---|
| `variant` | `'ghost' \| 'primary' \| 'danger' \| 'subtle' \| 'outline'` | `'ghost'` |
| `size` | `'sm' \| 'md'` | `'md'` |
| `loading` | `boolean` | `false` |
| `startIcon` / `endIcon` | `ReactNode` | — |
| `fullWidth` | `boolean` | `false` |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` |

```tsx
<Button variant="primary" startIcon={<Icon name="plus" />}>新增頁面</Button>
```

### `<IconButton>`

繼承 `Button`（去掉 `startIcon`/`endIcon`/`fullWidth`）。

| Prop | 型別 | 預設 | 說明 |
|---|---|---|---|
| `label` | `string` | **必填** | `aria-label` 與 tooltip 內容。 |
| `tooltip` | `boolean` | `true` | §4.7.4：IconButton 必帶 Tooltip。 |
| `shortcut` | `string` | — | tooltip 右側快捷鍵，如 `'mod+b'`。 |

### `<Input>`

| Prop | 型別 | 預設 |
|---|---|---|
| `size` | `'sm' \| 'md'` | `'md'` |
| `variant` | `'outline' \| 'filled'` | `'outline'` |
| `label` / `hint` / `error` | `ReactNode` | — |
| `startAdornment` / `endAdornment` | `ReactNode` | — |
| `autoSelect` | `boolean` | — | 掛載後聚焦並全選（重新命名用） |

其餘同原生 `<input>`（受控／非受控皆可）。`error` 會自動加 `aria-invalid` 與 `aria-describedby`。

### `<Switch>` / `<Checkbox>`

原生 `<input type="checkbox">` + 自繪外觀，保留鍵盤與表單語意。
`Switch` 有 `size`（`'sm' | 'md'`）；`Checkbox` 有 `indeterminate`。

### `<Select>`（自研 listbox，不用原生 `<select>`）

| Prop | 型別 | 預設 |
|---|---|---|
| `options` | `SelectOption[]`（`{ value, label, description?, icon?, disabled? }`） | — |
| `value` / `defaultValue` / `onChange` | 受控／非受控 | — |
| `placeholder` | `string` | `'請選擇…'` |
| `size` | `'sm' \| 'md'` | `'md'` |
| `matchWidth` | `boolean` | `true` |
| `placement` | `Placement` | `'bottom-start'` |

`role="combobox"` 觸發器 + `role="listbox"` 面板 + `role="option"`，方向鍵／Home／End／首字母跳轉。

### `<Tabs>`

`items: { id, label, icon?, disabled?, content? }[]`、`value` / `defaultValue` / `onChange`、
`actions`（右側附加內容，例如「＋ 新增檢視」）、`hideContent`。
`role="tablist"` + roving tabindex + ←→/Home/End。

### `<Popover>`

| Prop | 型別 | 預設 | 說明 |
|---|---|---|---|
| `open` / `defaultOpen` / `onOpenChange` | | | 受控或非受控 |
| `anchor` | `Element \| RectLike \| (() => …)` | trigger 元素 | **支援 DOMRect**，浮動工具列／slash menu 用 |
| `trigger` | `ReactNode` | — | **asChild 語意**：`onClick` / `aria-*` / `ref` 用 `cloneElement` 直接合併到 trigger 元素上 |
| `asChild` | `boolean` | `true` | `false` 時改回「包一層 inline-flex span」；trigger 不是單一元素時也會自動退回 |
| `placement` / `offset` / `flip` / `shift` / `padding` / `matchWidth` / `arrow` | 同 `computePosition` | |
| `level` | `OverlayLevel` | `'dropdown'` | 決定 z-index |
| `closeOnOutside` / `closeOnEsc` / `trapFocus` | `boolean` | `true` / `true` / `false` | |
| `initialFocus` | `RefObject<HTMLElement>` | — | |
| `autoUpdateOptions` | `AutoUpdateOptions` | — | 要追 caret 就 `{ animationFrame: true }` |
| `role` | `'dialog' \| 'menu' \| 'listbox' \| 'tooltip' \| 'none'` | `'dialog'` | 內容自帶 role 時傳 `'none'` |
| `haspopup` | `'dialog' \| 'menu' \| 'listbox' \| false` | 由 `role` 推導 | trigger 的 `aria-haspopup` |
| `padded` | `boolean` | `true` | 選單自行控制內距時設 `false` |

trigger 的 `onClick` **掛在 trigger 元素本身**，不是包住它的 `<span>`：
包一層 span 的寫法等於要求 trigger 內不能 `stopPropagation()`（例如同一列既要導頁、
又有自己的 ⋯ 按鈕時很常見），一擋掉浮層就永遠打不開。
trigger 原本的 `onClick` 會先被呼叫，它若 `preventDefault()` 就不會 toggle；
原本的 `ref` 也會被保留（兩邊都拿得到節點）。

```tsx
// 浮動工具列：錨定於選取範圍，捲動時持續追蹤
<Popover
  open={hasSelection}
  anchor={getSelectionRect}
  placement="top"
  level="toolbar"
  autoUpdateOptions={{ animationFrame: true }}
>
  <InlineToolbar />
</Popover>
```

### `<Dialog>`

| Prop | 型別 | 預設 |
|---|---|---|
| `open` / `onClose` | | **必填** |
| `title` / `description` / `footer` | `ReactNode` | — |
| `size` | `'sm' \| 'md' \| 'lg' \| 'search' \| 'full'` | `'md'` |
| `align` | `'center' \| 'top'` | `'center'`（`'top'` 為距頂端 15vh 的搜尋型 modal） |
| `showClose` / `closeOnBackdrop` / `closeOnEsc` | `boolean` | `true` |
| `initialFocus` | `RefObject<HTMLElement>` | — |
| `inertRoot` | `HTMLElement \| null` | — | 背景設 `inert` + `aria-hidden` |
| `flush` | `boolean` | `false` | body 不加內距 |

focus trap + scroll lock + `role="dialog"` / `aria-modal` / `aria-labelledby`；
遮罩淡入、面板淡入 + 上移 8px，`prefers-reduced-motion` 下即時顯示。

### `<Menu>` / `<MenuItem>` / `<MenuSeparator>` / `<MenuGroup>` / `<SubMenu>`

`Menu` 繼承 `Popover`（去掉 `role` / `padded`），另有 `listProps`、`listRole`。

`MenuItem`：

| Prop | 型別 | 說明 |
|---|---|---|
| `icon` | `ReactNode` | 左側圖示欄 |
| `children` | `ReactNode` | 主文字 |
| `textValue` | `string` | 打字搜尋比對用（children 非字串時必填） |
| `description` | `ReactNode` | 第二行說明（slash menu 用） |
| `shortcut` | `string` | 右側快捷鍵欄，如 `'mod+d'` |
| `trailing` | `ReactNode` | 覆寫右側內容 |
| `checked` | `boolean` | 顯示勾勾 |
| `disabled` / `danger` | `boolean` | |
| `onSelect` | `() => void` | |
| `closeOnSelect` | `boolean`（預設 `true`） | 多選選單設 `false` |

鍵盤：roving tabindex、↑↓（跳過 disabled、循環）、Home / End、Enter / Space 選取、
打字搜尋（600ms 緩衝、單字母連按可在同字首項目間循環）、→ 開子選單、← 關子選單。

`SubMenu`：hover 300ms 延遲開啟 + **安全三角形**（滑鼠往子選單移動時不切換項目），
子選單自成 overlayStack 的一層，Esc 只關它。

### `<SearchableMenu>`（slash menu / 快速尋找）

| Prop | 型別 | 預設 |
|---|---|---|
| `items` | `SearchableMenuItem[]`（`{ id, label, description?, icon?, keywords?, shortcut?, group?, disabled? }`） | — |
| `query` / `defaultQuery` / `onQueryChange` | 受控／非受控查詢字串 | |
| `searchable` | `boolean` | `true`（設 `false` 時由外部餵 `query`） |
| `placeholder` / `emptyMessage` | | `'搜尋…'` / `'沒有符合的項目'` |
| `groupOrder` | `string[]` | 分組顯示順序 |
| `filter` | `(item, query) => boolean` | 預設比對 label / description / keywords |
| `onSelect` | `(item) => void` | |
| `footer` | `ReactNode` | 底部提示列 |
| `maxHeight` | `number` | `320` |
| `handleRef` | `Ref<SearchableMenuHandle>` | `{ move(delta), selectActive(), activeId }` |

在編輯器裡打字時（焦點不在選單上）用 `searchable={false}` + 受控 `query` + `handleRef.current.move/selectActive`。

### `<ContextMenu>` / `useContextMenu()`

```tsx
<ContextMenu menu={<><MenuItem>重新命名</MenuItem><MenuItem danger>刪除</MenuItem></>}>
  <TreeNode />
</ContextMenu>
```

預設會包一層 `<div className={className}>` 收 `onContextMenu`；`asChild`（給了 `className` 時無效）
改成把 `onContextMenu` 直接合併到單一子元素上 —— 子元素自己對 contextmenu `stopPropagation()` 時也收得到。

需要更細控制時：`const ctx = useContextMenu()` → `{ onContextMenu, anchor, open, setOpen, openAt, close }`，
再自行渲染 `<Menu anchor={ctx.anchor} open={ctx.open} onOpenChange={ctx.setOpen}>`。

### `<Tooltip>`

| Prop | 型別 | 預設 |
|---|---|---|
| `content` | `ReactNode` | — |
| `shortcut` | `string` | — |
| `placement` / `offset` | | `'top'` / `6` |
| `delay` | `number` | `400`（`TOOLTIP_OPEN_DELAY`），關閉延遲 `100` |
| `disabled` | `boolean` | `false` |

`children` 是單一元素時用 `cloneElement` 合併（asChild 語意），
子元素原本的 `onPointerEnter` / `onPointerLeave` / `onFocus` / `onBlur` / `ref` 都會保留；
不是單一元素時才退回包一層 `<span>`。

跨元件共享的 delay group：目前有 tooltip 開著、或上一個關掉未滿 300ms，就免延遲直接顯示。
觸控裝置（`pointer: coarse`）不顯示。永遠 z-index 700，不搶焦點。

### `toast` / `<ToastRegion>`

```tsx
toast.show({ title: '已刪除 1 個區塊', action: { label: '復原', onClick: undo } });
toast.success('已複製連結');
toast.error('連線失敗', { description: '將於 5 秒後重試。' });
toast.dismiss(id);
```

| `ToastOptions` | 預設 | 說明 |
|---|---|---|
| `title` | — | 必填 |
| `description` | — | |
| `tone` | `'info'` | `'info' \| 'success' \| 'error' \| 'warning'` |
| `duration` | `4000`（error `6000`） | `0` 表示不自動關閉 |
| `action` | — | `{ label, onClick }` |
| `id` | 自動 | 相同 id 會取代既有 toast |

最多同時 3 則；滑鼠移入暫停倒數；error 用 `role="alert"`，其餘 `role="status"`。

### `<Avatar>` / `<AvatarStack>`

`Avatar`：`name`（必填）、`src`、`seed`、`size`（預設 24）、`shape`（`'circle' | 'rounded'`）。
圖片失敗 → 姓名首字（中文取後兩字、英文取首末字母）+ 依 seed 雜湊的 block 配色。
`AvatarStack`：`people`、`max`（預設 4）、`size`。
另匯出 `avatarColor(seed)`、`avatarInitials(name)`。

### `<Spinner>` / `<Skeleton>` / `<Divider>` / `<Kbd>`

- `Spinner`：`size`（預設 16）、`label`（有 label 才進無障礙樹）。
- `Skeleton`：`shape`（`'text' | 'rect' | 'circle'`）、`width`、`height`、`lines`。
- `Divider`：`orientation`、`label`（帶文字的分隔線）。
- `Kbd`：`keys`（`'mod+k'` 會依平台顯示 ⌘K / Ctrl+K）或直接給 children。

### `<Resizable>`

| Prop | 型別 | 預設 |
|---|---|---|
| `size` / `defaultSize` | `number` | `260` |
| `min` / `max` | `number` | `120` / `640` |
| `side` | `'right' \| 'left' \| 'bottom' \| 'top'` | `'right'` |
| `onResize` / `onResizeEnd` | `(size: number) => void` | |
| `resetSize` | `number` | 雙擊把手時重設 |
| `step` | `number` | `16`（Shift 為 4 倍） |
| `handleLabel` | `string` | `'調整大小'` |

Pointer Events + `setPointerCapture`，拖曳中加 `html.kn-dragging` 禁止文字選取；
把手可聚焦，←→/↑↓/Home/End 可用鍵盤調整（`role="separator"` + `aria-valuenow`）。
`onResize` / `onResizeEnd` 拿到的都是**夾在 min/max 之後**的值；兩者都是選用的，
鍵盤調整與雙擊重設不需要 `onResizeEnd` 也會生效（非受控時尺寸自己會更新）。

---

## 4. 虛擬捲動 `virtual/`

### `<VirtualList>`

| Prop | 型別 | 預設 | 說明 |
|---|---|---|---|
| `items` | `readonly T[]` | — | |
| `itemSize` | `number \| ((i) => number)` | — | 數字 = 固定高（純數學，最快）；不給 = 不定高 + 量測快取 |
| `estimateSize` | `number` | `60` | 不定高模式的估計值 |
| `overscan` | `number` | `4` | |
| `horizontal` | `boolean` | `false` | 資料庫表格欄 |
| `size` | `number \| string` | `400` | 容器高度（橫向時為寬度） |
| `getKey` | `(item, i) => string \| number` | index | |
| `empty` | `ReactNode` | — | |
| `children` | `(item, virtual) => ReactNode` | — | `virtual`：`{ index, start, size, end }` |

`ref` 取得 `VirtualListHandle`：`scrollToIndex(i, { align: 'auto' \| 'start' \| 'center' \| 'end' })`、
`scrollToOffset(px)`、`measure()`、`getScrollElement()`。

不定高模式以 `ResizeObserver` 回填真實高度、分段重算前綴和；
**修正點在視窗之上時會同步調整 `scrollTop`**，避免畫面跳動（§8.4）。
項目一律以 `translate3d` 定位（合成層，捲動不觸發 layout）。

底層 hook `useVirtual({ count, getScrollElement, itemSize, estimateSize, overscan, horizontal, fallbackViewport })`
可單獨用在自訂結構（例如表格的 `<tbody>`）。

---

## 5. 拖放引擎 `dnd/`

### `computeDropTarget(pointer, items, options?)`（純函式）

頁面樹與 block 排序共用，完全不碰 DOM。

`items: DropItemRect[]`：`{ id, top, bottom, left, right, depth?, acceptsChildren? }`（依 `top` 排序）。

| 選項 | 預設 | 說明 |
|---|---|---|
| `mode` | `'tree'` | `'tree'` 三段式 before / inside / after；`'list'` 兩段式 |
| `insideThreshold` | `24` | **水平偏移 ≥ 此值即判定為「進裡面」** |
| `indentUnit` | `24` | 每層縮排寬度（`--block-indent`） |
| `contentLeft` | 目標項目的 `left` | 算水平偏移的基準 |
| `edgeRatio` | `0.25` | 三段式上下緣比例（中段刻意佔 50%） |
| `disabledIds` | — | 來源自身與其子孫；命中回傳 `null` |
| `maxDepth` | `Infinity` | |

回傳 `{ id, position, itemIndex, index, depth, indicator }`，
`indicator` 為 `{ type: 'line' \| 'box', x, y, width, height }`（`'inside'` 畫整列外框，其餘畫線）。

另有 `computeInsertIndex(pointer, items, orientation?)`：看板 / 單純排序用。

### React API

```tsx
<DndProvider>
  <Tree />
</DndProvider>
```

| API | 說明 |
|---|---|
| `<DndProvider controller? indicator?>` | 提供 controller，並在 OverlayRoot 掛上**唯一**的幽靈層與落點指示器 |
| `useDraggable({ id, kind, data?, disabled?, getGhost?, onDragStart?, onDragEnd? })` | → `{ setNodeRef, handleProps, isDragging }` |
| `useDroppable({ id, accepts, orientation?, itemSelector?, dropOptions?, resolveDrop?, getScrollContainer?, onDrop? })` | → `{ setNodeRef, isOver, target }` |
| `useDragState()` | 訂閱 `{ phase, sourceId, kind, payload, pointer, zoneId, target }` |
| `dragController` | 單例；另有 `invalidateRects()`（spring-loaded 展開後重建 rect 快取）、`cancel()`、`reset()` |
| `<SortableList>` | 便利包裝，見下 |

落點項目需要 `data-kn-dnd-item` + `data-id`（可選 `data-depth`、`data-accepts-children`）；
`SortableList` 會自動加上。

兩個 `setNodeRef` 的身分都是**穩定的**（`useCallback` 空相依），可以安心放進 `deps`。
註冊／反註冊以 **effect** 為準，ref callback 只記住節點 ——
React 18 StrictMode 的「setup → cleanup → setup」不會重跑 ref callback，
若註冊寫在 ref、反註冊寫在 effect cleanup，第二次 setup 前就會把自己註銷掉。
同理，inline ref callback 每次 render 造成的 `ref(null)` → `ref(同一節點)` 也不會重註冊
（否則會在拖曳中把 zone 的 rect 快取清掉）。

指標捕獲（`setPointerCapture`）一律打在 **`registerSource()` 當時登記的元素**上，
**不能**用事件的 `currentTarget`：呼叫端交過來的是 React 合成事件的 `nativeEvent`，
而 React 18 的原生監聽掛在 root container，`currentTarget` 會是 `#root` ——
指標被 root 捕獲後，整個應用的 `pointerup` / `click` 都會被重新指派過去（點了沒反應）。
想改捕獲在把手上時，用 `dragController.handlePointerDown(id, event, handleEl)` 的第三個參數。

行為：桌機移動 > 5px、觸控長按 400ms（期間移動則取消，讓使用者還能捲動）；
rAF 迴圈中「先寫 DOM、再讀快取」，零 `getBoundingClientRect`；邊緣 60px 內自動捲動（二次曲線加速）；
拖曳中 `html.kn-dragging` 禁止文字選取；`kind` / `accepts` 用來隔離不同種類的拖放。

### `<SortableList>`

| Prop | 型別 | 預設 |
|---|---|---|
| `id` | `string` | — |
| `items` / `getId` | | — |
| `getDepth` / `getAcceptsChildren` | `(item, i) => …` | — |
| `kind` | `string` | `` `sortable:${id}` `` |
| `mode` | `'list' \| 'tree'` | `'list'` |
| `dropOptions` | `ComputeDropTargetOptions` | |
| `onReorder` | `({ from, to, position, depth, result }) => void` | |
| `children` | `(item, { setNodeRef, handleProps, isDragging, index }) => ReactNode` | |

---

## 6. Icons `icons/`

80 個自建 SVG icon：20×20 viewBox、1.5px 線條、`currentColor`、round cap/join。

```tsx
<Icon name="chevron-right" size={16} />
<Icon name="trash" title="刪除" />   {/* 有 title → role="img"；沒有 → aria-hidden */}
```

| Prop | 型別 | 預設 |
|---|---|---|
| `name` | `IconName` | — |
| `size` | `number \| string` | `20` |
| `strokeWidth` | `number` | `1.5` |
| `title` | `string` | — |

`ICON_NAMES` 為完整清單，`ICON_SHAPES` 為原始形狀資料（要產 sprite 或給非 React 環境用時可直接讀）。

包含：chevron-right/down/left/up、plus、search、home、inbox、settings、trash、star、star-filled、
more-horizontal/vertical、drag-handle(⠿)、page、page-empty、database、table、board、list、gallery、
calendar、timeline、comment、history、share、duplicate、link、check、close、arrow-left/right/up/down、
sidebar-toggle、sun、moon、bold、italic、underline、strikethrough、code、text-color、undo、redo、
image、file、bookmark、divider、quote、callout、todo、bulleted-list、numbered-list、toggle、
heading1/2/3、text、paragraph、filter、sort、group、hide、lock、globe、user、users、bell、help、
template、import、export、expand、collapse、external-link、sync、emoji、reload。

---

## 7. 樣式 `styles/ui.css`

- **元件層 token**（設計系統 §6.1 Layer 3）：`--kn-ui-*` 全部由 `apps/web` 的 `--kn-*` 語意 token 衍生，
  所以 primitives 不需要自己判斷主題，深色模式自動跟著走。
- Notion 對齊值：選單圓角 6px（面板 8px）、陰影
  `rgba(15,15,15,.05) 0 0 0 1px, rgba(15,15,15,.1) 0 3px 6px, rgba(15,15,15,.2) 0 9px 24px`、
  選單項高 28px、字 14px、hover `rgba(55,53,47,.08)`（深色 `rgba(255,255,255,.055)`）。
- 全域 class：`#kn-overlay-root`（pointer-events 穿透）、`html.kn-dragging`、`.kn-drag-ghost`、
  `.kn-drop-indicator`、`.kn-scroll`（細捲軸）、`.kn-focusable`（focus ring）、`.kn-sr-only`。

---

## 決策

1. **`computePosition` 收 options 物件而非 `(anchor, floating, opts)` 三參數。**
   規格 §4.5.2 寫的是三參數；改成單一 options 物件是為了讓 `floating` 可以是「純尺寸物件」，
   單元測試才能在 jsdom 裡手動餵 rect（jsdom 量不到排版）。行為與步驟完全照規格。
2. **`anchor` 同時接受 `Element` 與 `RectLike`。** 規格要求一律傳 `DOMRect`，但 90% 的呼叫端手上就是元素，
   每次都寫 `el.getBoundingClientRect()` 是重複勞動且容易忘記重新量測。內部一律正規化成純物件快照。
3. **z-index 採 §2.6 的表（dropdown 300 / toolbar 400 / modal 500 / toast 600 / tooltip 700），
   而不是 `tokens.css` 現有的 `--kn-z-*`。** 兩者不一致（tokens 少了 toolbar 與 tooltip）。
   JS 端用 `OVERLAY_Z_INDEX` 常數，CSS 端在 `ui.css` 以 `--kn-ui-z-*` 鏡像。
   `tokens.css` 屬於 apps/web，本代理不改；等統一時只要把 `ui.css` 的鏡像換成 `var()` 即可。
4. **Tooltip 開啟延遲用 400ms 而非規格的 500ms**，關閉 100ms，並加上 300ms 的跨元件 grace period。
   500ms 在工具列上連續掃過時感覺遲鈍；400ms + delay group 是實測較順手的組合。
5. **Tooltip 與 Toast 不進 `overlayStack`。** 兩者都不搶焦點、不吃外部點擊，
   進堆疊只會讓 `closeTop()` 的語意變複雜（Esc 應該關選單而不是關 tooltip）。
   它們直接用 `OVERLAY_Z_INDEX` 取 z-index，Tooltip 自行處理 Esc。
6. **浮層的 `role` 與 trigger 的 `aria-haspopup` 拆成兩個 prop。**
   `Menu` / `Select` / `SearchableMenu` 的內容自帶 `role="menu"` / `role="listbox"`，
   若 `Popover` 外層也掛同一個 role 會產生巢狀重複 role（`getByRole` 會抓到兩個，螢幕閱讀器也會念兩次）。
   因此這些元件傳 `role="none"` + `haspopup="menu"`。
7. **`createFocusTrap` 在「焦點已經在容器內」時不搶焦點。**
   `MenuList` 掛載時會先聚焦第一個項目，若 focus trap 之後又把焦點搬到容器本身，
   方向鍵與 Enter 就會失效（事件不會到 MenuList 的 handler）。
8. **`SearchableMenu` 自己管理高亮，不重用 `MenuList` 的 roving tabindex。**
   slash menu 的焦點通常留在編輯器裡，需要把 `move` / `selectActive` 交給外部；
   而且 query 改變時要能立刻把高亮拉回第一筆。`MenuList` 的模型是「焦點跟著高亮走」，不適用。
9. **`useMenuItem` 的 ref callback 不把 context 放進 deps。**
   context 物件每次 `activeId` 改變都會換身分，放進 deps 會讓 React 每次 re-render 重跑 ref
   （先 `null` 再 `node`），反覆解除註冊 → 剛設定的 active 立刻被清掉。context 改走 ref 讀取。
10. **`getFocusable` 用 computed style 判斷可見性，不用 `offsetParent`。**
    jsdom 沒有排版，`offsetParent` 永遠是 `null`，會讓所有元素被判定為隱藏、focus trap 整個失效。
11. **`Input` 的前後綴 prop 叫 `startAdornment` / `endAdornment`。**
    原生 `<input>` 的 `prefix` 屬性型別是 `string`，用同名 prop 會與 `InputHTMLAttributes` 衝突。
12. **DnD 不做鍵盤拖曳。** 規格 §4.6.5 標為 P2，本次略過；
    但 `Resizable` 有完整鍵盤支援，`computeDropTarget` 是純函式，之後要補鍵盤模式不需要改引擎。
13. **看板的「撐開間隙」動畫（§4.6.4 C）留給呼叫端。**
    引擎提供 `computeInsertIndex` 與 `useDragState()`，位移哪些卡片是版面層的決定，
    硬塞進 primitives 會綁死 DOM 結構。
14. **playground 直接 import `apps/web/src/styles/tokens.css`**（`server.fs.allow` 放行 repo 根），
    維持設計 token 的單一真實來源，不在 `packages/ui` 複製一份會漂移的副本。
15. **CSS Modules 用 `composes`（`Menu.module.css` 的 `.option`）。**
    Vite 原生支援；vitest 以 `css: false` 跑，class 名走 proxy，不影響測試。
16. **trigger 一律走 `cloneElement`（asChild），不包外層 `<span>`。**
    掛在外層 span 的 `onClick` 收的是冒泡上來的事件，trigger 內只要 `stopPropagation()`
    浮層就永遠打不開；包一層也會多一個 inline-flex 盒子干擾版面。
    共用工具在 `components/trigger.ts`（handler 組合 + ref 合併），`Popover` / `Tooltip` / `ContextMenu` 共用。
17. **DnD 的註冊以 effect 為準、指標捕獲打在註冊的元素上。**
    註冊寫在 ref callback 會被 React 18 StrictMode 的 setup → cleanup → setup 註銷掉（ref 不會重跑）；
    捕獲用事件的 `currentTarget` 會打在 React 的 root container 上，讓整個應用的 click 失效。
    細節見 `dnd/useNodeRegistration.ts` 的註解。

## 尚未實作

- `DatePicker`、`EmojiPicker`、`ColorSwatch`（§4.7.4 列為 P1，但依賴 emoji 資料表與日期在地化，
  規模足以自成一個交付）。
- DnD 的鍵盤拖曳模式（§4.6.5，P2）與 spring-loaded 自動展開的 UI（引擎已提供 `invalidateRects()`）。
- `Drawer`（行動版側欄）——目前 `Dialog` 在 640px 以下已自動全螢幕，暫時夠用。
