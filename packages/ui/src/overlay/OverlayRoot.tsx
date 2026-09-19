import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const OVERLAY_ROOT_ID = 'kn-overlay-root';

const OverlayContainerContext = createContext<HTMLElement | null>(null);

/**
 * 取得（必要時建立）唯一的浮層掛載點（§4.7.1）。
 * 所有浮層都掛在 body 下，避免被祖先的 overflow/transform/filter 裁切。
 */
export function getOverlayContainer(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(OVERLAY_ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = OVERLAY_ROOT_ID;
    // pointer-events 穿透由 ui.css 負責；這裡補上最低限度的 inline 樣式，
    // 即使呼叫端忘了載入 ui.css 也不會擋住整個畫面。
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
  }
  return el;
}

export interface OverlayRootProps {
  /** 一般不用填；預設自動在 body 下建立 #kn-overlay-root。 */
  container?: HTMLElement | null;
  children?: ReactNode;
}

/**
 * 掛在 App 最外層一次即可。提供浮層掛載點給所有 Popover / Dialog / Menu / Toast。
 * 不渲染時各元件會自行 lazy 建立掛載點，所以它是「建議」而非「必要」。
 */
export function OverlayRoot({ container, children }: OverlayRootProps): JSX.Element {
  const [created] = useState(() => container ?? getOverlayContainer());
  const resolved = container ?? created;

  return (
    <OverlayContainerContext.Provider value={resolved}>{children}</OverlayContainerContext.Provider>
  );
}

export function useOverlayContainer(): HTMLElement | null {
  const fromContext = useContext(OverlayContainerContext);
  // 用 lazy initializer 同步建立掛載點：若等 effect 才建立，
  // 第一輪 render 會 portal 不出任何東西，浮層的 ref / focus trap 就全都拿不到節點。
  const [fallback] = useState<HTMLElement | null>(() => getOverlayContainer());
  return fromContext ?? fallback;
}

export interface OverlayPortalProps {
  children: ReactNode;
  container?: HTMLElement | null;
}

/** 把 children portal 到浮層掛載點。容器還沒準備好時回傳 null。 */
export function OverlayPortal({ children, container }: OverlayPortalProps): JSX.Element | null {
  const fallback = useOverlayContainer();
  const target = container ?? fallback;
  if (!target) return null;
  return createPortal(children, target);
}
