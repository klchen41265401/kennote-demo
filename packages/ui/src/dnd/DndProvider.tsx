import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { OverlayPortal } from '../overlay/OverlayRoot.js';
import { OVERLAY_Z_INDEX } from '../overlay/stack.js';
import { DragController, dragController, type DragState } from './controller.js';

const DndContext = createContext<DragController>(dragController);

export interface DndProviderProps {
  /** 自訂 controller（測試或多實例時用）。 */
  controller?: DragController;
  /** 是否渲染共用的 drop indicator，預設 true。 */
  indicator?: boolean;
  children?: ReactNode;
}

/**
 * 提供拖放 controller，並在 OverlayRoot 內掛上「唯一」的幽靈層與落點指示器。
 * 整個應用程式只建立一個 indicator（§4.6.4），由當前 zone 決定形狀與位置。
 */
export function DndProvider({
  controller = dragController,
  indicator = true,
  children,
}: DndProviderProps): JSX.Element {
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    controller.setGhostLayer(layerRef.current);
    return () => controller.setGhostLayer(null);
  }, [controller]);

  return (
    <DndContext.Provider value={controller}>
      {children}
      <OverlayPortal>
        <div
          ref={layerRef}
          className="kn-drag-layer"
          style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 200 }}
        >
          {indicator ? <DropIndicator controller={controller} /> : null}
        </div>
      </OverlayPortal>
    </DndContext.Provider>
  );
}

export function useDndController(): DragController {
  return useContext(DndContext);
}

export function useDragState(controller?: DragController): DragState {
  const ctx = useContext(DndContext);
  const c = controller ?? ctx;
  return useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
}

function DropIndicator({ controller }: { controller: DragController }): JSX.Element | null {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const geo = state.phase === 'dragging' ? state.target?.indicator : null;
  const style = useMemo(() => {
    if (!geo) return null;
    return {
      position: 'fixed' as const,
      left: 0,
      top: 0,
      transform: `translate3d(${Math.round(geo.x)}px, ${Math.round(geo.y)}px, 0)`,
      width: Math.round(geo.width),
      height: Math.round(geo.height),
      zIndex: OVERLAY_Z_INDEX.dropdown - 100,
      pointerEvents: 'none' as const,
    };
  }, [geo]);
  if (!geo || !style) return null;
  return (
    <div
      className={geo.type === 'box' ? 'kn-drop-indicator kn-drop-indicator--box' : 'kn-drop-indicator'}
      data-position={state.target?.position}
      style={style}
    />
  );
}
