/**
 * `<SidePeek>` —— 非 modal 的側邊 / 置中預覽外框（gap-review §C-1 / §C-4 / §C-6）。
 *
 * 舊的 `RowPeek` 走的是 `features/database/_fallback/Dialog`，
 * 而 `Dialog` 是**真正的 modal**：`createFocusTrap` + `inert` 背景 + 捲動鎖 +
 * `backdrop-filter: blur(2px)`。那正是「peek 不像 peek」的根因 ——
 * Notion 的 side peek 開著的時候主頁仍然可讀、可捲、可點。
 *
 * 所以這裡**不繼承 Dialog**，而是自己畫一個 `<aside>`：
 *   · 沒有 focus trap、沒有 `inert`、沒有捲動鎖
 *   · 側邊模式是**推擠**（`peek-layout.css` 給 `.kn-shell` 補 padding-right），
 *     不是覆蓋 —— 量自 Notion：`.notion-frame` 1170 → 450
 *   · 左緣可拖曳（`Resizable`，min 400 / max 80vw），寬度記在 localStorage
 *   · Escape 關閉（由 `PeekHost` 掛在 window 上）
 *   · 沒有麵包屑（這是 peek 的特徵），只有「上一頁 / 下一頁」
 *
 * 置中模式沿用「遮罩 + 置中面板」的外觀，但**內容是同一個元件**。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Icon, Menu, MenuItem, MenuSeparator, Resizable } from '@kennote/ui';
import { OPEN_PAGE_IN_META, OPEN_PAGE_IN_VALUES, type OpenPageIn } from '@kennote/shared-types';
import type { PeekMode } from './peek-url';
import styles from './Peek.module.css';

const WIDTH_KEY = 'kennote:peek-width';
const MIN_WIDTH = 400;

/** 預設寬度 = 50% 視窗（Notion 1440 下量到 720） */
export function defaultPeekWidth(): number {
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  return Math.max(MIN_WIDTH, Math.round(vw * 0.5));
}

export function maxPeekWidth(): number {
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  return Math.max(MIN_WIDTH + 1, Math.round(vw * 0.8));
}

function readStoredWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= MIN_WIDTH) return Math.min(n, maxPeekWidth());
  } catch {
    /* 無痕 / 被擋掉都當作沒有 */
  }
  return defaultPeekWidth();
}

function writeStoredWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    /* ignore */
  }
}

export interface PeekAction {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

export interface SidePeekProps {
  mode: PeekMode;
  onClose: () => void;
  onChangeMode: (mode: OpenPageIn) => void;
  onOpenInNewTab: () => void;
  onCopyLink: () => void;
  /** 在資料庫脈絡下才有（`null` = 沒有上一列 / 下一列） */
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
  /** ⋯ 選單的項目（複製、刪除…） */
  actions?: PeekAction[];
  children: ReactNode;
}

export function SidePeek({
  mode,
  onClose,
  onChangeMode,
  onOpenInNewTab,
  onCopyLink,
  onPrev,
  onNext,
  actions = [],
  children,
}: SidePeekProps): JSX.Element {
  const [width, setWidth] = useState(readStoredWidth);
  const [max, setMax] = useState(maxPeekWidth);

  // 視窗變窄時把 peek 一起夾回來，不然 400px 的手機會被推出畫面
  useEffect(() => {
    const onResize = (): void => {
      const nextMax = maxPeekWidth();
      setMax(nextMax);
      setWidth((w) => Math.min(w, nextMax));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* 側邊模式：把寬度交給 `.kn-shell`，讓主內容被**推窄**而不是被蓋住 */
  useEffect(() => {
    const el = document.documentElement;
    if (mode !== 'side') {
      el.removeAttribute('data-kn-peek');
      return undefined;
    }
    el.setAttribute('data-kn-peek', 'side');
    el.style.setProperty('--kn-peek-width', `${width}px`);
    return () => {
      el.removeAttribute('data-kn-peek');
      el.style.removeProperty('--kn-peek-width');
    };
  }, [mode, width]);

  const panel = (
    <aside className={styles.panel} aria-label={mode === 'side' ? '側邊預覽' : '置中預覽'}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.iconButton} aria-label="關閉" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="以完整頁面開啟"
          onClick={() => onChangeMode('full')}
        >
          <Icon name="expand" size={16} />
        </button>
        <Menu
          placement="bottom-start"
          trigger={
            <button type="button" className={styles.iconButton} aria-label="切換預覽模式">
              <Icon name="chevron-down" size={16} />
            </button>
          }
        >
          {OPEN_PAGE_IN_VALUES.map((value) => (
            <MenuItem
              key={value}
              textValue={OPEN_PAGE_IN_META[value].label}
              checked={value !== 'full' && value === mode}
              description={OPEN_PAGE_IN_META[value].description}
              onSelect={() => onChangeMode(value)}
            >
              {OPEN_PAGE_IN_META[value].label}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onSelect={onOpenInNewTab}>新分頁</MenuItem>
        </Menu>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="上一頁"
          disabled={!onPrev}
          onClick={() => onPrev?.()}
        >
          <Icon name="arrow-up" size={16} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="下一頁"
          disabled={!onNext}
          onClick={() => onNext?.()}
        >
          <Icon name="arrow-down" size={16} />
        </button>

        <span className={styles.spacer} />

        <button
          type="button"
          className={styles.iconButton}
          aria-label="複製連結"
          onClick={onCopyLink}
        >
          <Icon name="link" size={16} />
        </button>
        <Menu
          placement="bottom-end"
          trigger={
            <button type="button" className={styles.iconButton} aria-label="動作">
              <Icon name="more-horizontal" size={16} />
            </button>
          }
        >
          <MenuItem onSelect={onCopyLink}>拷貝連結</MenuItem>
          <MenuItem onSelect={onOpenInNewTab}>在新分頁中打開</MenuItem>
          {actions.length > 0 ? <MenuSeparator /> : null}
          {actions.map((action) => (
            <MenuItem key={action.label} danger={action.danger} onSelect={action.onSelect}>
              {action.label}
            </MenuItem>
          ))}
        </Menu>
      </div>

      <div className={styles.body} data-peek-body="">
        {children}
      </div>
    </aside>
  );

  if (mode === 'center') {
    return (
      <div
        className={styles.centerBackdrop}
        data-peek-mode="center"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className={styles.center}>{panel}</div>
      </div>
    );
  }

  return (
    <Resizable
      className={styles.side}
      size={width}
      min={MIN_WIDTH}
      max={max}
      side="left"
      resetSize={defaultPeekWidth()}
      handleLabel="調整側邊預覽寬度"
      onResize={setWidth}
      onResizeEnd={(next) => {
        setWidth(next);
        writeStoredWidth(next);
      }}
    >
      {panel}
    </Resizable>
  );
}
