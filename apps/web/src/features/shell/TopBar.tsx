/**
 * TopBar（02 §3.3）。版面與尺寸照 reference/notion-capture/dom/03-topbar.html：
 *   [側欄鈕] 麵包屑 … 「已於 X 分鐘前編輯」 頭像 連線 分享 連結 星號 ⋯
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PageTreeNode } from '@kennote/shared-types';
import { Icon, Menu, MenuItem, MenuSeparator, Popover, Switch, Tooltip, toast } from '@kennote/ui';
import { setPageSubscription } from '../../stores/notifications';
import { ConnectionBadge } from '../../components/ConnectionBadge';
import { PresenceAvatars } from '../../components/PresenceAvatars';
import { SharePopover } from '../share/SharePopover';
import { editedLabel, setPageLayout, useNow, usePageLayout, type PageLayout } from '../../stores/pages';
import {
  openOverlay,
  toggleRightPanel,
  toggleSidebar,
  useUi,
} from '../../stores/ui';
import { duplicatePage, deletePage, setFavorite } from '../../lib/queries';
import { Breadcrumbs } from './Breadcrumbs';
import { ExportDialog } from '../export';
import { ImportDialog } from '../import';
import styles from './TopBar.module.css';

export interface TopBarProps {
  workspaceId: string;
  pageId: string | null;
  chain: readonly PageTreeNode[];
  updatedAt: string | null;
  favorite: boolean;
  onFavoriteChanged(): void;
  onTreeChanged(): void;
  /** 儲存狀態文字（Editor 的 onTransportState） */
  saveLabel?: string;
  /** 側邊欄收合時才顯示展開鈕 */
  showSidebarToggle: boolean;
}

export function TopBar({
  workspaceId,
  pageId,
  chain,
  updatedAt,
  favorite,
  onFavoriteChanged,
  onTreeChanged,
  saveLabel,
  showSidebarToggle,
}: TopBarProps): JSX.Element {
  const navigate = useNavigate();
  const ui = useUi();
  const now = useNow();
  const layout = usePageLayout(pageId);
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  /* 第五輪 BUG-19：`features/export` / `features/import` 早就寫好了（後端的
     /api/pages/:id/export 與 /api/import 也都在），只是從來沒有人 import 它們。
     選單原本走的是 shell/export.ts 的「最小版」（只吐 Markdown、不含子頁），
     而「匯入」甚至只彈一個「尚未開放」的 toast。這裡接上真正的對話框。 */
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  /** 首頁 / 收件匣沒有「目前頁面」，右側那一組動作整組不畫 */
  const hasPage = Boolean(pageId);

  function patchLayout(patch: Partial<PageLayout>): void {
    if (pageId) setPageLayout(pageId, patch);
  }

  function copyLink(): void {
    if (!pageId) return;
    void navigator.clipboard
      ?.writeText(`${window.location.origin}/page/${pageId}`)
      .then(() => toast.success('已複製連結'))
      .catch(() => toast.error('無法複製連結'));
  }

  return (
    <header className={styles.topbar} role="banner">
      <div className={styles.left}>
        {showSidebarToggle && (
          <Tooltip content="開啟側邊欄" shortcut="mod+\\">
            <button
              type="button"
              className={styles.iconButton}
              aria-label="開啟側邊欄"
              onClick={() => toggleSidebar()}
            >
              <Icon name="sidebar-toggle" size={20} />
            </button>
          </Tooltip>
        )}
        {chain.length > 0 && (
          <Breadcrumbs chain={chain} onNavigate={(id) => navigate(`/page/${id}`)} />
        )}
      </div>

      <div className={`${styles.right} kn-topbar-actions`}>
        {saveLabel && <span className={styles.edited}>{saveLabel}</span>}
        {!saveLabel && updatedAt && (
          <span className={styles.edited} title={new Date(updatedAt).toLocaleString('zh-TW')}>
            {editedLabel(updatedAt, now)}
          </span>
        )}

        {hasPage && (
          <span className={styles.compactHide}>
            <PresenceAvatars pageId={pageId} />
          </span>
        )}
        {hasPage && (
          <span className={styles.compactHide}>
            <ConnectionBadge />
          </span>
        )}

        {pageId && (
          <span className={styles.compactHide}>
          <Popover
            open={shareOpen}
            onOpenChange={setShareOpen}
            placement="bottom-end"
            padded={false}
            trigger={
              <button type="button" className={styles.shareButton}>
                <Icon name="lock" size={16} />
                分享
              </button>
            }
          >
            <SharePopover pageId={pageId} workspaceId={workspaceId} onClose={() => setShareOpen(false)} />
          </Popover>
          </span>
        )}

        {hasPage && (
        <Tooltip content="拷貝連結" shortcut="mod+l">
          <button
            type="button"
            className={`${styles.iconButton} ${styles.compactHide}`}
            aria-label="拷貝連結"
            onClick={copyLink}
          >
            <Icon name="link" size={20} />
          </button>
        </Tooltip>
        )}

        {hasPage && (
        <Tooltip content="留言">
          <button
            type="button"
            className={`${styles.iconButton} ${styles.compactHide} ${ui.rightPanelOpen && ui.rightPanelTab === 'comments' ? styles.iconButtonActive : ''}`}
            aria-label="留言"
            onClick={() => toggleRightPanel('comments')}
          >
            <Icon name="comment" size={20} />
          </button>
        </Tooltip>
        )}

        {hasPage && (
        <Tooltip content={favorite ? '從收藏中移除' : '加入最愛'}>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.compactHide} ${favorite ? styles.starOn : ''}`}
            aria-label={favorite ? '從收藏中移除' : '加入最愛'}
            onClick={async () => {
              if (!pageId) return;
              await setFavorite(pageId, workspaceId, !favorite);
              onFavoriteChanged();
            }}
          >
            <Icon name={favorite ? 'star-filled' : 'star'} size={20} />
          </button>
        </Tooltip>
        )}

        {hasPage && (
        <Menu
          open={moreOpen}
          onOpenChange={setMoreOpen}
          placement="bottom-end"
          listProps={{ className: styles.menuWide }}
          trigger={
            <button type="button" className={styles.iconButton} aria-label="動作">
              <Icon name="more-horizontal" size={20} />
            </button>
          }
        >
          <div className={styles.fontRow}>
            {(
              [
                { id: 'default', label: '預設', cls: '' },
                { id: 'serif', label: '襯線體', cls: styles.fontSerif },
                { id: 'mono', label: '等寬體', cls: styles.fontMono },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                className={`${styles.fontOption} ${layout.font === f.id ? styles.fontOptionActive : ''}`}
                onClick={() => patchLayout({ font: f.id })}
              >
                <span className={`${styles.fontSample} ${f.cls}`}>Ag</span>
                <span className={styles.fontLabel}>{f.label}</span>
              </button>
            ))}
          </div>
          <MenuSeparator />
          <MenuItem
            icon={<Icon name="text" size={16} />}
            trailing={<Switch checked={layout.smallText} size="sm" readOnly />}
            closeOnSelect={false}
            onSelect={() => patchLayout({ smallText: !layout.smallText })}
          >
            小字型
          </MenuItem>
          <MenuItem
            icon={<Icon name="expand" size={16} />}
            trailing={<Switch checked={layout.fullWidth} size="sm" readOnly />}
            closeOnSelect={false}
            onSelect={() => patchLayout({ fullWidth: !layout.fullWidth })}
          >
            全寬
          </MenuItem>
          <MenuItem
            icon={<Icon name="lock" size={16} />}
            trailing={<Switch checked={layout.locked} size="sm" readOnly />}
            closeOnSelect={false}
            onSelect={() => patchLayout({ locked: !layout.locked })}
          >
            鎖定頁面
          </MenuItem>
          <MenuItem icon={<Icon name="settings" size={16} />} onSelect={() => openOverlay('settings')}>
            自訂頁面
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Icon name="link" size={16} />} shortcut="mod+l" onSelect={copyLink}>
            拷貝連結
          </MenuItem>
          <MenuItem
            icon={<Icon name="duplicate" size={16} />}
            shortcut="mod+d"
            onSelect={async () => {
              if (!pageId) return;
              const page = await duplicatePage(pageId, workspaceId);
              onTreeChanged();
              navigate(`/page/${page.id}`);
            }}
          >
            建立複本
          </MenuItem>
          <MenuItem
            icon={<Icon name="arrow-right" size={16} />}
            shortcut="mod+shift+p"
            onSelect={() => pageId && openOverlay('moveTo', { moveTargetId: pageId })}
          >
            移動到
          </MenuItem>
          <MenuSeparator />
          {/* 第六輪 BUG-30：後端的追蹤 / 靜音端點從 M5 就在，但前端沒有任何入口 */}
          <MenuItem
            icon={<Icon name="bell" size={16} />}
            onSelect={async () => {
              if (!pageId) return;
              try {
                await setPageSubscription(pageId, 'explicit');
                toast.success('已追蹤這個頁面');
              } catch {
                toast.error('追蹤失敗');
              }
            }}
          >
            追蹤這個頁面
          </MenuItem>
          <MenuItem
            icon={<Icon name="hide" size={16} />}
            onSelect={async () => {
              if (!pageId) return;
              try {
                await setPageSubscription(pageId, 'muted');
                toast.show({ title: '已靜音，不再收到這一頁的通知' });
              } catch {
                toast.error('靜音失敗');
              }
            }}
          >
            靜音這個頁面
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Icon name="import" size={16} />} onSelect={() => setImportOpen(true)}>
            匯入
          </MenuItem>
          <MenuItem icon={<Icon name="export" size={16} />} onSelect={() => setExportOpen(true)}>
            匯出
          </MenuItem>
          <MenuSeparator />
          {/*
            「留言」在頂欄有自己的按鈕，但那顆按鈕掛了 `.compactHide`
            —— <768 整個不顯示，而 ⋯ 選單裡原本又只有「版本歷史」，
            於是手機上**留言完全沒有入口**。這一項就是補那個洞
            （桌機上重複一份無妨，Notion 的 ⋯ 選單也有「留言」）。
          */}
          <MenuItem icon={<Icon name="comment" size={16} />} onSelect={() => toggleRightPanel('comments')}>
            留言
          </MenuItem>
          <MenuItem icon={<Icon name="history" size={16} />} onSelect={() => toggleRightPanel('history')}>
            版本歷史
          </MenuItem>
          <MenuItem
            icon={<Icon name="list" size={16} />}
            onSelect={() =>
              toast.show({
                title: '頁面統計',
                description: updatedAt ? `最後更新：${new Date(updatedAt).toLocaleString('zh-TW')}` : '尚無資料',
              })
            }
          >
            頁面統計
          </MenuItem>
          <MenuItem icon={<Icon name="help" size={16} />} shortcut="mod+/" onSelect={() => openOverlay('shortcuts')}>
            快捷鍵
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Icon name="trash" size={16} />}
            danger
            onSelect={async () => {
              if (!pageId) return;
              await deletePage(pageId, workspaceId);
              onTreeChanged();
              toast.show({ title: '已移至垃圾桶' });
              navigate('/');
            }}
          >
            移至垃圾桶
          </MenuItem>
        </Menu>
        )}

        {exportOpen && pageId ? (
          <ExportDialog pageId={pageId} onClose={() => setExportOpen(false)} />
        ) : null}
        {importOpen ? (
          <ImportDialog
            workspaceId={workspaceId}
            parentId={pageId}
            onClose={() => setImportOpen(false)}
            onImported={(result) => {
              onTreeChanged();
              if (result.rootPageId) navigate(`/page/${result.rootPageId}`);
            }}
          />
        ) : null}
      </div>
    </header>
  );
}
