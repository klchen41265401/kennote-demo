/**
 * 右側協作面板（gap-review B-5 / B-6 / C-2 / C-3 / C-8）。
 *
 * ## 為什麼長這樣
 *
 * 本輪重新採集了真實 Notion 7.34（`reference/shots/gap-review/notion/`，
 * `_SUMMARY.json` 的 `A_rightPanel` + `_A3-updates.json`）。實際量到的是：
 *
 * - 右側面板只有一個 `<aside>`，裡面是 **role=tab 的「更新 / 分析」兩個分頁**
 *   （預設「更新」）。**沒有「留言」分頁** —— 頁面層級留言在這一版是
 *   標題下方的 inline 討論串。
 * - 「版本紀錄（測試版）」是 ⋯ 選單裡**另一個獨立項目**，不是這個面板的 tab。
 * - 每一則更新右側有 aria-label「查看本次更新後的版本」的 24×24 按鈕。
 * - 面板左上角是 aria-label「關閉面板」的 24×24 按鈕（不是右上角）。
 *
 * kennote 與 Notion 的差別（刻意保留）：多一個「留言」檢視。
 * Notion 把頁面留言做成 inline，但 kennote 的側邊欄 / 頂欄一直有「留言」入口，
 * 而跨頁的「所有留言」本來就需要一個落腳處（C-8：以前在首頁按了只有一句提示）。
 *
 * ## 檔案邊界
 * 這支從 `AppShell.tsx` 裡搬出來（本輪三個代理平行作業，`features/shell/**`
 * 的其他檔案由 RWD 代理在改）。`AppShell` 只留 `import { RightPanel }`。
 */
import { useEffect } from 'react';
import { Icon, Tooltip } from '@kennote/ui';
import { CommentsPanel } from '../comments/CommentsPanel';
import { WorkspaceComments } from '../comments/WorkspaceComments';
import { HistoryPanel } from '../history/HistoryPanel';
import { UpdatesFeed } from '../history/UpdatesFeed';
import { PageAnalytics } from '../history/PageAnalytics';
import { scrollToBlock, setActiveDiscussion } from '../comments/highlight';
import { setRightPanel, useUi, type RightPanelTab } from '../../stores/ui';
import { usePagePermission } from '../../lib/queries';
import { useWorkspace } from '../../stores/workspace';
import styles from './RightPanel.module.css';

export interface RightPanelProps {
  pageId: string | null;
  userId: string | null;
}

const TABS: ReadonlyArray<{ id: RightPanelTab; label: string }> = [
  { id: 'updates', label: '更新' },
  { id: 'analytics', label: '分析' },
  { id: 'comments', label: '留言' },
];

export function RightPanel({ pageId, userId }: RightPanelProps): JSX.Element {
  const ui = useUi();
  const workspace = useWorkspace();
  // 第六輪 BUG-32：留言框與「還原這個版本」都要看權限
  const permission = usePagePermission(pageId);
  const view = ui.rightPanelTab;
  const fullView = view === 'history';

  // 換頁時不要把上一頁的「目前這一張留言卡片」帶過來
  useEffect(() => setActiveDiscussion(null), [pageId]);

  return (
    <aside className={styles.panel} aria-label="側邊面板">
      <div className={styles.header}>
        {/* Notion：關閉鈕在**左上角**（24×24） */}
        <Tooltip content="關閉面板">
          <button
            type="button"
            className={styles.iconButton}
            aria-label="關閉面板"
            onClick={() => setRightPanel(false)}
          >
            <Icon name="close" size={16} />
          </button>
        </Tooltip>

        {fullView ? (
          <span className={styles.headerTitle}>版本紀錄</span>
        ) : (
          <div className={styles.tabs} role="tablist" aria-label="面板分頁">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={view === tab.id}
                className={`${styles.tab} ${view === tab.id ? styles.tabActive : ''}`}
                onClick={() => setRightPanel(true, tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* ⋯：版本紀錄是**獨立檢視**，從這裡進去（Notion 是頁面 ⋯ 選單，
            kennote 的頂欄 ⋯ 也有一份，這裡再給一個就近的入口） */}
        {!fullView && pageId ? (
          <Tooltip content="版本紀錄">
            <button
              type="button"
              className={styles.iconButton}
              aria-label="版本紀錄"
              onClick={() => setRightPanel(true, 'history')}
            >
              <Icon name="history" size={16} />
            </button>
          </Tooltip>
        ) : null}
      </div>

      <div className={styles.body}>
        {/*
          gap-review C-8：首頁（沒有 pageId）按側邊欄「留言」以前只會看到
          「選一個頁面才能看留言與版本歷史」。留言改成跨頁清單；
          更新 / 分析 / 版本紀錄仍然需要一個頁面。
        */}
        {!pageId && view === 'comments' && (
          <WorkspaceComments workspaceId={workspace?.id ?? null} />
        )}
        {!pageId && view !== 'comments' && (
          <p className={styles.stateHint}>選一個頁面才能看這一頁的更新與版本紀錄。</p>
        )}

        {pageId && view === 'updates' && (
          <UpdatesFeed
            pageId={pageId}
            onOpenDiscussion={(discussionId) => {
              setActiveDiscussion(discussionId);
              setRightPanel(true, 'comments');
            }}
          />
        )}

        {pageId && view === 'analytics' && <PageAnalytics pageId={pageId} />}

        {pageId && view === 'comments' && (
          <CommentsPanel
            pageId={pageId}
            currentUserId={userId}
            /*
             * 第六輪 BUG-32：`canComment` 預設 `true`，所以只有 `read` 權限的人
             * 也看得到留言輸入框（送出才 403）。`comment` 以上才給。
             */
            canComment={permission.permission !== 'read'}
            onHighlightBlock={(blockId) => scrollToBlock(blockId)}
          />
        )}

        {pageId && fullView && (
          <HistoryPanel
            pageId={pageId}
            onBack={() => setRightPanel(true, 'updates')}
            /* 還原是寫入：只有 edit / full 能按 */
            canRestore={permission.canEdit !== false}
          />
        )}
      </div>
    </aside>
  );
}
