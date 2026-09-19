/**
 * 留言的資料抓取與 mutation。用自研的 useQuery（packages/ui），不用 react-query。
 * WS 的 `comment` 事件會讓這個 key 失效（stores/sync.ts 的 onComment），面板自動更新。
 */
import type {
  CreateDiscussionRequest,
  Discussion,
  DiscussionListResponse,
  RichText,
} from '@kennote/shared-types';
import { COLLAB_API_ROUTES } from '@kennote/shared-types';
import { invalidateQueries, useQuery } from '@kennote/ui';
import { api } from '../../lib/api-client';

export const discussionKey = (pageId: string) => ['page', pageId, 'discussions'] as const;

export function usePageDiscussions(pageId: string | null) {
  return useQuery<DiscussionListResponse>({
    key: pageId ? discussionKey(pageId) : ['page', 'none', 'discussions'],
    enabled: Boolean(pageId),
    fetcher: () =>
      api.get<DiscussionListResponse>(COLLAB_API_ROUTES.pageDiscussions(pageId as string)),
  });
}

export async function createDiscussion(
  pageId: string,
  input: CreateDiscussionRequest,
): Promise<Discussion> {
  const discussion = await api.post<Discussion>(COLLAB_API_ROUTES.pageDiscussions(pageId), input);
  invalidateQueries(discussionKey(pageId));
  return discussion;
}

export async function addComment(
  pageId: string,
  discussionId: string,
  body: RichText,
): Promise<Discussion> {
  const discussion = await api.post<Discussion>(
    COLLAB_API_ROUTES.discussionComments(discussionId),
    { body },
  );
  invalidateQueries(discussionKey(pageId));
  return discussion;
}

export async function setDiscussionResolved(
  pageId: string,
  discussionId: string,
  resolved: boolean,
): Promise<void> {
  const path = COLLAB_API_ROUTES.discussionResolve(discussionId);
  if (resolved) await api.post(path);
  else await api.delete(path);
  invalidateQueries(discussionKey(pageId));
}

export async function editComment(
  pageId: string,
  commentId: string,
  body: RichText,
): Promise<void> {
  await api.patch(COLLAB_API_ROUTES.comment(commentId), { body });
  invalidateQueries(discussionKey(pageId));
}

export async function deleteComment(pageId: string, commentId: string): Promise<void> {
  await api.delete(COLLAB_API_ROUTES.comment(commentId));
  invalidateQueries(discussionKey(pageId));
}

/** 提及解析用的最小成員形狀（`useWorkspaceMembers()` 回的那一坨的子集） */
export interface MentionCandidate {
  userId: string;
  user?: { name?: string | null; email?: string | null } | null;
}

/**
 * 第六輪 BUG-30：把輸入框的純文字轉成 RichText，**並且把 `@某人` 變成 mention atom**。
 *
 * 原本這支是 `[{ text: trimmed }]`，檔頭寫著「`@name` 之後會由編輯器版的
 * mention atom 取代」—— 那個「之後」沒有來。後果是整條
 * 「@提及 → 通知 → 收件匣」鏈路**從 UI 完全走不到**：
 *   - 後端 `extractMentionedUserIds()` 只認 `atom === 'mention'` 的節點
 *   - 留言框只送得出純文字 → `mentionedUserIds` 永遠是空的
 *   - 編輯器裡的 mention 有 atom，但後端只掃留言的 body，不掃 block 內容
 * 實測遠端站台（用 API 直接送 mention atom）：通知**產得出來**，
 * 所以壞掉的只有這一層轉換。
 *
 * 比對規則刻意保守：`@` 之後的字串要**完整等於**某個成員的顯示名稱或 email
 * 的本地部分（大小寫不計），才換成 atom；比不到就原樣留成文字，
 * 不會把使用者打的 `@下午三點` 吃掉。長名字優先比，避免
 * 「小明」先吃掉「小明華」的前綴。
 */
export function plainToBody(text: string, members: readonly MentionCandidate[] = []): RichText {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (members.length === 0) return [{ text: trimmed }];

  // name → userId，長的排前面（最長匹配優先）
  const table: Array<{ label: string; userId: string; display: string }> = [];
  for (const m of members) {
    const name = m.user?.name?.trim();
    const email = m.user?.email?.trim();
    if (name) table.push({ label: name.toLowerCase(), userId: m.userId, display: name });
    const local = email ? email.split('@')[0] : undefined;
    if (local) table.push({ label: local.toLowerCase(), userId: m.userId, display: local });
  }
  table.sort((a, b) => b.label.length - a.label.length);

  const out: RichText = [];
  let buffer = '';
  let i = 0;

  const flush = (): void => {
    if (buffer.length > 0) out.push({ text: buffer });
    buffer = '';
  };

  while (i < trimmed.length) {
    if (trimmed[i] !== '@') {
      buffer += trimmed[i];
      i += 1;
      continue;
    }
    const rest = trimmed.slice(i + 1).toLowerCase();
    const hit = table.find((t) => rest.startsWith(t.label));
    if (!hit) {
      buffer += '@';
      i += 1;
      continue;
    }
    flush();
    out.push({ atom: 'mention', data: { userId: hit.userId, text: `@${hit.display}` } } as never);
    i += 1 + hit.label.length;
  }
  flush();
  return out;
}
