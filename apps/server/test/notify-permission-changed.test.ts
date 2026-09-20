/**
 * 第十三輪：`permission_changed` 的發送端。
 *
 * 背景（為什麼這支測試存在）：
 * 第七、八輪查到「7 種通知型別裡有 4 種沒有發送端」，第九輪把
 * `notifyPermissionChanged()` 接到 `setPagePermission()` 上 —— 可是第十二輪的
 * 報告 §7 又寫了一句「`permission_changed` 仍沒有發送端（連六輪）」。
 * **那句話是抄來的，不是量出來的**：發送端從第九輪起就在 `permissions/service.ts:304`。
 *
 * 這支測試把「有沒有人呼叫」變成會紅的東西，這樣就不必再靠記憶：
 *   1. 單元：`notifyWorkspaceRoleChanged()` 真的寫出一則 `permission_changed`
 *   2. 靜態：`setPagePermission` / `changeMemberRole` / `removeMember`
 *      三個出口**都**看得到呼叫（`route-permission-audit.test.ts` 的同一個模子）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type NotifyInput = Record<string, unknown>;
const notify = vi.fn(async (_input: NotifyInput) => null);

vi.mock('../src/modules/notifications/service.js', () => ({
  notify,
  notifyMany: vi.fn(async () => 0),
  listPageSubscribers: vi.fn(async () => []),
  pageTitleOf: vi.fn(async () => '某一頁'),
  touchSubscription: vi.fn(async () => {}),
}));

const { notifyPermissionChanged, notifyWorkspaceRoleChanged } = await import(
  '../src/modules/notifications/fanout.js'
);

const serviceSrc = readFileSync(
  fileURLToPath(new URL('../src/modules/permissions/service.ts', import.meta.url)),
  'utf8',
);

/** 取一個 top-level `export async function <name>(` 的函式本體（到下一個 top-level export 為止） */
function bodyOf(name: string): string {
  const start = serviceSrc.indexOf(`export async function ${name}(`);
  expect(start, `找不到 ${name}()`).toBeGreaterThanOrEqual(0);
  const rest = serviceSrc.slice(start + 10);
  const next = rest.indexOf('\nexport ');
  return next < 0 ? rest : rest.slice(0, next);
}

describe('permission_changed 的發送端', () => {
  beforeEach(() => notify.mockClear());

  it('工作區角色變更會寫出一則 permission_changed（pageId 為 null、scope = workspace）', async () => {
    await notifyWorkspaceRoleChanged({
      workspaceId: 'ws-1',
      actorId: 'admin-1',
      recipientId: 'member-1',
      permission: 'guest',
      previousPermission: 'member',
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const input = notify.mock.calls[0]![0];
    expect(input.type).toBe('permission_changed');
    expect(input.recipientId).toBe('member-1');
    // 工作區層沒有頁面：收件匣的 onOpenPage 靠 pageId 決定要不要導頁
    expect(input.pageId).toBeUndefined();
    expect(input.payload).toMatchObject({
      scope: 'workspace',
      permission: 'guest',
      previousPermission: 'member',
    });
    expect(String(input.groupKey)).toContain('permission_changed:ws:ws-1');
  });

  it('被移出工作區（permission = none）一樣要通知', async () => {
    await notifyWorkspaceRoleChanged({
      workspaceId: 'ws-1',
      actorId: 'admin-1',
      recipientId: 'member-1',
      permission: 'none',
      previousPermission: 'member',
    });
    expect(notify).toHaveBeenCalledTimes(1);
    const payload = notify.mock.calls[0]![0].payload as Record<string, unknown>;
    expect(payload.permission).toBe('none');
  });

  it('自己改自己不通知', async () => {
    await notifyWorkspaceRoleChanged({
      workspaceId: 'ws-1',
      actorId: 'me',
      recipientId: 'me',
      permission: 'admin',
    });
    await notifyPermissionChanged({
      workspaceId: 'ws-1',
      pageId: 'p-1',
      actorId: 'me',
      recipientId: 'me',
      permission: 'read',
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('頁面層的發送端仍然在 setPagePermission 裡（第九輪接的，第十二輪誤記為「仍沒有」）', () => {
    expect(bodyOf('setPagePermission')).toContain('notifyPermissionChanged({');
  });

  it('工作區層的兩個出口都有發送端（第十三輪接的）', () => {
    expect(bodyOf('changeMemberRole')).toContain('notifyWorkspaceRoleChanged({');
    expect(bodyOf('removeMember')).toContain('notifyWorkspaceRoleChanged({');
  });
});
