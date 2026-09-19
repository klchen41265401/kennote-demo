/**
 * 自製 block 拖曳（Pointer Events，02 §4.1.2 / §4.6）。
 * 不用 HTML5 DnD、不用任何拖放套件。
 *
 * 流程：pointerdown → 5px 門檻 → 建立幽靈元素 → 每幀算落點 → pointerup 產生 block.move op。
 * 拖到 block 右／左緣 → 建立 columnList + 兩個 column（Notion 的「拖成兩欄」）。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { flattenDoc, toPlainText, type Editor, type EditorDoc, type Operation } from '@kennote/editor-core';
import { autoScrollSpeed, computeDropTarget, indicatorGeometry, type BlockRect, type DropTarget } from './drop-target';
import { isDescendantOf, moveOpFor } from '../lib/model-helpers';

const DRAG_THRESHOLD_PX = 5;
const INDENT_THRESHOLD_PX = 24;

export interface DragState {
  ids: string[];
  label: string;
  pointer: { x: number; y: number };
  target: DropTarget | null;
  indicator: { top: number; left: number; width: number; height: number; vertical: boolean } | null;
}

export interface UseBlockDragOptions {
  editor: Editor | null;
  readOnly: boolean;
  /** 目前被整塊選取的 block（多選拖曳） */
  getSelectedIds(): string[];
}

export function useBlockDrag({ editor, readOnly, getSelectedIds }: UseBlockDragOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const rectsRef = useRef<BlockRect[]>([]);
  const forbiddenRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number | null>(null);

  const collectRects = useCallback(
    (doc: EditorDoc, ed: Editor): BlockRect[] => {
      const out: BlockRect[] = [];
      for (const id of flattenDoc(doc)) {
        const el = ed.view.getBlockEl(id);
        const block = doc.blocks[id];
        if (!el || !block) continue;
        const rect = el.getBoundingClientRect();
        if (rect.height === 0) continue;
        const parent = block.parentId ? doc.blocks[block.parentId] : undefined;
        out.push({
          id,
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          depth: depthOf(doc, id),
          canHaveChildren: ed.registry.get(block.type).canHaveChildren,
          inColumn: parent?.type === 'column' || block.type === 'column' || block.type === 'columnList',
        });
      }
      return out;
    },
    [],
  );

  const startDrag = useCallback(
    (event: ReactPointerEvent, blockId: string): void => {
      if (!editor || readOnly) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const selected = getSelectedIds();
      const ids = selected.includes(blockId) && selected.length > 1 ? selected : [blockId];
      let started = false;

      const doc = editor.getDoc();
      const label =
        ids.length > 1
          ? `${ids.length} 個區塊`
          : toPlainText(doc.blocks[blockId]?.content ?? []).slice(0, 40) || '空白區塊';

      const onMove = (e: PointerEvent): void => {
        if (!started) {
          if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD_PX && Math.abs(e.clientY - startY) < DRAG_THRESHOLD_PX) {
            return;
          }
          started = true;
          const currentDoc = editor.getDoc();
          rectsRef.current = collectRects(currentDoc, editor);
          const forbidden = new Set<string>();
          for (const id of ids) {
            forbidden.add(id);
            for (const other of flattenDoc(currentDoc)) {
              if (isDescendantOf(currentDoc, other, id)) forbidden.add(other);
            }
          }
          forbiddenRef.current = forbidden;
          document.body.classList.add('kn-dragging');
        }
        updateTarget(e.clientX, e.clientY);
      };

      const updateTarget = (x: number, y: number): void => {
        const target = computeDropTarget(rectsRef.current, x, y, {
          indentThreshold: INDENT_THRESHOLD_PX,
          forbidden: forbiddenRef.current,
        });
        const rect = target ? rectsRef.current.find((r) => r.id === target.id) : undefined;
        setDrag({
          ids,
          label,
          pointer: { x, y },
          target,
          indicator: target && rect ? indicatorGeometry(rect, target.position, INDENT_THRESHOLD_PX) : null,
        });

        // 自動捲動
        const speed = autoScrollSpeed(y, window.innerHeight);
        if (speed !== 0 && rafRef.current === null) {
          const step = (): void => {
            window.scrollBy(0, speed);
            rectsRef.current = collectRects(editor.getDoc(), editor);
            rafRef.current = requestAnimationFrame(step);
          };
          rafRef.current = requestAnimationFrame(step);
        } else if (speed === 0 && rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };

      const onUp = (e: PointerEvent): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.classList.remove('kn-dragging');
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (!started) {
          setDrag(null);
          return;
        }
        const target = computeDropTarget(rectsRef.current, e.clientX, e.clientY, {
          indentThreshold: INDENT_THRESHOLD_PX,
          forbidden: forbiddenRef.current,
        });
        setDrag(null);
        if (target) applyDrop(editor, ids, target);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [editor, readOnly, getSelectedIds, collectRects],
  );

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      document.body.classList.remove('kn-dragging');
    },
    [],
  );

  return { drag, startDrag };
}

function depthOf(doc: EditorDoc, id: string): number {
  let depth = 0;
  let current = doc.blocks[id]?.parentId ?? null;
  while (current) {
    depth += 1;
    current = doc.blocks[current]?.parentId ?? null;
  }
  return depth;
}

/** 把落點翻譯成 Operation 並派送 */
export function applyDrop(editor: Editor, ids: string[], target: DropTarget): void {
  const doc = editor.getDoc();
  if (target.position === 'column-left' || target.position === 'column-right') {
    const ops = buildColumnOps(editor, doc, ids, target.id, target.position === 'column-left' ? 'left' : 'right');
    if (ops.length > 0) editor.dispatch({ ops, kind: 'structural', breakHistory: true });
    return;
  }

  // 多選時要保持原本的相對順序
  const ordered = flattenDoc(doc).filter((id) => ids.includes(id));
  let anchor: { id: string; position: 'before' | 'after' | 'child' } = {
    id: target.id,
    position: target.position,
  };
  for (const id of ordered) {
    const place = moveOpFor(editor.getDoc(), id, anchor);
    if (!place) continue;
    editor.moveBlock(id, place.parentId, place.afterId);
    anchor = { id, position: 'after' };
  }
}

/**
 * 拖到 block 左／右緣 → 建立兩欄版面。
 * 順序很重要：先插 columnList 與兩個 column，再把 target 與被拖的 block 搬進去。
 */
export function buildColumnOps(
  editor: Editor,
  doc: EditorDoc,
  ids: string[],
  targetId: string,
  side: 'left' | 'right',
): Operation[] {
  const target = doc.blocks[targetId];
  if (!target) return [];
  const listId = editor.newId();
  const colA = editor.newId();
  const colB = editor.newId();

  const ops: Operation[] = [
    {
      type: 'block.insert',
      blockId: listId,
      parentId: target.parentId,
      afterId: targetId,
      blockType: 'columnList',
      props: {},
      content: [],
    },
    {
      type: 'block.insert',
      blockId: colA,
      parentId: listId,
      afterId: null,
      blockType: 'column',
      props: { ratio: 0.5 },
      content: [],
    },
    {
      type: 'block.insert',
      blockId: colB,
      parentId: listId,
      afterId: colA,
      blockType: 'column',
      props: { ratio: 0.5 },
      content: [],
    },
  ];

  const targetColumn = side === 'left' ? colB : colA;
  const dropColumn = side === 'left' ? colA : colB;

  ops.push({ type: 'block.move', blockId: targetId, parentId: targetColumn, afterId: null });
  let after: string | null = null;
  for (const id of ids) {
    ops.push({ type: 'block.move', blockId: id, parentId: dropColumn, afterId: after });
    after = id;
  }
  return ops;
}
