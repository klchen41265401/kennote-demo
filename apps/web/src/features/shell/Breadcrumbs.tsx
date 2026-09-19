/**
 * 麵包屑：祖先鏈 + 中段省略（`…` 下拉）+ hover 預覽。
 * 省略規則是純函式 `collapseBreadcrumb()`（tree.ts），有單元測試。
 */
import { useState } from 'react';
import type { PageTreeNode } from '@kennote/shared-types';
import { Icon, Menu, MenuItem, Tooltip } from '@kennote/ui';
import { collapseBreadcrumb, displayTitle } from '../page-tree/tree';
import { relativeTime } from '../../stores/pages';
import styles from './TopBar.module.css';

export interface BreadcrumbsProps {
  chain: readonly PageTreeNode[];
  onNavigate(pageId: string): void;
  /** 私人 / 共用 —— Notion 在麵包屑右側顯示的所在分區 */
  scopeLabel?: string;
  max?: number;
}

export function Breadcrumbs({
  chain,
  onNavigate,
  scopeLabel = '私人',
  max = 4,
}: BreadcrumbsProps): JSX.Element {
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const { head, hidden, tail } = collapseBreadcrumb(chain, max);
  const visible = hidden.length > 0 ? [...head, ...tail] : head;

  return (
    <nav className={styles.crumbs} aria-label="麵包屑">
      {head.map((node, i) => (
        <Crumb
          key={node.id}
          node={node}
          last={hidden.length === 0 && tail.length === 0 && i === head.length - 1}
          onNavigate={onNavigate}
          showSep={i < visible.length - 1 || hidden.length > 0}
        />
      ))}

      {hidden.length > 0 && (
        <>
          <Menu
            open={hiddenOpen}
            onOpenChange={setHiddenOpen}
            placement="bottom-start"
            trigger={
              <button type="button" className={styles.crumb} aria-label="顯示被省略的上層頁面">
                …
              </button>
            }
          >
            {hidden.map((node) => (
              <MenuItem
                key={node.id}
                icon={<span className={styles.crumbIcon}>{node.icon ?? <Icon name="page" size={16} />}</span>}
                textValue={displayTitle(node.title)}
                onSelect={() => onNavigate(node.id)}
              >
                {displayTitle(node.title)}
              </MenuItem>
            ))}
          </Menu>
          <span className={styles.sep} aria-hidden="true">
            /
          </span>
        </>
      )}

      {tail.map((node, i) => (
        <Crumb
          key={node.id}
          node={node}
          last={i === tail.length - 1}
          onNavigate={onNavigate}
          showSep={i < tail.length - 1}
        />
      ))}

      {scopeLabel && (
        <button type="button" className={styles.scope} aria-label={`所在分區：${scopeLabel}`}>
          <Icon name="lock" size={14} />
          {scopeLabel}
          <Icon name="chevron-down" size={12} />
        </button>
      )}
    </nav>
  );
}

interface CrumbProps {
  node: PageTreeNode;
  last: boolean;
  showSep: boolean;
  onNavigate(id: string): void;
}

function Crumb({ node, last, showSep, onNavigate }: CrumbProps): JSX.Element {
  const title = displayTitle(node.title);
  return (
    <>
      <Tooltip
        content={
          <span className={styles.preview}>
            <span className={styles.previewTitle}>
              {node.icon ?? <Icon name="page" size={15} />}
              {title}
            </span>
            <span className={styles.previewMeta}>
              {relativeTime(node.updatedAt) ? `更新於 ${relativeTime(node.updatedAt)}` : ''}
            </span>
          </span>
        }
      >
        <button
          type="button"
          className={`${styles.crumb} ${last ? styles.crumbCurrent : ''}`}
          onClick={() => onNavigate(node.id)}
        >
          <span className={styles.crumbIcon} aria-hidden="true">
            {node.icon ?? <Icon name={node.isDatabase ? 'table' : 'page'} size={16} />}
          </span>
          <span className={styles.crumbLabel}>{title}</span>
        </button>
      </Tooltip>
      {showSep && (
        <span className={styles.sep} aria-hidden="true">
          /
        </span>
      )}
    </>
  );
}
