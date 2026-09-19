/**
 * Field Type Registry 的註冊入口。
 *
 * ⭐ 新增一種欄位型別 = 新增一個資料夾 + 這裡多一行 import。
 *   Table / Board / List / Gallery / Calendar / FilterBuilder / SortBuilder /
 *   PropertyList / CSV 匯出**一行都不用改** —— rating 就是證明（04 §8 M4 驗收標準）。
 *
 * import 的順序 = 型別選單的顯示順序，所以刻意照 Notion 的排法。
 */
import './title/index';
import './text/index';
import './number/index';
import './select/index';
import './multiSelect/index';
import './date/index';
import './person/index';
import './files/index';
import './checkbox/index';
import './url/index';
import './email/index';
import './phone/index';
import './rating/index';
import './formula/index';
import './relation/index';
import './rollup/index';
import './createdTime/index';
import './lastEditedTime/index';
import './createdBy/index';
import './lastEditedBy/index';

export * from './types';
