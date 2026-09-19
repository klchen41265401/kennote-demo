/** 範本選單：三個內建範本，選了就建立頁面並跳過去。 */
import { useState } from 'react';
import { Menu, MenuItem, toast } from '@kennote/ui';
import { createFromTemplate, TEMPLATES } from './templates';

export interface TemplatesMenuProps {
  workspaceId: string;
  trigger: JSX.Element;
  onCreated(pageId: string): void | Promise<void>;
}

export function TemplatesMenu({ workspaceId, trigger, onCreated }: TemplatesMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Menu open={open} onOpenChange={setOpen} placement="right-start" trigger={trigger}>
      {TEMPLATES.map((t) => (
        <MenuItem
          key={t.id}
          icon={<span aria-hidden="true">{t.icon}</span>}
          description={t.description}
          textValue={t.name}
          onSelect={async () => {
            try {
              const id = await createFromTemplate(t, workspaceId);
              await onCreated(id);
              toast.success(`已依「${t.name}」建立頁面`);
            } catch {
              toast.error('建立失敗');
            }
          }}
        >
          {t.name}
        </MenuItem>
      ))}
    </Menu>
  );
}
