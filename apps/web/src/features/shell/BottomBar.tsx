/**
 * D-4：手機（<768）固定底部工具列。
 *
 * Notion 網頁版在手機把常用動作放在螢幕底部（拇指區），而不是頂欄 ⋯ 的第二層。
 * 這裡分兩種情境（規格 02 §2.5）：
 *
 * - **編輯頁**（`/page/:id`、`/database/:id`）：`＋` 插入區塊、`/` 指令、留言、⋯
 * - **非編輯頁**（首頁 / 搜尋結果 / 設定…）：首頁、搜尋、收件匣
 *
 * 軟鍵盤打開時整條**讓位**給編輯器自己的格式工具列（`features/editor/ui/overlay.tsx`
 * 已經把它吸在 `visualViewport` 的鍵盤上緣），不然兩條會疊在一起。
 */
import { useNavigate } from 'react-router-dom';
import { Icon, Menu, MenuItem, MenuSeparator } from '@kennote/ui';
import { openOverlay, setRightPanel, toggleSidebar } from '../../stores/ui';
import styles from './BottomBar.module.css';

export interface BottomBarProps {
  /** 目前路由對應的頁面 id（null = 非編輯頁） */
  pageId: string | null;
  /** 軟鍵盤是否打開（由 AppShell 的 visualViewport 判斷） */
  keyboardOpen: boolean;
}

/**
 * 把游標送進編輯器並插入一個字元（`/` 會叫出 slash menu）。
 * 刻意不進 `packages/editor-core`：底部工具列只是「幫使用者打那個字」。
 */
function typeIntoEditor(char: string): boolean {
  const host = document.querySelector('.kn-editor-host');
  if (!host) return false;
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && host.contains(active) && active.isContentEditable;
  let target: HTMLElement | null = inside ? (active as HTMLElement) : null;
  if (!target) {
    const editables = host.querySelectorAll<HTMLElement>('[contenteditable="true"]');
    target = editables.item(editables.length - 1) ?? null;
    if (!target) return false;
    target.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  // execCommand 會觸發 beforeinput/input，編輯器的 markdown / slash 規則照常生效。
  return document.execCommand('insertText', false, char);
}

export function BottomBar({ pageId, keyboardOpen }: BottomBarProps): JSX.Element {
  const navigate = useNavigate();
  const editing = pageId !== null;

  return (
    <nav
      className={styles.bar}
      data-hidden={keyboardOpen ? 'true' : undefined}
      data-mode={editing ? 'page' : 'nav'}
      aria-label="底部工具列"
      aria-hidden={keyboardOpen || undefined}
    >
      {editing ? (
        <>
          <button
            type="button"
            className={styles.item}
            aria-label="插入區塊"
            onClick={() => typeIntoEditor('/')}
          >
            <Icon name="plus" size={22} />
            <span className={styles.label}>插入</span>
          </button>
          <button
            type="button"
            className={styles.item}
            aria-label="指令選單"
            onClick={() => typeIntoEditor('/')}
          >
            <span className={styles.glyph} aria-hidden="true">
              /
            </span>
            <span className={styles.label}>指令</span>
          </button>
          <button
            type="button"
            className={styles.item}
            aria-label="留言"
            onClick={() => setRightPanel(true, 'comments')}
          >
            <Icon name="comment" size={22} />
            <span className={styles.label}>留言</span>
          </button>
          <Menu
            listProps={{ 'aria-label': '更多動作' }}
            trigger={
              <button type="button" className={styles.item} aria-label="更多">
                <Icon name="more-horizontal" size={22} />
                <span className={styles.label}>更多</span>
              </button>
            }
          >
            <MenuItem icon={<Icon name="search" size={18} />} onSelect={() => openOverlay('search')}>
              搜尋
            </MenuItem>
            <MenuItem
              icon={<Icon name="history" size={18} />}
              onSelect={() => setRightPanel(true, 'history')}
            >
              版本歷史
            </MenuItem>
            <MenuItem icon={<Icon name="inbox" size={18} />} onSelect={() => navigate('/inbox')}>
              收件匣
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<Icon name="sidebar-toggle" size={18} />}
              onSelect={() => toggleSidebar()}
            >
              側邊欄
            </MenuItem>
            <MenuItem
              icon={<Icon name="settings" size={18} />}
              onSelect={() => openOverlay('settings')}
            >
              設定
            </MenuItem>
          </Menu>
        </>
      ) : (
        <>
          <button
            type="button"
            className={styles.item}
            aria-label="首頁"
            onClick={() => navigate('/')}
          >
            <Icon name="home" size={22} />
            <span className={styles.label}>首頁</span>
          </button>
          <button
            type="button"
            className={styles.item}
            aria-label="搜尋"
            onClick={() => openOverlay('search')}
          >
            <Icon name="search" size={22} />
            <span className={styles.label}>搜尋</span>
          </button>
          <button
            type="button"
            className={styles.item}
            aria-label="收件匣"
            onClick={() => navigate('/inbox')}
          >
            <Icon name="inbox" size={22} />
            <span className={styles.label}>收件匣</span>
          </button>
        </>
      )}
    </nav>
  );
}
