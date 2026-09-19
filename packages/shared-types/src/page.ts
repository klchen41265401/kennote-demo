import type { Block } from './block.js';
import type { RichText } from './richtext.js';

/** icon 目前只支援 emoji 字串；未來要支援上傳圖檔時改成 discriminated union */
export type PageIcon = string | null;
/** cover 目前存 file id 或外部 URL 字串 */
export type PageCover = string | null;

export interface Page {
  id: string;
  workspaceId: string;
  /** null = 工作區頂層頁面 */
  parentId: string | null;
  title: RichText;
  icon: PageIcon;
  cover: PageCover;
  /** 自研 fractional index；同一個 parent 底下以字典序排列 */
  sortKey: string;
  /** 根層 block 的順序（排序真值，對應 Block.children 的同一套規則） */
  children: string[];
  isDatabase: boolean;
  /** is_database=true 時指向 collections.id */
  collectionId: string | null;
  /** database row 的欄位值（03 §6.4）；一般頁面為 {} */
  properties: Record<string, unknown>;
  /** 頁面層級 transaction 序號 */
  seq: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

/** 側邊欄樹用的精簡節點（GET /api/workspaces/:id/tree 回扁平陣列） */
export interface PageTreeNode {
  id: string;
  workspaceId: string;
  parentId: string | null;
  title: string;
  icon: PageIcon;
  sortKey: string;
  isDatabase: boolean;
  hasChildren: boolean;
  updatedAt: string;
}

export interface TrashedPage extends PageTreeNode {
  deletedAt: string;
  /** 這一筆是某個資料庫的「列」時，帶回所屬 collection 與它的名稱 */
  collectionId?: string | null;
  collectionTitle?: string | null;
}

export type RecordRole = 'owner' | 'editor' | 'commenter' | 'reader' | 'none';

export interface RecordEntry<T> {
  value: T;
  role: RecordRole;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * GET /api/pages/:id/snapshot 的回應（03 §9.1 的 record_map 形狀）。
 * 扁平 normalized map，前端 store 直接吃，不需要拆巢狀樹。
 */
export interface PageSnapshot {
  pageId: string;
  /** 這份資料對應的 transaction 序號；WS 從這裡接續，中間沒有空窗 */
  seq: number;
  /** 根層 block id 順序（= Page.children） */
  rootBlockIds: string[];
  recordMap: {
    page: Record<string, RecordEntry<Page>>;
    block: Record<string, RecordEntry<Block>>;
    user: Record<string, RecordEntry<PublicUser>>;
  };
}
