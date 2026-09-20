/**
 * 版本歷史（04 §8 M5-13）。
 * 快照不另存表：直接從 `page_transactions` 重播 operation log 重建任意 seq 的狀態。
 */
import type { PageSnapshot } from './page.js';

export interface HistoryVersion {
  /** 這個版本點對應的 transaction seq（重建時用） */
  seq: number;
  /** 這個版本點聚合了幾筆 transaction */
  txCount: number;
  at: string;
  /** 這段期間編輯過的人 */
  actorIds: string[];
}

export interface HistoryListResponse {
  pageId: string;
  currentSeq: number;
  versions: HistoryVersion[];
}

export interface HistorySnapshotResponse {
  pageId: string;
  seq: number;
  at: string | null;
  snapshot: PageSnapshot;
}

export interface RestoreVersionResponse {
  pageId: string;
  /** 還原是「再送一筆 transaction」，歷史不被改寫 */
  restoredFromSeq: number;
  newSeq: number;
  opCount: number;
}

/** 版本點聚合規則：每 N 筆或跨過一小時就切一個版本點 */
export const HISTORY_BUCKET_TX = 20;
export const HISTORY_BUCKET_MS = 60 * 60_000;

/* ── 「更新」feed（gap-review B-5 / O-38）─────────────────────
 * Notion 的右側面板「更新和分析」裡的「更新」是**活動摘要**，
 * 跟「版本紀錄」（快照清單 + 還原）是兩個不同的東西
 * （reference/shots/gap-review/notion/_SUMMARY.json A_rightPanel）。
 * 這裡的 entry 聚合三種來源：
 *   - `edit`      ：`page_transactions` 的 block.* ops（「編輯了 N 個區塊」）
 *   - `property`  ：`page.update` ops（標題 / 圖示 / 封面）
 *   - `comment`   ：discussions / comments 的建立與解決
 */
export type PageUpdateKind = 'edit' | 'property' | 'comment' | 'comment_resolved';

export interface PageUpdateEntry {
  /** 穩定 id（`edit:<seq>` / `comment:<commentId>` …），前端當 key 用 */
  id: string;
  kind: PageUpdateKind;
  /** 這一筆對應的 transaction seq（只有 edit / property 有）—— 「查看本次更新後的版本」 */
  seq: number | null;
  actorId: string | null;
  at: string;
  /** 已經組好的中文摘要，例如「編輯了 3 個區塊」 */
  summary: string;
  /** 受影響的 block id（edit 用，最多 20 個；前端捲到第一個） */
  blockIds: string[];
  /** comment 類才有 */
  discussionId: string | null;
  /** 留言內容片段（最多 140 字） */
  snippet: string | null;
  /** property 類：被改的欄位名（`title` / `icon` / `cover`） */
  properties: string[];
}

export interface PageUpdatesResponse {
  pageId: string;
  entries: PageUpdateEntry[];
  /** 下一頁游標（entry 的 `at` ISO 字串）；null = 沒有更多 */
  nextCursor: string | null;
  users: Record<string, import('./page.js').PublicUser>;
}

/** 同一個人、同一種類、這個毫秒數之內的活動合併成一則 */
export const UPDATES_GROUP_MS = 5 * 60_000;
export const UPDATES_PAGE_SIZE = 30;
