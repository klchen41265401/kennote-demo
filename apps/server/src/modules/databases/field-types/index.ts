/**
 * Field Type Registry 的註冊入口（04 §10.2）。
 *
 * 新增一種欄位型別 = 新增一個檔案（或資料夾）+ 這裡多一行 import。
 * query-builder / service / routes / CSV 匯出**完全不必動**。
 * rating.ts 就是這條規則的實際證明。
 */
import './text-like.js'; // title / text / url / email / phone
import './numeric.js'; // number / checkbox
import './select-like.js'; // select / multiSelect
import './date.js'; // date
import './people-files.js'; // person / files
import './rating.js'; // ⭐ 自定型別的示範
import './system.js'; // createdTime / lastEditedTime / createdBy / lastEditedBy
import './relation-computed.js'; // relation / rollup / formula

export * from './types.js';
export * from './common.js';
export { buildDateFilterSql, expandDateFilterValue, localDateString } from './date.js';
export { buildArrayFilterSql } from './array-filter.js';
