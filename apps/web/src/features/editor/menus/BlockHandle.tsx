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
