/**
 * features/peek —— side peek（側邊 / 置中預覽）的對外入口。
 *
 * 只從這裡 import。`peek-url` / `peek-store` 兩支是葉節點（不 import 任何 feature），
 * `features/database` 可以直接引用它們而不會造成循環相依。
 */
export { PeekHost } from './PeekHost';
export { SidePeek, defaultPeekWidth, maxPeekWidth } from './SidePeek';
export type { SidePeekProps, PeekAction } from './SidePeek';
export { usePeekState, usePeekNavigation, parsePeekMode, PEEK_PARAM, PEEK_MODE_PARAM } from './peek-url';
export type { PeekMode, PeekState, PeekNavigation } from './peek-url';
export { registerPeekRowSource, releasePeekRowSource, usePeekRowSource } from './peek-store';
export type { PeekRowSource } from './peek-store';
