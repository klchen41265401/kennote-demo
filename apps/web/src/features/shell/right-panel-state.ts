/**
 * 右側面板的「目前顯示什麼」—— 薄薄一層，只是把 `stores/ui` 的
 * `rightPanelTab` 講成 Notion 的講法，讓面板外面的人（例如 `PageRoute`
 * 的預覽橫幅「還原此版本」）不必知道 store 的欄位名。
 *
 * Notion 7.34 的結構（`reference/shots/gap-review/notion/_SUMMARY.json`）：
 *   - 右側面板 = 一個 `<aside>`，裡面 role=tab 的「更新」/「分析」
 *   - **版本紀錄是 ⋯ 選單裡另一個獨立項目**，不是面板的 tab
 * kennote 多留一個「留言」檢視（Notion 這一版把頁面留言做成標題下方的
 * inline 討論串，但跨頁的「所有留言」仍然需要一個入口）。
 */
import { setRightPanel, uiStore, type RightPanelTab } from '../../stores/ui';

export type RightPanelView = RightPanelTab;

export function setRightPanelView(view: RightPanelView): void {
  setRightPanel(true, view);
}

export function closeRightPanel(): void {
  setRightPanel(false);
}

/** 版本紀錄是「佔滿面板的另一個檢視」，不是 tab —— 判斷放這裡，元件只問這一句 */
export function isFullView(view: RightPanelView): boolean {
  return view === 'history';
}

export function currentRightPanelView(): RightPanelView {
  return uiStore.getState().rightPanelTab;
}
