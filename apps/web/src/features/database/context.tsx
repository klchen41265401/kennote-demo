/**
 * database 模組的共用 context。
 *
 * 為什麼需要它：儲存格編輯器（在 Table / Board / RowPeek 三個地方重複使用）
 * 需要 schema、工作區成員、「新增選項」這類動作。用 context 提供，
 * 三處才不必各自 prop drilling 一份（02 §3.5 的架構要點）。
 */
import { createContext, useContext } from 'react';
import type { CollectionSchema, SchemaOp, WorkspaceMember } from '@kennote/shared-types';

export interface DatabaseContextValue {
  collectionId: string;
  workspaceId: string;
  schema: CollectionSchema;
  members: WorkspaceMember[];
  /** select / multiSelect 編輯器裡直接建立新選項，回傳新的 optionId */
  createOption: (propertyId: string, label: string) => Promise<string | null>;
  /** 開啟側邊預覽（Notion 的 side peek） */
  openRow: (rowId: string) => void;
  /** 以整頁開啟 */
  openRowPage: (rowId: string) => void;
  /**
   * 欄位的新增／改名／改型別／刪除（PATCH schema 的 ops 介面）。
   * 回傳**這一批 ops 新增出來的 propertyId**（依序），呼叫端才能把新欄位
   * 接到 `view.format.properties` 尾端、捲過去並聚焦（BUG-8 / 表頭 ＋ 新增欄位）。
   */
  applySchemaOps: (ops: SchemaOp[]) => Promise<string[]>;
  readOnly: boolean;
}

const fallback: DatabaseContextValue = {
  collectionId: '',
  workspaceId: '',
  schema: {},
  members: [],
  createOption: async () => null,
  openRow: () => {},
  openRowPage: () => {},
  applySchemaOps: async () => [],
  readOnly: true,
};

export const DatabaseContext = createContext<DatabaseContextValue>(fallback);

export function useDatabaseContext(): DatabaseContextValue {
  return useContext(DatabaseContext);
}

/** 依 userId 找成員顯示名稱（person / createdBy 的儲存格都要） */
export function useMemberLookup(): (userId: string) => WorkspaceMember | undefined {
  const { members } = useDatabaseContext();
  return (userId: string) => members.find((m) => m.userId === userId);
}
