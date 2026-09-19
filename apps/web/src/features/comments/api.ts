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

/** 把輸入框的純文字轉成 RichText；`@name` 之後會由編輯器版的 mention atom 取代 */
export function plainToBody(text: string): RichText {
  const trimmed = text.trim();
  return trimmed.length > 0 ? [{ text: trimmed }] : [];
}
