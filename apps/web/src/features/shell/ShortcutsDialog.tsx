/** 快捷鍵說明（Ctrl+/）。內容直接讀 lib/shortcuts.ts 的表，不另外維護一份。 */
import { Dialog, Kbd } from '@kennote/ui';
import { shortcutGroups } from '../../lib/shortcuts';
import styles from './ShortcutsDialog.module.css';

export interface ShortcutsDialogProps {
  open: boolean;
  onClose(): void;
}

/** 編輯器內部的快捷鍵（features/editor/keyboard/hostKeymap.ts），這裡只列出來給使用者看 */
const EDITOR_SHORTCUTS: { combo: string; label: string }[] = [
  { combo: 'mod+b', label: '粗體' },
  { combo: 'mod+i', label: '斜體' },
  { combo: 'mod+u', label: '底線' },
  { combo: 'mod+shift+s', label: '刪除線' },
  { combo: 'mod+e', label: '行內程式碼' },
  { combo: 'mod+shift+1', label: '轉成標題 1' },
  { combo: 'mod+shift+2', label: '轉成標題 2' },
  { combo: 'mod+shift+3', label: '轉成標題 3' },
  { combo: 'mod+d', label: '建立複本' },
  { combo: 'mod+enter', label: '勾選待辦 / 展開折疊' },
  { combo: 'esc', label: '進入區塊選取態' },
  { combo: 'tab', label: '清單縮排' },
  { combo: 'shift+tab', label: '清單反縮排' },
];

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps): JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} size="md" title="鍵盤快捷鍵">
      <div className={styles.grid}>
        {shortcutGroups().map((g) => (
          <section key={g.group} className={styles.group}>
            <h3 className={styles.groupTitle}>{g.group}</h3>
            {g.items.map((s) => (
              <div key={s.action} className={styles.row}>
                <span className={s.todo ? styles.labelTodo : styles.label}>
                  {s.label}
                  {s.todo ? '（尚未實作）' : ''}
                </span>
                <Kbd keys={s.combo} />
              </div>
            ))}
          </section>
        ))}
        <section className={styles.group}>
          <h3 className={styles.groupTitle}>編輯器</h3>
          {EDITOR_SHORTCUTS.map((s) => (
            <div key={s.combo} className={styles.row}>
              <span className={styles.label}>{s.label}</span>
              <Kbd keys={s.combo} />
            </div>
          ))}
        </section>
      </div>
    </Dialog>
  );
}
