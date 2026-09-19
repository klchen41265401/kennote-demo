/**
 * 搜尋契約（M6）。01 §8、03 §7.4。
 *
 * 這個檔案是前後端唯一的搜尋契約。M1 的 `SearchHit` 原本住在 api.ts，
 * M6 把它搬來這裡並補上 `snippet`（HTML）、`parentTitles`、`type` 與 cursor 分頁。
 */

/** 命中的東西是什麼。`row` = database 的一列（也是一個 page） */
export type SearchResultType = 'page' | 'database' | 'row';

/** 搜尋篩選允許的 type（row 併進 database 一起看） */
export type SearchTypeFilter = 'page' | 'database';

export interface SearchHit {
  pageId: string;
  /** 命中在哪個 block；標題命中為 null */
  blockId: string | null;
  workspaceId: string;
  /** 純文字標題（未逸出，前端自行 render 成文字節點） */
  title: string;
  icon: string | null;
  /**
   * ⚠️ 已逸出的 HTML 片段，命中處包 `<mark>`。
   * 除了 `<mark>` 與 `</mark>` 以外，其餘字元都已 HTML escape，
   * 前端可以安全地 dangerouslySetInnerHTML。
   */
  snippet: string;
  /** 祖先頁面標題，由遠到近（麵包屑）。不含自己 */
  parentTitles: string[];
  updatedAt: string;
  type: SearchResultType;
  score: number;
}

export interface SearchQueryInput {
  q: string;
  workspaceId?: string;
  type?: SearchTypeFilter;
  createdBy?: string;
  /** ISO 字串；只回這個時間之後更新過的 */
  updatedAfter?: string;
  limit?: number;
  cursor?: string;
}

export interface SearchResponse {
  query: string;
  hits: SearchHit[];
  /** null = 沒有下一頁 */
  nextCursor: string | null;
  /**
   * true 代表這是「空查詢的最近瀏覽」而不是真的搜尋結果
   * （搜尋框剛打開時的空狀態）。
   */
  recent: boolean;
  /** 查詢字串斷詞後的 token（除錯 / 高亮用） */
  tokens: string[];
}

/* ── 最近瀏覽 ─────────────────────────────────────────── */

export interface RecentPage {
  pageId: string;
  workspaceId: string;
  title: string;
  icon: string | null;
  type: SearchResultType;
  /** 這位使用者最後一次開啟的時間 */
  visitedAt: string;
  updatedAt: string;
  parentTitles: string[];
}

export type RecentResponse = RecentPage[];
