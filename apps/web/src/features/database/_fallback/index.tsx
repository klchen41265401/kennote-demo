/**
 * ⚠️ 暫時的 UI 基元（Popover / Menu / Dialog / VirtualList / icons）。
 *
 * 第十一輪：`dnd` 已經**從這裡搬走**了 —— HTML5 Drag & Drop 那一份
 * （`_fallback/dnd.ts`）整個刪掉，改用 `packages/ui/src/dnd` 的 Pointer 引擎，
 * 轉接層在 `features/database/dnd.ts`。理由見那支檔案的檔頭。
 *
 * `packages/ui` 由另一位代理平行開發中（`@kennote/ui` 目前只 export
 * createStore / useStore / useQuery / useMutation / invalidateQueries）。
 * database 模組需要這些基元才能動，所以先在這裡放一份**最小可用**的實作。
 *
 * ⭐ 替換方式：`packages/ui` 補齊之後，只要改這個檔案的 re-export：
 *
 *     export { Popover, Menu, MenuItem, Dialog, VirtualList } from '@kennote/ui';
 *
 * 其他檔案一律 `import { … } from '../_fallback'`，不直接 import 實作檔，
 * 所以替換的 diff 只會有這一支。
 */
export { Popover } from './Popover';
export type { PopoverProps } from './Popover';
export { Menu, MenuItem, MenuSeparator, MenuLabel } from './Menu';
export { Dialog } from './Dialog';
export { VirtualList } from './VirtualList';
export { FieldIcon, UiIcon } from './icons';
