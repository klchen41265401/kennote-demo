/**
 * 把 React renderer 掛進 editor-core 產生的容器。
 *
 * 為什麼用 portal 而不是讓 React 畫整棵樹：
 * editor-core 是 contenteditable 的唯一擁有者（React 的 diff 不能進那棵子樹，
 * 否則 caret 會在重繪時消失）。所以 React 只負責「不可編輯的葉子」，
 * 透過 createPortal 掛進 editor-core 給的容器。容器節點只要不被換掉，
 * React 的狀態（上傳進度、選單開關）就會一直活著。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { flattenDoc } from '@kennote/editor-core';
import { useEditorHostApi } from '../context';
import { getSpec } from './registry';
import { findMountPoint } from './hostRegistry';
import { onExternalRegistryChange } from './externalRegistry';

interface Mount {
  key: string;
  blockId: string;
  el: HTMLElement;
}

export function BlockPortals() {
  const host = useEditorHostApi();
  const [externalRev, setExternalRev] = useState(0);

  useEffect(() => onExternalRegistryChange(() => setExternalRev((n) => n + 1)), []);

  const mounts = useMemo<Mount[]>(() => {
    const out: Mount[] = [];
    for (const id of flattenDoc(host.doc)) {
      const block = host.doc.blocks[id];
      if (!block) continue;
      const spec = getSpec(block.type);
      if (!spec?.Renderer) continue;
      const point = findMountPoint(host.editor.view.getBlockEl(id));
      if (!point) continue;
      // key 帶上 type：型別改變時 editor-core 會換掉容器節點，portal 必須跟著重掛
      out.push({ key: `${id}:${block.type}`, blockId: id, el: point.el });
    }
    return out;
  }, [host.doc, host.rev, host.editor]);

  return (
    <>
      {mounts.map((mount) => {
        const block = host.doc.blocks[mount.blockId];
        if (!block) return null;
        const spec = getSpec(block.type);
        const Renderer = spec?.Renderer;
        if (!Renderer) return null;
        return (
          <PortalBoundary key={`${mount.key}:${externalRev}`} container={mount.el}>
            <Renderer block={block} container={mount.el} host={host} />
          </PortalBoundary>
        );
      })}
    </>
  );
}

function PortalBoundary({ container, children }: { container: HTMLElement; children: ReactNode }) {
  // 容器已經被 editor-core 從文件上移除時不要 portal（React 會噴 warning）
  if (!container.isConnected) return null;
  return createPortal(children, container);
}
