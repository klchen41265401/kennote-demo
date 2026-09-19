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
