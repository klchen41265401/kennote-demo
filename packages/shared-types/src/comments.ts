/**
 * 留言系統（03 §4.9、01 §6.2）。
 *
 * 錨點策略：**行內留言一律用 rich text 上的 `{ t:'comment', id }` mark**，
 * 不用字元位移（03 §4.9 的警告：位移會在原文被編輯後失效）。
 * `anchor.quote` 只是「討論串被孤立時要顯示什麼」的備援快照。
 */
import type { PublicUser } from './page.js';
import type { RichText } from './richtext.js';

export type DiscussionAnchorKind = 'page' | 'inline' | 'property';

export type DiscussionAnchor =
  /** 頁面層級討論串（右側面板頂端） */
  | { kind: 'page' }
  /** 行內留言：blockId + 被選取文字的快照；真正的定位靠 comment mark */
  | { kind: 'inline'; quote: string }
  /** database 欄位留言（M7 才會用到，型別先留著） */
  | { kind: 'property'; property: string };

export interface Comment {
  id: string;
  discussionId: string;
  workspaceId: string;
  authorId: string | null;
  body: RichText;
  plainText: string;
  /** 從 body 的 mention atom 萃取出來，方便發通知與索引 */
  mentionedUserIds: string[];
  createdAt: string;
  updatedAt: string;
  /** 已刪除的留言仍回傳（顯示為「這則留言已刪除」），但 body 會被清空 */
  deletedAt: string | null;
}

export interface Discussion {
  id: string;
  workspaceId: string;
  pageId: string;
  /** null = 頁面層級討論串 */
  blockId: string | null;
  anchor: DiscussionAnchor;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  comments: Comment[];
}

export interface DiscussionListResponse {
  pageId: string;
  discussions: Discussion[];
  /** 討論串作者 / 留言者的精簡資料，前端不必逐一再查 */
  users: Record<string, PublicUser>;
}

export interface CreateDiscussionRequest {
  /** 行內留言要給 blockId；頁面層級討論串省略 */
  blockId?: string | null;
  anchor?: DiscussionAnchor;
  /** 第一則留言的內容 */
  body: RichText;
  /** 前端先產生 discussionId，才能在同一個 transaction 裡寫 comment mark */
  discussionId?: string;
}

export interface CreateCommentRequest {
  body: RichText;
}

export interface UpdateCommentRequest {
  body: RichText;
}

/** 從 rich text 萃取 @提及的 userId（前後端共用，避免兩套規則） */
export function extractMentionedUserIds(body: RichText | null | undefined): string[] {
  if (!Array.isArray(body)) return [];
  const ids = new Set<string>();
  for (const node of body) {
    const atom = node as { atom?: string; data?: Record<string, unknown> };
    if (atom.atom !== 'mention') continue;
    const userId = atom.data?.userId;
    if (typeof userId === 'string' && userId.length > 0) ids.add(userId);
  }
  return [...ids];
}

/** 找出 rich text 裡所有 comment mark 的 discussionId（block 對應討論串用） */
export function extractCommentIds(body: RichText | null | undefined): string[] {
  if (!Array.isArray(body)) return [];
  const ids = new Set<string>();
  for (const node of body) {
    const marks = (node as { marks?: Array<{ t: string; id?: string }> }).marks;
    if (!marks) continue;
    for (const m of marks) {
      if (m.t === 'comment' && typeof m.id === 'string') ids.add(m.id);
    }
  }
  return [...ids];
}
