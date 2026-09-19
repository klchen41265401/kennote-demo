/**
 * View Registry 的註冊入口（04 §10.3）。
 *
 * ⭐ 新增一種視圖（例如 timeline）= 一個資料夾 + 這裡多一行 import。
 *   視圖切換器、工具列、設定面板全部自動出現。
 *
 * import 的順序 = 視圖選單的顯示順序。
 */
import './table/index';
import './board/index';
import './list/index';
import './gallery/index';
import './calendar/index';
import './timeline/index';

export * from './types';
