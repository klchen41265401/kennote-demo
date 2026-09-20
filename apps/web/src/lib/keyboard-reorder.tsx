/**
 * O-17（第十三輪）：**拖曳排序的鍵盤替代路徑**。
 *
 * 第十一輪把資料庫模組的拖放從 HTML5 DnD 換成 Pointer Events，
 * 第十二輪又讓 hover-only 的入口在觸控上常駐 —— 兩輪都在處理**指標**。
 * 但 `useSortableItem()` / `useCardDrag()` 綁的全是 `onPointerDown`：
 * 沒有滑鼠也沒有手指的人（鍵盤、切換開關、螢幕閱讀器）**連入口都沒有**，
 * 而且把手本來還是 `aria-hidden="true"` 的 `<span>` —— 對輔助技術等於不存在。
 *
 * 這支提供兩件事：
 *   1. `useKeyboardReorder()` —— 展開到把手上，把手變成真正的 `<button>`，
 *      Alt + ↑/↓（或 ←/→）移動一格，Alt + Home/End 移到頭 / 尾。
 *   2. `useReorderAnnouncer()` —— 一個 `aria-live="polite"` 的區域。
 *      **拖曳的回饋是視覺的**（落點線、半透明的列），鍵盤移動完畫面上
 *      同樣會動，但螢幕閱讀器讀不到「它現在在第幾個」——
 *      所以每一次移動都要用一句話把新位置講出來。
 *
 * ⚠️ 為什麼用 **Alt** 而不是單純的 ↑/↓：這些把手待在 Popover / 面板裡，
 * 方向鍵本身是選單的巡覽鍵（`Menu` 的 roving focus）。
 * 單押方向鍵會同時做兩件事，Alt 是 Notion / GitHub 清單排序的既有慣例。
 */
import { useCallback, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface ReorderAnnouncer {
  /** 講一句話給螢幕閱讀器（同一句連講兩次不會重播，所以訊息裡一定要帶位置） */
  announce: (message: string) => void;
  /** 放到清單容器裡（視覺上不可見） */
  live: ReactNode;
}

export function useReorderAnnouncer(): ReorderAnnouncer {
  const [message, setMessage] = useState('');
  const announce = useCallback((next: string) => setMessage(next), []);
  return {
    announce,
    live: (
      <span className="kn-sr-only" role="status" aria-live="polite" data-kn-reorder-live="">
        {message}
      </span>
    ),
  };
}

export interface KeyboardReorderOptions {
  /** 被搬的東西叫什麼（會念出來） */
  label: string;
  index: number;
  count: number;
  /** 搬到第 `to` 個（0-based）；`to` 一定在 0..count-1 之間 */
  onMove: (to: number) => void;
  announce?: (message: string) => void;
  /** 看板換欄是左右，清單是上下 */
  axis?: 'vertical' | 'horizontal';
  disabled?: boolean;
  /** 停用時要念的理由（例如「這個視圖有排序條件」） */
  disabledReason?: string;
}

export interface KeyboardReorderProps {
  tabIndex: number;
  'aria-label': string;
  'aria-disabled'?: true;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

/**
 * 按鍵 → 目標位置的**純函式**（`apps/web` 沒有 @testing-library，
 * 把判斷抽出來才驗得到；hook 只負責把結果接到 DOM 上）。
 *
 * 回傳值三態：
 *   - `number`：搬到第幾個（已保證在 0..count-1）
 *   - `'first'` / `'last'`：已經在頭 / 尾，**要出聲但不搬**
 *   - `null`：這個組合不歸我管，交回給外層（選單巡覽、瀏覽器捲動）
 */
export function reorderKeyTarget(
  e: { key: string; altKey: boolean; ctrlKey?: boolean; metaKey?: boolean },
  opts: { index: number; count: number; axis?: 'vertical' | 'horizontal' },
): number | 'first' | 'last' | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  const axis = opts.axis ?? 'vertical';
  const prevKey = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
  const nextKey = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  const { index, count } = opts;
  let to: number;
  if (e.key === prevKey) to = index - 1;
  else if (e.key === nextKey) to = index + 1;
  else if (e.key === 'Home') to = 0;
  else if (e.key === 'End') to = count - 1;
  else return null;
  if (to < 0) return 'first';
  if (to >= count) return 'last';
  // Home/End 在頭 / 尾按下去也是原地不動，跟撞邊界是同一種回饋
  if (to === index) return index === 0 ? 'first' : 'last';
  return to;
}

/** 位置的描述統一在這裡產生，訊息與 aria-label 才不會各講一套 */
function positionText(index: number, count: number, axis: 'vertical' | 'horizontal'): string {
  return axis === 'horizontal'
    ? `第 ${index + 1} 欄，共 ${count} 欄`
    : `第 ${index + 1} 項，共 ${count} 項`;
}

export function useKeyboardReorder(options: KeyboardReorderOptions): KeyboardReorderProps {
  const { label, index, count, onMove, announce, disabled } = options;
  const axis = options.axis ?? 'vertical';
  const hint = axis === 'horizontal' ? 'Alt + 左右鍵調整順序' : 'Alt + 上下鍵調整順序';

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      // 只吃 Alt 組合：不帶 Alt 的方向鍵要留給外層選單的巡覽
      const to = reorderKeyTarget(e, { index, count, axis });
      if (to === null) return;

      // 認得的組合一律吃掉，否則 Alt+↑ 會冒泡出去（Popover 的巡覽、瀏覽器的捲動）
      e.preventDefault();
      e.stopPropagation();

      if (disabled) {
        announce?.(options.disabledReason ?? `「${label}」目前不能調整順序`);
        return;
      }
      if (to === 'first' || to === 'last') {
        // 撞到頭 / 尾也要出聲：沒有回饋的話使用者只會以為按鍵沒被收到
        announce?.(`「${label}」已經在${to === 'first' ? '第一個' : '最後一個'}`);
        return;
      }
      onMove(to);
      announce?.(`「${label}」已移到${positionText(to, count, axis)}`);
    },
    [label, index, count, onMove, announce, disabled, options.disabledReason, axis],
  );

  return {
    tabIndex: 0,
    'aria-label': `移動「${label}」（${positionText(index, count, axis)}；${hint}）`,
    ...(disabled ? { 'aria-disabled': true as const } : {}),
    onKeyDown,
  };
}
