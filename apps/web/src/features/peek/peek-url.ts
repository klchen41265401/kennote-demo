/**
 * side peek 的 URL 狀態（gap-review §B-1）。
 *
 * 量自 Notion 桌面版 7.34（`reference/shots/gap-review/notion/_SUMMARY.json` → `B_sidePeek.url`）：
 *
 *   側邊預覽  …/p/<dbId>?v=<viewId>&p=<pageId>&pm=s
 *   置中預覽  …/p/<dbId>?v=<viewId>&p=<pageId>&pm=c
 *   完整頁面  …/p/<slug>-<pageId>          ← **沒有** p / pm，是真的換頁
 *
 * 也就是說：peek 不是元件內的 `useState`，而是 **query string**。
 * 因此重新整理 peek 還在、瀏覽器上一頁關掉 peek、把網址貼給同事看到的是同一個 peek。
 * 原本的 `?v=` 這類參數一律保留（只加 / 只刪 `p` 與 `pm`）。
 */
import { useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { OpenPageIn } from '@kennote/shared-types';

/** peek 面板能呈現的兩種模式；`full` 不是 peek，是換頁 */
export type PeekMode = 'side' | 'center';

export const PEEK_PARAM = 'p';
export const PEEK_MODE_PARAM = 'pm';

/** `pm` 的值（Notion 用單字母） */
export const PEEK_MODE_CODE: Record<PeekMode, string> = { side: 's', center: 'c' };

export function parsePeekMode(raw: string | null): PeekMode {
  return raw === 'c' ? 'center' : 'side';
}

export interface PeekState {
  pageId: string | null;
  mode: PeekMode;
}

/** 目前網址描述的 peek 狀態 */
export function usePeekState(): PeekState {
  const [params] = useSearchParams();
  const pageId = params.get(PEEK_PARAM);
  const mode = parsePeekMode(params.get(PEEK_MODE_PARAM));
  return useMemo(() => ({ pageId: pageId || null, mode }), [pageId, mode]);
}

export interface PeekNavigation {
  /** 開啟（`full` 會直接導向 `/page/:id`，不留 p/pm） */
  open: (pageId: string, mode?: OpenPageIn) => void;
  /** 關閉：把 p/pm 從網址拿掉（留下其他參數） */
  close: () => void;
  /** 換模式：side ↔ center ↔ full */
  setMode: (mode: OpenPageIn) => void;
  /** 在新分頁開啟整頁 */
  openInNewTab: (pageId: string) => void;
}

export function usePeekNavigation(): PeekNavigation {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const open = useCallback(
    (pageId: string, mode: OpenPageIn = 'side') => {
      if (mode === 'full') {
        navigate(`/page/${pageId}`);
        return;
      }
      const next = new URLSearchParams(params);
      next.set(PEEK_PARAM, pageId);
      next.set(PEEK_MODE_PARAM, PEEK_MODE_CODE[mode]);
      // push（不是 replace）—— 這樣瀏覽器「上一頁」才會關掉 peek
      setParams(next);
    },
    [params, setParams, navigate],
  );

  const close = useCallback(() => {
    const next = new URLSearchParams(params);
    if (!next.has(PEEK_PARAM) && !next.has(PEEK_MODE_PARAM)) return;
    next.delete(PEEK_PARAM);
    next.delete(PEEK_MODE_PARAM);
    setParams(next);
  }, [params, setParams]);

  const setMode = useCallback(
    (mode: OpenPageIn) => {
      const pageId = params.get(PEEK_PARAM);
      if (!pageId) return;
      if (mode === 'full') {
        navigate(`/page/${pageId}`);
        return;
      }
      const next = new URLSearchParams(params);
      next.set(PEEK_MODE_PARAM, PEEK_MODE_CODE[mode]);
      // 換模式用 replace：不要在上一頁堆一堆同一頁的紀錄
      setParams(next, { replace: true });
    },
    [params, setParams, navigate],
  );

  const openInNewTab = useCallback((pageId: string) => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    window.open(`${base}/page/${pageId}`, '_blank', 'noopener');
  }, []);

  return useMemo(
    () => ({ open, close, setMode, openInNewTab }),
    [open, close, setMode, openInNewTab],
  );
}
