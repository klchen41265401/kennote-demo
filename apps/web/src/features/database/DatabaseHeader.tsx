/**
 * 視圖 tabs + 右側工具列（02 §4.3.2 的版面）：
 *
 *   📋 總表  📌 看板  📅 行事曆  ＋        🔍  ⚙ 篩選  ↕ 排序  …  [ 新增 ]
 *
 * 工具列的按鈕由 **view registry 的能力宣告** 決定要不要顯示，
 * 這裡沒有任何 `if (viewType === 'board')`（04 §10.3）。
 */
import { useState } from 'react';
import type {
  CollectionSchema,
  CollectionView,
  RowGroup,
  ViewFormat,
  ViewQuery,
  ViewType,
} from '@kennote/shared-types';
import { VIEW_TYPE_LABELS, countFilters } from '@kennote/shared-types';
import { Menu, MenuItem, MenuLabel, MenuSeparator, Popover, UiIcon } from './_fallback';
import { FilterBuilder } from './FilterBuilder';
import { GroupSettings } from './GroupSettings';
import { PropertyList } from './PropertyList';
import { SortBuilder } from './SortBuilder';
import { getViewType, listViewTypes, viewTypeAvailable } from './views/types';
import styles from './DatabaseHeader.module.css';

export interface DatabaseHeaderProps {
  title: string;
  schema: CollectionSchema;
  views: CollectionView[];
  view: CollectionView;
  groups?: RowGroup[];
  search: string;
  readOnly?: boolean;
  /** 內嵌模式：標題列比較緊湊，不顯示資料庫標題 */
  inline?: boolean;
  onSelectView: (viewId: string) => void;
  onUpdateView: (patch: { query?: ViewQuery; format?: ViewFormat; name?: string }) => void;
  onCreateView: (type: ViewType) => void;
  onDuplicateView: () => void;
  onDeleteView: () => void;
  onChangeViewType: (type: ViewType) => void;
  onSearch: (value: string) => void;
  onCreateRow: () => void;
  onExportCsv: () => void;
}

type PanelKind = 'filter' | 'sort' | 'group' | 'properties' | 'layout' | 'more' | 'viewMenu' | 'newView';

export function DatabaseHeader(props: DatabaseHeaderProps) {
  const { schema, views, view, search, readOnly } = props;
  const [panel, setPanel] = useState<{ kind: PanelKind; anchor: HTMLElement } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [searchOpen, setSearchOpen] = useState(search !== '');

  const viewDef = getViewType(view.type);
  const filterCount = countFilters(view.query?.filter);
  const sortCount = view.query?.sort?.length ?? 0;

  function open(kind: PanelKind, e: React.MouseEvent<HTMLElement>) {
    setPanel({ kind, anchor: e.currentTarget });
  }

  function close() {
    setPanel(null);
  }

  return (
    <header className={props.inline ? styles.headerInline : styles.header}>
      {/* Notion 內嵌資料庫**也會**顯示標題（未命名時是淺灰 placeholder），
          原本 inline 模式整個不畫，跟 07-db-table-light.png 差一整列 */}
      {props.inline ? (
        <h2 className={`${styles.titleInline}${props.title ? '' : ` ${styles.titlePlaceholder}`}`}>
          {props.title || '新資料庫'}
        </h2>
      ) : (
        <h2 className={styles.title}>{props.title}</h2>
      )}

      <div className={styles.bar}>
        <nav className={styles.tabs} aria-label="檢視">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              className={v.id === view.id ? styles.tabActive : styles.tab}
              onClick={(e) => {
                if (v.id === view.id) open('viewMenu', e);
                else props.onSelectView(v.id);
              }}
            >
              <span className={styles.tabIcon} aria-hidden="true">
                <UiIcon name={viewGlyph(v.type)} size={15} />
              </span>
              {v.name}
            </button>
          ))}
          {!readOnly ? (
            <button
              type="button"
              className={styles.tabAdd}
              aria-label="新增檢視"
              onClick={(e) => open('newView', e)}
            >
              <UiIcon name="plus" size={14} />
            </button>
          ) : null}
        </nav>

        {/* 順序照 Notion：篩選 → 排序 → 搜尋 → 設定 → 藍色「新建」（UI-SPEC §8.1） */}
        <div className={styles.tools}>
          {viewDef.supportsFiltering ? (
            <button
              type="button"
              className={filterCount > 0 ? styles.toolButtonActive : styles.toolButton}
              aria-label="篩選"
              onClick={(e) => open('filter', e)}
            >
              <UiIcon name="filter" size={16} />
              {filterCount > 0 ? <span className={styles.badge}>{filterCount}</span> : null}
            </button>
          ) : null}

          {viewDef.supportsSorting ? (
            <button
              type="button"
              className={sortCount > 0 ? styles.toolButtonActive : styles.toolButton}
              aria-label="排序"
              onClick={(e) => open('sort', e)}
            >
              <UiIcon name="sort" size={16} />
              {sortCount > 0 ? <span className={styles.badge}>{sortCount}</span> : null}
            </button>
          ) : null}

          {searchOpen ? (
            <input
              className={styles.search}
              value={search}
              placeholder="搜尋"
              autoFocus
              onChange={(e) => props.onSearch(e.target.value)}
              onBlur={() => search === '' && setSearchOpen(false)}
            />
          ) : (
            <button
              type="button"
              className={styles.toolButton}
              aria-label="搜尋"
              onClick={() => setSearchOpen(true)}
            >
              <UiIcon name="search" size={16} />
            </button>
          )}

          <button
            type="button"
            className={styles.toolButton}
            aria-label="設定"
            onClick={(e) => open('more', e)}
          >
            <UiIcon name="more" size={16} />
          </button>

          {/* Notion 是「新建 ⌄」的分段按鈕（07n-db-view-tabs-light.png），不是單純的「新增」 */}
          {!readOnly ? (
            <span className={styles.newGroup}>
              <button type="button" className={styles.newButton} onClick={props.onCreateRow}>
                新建
              </button>
              <button
                type="button"
                className={styles.newCaret}
                aria-label="新建選項"
                onClick={props.onCreateRow}
              >
                <UiIcon name="chevronDown" size={14} />
              </button>
            </span>
          ) : null}
        </div>
      </div>

      {/* ── 浮層 ── */}
      <Popover
        open={panel?.kind === 'filter'}
        anchor={panel?.anchor ?? null}
        onClose={close}
        placement="bottom-end"
      >
        <FilterBuilder
          schema={schema}
          query={view.query ?? {}}
          onChange={(query) => props.onUpdateView({ query })}
        />
      </Popover>

      <Popover
        open={panel?.kind === 'sort'}
        anchor={panel?.anchor ?? null}
        onClose={close}
        placement="bottom-end"
      >
        <SortBuilder
          schema={schema}
          query={view.query ?? {}}
          onChange={(query) => props.onUpdateView({ query })}
        />
      </Popover>

      <Popover
        open={panel?.kind === 'group'}
        anchor={panel?.anchor ?? null}
        onClose={close}
        placement="bottom-end"
      >
        <GroupSettings
          schema={schema}
          query={view.query ?? {}}
          groups={props.groups}
          onChange={(query) => props.onUpdateView({ query })}
        />
      </Popover>

      <Popover
        open={panel?.kind === 'properties'}
        anchor={panel?.anchor ?? null}
        onClose={close}
        placement="bottom-end"
      >
        <PropertyList
          schema={schema}
          format={view.format ?? {}}
          onChangeFormat={(format) => props.onUpdateView({ format })}
        />
      </Popover>

      <Popover
        open={panel?.kind === 'layout'}
        anchor={panel?.anchor ?? null}
        onClose={close}
        placement="bottom-end"
      >
        {viewDef.SettingsPanel ? (
          <viewDef.SettingsPanel
            view={view}
            schema={schema}
            onChange={(patch) => props.onUpdateView(patch)}
          />
        ) : (
          <p className={styles.panelHint}>這個視圖沒有額外的版面設定。</p>
        )}
      </Popover>

      {/* ⋯ 選單 */}
      <Popover
        open={panel?.kind === 'more'}
        anchor={panel?.anchor ?? null}
        onClose={close}
        placement="bottom-end"
      >
        {panel ? (
          <Menu ariaLabel="視圖設定">
            <MenuItem
              onSelect={() => setPanel({ kind: 'properties', anchor: panel.anchor })}
              icon={<UiIcon name="eye" size={14} />}
            >
              屬性
            </MenuItem>
            {viewDef.supportsGrouping ? (
              <MenuItem
                onSelect={() => setPanel({ kind: 'group', anchor: panel.anchor })}
                icon={<UiIcon name="group" size={14} />}
              >
                分組
              </MenuItem>
            ) : null}
            <MenuItem onSelect={() => setPanel({ kind: 'layout', anchor: panel.anchor })}>
              版面設定
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<UiIcon name="download" size={14} />}
              onSelect={() => {
                close();
                props.onExportCsv();
              }}
            >
              匯出 CSV
            </MenuItem>
          </Menu>
        ) : null}
      </Popover>

      {/* 視圖 tab 的右鍵／再點一次選單 */}
      <Popover open={panel?.kind === 'viewMenu'} anchor={panel?.anchor ?? null} onClose={close}>
        <Menu ariaLabel="檢視選單">
          <MenuLabel>檢視型別</MenuLabel>
          {listViewTypes().map((def) => (
            <MenuItem
              key={def.type}
              selected={def.type === view.type}
              disabled={!viewTypeAvailable(def, schema)}
              hint={viewTypeAvailable(def, schema) ? undefined : '需要日期欄位'}
              onSelect={() => {
                close();
                props.onChangeViewType(def.type);
              }}
            >
              {def.label}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            onSelect={() => {
              close();
              setRenaming(true);
            }}
          >
            重新命名
          </MenuItem>
          <MenuItem
            onSelect={() => {
              close();
              props.onDuplicateView();
            }}
          >
            複製檢視
          </MenuItem>
          <MenuItem
            danger
            disabled={views.length <= 1}
            onSelect={() => {
              close();
              props.onDeleteView();
            }}
          >
            刪除檢視
          </MenuItem>
        </Menu>
      </Popover>

      {/* 新增檢視 */}
      <Popover open={panel?.kind === 'newView'} anchor={panel?.anchor ?? null} onClose={close}>
        <Menu ariaLabel="新增檢視">
          <MenuLabel>新增檢視</MenuLabel>
          {listViewTypes().map((def) => (
            <MenuItem
              key={def.type}
              disabled={!viewTypeAvailable(def, schema)}
              onSelect={() => {
                close();
                props.onCreateView(def.type);
              }}
            >
              {def.label}
            </MenuItem>
          ))}
        </Menu>
      </Popover>

      {renaming ? (
        <div className={styles.renameOverlay} onClick={() => setRenaming(false)}>
          <input
            className={styles.renameInput}
            defaultValue={view.name}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              if (e.target.value.trim()) props.onUpdateView({ name: e.target.value.trim() });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        </div>
      ) : null}
    </header>
  );
}

/**
 * Notion 的 view tab 用的是**線條 icon**（07n-db-view-tabs-light.png），
 * 不是 ▦▥☰ 這種全形方塊字 —— 後者在不同字體下大小/基線會亂跳。
 * packages/ui 的 icon 集本來就有 table/board/list/gallery/calendar 五個。
 */
function viewGlyph(type: ViewType): 'table' | 'board' | 'list' | 'gallery' | 'calendar' {
  const names = {
    table: 'table',
    board: 'board',
    list: 'list',
    gallery: 'gallery',
    calendar: 'calendar',
  } as const;
  return names[type] ?? 'table';
}
