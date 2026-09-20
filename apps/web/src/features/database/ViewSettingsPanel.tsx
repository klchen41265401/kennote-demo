/**
 * 「瀏覽模式設定」面板（`07m-db-settings-light.png` / UI-SPEC §8.5）。
 *
 * Notion 的 ⚙ 不是一張四項的小選單，而是一整張設定面板：
 *
 *   瀏覽模式設定                              ✕
 *   [型別icon] [ 查看名稱 ]                    ⓘ
 *   ───────────────────────────────
 *   版面配置            表格  ›
 *   屬性能見度            4   ›
 *   篩選 / 排序 / 分組 / 條件式顏色           ›
 *   拷貝瀏覽模式連結
 *   ── 資料來源設定 ──
 *   來源              新資料庫 ›
 *   編輯屬性 / 自動化 / AI 自動填寫 / 更多設定  ›
 *   ───────────────────────────────
 *   管理資料來源 / 鎖定資料庫 / 在日曆中管理    ↗
 *
 * 逐像素量自 `07m-db-settings-light.png`（315×624 的裁切）：
 *   標題 y34..44、名稱列 y71..84，之後每一列的間距都是 **29px**
 *   （108 / 137 / 166 / 194 / 223 / 252 / 281 …）。
 *
 * 尚未實作的項目（條件式顏色、自動化、AI 自動填寫、管理資料來源、鎖定資料庫）
 * 一律 `disabled` —— 版面要對，但不能假裝點得動。
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { CollectionSchema, CollectionView, ViewType } from '@kennote/shared-types';
import {
  OPEN_PAGE_IN_META,
  OPEN_PAGE_IN_VALUES,
  type OpenPageIn,
} from '@kennote/shared-types';
import { UiIcon } from './_fallback';
import { getViewType } from './views/types';
import styles from './ViewSettingsPanel.module.css';

export interface ViewSettingsPanelProps {
  view: CollectionView;
  schema: CollectionSchema;
  title: string;
  /** 這個 collection 上還有哪些視圖（決定「在日曆中管理」能不能點） */
  views: CollectionView[];
  onClose: () => void;
  onRename: () => void;
  onOpen: (kind: 'layout' | 'properties' | 'filter' | 'sort' | 'group') => void;
  onCopyLink: () => void;
  onExportCsv: () => void;
  onSelectView: (viewId: string) => void;
  viewGlyph: (type: ViewType) => 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline';
}

export function ViewSettingsPanel(props: ViewSettingsPanelProps) {
  const { view, schema, views } = props;
  const [moreOpen, setMoreOpen] = useState(false);
  const viewDef = getViewType(view.type);

  const visibleCount =
    view.format?.properties?.filter((p) => p.visible !== false).length ?? Object.keys(schema).length;
  const calendarView = views.find((v) => v.type === 'calendar' && v.id !== view.id);

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.headerTitle}>瀏覽模式設定</span>
        <button type="button" className={styles.iconButton} aria-label="關閉" onClick={props.onClose}>
          <UiIcon name="close" size={14} />
        </button>
      </header>

      <div className={styles.nameRow}>
        <span className={styles.nameIcon} aria-hidden="true">
          <UiIcon name={props.viewGlyph(view.type)} size={15} />
        </span>
        <button type="button" className={styles.nameInput} onClick={props.onRename}>
          {view.name || '查看名稱'}
        </button>
      </div>

      <div className={styles.section}>
        <Row icon="table" label="版面配置" value={viewDef.label} onSelect={() => props.onOpen('layout')} />
        {/* B-3：Notion 把「頁面打開方式」放在版面配置面板裡；這裡再給一條捷徑，
            面板上看得到目前值（側邊預覽 / 置中預覽 / 完整頁面）。 */}
        <Row
          icon="expand"
          label="頁面打開方式"
          value={OPEN_PAGE_IN_META[view.format?.openPageIn ?? 'side'].label}
          onSelect={() => props.onOpen('layout')}
        />
        <Row icon="eye" label="屬性能見度" value={String(visibleCount)} onSelect={() => props.onOpen('properties')} />
        <Row icon="filter" label="篩選" onSelect={() => props.onOpen('filter')} />
        <Row icon="sort" label="排序" onSelect={() => props.onOpen('sort')} />
        <Row
          icon="group"
          label="分組"
          disabled={!viewDef.supportsGrouping}
          onSelect={() => props.onOpen('group')}
        />
        <Row icon="sparkle" label="條件式顏色" disabled />
        <Row icon="expand" label="拷貝瀏覽模式連結" chevron={false} onSelect={props.onCopyLink} />
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>資料來源設定</p>
        <Row icon="drag" label="來源" value={props.title} disabled />
        <Row icon="list" label="編輯屬性" onSelect={() => props.onOpen('properties')} />
        <Row icon="bolt" label="自動化" disabled />
        <Row icon="sparkle" label="AI 自動填寫" disabled />
        <Row icon="more" label="更多設定" onSelect={() => setMoreOpen((v) => !v)} />
        {moreOpen ? (
          <Row icon="download" label="匯出 CSV" chevron={false} onSelect={props.onExportCsv} />
        ) : null}
      </div>

      <div className={styles.section}>
        <Row icon="board" label="管理資料來源" disabled />
        <Row icon="settings" label="鎖定資料庫" disabled />
        <Row
          icon="calendar"
          label="在日曆中管理"
          chevron={false}
          trailing={<span aria-hidden="true">↗</span>}
          disabled={!calendarView}
          onSelect={() => calendarView && props.onSelectView(calendarView.id)}
        />
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  chevron = true,
  trailing,
  disabled,
  onSelect,
}: {
  icon: Parameters<typeof UiIcon>[0]['name'];
  label: string;
  value?: string;
  chevron?: boolean;
  trailing?: ReactNode;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button type="button" className={styles.row} disabled={disabled} onClick={onSelect}>
      <span className={styles.rowIcon} aria-hidden="true">
        <UiIcon name={icon} size={15} />
      </span>
      <span className={styles.rowLabel}>{label}</span>
      {value ? <span className={styles.rowValue}>{value}</span> : null}
      {trailing ?? (chevron ? <UiIcon name="chevronRight" size={12} /> : null)}
    </button>
  );
}

/**
 * 「頁面打開方式」（gap-review §B-3）。
 *
 * 原文與順序照抄 Notion 7.34 zh-TW 的視圖設定 → 版面配置面板
 * （`reference/shots/gap-review/notion/notion-view-openas.png`）：
 *
 *   頁面打開方式
 *   ● 側邊預覽   在側邊開啟頁面。保持互動後方的瀏覽模式。   [表格的預設值]
 *   ○ 置中預覽   以焦點、置中互動視窗開啟頁面。
 *   ○ 完整頁面   以完整頁面開啟頁面。
 *
 * 值存在 `view.format.openPageIn`（jsonb，不用 migration）。
 */
export function OpenPageInSetting({
  view,
  viewLabel,
  onChange,
}: {
  view: CollectionView;
  /** 「<型別>的預設值」徽章用的字（表格 / 看板 / …） */
  viewLabel: string;
  onChange: (openPageIn: OpenPageIn) => void;
}): JSX.Element {
  const current: OpenPageIn = view.format?.openPageIn ?? 'side';
  return (
    <div className={styles.section}>
      <p className={styles.sectionLabel}>頁面打開方式</p>
      <div className={styles.openPageIn} role="radiogroup" aria-label="頁面打開方式">
        {OPEN_PAGE_IN_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === current}
            className={styles.openPageInOption}
            onClick={() => onChange(value)}
          >
            <span className={styles.openPageInText}>
              <span className={styles.openPageInLabel}>
                {OPEN_PAGE_IN_META[value].label}
                {value === 'side' ? (
                  <span className={styles.openPageInBadge}>{viewLabel}的預設值</span>
                ) : null}
              </span>
              <span className={styles.openPageInDesc}>{OPEN_PAGE_IN_META[value].description}</span>
            </span>
            {value === current ? <UiIcon name="check" size={14} /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
