/**
 * Block 操作選單（拖曳把手點擊 / 右鍵）。
 * 轉換成、顏色、複製、複製連結、移動到、刪除、留言、快捷鍵提示。
 */
import { useState } from 'react';
import type { BlockType } from '@kennote/shared-types';
import type { EditorHostApi } from '../context';
import { MenuItem, MenuSeparator, Popover } from '../ui/overlay';
import { Icon } from '../ui/icons';
import { rectFromDOMRect, type RectLike } from '../lib/floating';
import { convertibleSpecs, getSpec } from '../blocks/registry';
import { BLOCK_BACKGROUNDS, BLOCK_COLORS } from './slashCommands';
import { duplicateBlockOps } from '../lib/model-helpers';
import { toast } from '../ui/toast';

export interface BlockMenuProps {
  host: EditorHostApi;
  anchor: RectLike | null;
  blockIds: string[];
  onClose(): void;
}

export function BlockMenu({ host, anchor, blockIds, onClose }: BlockMenuProps) {
  const [sub, setSub] = useState<'type' | 'color' | null>(null);
  const [subAnchor, setSubAnchor] = useState<RectLike | null>(null);
  const open = anchor !== null && blockIds.length > 0;
  const primary = blockIds[0];
  const block = primary ? host.getBlock(primary) : undefined;

  const duplicate = (): void => {
    const doc = host.editor.getDoc();
    const ops = blockIds.flatMap((id) => duplicateBlockOps(doc, id, host.editor.newId).ops);
    if (ops.length > 0) host.applyOps(ops);
    onClose();
  };

  const copyLink = (): void => {
    if (!primary) return;
    const url = `${window.location.origin}${window.location.pathname}#${primary}`;
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast('已複製區塊連結', { kind: 'success' }))
      .catch(() => toast('複製失敗', { kind: 'error' }));
    onClose();
  };

  return (
    <>
      <Popover
        anchor={anchor}
        open={open && sub === null}
        onClose={onClose}
        className="kn-popover--list"
        ariaLabel="區塊操作"
        sheetOnMobile
      >
        <div className="kn-menu-scroll">
          {/*
            觸控裝置沒有 gutter（`.kn-gutter` 在 720px 以下是 display:none，而且它是
            mousemove 驅動的），所以「在下方插入區塊」必須在這個選單裡也有一份，
            否則手機上完全沒有插入新 block 的路（第五輪）。
          */}
          <MenuItem
            icon={<Icon name="plus" />}
            label="在下方插入區塊"
            onSelect={() => {
              if (!primary) return;
              const id = host.insertAfter(primary, { type: 'paragraph' });
              if (id) host.focus(id, 0);
              onClose();
            }}
          />
          <MenuSeparator />
          <MenuItem
            icon={<Icon name="arrow-right" />}
            label="轉換成"
            hint={<Icon name="chevron-right" size={12} />}
            description={block ? (getSpec(block.type)?.label ?? block.type) : undefined}
            onMouseEnter={() => undefined}
            onSelect={() => {
              setSubAnchor(anchor);
              setSub('type');
            }}
          />
          <MenuItem
            icon={<Icon name="palette" />}
            label="顏色"
            hint={<Icon name="chevron-right" size={12} />}
            onSelect={() => {
              setSubAnchor(anchor);
              setSub('color');
            }}
          />
          <MenuSeparator />
          <MenuItem icon={<Icon name="copy" />} label="複製一份" hint="Ctrl+D" onSelect={duplicate} />
          <MenuItem icon={<Icon name="link" />} label="複製區塊連結" onSelect={copyLink} />
          <MenuItem
            icon={<Icon name="move" />}
            label="移動到…"
            onSelect={() => {
              toast('跨頁面搬移會在 M3（頁面樹）開放', { kind: 'info' });
              onClose();
            }}
          />
          <MenuItem
            icon={<Icon name="comment" />}
            label="留言"
            onSelect={() => {
              toast('留言功能在 M5 才會開放', { kind: 'info' });
              onClose();
            }}
          />
          <MenuSeparator />
          <MenuItem
            icon={<Icon name="trash" />}
            label="刪除"
            hint="Del"
            danger
            onSelect={() => {
              host.remove(blockIds);
              onClose();
            }}
          />
          <div className="kn-menu-footer">
            拖曳可搬移位置 · 按住 <kbd>Alt</kbd> 點 <kbd>+</kbd> 插入到上方
          </div>
        </div>
      </Popover>

      <Popover
        anchor={subAnchor}
        open={open && sub === 'type'}
        onClose={() => setSub(null)}
        className="kn-popover--list"
        ariaLabel="轉換成"
      >
        <div className="kn-menu-scroll">
          {convertibleSpecs().map((spec) => (
            <MenuItem
              key={spec.type}
              icon={<Icon name={spec.icon} />}
              label={spec.label}
              hint={spec.shortcut}
              active={spec.type === block?.type}
              onSelect={() => {
                host.setType(blockIds, spec.type as BlockType, spec.defaultProps);
                setSub(null);
                onClose();
              }}
            />
          ))}
        </div>
      </Popover>

      <Popover
        anchor={subAnchor}
        open={open && sub === 'color'}
        onClose={() => setSub(null)}
        className="kn-popover--list"
        ariaLabel="顏色"
      >
        <div className="kn-menu-scroll">
          <div className="kn-menu-group-title">文字顏色</div>
          {BLOCK_COLORS.map((c) => (
            <MenuItem
              key={c.id}
              icon={<span className="kn-swatch" style={c.cssVar ? { background: `var(${c.cssVar})` } : undefined} />}
              label={c.label}
              onSelect={() => {
                for (const id of blockIds) host.updateProps(id, { color: c.id });
                setSub(null);
                onClose();
              }}
            />
          ))}
          <div className="kn-menu-group-title">背景色</div>
          {BLOCK_BACKGROUNDS.map((c) => (
            <MenuItem
              key={c.id}
              icon={<span className="kn-swatch" style={c.cssVar ? { background: `var(${c.cssVar})` } : undefined} />}
              label={c.label}
              onSelect={() => {
                for (const id of blockIds) host.updateProps(id, { color: c.id });
                setSub(null);
                onClose();
              }}
            />
          ))}
        </div>
      </Popover>
    </>
  );
}

export { rectFromDOMRect };
