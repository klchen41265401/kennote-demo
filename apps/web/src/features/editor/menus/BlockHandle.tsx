/**
 * Block gutter：hover 時出現在區塊左側外緣的 `+` 與 `⠿`（02 §3.4 BlockGutter）。
 *
 * 效能要點：**整個編輯器只有一組 gutter**，用事件委派量測目標 block 的 rect
 * 再 translate 到位。1000 個 block 各渲染一組把手會讓 DOM 節點數直接翻倍。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { EditorHostApi } from '../context';
import { Icon } from '../ui/icons';
import type { RectLike } from '../lib/floating';

export interface BlockHandleProps {
  host: EditorHostApi;
  wrapperRef: RefObject<HTMLElement | null>;
  dragging: boolean;
  onStartDrag(event: ReactPointerEvent, blockId: string): void;
  onOpenMenu(blockId: string, anchor: RectLike): void;
}

interface HandleState {
  blockId: string;
  top: number;
  height: number;
  left: number;
}

/** 觸控長按要撐多久才算「長按」。Android 的系統值就是 400ms。 */
const LONG_PRESS_MS = 400;

export function BlockHandle({ host, wrapperRef, dragging, onStartDrag, onOpenMenu }: BlockHandleProps) {
  const [state, setState] = useState<HandleState | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback(
    (target: EventTarget | null) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !(target instanceof Element)) return;
      const blockEl = target.closest<HTMLElement>('[data-block-id]');
      if (!blockEl || !wrapper.contains(blockEl)) return;
      const id = blockEl.getAttribute('data-block-id');
      if (!id) return;
      const main = blockEl.firstElementChild as HTMLElement | null;
      const rect = (main ?? blockEl).getBoundingClientRect();
      const base = wrapper.getBoundingClientRect();
      setState({
        blockId: id,
        top: rect.top - base.top,
        height: rect.height,
        left: rect.left - base.left,
      });
    },
    [wrapperRef],
  );

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onOver = (event: Event): void => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      update(event.target);
    };
    const onLeave = (): void => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setState(null), 160);
    };
    wrapper.addEventListener('mousemove', onOver);
    wrapper.addEventListener('mouseleave', onLeave);
    return () => {
      wrapper.removeEventListener('mousemove', onOver);
      wrapper.removeEventListener('mouseleave', onLeave);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [wrapperRef, update]);

  /*
   * 觸控裝置的替代路徑（第五輪）：長按 400ms 開 block 選單。
   *
   * gutter 是 `mousemove` 驅動的，手機上永遠不會出現（而且 720px 以下 CSS 直接把它
   * 藏起來），所以「插入 / 拖曳 / 區塊選單」在觸控裝置上原本一條路都沒有。
   * 這裡只掛 `pointerType === 'touch'`，桌機的滑鼠行為一個位元都沒動。
   *
   * 取消條件照 Android / iOS 的慣例：手指移動超過 10px（在捲動）、放開、
   * 或多指（縮放）就不算長按。
   */
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || host.readOnly) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let origin: { x: number; y: number } | null = null;

    const cancel = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
      origin = null;
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const blockEl = target.closest<HTMLElement>('[data-block-id]');
      if (!blockEl || !wrapper.contains(blockEl)) return;
      const id = blockEl.getAttribute('data-block-id');
      if (!id) return;
      origin = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => {
        timer = null;
        origin = null;
        // 長按已成立：把選單開在 block 左上角，並給一下觸覺回饋
        const rect = blockEl.getBoundingClientRect();
        navigator.vibrate?.(10);
        onOpenMenu(id, {
          left: rect.left,
          right: rect.left,
          top: rect.top,
          bottom: rect.top + Math.min(rect.height, 24),
          width: 0,
          height: Math.min(rect.height, 24),
        });
      }, LONG_PRESS_MS);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!origin || event.pointerType !== 'touch') return;
      if (Math.abs(event.clientX - origin.x) > 10 || Math.abs(event.clientY - origin.y) > 10) cancel();
    };

    wrapper.addEventListener('pointerdown', onPointerDown);
    wrapper.addEventListener('pointermove', onPointerMove);
    wrapper.addEventListener('pointerup', cancel);
    wrapper.addEventListener('pointercancel', cancel);
    window.addEventListener('scroll', cancel, true);
    return () => {
      cancel();
      wrapper.removeEventListener('pointerdown', onPointerDown);
      wrapper.removeEventListener('pointermove', onPointerMove);
      wrapper.removeEventListener('pointerup', cancel);
      wrapper.removeEventListener('pointercancel', cancel);
      window.removeEventListener('scroll', cancel, true);
    };
  }, [wrapperRef, host.readOnly, onOpenMenu]);

  if (!state || dragging || host.readOnly) return null;

  const insert = (above: boolean): void => {
    const block = host.getBlock(state.blockId);
    if (!block) return;
    if (above) {
      const siblings = block.parentId ? (host.getBlock(block.parentId)?.children ?? []) : host.doc.rootIds;
      const index = siblings.indexOf(state.blockId);
      const prev = index > 0 ? (siblings[index - 1] ?? null) : null;
      if (prev) {
        const id = host.insertAfter(prev, { type: 'paragraph' });
        if (id) host.focus(id, 0);
        return;
      }
      // 沒有前一個兄弟 → 插到這一層的最前面（afterId: null 在 apply 層就是「放最前面」）
      const id = host.editor.newId();
      host.applyOps([
        {
          type: 'block.insert',
          blockId: id,
          parentId: block.parentId,
          afterId: null,
          blockType: 'paragraph',
          props: {},
          content: [],
        },
      ]);
      host.focus(id, 0);
      return;
    }
    const id = host.insertAfter(state.blockId, { type: 'paragraph' });
    if (id) host.focus(id, 0);
  };

  return (
    <div
      className="kn-gutter"
      style={{ transform: `translate(${state.left - 52}px, ${state.top}px)`, height: state.height }}
      onMouseEnter={() => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
      }}
    >
      <button
        type="button"
        className="kn-gutter-btn"
        title="在下方插入區塊（按住 Alt 改為上方）"
        aria-label="插入區塊"
        onPointerDown={(e) => e.preventDefault()}
        onClick={(e) => insert(e.altKey)}
      >
        <Icon name="plus" size={14} />
      </button>
      <button
        type="button"
        className="kn-gutter-btn kn-gutter-btn--grip"
        title="拖曳搬移，點擊開啟選單"
        aria-label="區塊操作"
        onPointerDown={(e) => {
          e.preventDefault();
          onStartDrag(e, state.blockId);
        }}
        onClick={(e) => onOpenMenu(state.blockId, e.currentTarget.getBoundingClientRect())}
      >
        <Icon name="grip" size={14} />
      </button>
    </div>
  );
}
