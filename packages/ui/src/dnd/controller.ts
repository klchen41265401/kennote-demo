/**
 * 自製拖放引擎（02-UI架構 §4.6）。Pointer Events + setPointerCapture，
 * 不使用 HTML5 Drag & Drop（觸控不支援、ghost 不可控、事件頻率不可控）。
 *
 * 狀態機：idle → pending → dragging → dropping → idle
 */

import {
  computeDropTarget,
  type ComputeDropTargetOptions,
  type DropItemRect,
  type DropTarget,
  type Point,
} from './computeDropTarget.js';

export type DragPhase = 'idle' | 'pending' | 'dragging' | 'dropping';

/** 桌機：移動超過此距離才算開始拖。 */
export const POINTER_THRESHOLD = 5;
/** 觸控：長按此毫秒數才算開始拖。 */
export const TOUCH_HOLD_MS = 400;
/** 放開後的動畫期，期間鎖住新拖曳。 */
export const DROP_ANIMATION_MS = 120;
/** 自動捲動的邊緣寬度與最高速度。 */
const AUTOSCROLL_EDGE = 60;
const AUTOSCROLL_MAX_SPEED = 18;

export interface DragSourceSpec<P = unknown> {
  id: string;
  /** 用來隔離：只有 zone.accepts 含此 kind 才是有效落點。 */
  kind: string;
  getPayload: () => P;
  /** 自建幽靈元素；沒給就複製來源節點。 */
  getGhost?: (source: HTMLElement) => HTMLElement;
  disabled?: boolean;
  onDragStart?: () => void;
  onDragEnd?: (result: DropResult | null) => void;
}

export interface DropZoneSpec {
  id: string;
  accepts: readonly string[];
  orientation?: 'vertical' | 'horizontal';
  /** 項目選擇器，預設 '[data-kn-dnd-item]'。元素上需有 data-id（與可選的 data-depth）。 */
  itemSelector?: string;
  /** 傳給 computeDropTarget 的設定。 */
  dropOptions?: ComputeDropTargetOptions;
  /** 自訂落點解析；沒給就用 computeDropTarget。 */
  resolveDrop?: (pointer: Point, items: readonly DropItemRect[]) => DropTarget | null;
  /** 捲動容器；沒給就用 zone 元素本身。 */
  getScrollContainer?: () => HTMLElement | null;
  onDrop?: (result: DropResult) => void;
}

export interface DropResult {
  zoneId: string;
  sourceId: string;
  kind: string;
  payload: unknown;
  target: DropTarget;
}

export interface DragState {
  phase: DragPhase;
  sourceId: string | null;
  kind: string | null;
  payload: unknown;
  pointer: Point | null;
  zoneId: string | null;
  target: DropTarget | null;
}

const IDLE: DragState = {
  phase: 'idle',
  sourceId: null,
  kind: null,
  payload: null,
  pointer: null,
  zoneId: null,
  target: null,
};

interface RegisteredSource {
  el: HTMLElement;
  spec: DragSourceSpec;
}
interface RegisteredZone {
  el: HTMLElement;
  spec: DropZoneSpec;
  items: DropItemRect[];
  rect: DOMRect | null;
}

type Listener = () => void;

export class DragController {
  private sources = new Map<string, RegisteredSource>();
  private zones = new Map<string, RegisteredZone>();
  private listeners = new Set<Listener>();
  private state: DragState = IDLE;

  private active: RegisteredSource | null = null;
  private startPoint: Point = { x: 0, y: 0 };
  private grabOffset: Point = { x: 0, y: 0 };
  private pointer: Point = { x: 0, y: 0 };
  private pointerId = -1;
  private captureEl: Element | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private ghost: HTMLElement | null = null;
  private ghostLayer: HTMLElement | null = null;
  private lastTargetKey = '';

  // ── 註冊 ────────────────────────────────────────────────

  registerSource(el: HTMLElement, spec: DragSourceSpec): () => void {
    this.sources.set(spec.id, { el, spec });
    return () => {
      const cur = this.sources.get(spec.id);
      if (cur?.el === el) this.sources.delete(spec.id);
    };
  }

  registerZone(el: HTMLElement, spec: DropZoneSpec): () => void {
    this.zones.set(spec.id, { el, spec, items: [], rect: null });
    return () => {
      const cur = this.zones.get(spec.id);
      if (cur?.el === el) this.zones.delete(spec.id);
    };
  }

  setGhostLayer(el: HTMLElement | null): void {
    this.ghostLayer = el;
  }

  // ── 訂閱 ────────────────────────────────────────────────

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): DragState => this.state;

  private setState(patch: Partial<DragState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  // ── 互動入口：把這個掛到 drag handle 的 onPointerDown ──

  /**
   * 掛到 drag handle 的 onPointerDown。
   * @param captureTarget 可選：要拿指標捕獲的元素（例如只想捕獲在把手上）。
   *   沒給就用 registerSource() 當時記下來的來源元素。
   */
  handlePointerDown(sourceId: string, event: PointerEvent, captureTarget?: Element | null): void {
    if (this.state.phase !== 'idle') return;
    const source = this.sources.get(sourceId);
    if (!source || source.spec.disabled) return;
    if (event.button !== undefined && event.button !== 0 && event.pointerType === 'mouse') return;

    this.active = source;
    this.pointerId = event.pointerId;
    this.startPoint = { x: event.clientX, y: event.clientY };
    this.pointer = { ...this.startPoint };

    const rect = source.el.getBoundingClientRect();
    this.grabOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    /**
     * ⚠️ 不能用 event.currentTarget 決定捕獲對象。
     * 呼叫端交給我們的是 React 合成事件的 nativeEvent，而 React 18 的原生監聽掛在
     * root container 上 —— currentTarget 會是 `#root`，指標被 root 捕獲之後
     * 整個應用的 pointerup / mouseup / click 都會被重新指派過去（點了沒反應）。
     * 捕獲對象一律用「呼叫端註冊的來源元素」（或呼叫端明講的把手）。
     */
    const captureEl = resolveCaptureTarget(captureTarget, source.el, event);
    this.captureEl = captureEl;
    if (captureEl) {
      try {
        captureEl.setPointerCapture(event.pointerId);
      } catch {
        /* jsdom / 不支援時忽略 */
      }
    }

    window.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('pointercancel', this.onPointerUp, true);

    this.setState({ phase: 'pending', sourceId, kind: source.spec.kind, pointer: this.pointer });

    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      // 觸控：長按 400ms 才啟動，期間若移動就取消（讓使用者還能捲動頁面）。
      this.holdTimer = setTimeout(() => this.begin(), TOUCH_HOLD_MS);
    }
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointer = { x: event.clientX, y: event.clientY };
    if (this.state.phase === 'pending') {
      const dx = this.pointer.x - this.startPoint.x;
      const dy = this.pointer.y - this.startPoint.y;
      const moved = Math.hypot(dx, dy);
      if (this.holdTimer) {
        // 觸控：門檻前移動視為捲動意圖，取消拖曳。
        if (moved > POINTER_THRESHOLD) this.cancel();
        return;
      }
      if (moved > POINTER_THRESHOLD) this.begin();
      return;
    }
    if (this.state.phase === 'dragging') {
      event.preventDefault();
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    if (this.state.phase === 'dragging') this.drop();
    else this.cancel();
  };

  // ── 狀態轉換 ─────────────────────────────────────────────

  private begin(): void {
    if (!this.active) return;
    this.clearHold();
    const { spec, el } = this.active;

    // 拖曳中禁止文字選取（§4.6）。
    document.documentElement.classList.add('kn-dragging');
    document.getSelection()?.removeAllRanges();

    this.ghost = spec.getGhost ? spec.getGhost(el) : defaultGhost(el);
    this.ghost.classList.add('kn-drag-ghost');
    (this.ghostLayer ?? document.body).appendChild(this.ghost);

    // 一次讀完所有 rect，之後只做位移修正（§4.6.3）。
    this.buildRectCaches();

    spec.onDragStart?.();
    this.setState({
      phase: 'dragging',
      payload: spec.getPayload(),
      pointer: this.pointer,
    });
    this.lastTargetKey = '';
    this.raf = requestAnimationFrame(this.loop);
  }

  private buildRectCaches(): void {
    for (const zone of this.zones.values()) {
      const selector = zone.spec.itemSelector ?? '[data-kn-dnd-item]';
      zone.rect = zone.el.getBoundingClientRect();
      zone.items = Array.from(zone.el.querySelectorAll<HTMLElement>(selector)).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.dataset['id'] ?? '',
          depth: Number(el.dataset['depth'] ?? 0),
          acceptsChildren: el.dataset['acceptsChildren'] !== 'false',
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
        };
      });
    }
  }

  /** 版面改變（例如 spring-loaded 展開）後呼叫，下一幀重建。 */
  invalidateRects(): void {
    if (this.state.phase === 'dragging') this.buildRectCaches();
  }

  private loop = (): void => {
    if (this.state.phase !== 'dragging') return;

    // ① 寫：移動幽靈（只動 transform，不觸發 layout）
    if (this.ghost) {
      const x = Math.round(this.pointer.x - this.grabOffset.x);
      const y = Math.round(this.pointer.y - this.grabOffset.y);
      this.ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }

    // ② 讀：命中測試（全部走快取，零 getBoundingClientRect）
    const zone = this.findZone(this.pointer);
    let target: DropTarget | null = null;
    if (zone) {
      const resolver = zone.spec.resolveDrop;
      target = resolver
        ? resolver(this.pointer, zone.items)
        : computeDropTarget(this.pointer, zone.items, {
            disabledIds: this.active ? [this.active.spec.id] : undefined,
            ...zone.spec.dropOptions,
          });
    }

    // ③ 寫：只在 target 變化時才更新 state（避免每幀 re-render）
    const key = target
      ? `${zone?.spec.id}:${target.id}:${target.position}:${target.depth}`
      : `${zone?.spec.id ?? ''}:null`;
    if (key !== this.lastTargetKey) {
      this.lastTargetKey = key;
      this.setState({ zoneId: zone?.spec.id ?? null, target, pointer: this.pointer });
    } else {
      this.state = { ...this.state, pointer: this.pointer };
    }

    // ④ 自動捲動
    this.applyAutoScroll(zone);

    this.raf = requestAnimationFrame(this.loop);
  };

  private findZone(p: Point): RegisteredZone | null {
    const kind = this.active?.spec.kind;
    if (!kind) return null;
    let best: RegisteredZone | null = null;
    for (const zone of this.zones.values()) {
      if (!zone.spec.accepts.includes(kind)) continue;
      const r = zone.rect;
      if (!r) continue;
      if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) {
        // 巢狀 zone：取最後註冊（通常是最內層）的那個。
        best = zone;
      }
    }
    return best;
  }

  private applyAutoScroll(zone: RegisteredZone | null): void {
    const container = zone?.spec.getScrollContainer?.() ?? zone?.el ?? null;
    if (!container) return;
    const r = zone?.rect;
    if (!r) return;
    const ease = (t: number): number => t * t; // 靠近邊緣加速更明顯
    let dy = 0;
    const fromTop = this.pointer.y - r.top;
    const fromBottom = r.bottom - this.pointer.y;
    if (fromTop < AUTOSCROLL_EDGE) {
      dy = -ease((AUTOSCROLL_EDGE - fromTop) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED;
    } else if (fromBottom < AUTOSCROLL_EDGE) {
      dy = ease((AUTOSCROLL_EDGE - fromBottom) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED;
    }
    if (dy) container.scrollTop += dy;
  }

  private drop(): void {
    const source = this.active;
    const target = this.state.target;
    const zone = this.state.zoneId ? this.zones.get(this.state.zoneId) : null;
    let result: DropResult | null = null;
    if (source && target && zone) {
      result = {
        zoneId: zone.spec.id,
        sourceId: source.spec.id,
        kind: source.spec.kind,
        payload: this.state.payload,
        target,
      };
      zone.spec.onDrop?.(result);
    }
    source?.spec.onDragEnd?.(result);
    this.setState({ phase: 'dropping' });
    this.teardown();
    setTimeout(() => {
      if (this.state.phase === 'dropping') this.setState({ ...IDLE });
    }, DROP_ANIMATION_MS);
  }

  /** 強制回到 idle（測試、或元件樹整個被換掉時用）。 */
  reset(): void {
    this.teardown();
    this.lastTargetKey = '';
    this.setState({ ...IDLE });
  }

  cancel(): void {
    const source = this.active;
    const wasDragging = this.state.phase === 'dragging';
    this.teardown();
    if (wasDragging) source?.spec.onDragEnd?.(null);
    this.setState({ ...IDLE });
  }

  private teardown(): void {
    this.clearHold();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.ghost) {
      this.ghost.remove();
      this.ghost = null;
    }
    document.documentElement.classList.remove('kn-dragging');
    if (this.captureEl && this.pointerId >= 0) {
      try {
        this.captureEl.releasePointerCapture(this.pointerId);
      } catch {
        /* 已釋放 */
      }
    }
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('pointercancel', this.onPointerUp, true);
    this.captureEl = null;
    this.pointerId = -1;
    this.active = null;
  }

  private clearHold(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }
}

/**
 * 指標捕獲對象：呼叫端明講的把手 → 註冊的來源元素 → event.target 的最近 Element。
 * 只接受還在文件裡的元素（已被移除的節點捕獲不到指標）。
 */
function resolveCaptureTarget(
  explicit: Element | null | undefined,
  sourceEl: HTMLElement,
  event: PointerEvent,
): Element | null {
  if (explicit instanceof Element && explicit.isConnected) return explicit;
  if (sourceEl.isConnected) return sourceEl;
  const target = event.target;
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function defaultGhost(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  const rect = source.getBoundingClientRect();
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.removeAttribute('id');
  return clone;
}

/** 全應用唯一的拖放控制器。 */
export const dragController: DragController = new DragController();
