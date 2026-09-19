import { registerFieldType } from '../types';
import { NumberFilterInput } from '../_shared/filters';
import { Cell } from './Cell';
import { Config } from './Config';
import { Editor } from './Editor';
import { ops } from './ops';

/**
 * 註冊 rating 欄位型別。這一行就是整個系統認識這個型別的全部入口：
 * Table / Board / List / Gallery / Calendar / 篩選 / 排序 / 匯出都從 registry 讀。
 */
registerFieldType({
  type: 'rating',
  ...ops,
  Cell,
  Editor,
  Config,
  FilterInput: NumberFilterInput,
});
