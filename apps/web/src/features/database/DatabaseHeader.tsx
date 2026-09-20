/**
 * 視圖 tabs + 右側工具列（02 §4.3.2 的版面）：
 *
 *   📋 總表  📌 看板  📅 行事曆  ＋        🔍  ⚙ 篩選  ↕ 排序  …  [ 新增 ]
 *
 * 工具列的按鈕由 **view registry 的能力宣告** 決定要不要顯示，
 * 這裡沒有任何 `if (viewType === 'board')`（04 §10.3）。
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type {
  CollectionSchema,
  CollectionView,
  RowGroup,
  ViewFormat,
  ViewQuery,
  ViewType,
} from '@kennote/shared-types';
import { countFilters } from '@kennote/shared-types';
import { Menu, MenuItem, MenuLabel, MenuSeparator, Popover, UiIcon } from './_fallback';
import { FilterBuilder } from './FilterBuilder';
import { GroupSettings } from './GroupSettings';
import { PropertyList } from './PropertyList';
import { SortBuilder } from './SortBuilder';
import { ViewSettingsPanel } from './ViewSettingsPanel';
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
  /** 內嵌資料庫的「⤢ 展開」：跳到承載這個 collection 的整頁 */
  onExpand?: () => void;
}

type PanelKind =
  | 'filter'
  | 'sort'
  | 'group'
  | 'properties'
  | 'layout'
  | 'more'
  | 'viewMenu'
  | 'newView'
  | 'automation'
  | 'ai'
  | 'moreTabs';

export function DatabaseHeader(props: DatabaseHeaderProps) {
  const { schema, views, view, search, readOnly } = props;
  const [panel, setPanel] = useState<{ kind: PanelKind; anchor: HTMLElement } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [searchOpen, setSearchOpen] = useState(search !== '');
  const tabsRef = useRef<HTMLElement>(null);
  /** tab 列放得下幾個（其餘收進「還有 N 個…」）—— 見 measureTabs */
  const [visibleTabs, setVisibleTabs] = useState(views.length);

  /**
   * Notion 的 tab 列放不下就收成「還有 N 個…」（UI-SPEC §8.1，07n-db-view-tabs-light.png
   * 裡 7 個檢視只露 4 個）。這裡照做：量每顆 tab 的實際寬度，扣掉 ＋ 與「還有…」的位子。
   */
  useLayoutEffect(() => {
    const nav = tabsRef.current;
    if (!nav) return;
    function measure() {
      const el = tabsRef.current;
      if (!el) return;
      const buttons = [...el.querySelectorAll<HTMLElement>('[data-tab]')];
      if (!buttons.length) return;
      const widths = buttons.map((b) => b.offsetWidth + 2);
      const total = widths.reduce((a, b) => a + b, 0);
      const plus = 28; // ＋ 新增檢視（只有「全部放得下」時才留在 tab 列上）
      if (total <= el.clientWidth - plus) {
        setVisibleTabs(buttons.length);
        return;
      }
      // 放不下時 ＋ 會收進「還有 N 個…」的下拉（Notion 的 tab 列上沒有 ＋，
      // 07n-db-view-tabs-light.png 實測：4 顆 tab ＋「還有 3 個…」，右邊直接接工具列），
      // 所以這裡**不再**替 ＋ 留位子，只留「還有 N 個…」（實測 ~92px）。
      const limit = el.clientWidth - 92;
      let used = 0;
      let fit = 0;
      for (const w of widths) {
        if (used + w > limit) break;
        used += w;
        fit += 1;
      }
      setVisibleTabs(Math.max(1, fit));
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [views]);

  const { shownViews, hiddenViews } = splitViewTabs(views, view.id, visibleTabs);

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
        <nav className={styles.tabs} aria-label="檢視" role="tablist" ref={tabsRef}>
          {shownViews.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              data-tab=""
              aria-selected={v.id === view.id}
              className={v.id === view.id ? styles.tabActive : styles.tab}
              onClick={(e) => {
                if (v.id === view.id) open('viewMenu', e);
                else props.onSelectView(v.id);
              }}
              /* BUG-7：右鍵一律開檢視選單（不用先把它點成作用中） */
              onContextMenu={(e) => {
                e.preventDefault();
                if (v.id !== view.id) props.onSelectView(v.id);
                open('viewMenu', e);
              }}
            >
              <span className={styles.tabIcon} aria-hidden="true">
                <UiIcon name={viewGlyph(v.type)} size={15} />
              </span>
              {v.name}
            </button>
          ))}
          {/* 量寬度用的影子清單：不佔版面，只讓 measureTabs 讀得到每顆 tab 的實際寬 */}
          <span className={styles.tabsGhost} aria-hidden="true">
            {views.map((v) => (
              <span key={v.id} data-tab="" className={styles.tab}>
                <span className={styles.tabIcon}>
                  <UiIcon name={viewGlyph(v.type)} size={15} />
                </span>
                {v.name}
              </span>
            ))}
          </span>
          {hiddenViews.length ? (
            <button
              type="button"
              className={styles.tabMore}
              onClick={(e) => open('moreTabs', e)}
            >
              還有 {hiddenViews.length} 個…
            </button>
          ) : null}
          {/* Notion 的 tab 列在「有收合」時**不放 ＋**（它在「還有 N 個…」的下拉裡） */}
          {!readOnly && !hiddenViews.length ? (
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

          {/**
            * ⚡ 自動化 / ✨ AI：Notion 這兩顆在「排序」與「搜尋」之間（UI-SPEC §8.1）。
            * 兩者都還沒實作，點開只給佔位選單 —— 但**版面要先對**，
            * 少兩顆按鈕會讓右側整條工具列往右偏 56px。
            */}
          <button
            type="button"
            className={styles.toolButton}
            aria-label="自動化"
            onClick={(e) => open('automation', e)}
          >
            <UiIcon name="bolt" size={16} />
          </button>

          <button
            type="button"
            className={styles.toolButton}
            aria-label="AI"
            onClick={(e) => open('ai', e)}
          >
            <UiIcon name="sparkle" size={16} />
          </button>

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

          {/* ⤢ 展開：內嵌資料庫跳到整頁（Notion 在「搜尋」與「設定」之間） */}
          {props.onExpand ? (
            <button
              type="button"
              className={styles.toolButton}
              aria-label="展開"
              onClick={props.onExpand}
            >
              <UiIcon name="expand" size={16} />
            </button>
          ) : null}

          <button
            type="button"
            className={styles.toolButton}
            /* O-33（第十三輪）：原本是 `aria-label="設定"`，與側邊欄底部的「設定」同名。
               一頁兩顆可及名稱相同、功能完全不同的按鈕 —— 螢幕閱讀器與
               `getByRole('button', { name: '設定' })` 都分不出來。 */
            aria-label="資料庫設定"
            onClick={(e) => open('more', e)}
          >
            <UiIcon name="settings" size={16} />
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
      {/* 「還有 N 個…」：收起來的檢視仍然是 role="tab"，這樣 e2e 展開後照樣點得到 */}
      <Popover open={panel?.kind === 'moreTabs'} anchor={panel?.anchor ?? null} onClose={close}>
        <div className={styles.tabMoreList} role="tablist" aria-label="其他檢視">
          {hiddenViews.map((v) => (
            /* BUG-7：收起來的檢視也要有「改名 / 建立複本 / 刪除」的入口（⋯ 或右鍵）。
               ⋯ 先把它選成作用中，再把浮層換成檢視選單 —— 錨點沿用「還有 N 個…」
               那顆按鈕（它不會被卸載，換 anchor 到 ⋯ 自己會因為浮層重繪而失效）。 */
            <div key={v.id} className={styles.tabMoreRow}>
              <button
                type="button"
                role="tab"
                aria-selected={v.id === view.id}
                className={v.id === view.id ? styles.tabActive : styles.tab}
                onClick={() => {
                  close();
                  props.onSelectView(v.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  props.onSelectView(v.id);
                  setPanel((p) => (p ? { kind: 'viewMenu', anchor: p.anchor } : null));
                }}
              >
                <span className={styles.tabIcon} aria-hidden="true">
                  <UiIcon name={viewGlyph(v.type)} size={15} />
                </span>
                {v.name}
              </button>
              <button
                type="button"
                className={styles.tabMoreMenu}
                aria-label={`${v.name} 的檢視選單`}
                onClick={() => {
                  props.onSelectView(v.id);
                  setPanel((p) => (p ? { kind: 'viewMenu', anchor: p.anchor } : null));
                }}
              >
                <UiIcon name="more" size={14} />
              </button>
            </div>
          ))}
          {!readOnly ? (
            <button
              type="button"
              className={styles.tabMoreAdd}
              onClick={() =>
                setPanel((p) => (p ? { kind: 'newView', anchor: p.anchor } : null))
              }
            >
              <span className={styles.tabIcon} aria-hidden="true">
                <UiIcon name="plus" size={15} />
              </span>
              新增檢視
            </button>
          ) : null}
        </div>
      </Popover>

      <Popover
        open={panel?.kind === 'automation'}
        anchor={panel?.anchor ?? null}
        onClose={close}
        placement="bottom-end"
      >
        <Menu>
          <MenuLabel>自動化</MenuLabel>
          <MenuItem disabled>新增自動化…（即將推出）</MenuItem>
          <MenuItem disabled>瀏覽自動化範本（即將推出）</MenuItem>
        </Menu>
      </Popover>

      <Popover
        open={panel?.kind === 'ai'}
        anchor={panel?.anchor ?? null}
        onClose={close}
        placement="bottom-end"
      >
        <Menu>
          <MenuLabel>AI</MenuLabel>
          <MenuItem disabled>AI 自動填寫（即將推出）</MenuItem>
          <MenuItem disabled>摘要這個資料庫（即將推出）</MenuItem>
        </Menu>
      </Popover>

      <Popover
        open={panel?.kind === 'filter'}
        anchor={panel?.anchor ?? null}
        onClose={close}
        placement="bottom-end"
        /* 第十一輪：手機上改成 bottom sheet（桌機不變） */
        sheetOnMobile
        flush
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
        /* 第十一輪：手機上改成 bottom sheet（桌機不變） */
        sheetOnMobile
        flush
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
        /* 第十一輪：手機上改成 bottom sheet（桌機不變） */
        sheetOnMobile
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
        /* 第十一輪：手機上改成 bottom sheet（桌機不變） */
        sheetOnMobile
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
        /* 第十一輪：手機上改成 bottom sheet（桌機不變） */
        sheetOnMobile
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
        /* 第十一輪：手機上改成 bottom sheet（桌機不變） */
        sheetOnMobile
        flush
      >
        {panel ? (
          <ViewSettingsPanel
            view={view}
            schema={schema}
            views={views}
            title={props.title}
            viewGlyph={viewGlyph}
            onClose={close}
            onRename={() => {
              close();
              setRenaming(true);
            }}
            onOpen={(kind) => setPanel({ kind, anchor: panel.anchor })}
            onCopyLink={() => {
              close();
              void navigator.clipboard?.writeText(`${window.location.href}#view=${view.id}`);
            }}
            onExportCsv={() => {
              close();
              props.onExportCsv();
            }}
            onSelectView={(viewId) => {
              close();
              props.onSelectView(viewId);
            }}
          />
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
 * BUG-7：tab 列溢位時，**目前選中的檢視一定要留在可見清單裡**。
 *
 * 原本只是 `views.slice(0, visibleTabs)`，所以從「還有 N 個…」切到被收起來的檢視之後：
 *   · 分頁列上一個 `aria-selected="true"` 的 tab 都沒有（看不出在哪個檢視）；
 *   · 「改名 / 建立複本 / 刪除」的入口是「再點一次選中的 tab」，整組選單因此打不開。
 *
 * 作法照 Notion：把選中的那顆擠進最後一格，被擠掉的那個退到「還有 N 個…」。
 * （`hiddenViews` 仍然保持原始順序，只是少了被擠進來的那一顆。）
 */
export function splitViewTabs<T extends { id: string }>(
  views: T[],
  activeViewId: string,
  visibleTabs: number,
): { shownViews: T[]; hiddenViews: T[] } {
  const limit = Math.max(0, Math.min(visibleTabs, views.length));
  const activeIndex = views.findIndex((v) => v.id === activeViewId);
  if (activeIndex < 0 || activeIndex < limit) {
    return { shownViews: views.slice(0, limit), hiddenViews: views.slice(limit) };
  }
  const active = views[activeIndex] as T;
  const shownViews = [...views.slice(0, Math.max(0, limit - 1)), active];
  const shownIds = new Set(shownViews.map((v) => v.id));
  return { shownViews, hiddenViews: views.filter((v) => !shownIds.has(v.id)) };
}

/**
 * Notion 的 view tab 用的是**線條 icon**（07n-db-view-tabs-light.png），
 * 不是 ▦▥☰ 這種全形方塊字 —— 後者在不同字體下大小/基線會亂跳。
 * packages/ui 的 icon 集本來就有 table/board/list/gallery/calendar 五個。
 */
function viewGlyph(type: ViewType): 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline' {
  const names = {
    table: 'table',
    board: 'board',
    list: 'list',
    gallery: 'gallery',
    calendar: 'calendar',
    timeline: 'timeline',
  } as const;
  return names[type] ?? 'table';
}
