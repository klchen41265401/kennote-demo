/**
 * database 模組的公開介面（給其他代理／其他模組 import 用）。
 *
 * 只從這裡 import，不要深入 features/database/** 的內部檔案 ——
 * 內部結構還會隨著 registry 擴充而變動。
 */

// registry 的副作用 import：任何人 import 這個模組就會拿到完整註冊表
import './fields/index';
import './views/index';

export { DatabaseView } from './DatabaseView';
export type { DatabaseViewProps } from './DatabaseView';
export { InlineDatabase } from './InlineDatabase';
export type { InlineDatabaseProps } from './InlineDatabase';
/* `RowPeek` 已移除：side peek 改由 `features/peek` 的 `<PeekHost>` 統一畫
   （gap-review §C-1 —— 舊的走 `_fallback/Dialog`，是 modal，不是 peek）。 */
export { EditableCell } from './EditableCell';
export { FieldIcon } from './_fallback';
export type { EditableCellProps } from './EditableCell';

export { createDatabase, useDatabase, fetchRows, downloadCsv } from './api';
export type { CreateDatabaseInput } from './api';

export { DatabaseContext, useDatabaseContext } from './context';
export type { DatabaseContextValue } from './context';

export { getFieldType, listFieldTypes, fieldTypeGroups, registerFieldType } from './fields/types';
export type { FieldTypeDefinition } from './fields/types';
export { getViewType, listViewTypes, registerViewType } from './views/types';
export type { ViewDefinition, ViewProps } from './views/types';
