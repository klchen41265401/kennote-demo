import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { createFocusTrap } from './focus-trap.js';

export interface FocusTrapProps extends HTMLAttributes<HTMLDivElement> {
  /** 是否啟用；false 時完全不攔截焦點。 */
  active?: boolean;
  /** 開啟時先聚焦哪個元素。 */
  initialFocus?: RefObject<HTMLElement | null>;
  /** 關閉時還原焦點，預設 true。 */
  restoreFocus?: boolean;
  /** 設為 inert 的背景根元素（通常是 #root）。 */
  inertRoot?: HTMLElement | null;
  children?: ReactNode;
}

/** §4.7.3 的 React 包裝。把 children 包在一個 div 裡並捕捉 Tab。 */
export const FocusTrap = forwardRef<HTMLDivElement, FocusTrapProps>(function FocusTrap(
  { active = true, initialFocus, restoreFocus = true, inertRoot, children, ...rest },
  ref,
) {
  const localRef = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => localRef.current as HTMLDivElement);

  useEffect(() => {
    const node = localRef.current;
    if (!active || !node) return;
    return createFocusTrap(node, {
      initialFocus: initialFocus?.current ?? null,
      restoreFocus,
      inertRoot: inertRoot ?? null,
    });
    // initialFocus 是 ref，內容變動不需重建 trap。
  }, [active, restoreFocus, inertRoot]);

  return (
    <div ref={localRef} {...rest}>
      {children}
    </div>
  );
});
