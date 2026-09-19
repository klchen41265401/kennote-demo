/**
 * 權限解析（03 §4.12 的繼承規則）。純邏輯，不需要資料庫。
 * 驗收標準：**Guest 只能留言不能編輯**（04 §8 M5）。
 */
import { describe, expect, it } from 'vitest';
import {
  maxPermission,
  minPermission,
  resolvePermission,
  resolvePublicPermission,
  type PermissionEntryInput,
} from '../src/modules/permissions/resolve.js';
import { canControlTrashedPage } from '../src/modules/permissions/service.js';

const entry = (
  partial: Partial<PermissionEntryInput> & Pick<PermissionEntryInput, 'role'>,
): PermissionEntryInput => ({
  subjectType: 'user',
  subjectId: 'me',
  depth: 0,
  ...partial,
});

describe('resolvePermission', () => {
  it('不是工作區成員 → none（呼叫端轉 404，不洩漏存在性）', () => {
    expect(resolvePermission({ userId: 'me', workspaceRole: null, entries: [] })).toBe('none');
  });

  it('owner / admin 直通 full_access，不看任何條目', () => {
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: 'admin',
        entries: [entry({ role: 'none' })],
      }),
    ).toBe('full');
    expect(resolvePermission({ userId: 'me', workspaceRole: 'owner', entries: [] })).toBe('full');
  });

  it('member 沒有任何條目時用 baseline（可編輯）', () => {
    expect(resolvePermission({ userId: 'me', workspaceRole: 'member', entries: [] })).toBe('edit');
  });

  it('guest 沒有條目時看不到任何頁面', () => {
    expect(resolvePermission({ userId: 'me', workspaceRole: 'guest', entries: [] })).toBe('none');
  });

  it('⭐ guest 被授權 editor 仍然被封頂在 comment（後端拒絕編輯）', () => {
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: 'guest',
        entries: [entry({ role: 'editor' })],
      }),
    ).toBe('comment');
  });

  it('guest 適用 user 條目，但不適用 workspace 條目', () => {
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: 'guest',
        entries: [entry({ subjectType: 'workspace', subjectId: null, role: 'editor' })],
      }),
    ).toBe('none');
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: 'guest',
        entries: [entry({ role: 'commenter' })],
      }),
    ).toBe('comment');
  });

  it('別人的 user 條目不會被誤用（我仍然只拿到工作區 baseline）', () => {
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: 'member',
        entries: [entry({ subjectId: 'someone-else', role: 'owner' })],
      }),
    ).toBe('edit');
    // guest 沒有自己的條目 → 仍然看不到
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: 'guest',
        entries: [entry({ subjectId: 'someone-else', role: 'owner' })],
      }),
    ).toBe('none');
  });

  it('多筆條目取最大值（繼承鏈上較深的也算）', () => {
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: 'member',
        entries: [
          entry({ role: 'reader', depth: 0 }),
          entry({ subjectType: 'workspace', subjectId: null, role: 'editor', depth: 3 }),
        ],
      }),
    ).toBe('edit');
  });

  it('member 被父頁面限制成 reader 時只能讀（條目存在就不套 baseline）', () => {
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: 'member',
        entries: [entry({ subjectType: 'workspace', subjectId: null, role: 'reader', depth: 2 })],
      }),
    ).toBe('read');
  });

  it('頁面建立者永遠是 full', () => {
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: 'member',
        entries: [entry({ role: 'reader' })],
        isPageOwner: true,
      }),
    ).toBe('full');
  });
});

describe('公開連結', () => {
  it('只認 public 條目，而且永遠封頂在唯讀', () => {
    expect(
      resolvePublicPermission([
        { subjectType: 'public', subjectId: null, role: 'editor', depth: 0 },
      ]),
    ).toBe('read');
    expect(
      resolvePublicPermission([{ subjectType: 'user', subjectId: 'me', role: 'owner', depth: 0 }]),
    ).toBe('none');
    expect(resolvePublicPermission([])).toBe('none');
  });
});

describe('比較工具', () => {
  it('max / min 依 none < read < comment < edit < full 排序', () => {
    expect(maxPermission('read', 'comment')).toBe('comment');
    expect(minPermission('full', 'comment')).toBe('comment');
    expect(maxPermission('none', 'none')).toBe('none');
  });
});

/* ═══════════════════════════════════════════════════════════
   第六輪：工作區外的被授權者 + 垃圾桶的處置權
   ═══════════════════════════════════════════════════════════ */

describe('工作區外的被授權者（第六輪）', () => {
  it('非成員被直接指名 → 拿得到授權，但封頂在 edit', () => {
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: null,
        entries: [entry({ role: 'commenter' })],
      }),
    ).toBe('comment');
    // owner 條目也只給到 edit：非成員永遠不能再分享 / 改權限
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: null,
        entries: [entry({ role: 'owner' })],
      }),
    ).toBe('edit');
  });

  it('非成員沒有 baseline：沒被指名 → none（其他頁面照樣 404）', () => {
    expect(resolvePermission({ userId: 'me', workspaceRole: null, entries: [] })).toBe('none');
  });

  it('非成員不吃 workspace 條目，也不吃別人的 user 條目', () => {
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: null,
        entries: [
          { subjectType: 'workspace', subjectId: 'ws-1', role: 'editor', depth: 0 },
          { subjectType: 'public', subjectId: null, role: 'editor', depth: 0 },
          entry({ role: 'owner', subjectId: 'someone-else' }),
        ],
      }),
    ).toBe('none');
  });

  it('祖先頁面上的條目一樣算數（繼承鏈由呼叫端收好）', () => {
    expect(
      resolvePermission({
        userId: 'me',
        workspaceRole: null,
        entries: [entry({ role: 'reader', depth: 2 })],
      }),
    ).toBe('read');
  });

  it('成員的行為完全沒變（回歸：baseline 仍然適用）', () => {
    expect(resolvePermission({ userId: 'me', workspaceRole: 'member', entries: [] })).toBe('edit');
    expect(resolvePermission({ userId: 'me', workspaceRole: 'guest', entries: [] })).toBe('none');
  });
});

describe('垃圾桶裡的頁面該由誰處置（第六輪 BUG-29）', () => {
  it('工作區 owner / admin 一律可以', () => {
    const page = { created_by: 'someone', updated_by: 'someone' };
    expect(canControlTrashedPage('me', 'owner', page)).toBe(true);
    expect(canControlTrashedPage('me', 'admin', page)).toBe(true);
  });

  it('建立者與「把它丟進垃圾桶的人」可以', () => {
    expect(canControlTrashedPage('me', 'member', { created_by: 'me', updated_by: 'other' })).toBe(
      true,
    );
    expect(canControlTrashedPage('me', 'member', { created_by: 'other', updated_by: 'me' })).toBe(
      true,
    );
  });

  it('其他成員與 guest 都不行 —— 這就是 BUG-29 的洞', () => {
    const page = { created_by: 'other', updated_by: 'other' };
    expect(canControlTrashedPage('me', 'member', page)).toBe(false);
    expect(canControlTrashedPage('me', 'guest', page)).toBe(false);
  });

  it('created_by / updated_by 是 null 時不會誤判成「是我」', () => {
    expect(canControlTrashedPage('me', 'member', { created_by: null, updated_by: null })).toBe(
      false,
    );
  });
});
