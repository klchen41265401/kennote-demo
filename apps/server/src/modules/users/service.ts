/**
 * 使用者個人資料與刪除帳號。routes 只負責驗參數與回應，決策都在這裡。
 */
import type { AuthUser, DeleteAccountResponse, UserPreferences } from '@kennote/shared-types';
import { db, withTransaction } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  deletedEmailFor,
  mergePreferences,
  pickOwnershipSuccessor,
} from '../auth/account-rules.js';
import * as authRepo from '../auth/repo.js';
import * as repo from './repo.js';

export interface ProfileInput {
  name?: string;
  avatarUrl?: string | null;
  preferences?: UserPreferences;
}

/**
 * 頭像網址只接受「同源相對路徑」或 http(s) 絕對網址。
 * 正常流程是 POST /api/files/upload 回來的 `/api/files/<id>`；
 * 擋掉 javascript: / data: 這類會在 <img> 或之後的 <a> 上變成 XSS 的東西（04 §5.6）。
 */
function normalizeAvatarUrl(value: string | null): string | null {
  if (value === null) return null;
  const url = value.trim();
  if (url === '') return null;
  if (url.length > 2048) throw new AppError('VALIDATION_FAILED', '頭像網址過長');
  const ok = url.startsWith('/') ? !url.startsWith('//') : /^https?:\/\//i.test(url);
  if (!ok) throw new AppError('VALIDATION_FAILED', '頭像網址格式不正確');
  return url;
}

export async function updateProfile(userId: string, input: ProfileInput): Promise<AuthUser> {
  const current = await authRepo.findUserById(userId);
  if (!current) throw new AppError('UNAUTHORIZED');

  const patch: repo.ProfilePatch = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name === '') throw new AppError('VALIDATION_FAILED', '顯示名稱不能是空的');
    patch.name = name;
  }
  if (input.avatarUrl !== undefined) patch.avatarUrl = normalizeAvatarUrl(input.avatarUrl);
  if (input.preferences !== undefined) {
    patch.preferences = mergePreferences(current.preferences, input.preferences);
  }

  const ok = await repo.updateUserProfile(db, userId, patch);
  if (!ok) throw new AppError('UNAUTHORIZED');

  const row = await authRepo.findUserById(userId);
  if (!row) throw new AppError('UNAUTHORIZED');
  return authRepo.toAuthUser(row);
}

/**
 * 刪除帳號：軟刪除 + 撤銷所有 session。
 *
 * owner 的工作區不能就這樣消失 —— 還有其他成員的先交接（pickOwnershipSuccessor），
 * 只剩自己的才連同工作區一起軟刪。全部在同一個交易裡，
 * 中途失敗不會留下「使用者沒了但工作區沒人管」的狀態。
 */
export async function deleteAccount(userId: string): Promise<DeleteAccountResponse> {
  const user = await authRepo.findUserById(userId);
  if (!user) throw new AppError('UNAUTHORIZED');

  const result = await withTransaction(async (tx) => {
    const transferredWorkspaces: string[] = [];
    const deletedWorkspaces: string[] = [];

    for (const ws of await repo.listOwnedWorkspaces(userId, tx)) {
      const successor = pickOwnershipSuccessor(ws.members, userId);
      if (successor) {
        await repo.transferWorkspaceOwnership(tx, {
          workspaceId: ws.workspaceId,
          fromUserId: userId,
          toUserId: successor.userId,
        });
        transferredWorkspaces.push(ws.workspaceId);
      } else {
        await repo.softDeleteWorkspace(tx, ws.workspaceId);
        deletedWorkspaces.push(ws.workspaceId);
      }
    }

    await repo.leaveAllWorkspaces(tx, userId);
    const removed = await repo.softDeleteUser(tx, {
      userId,
      deletedEmail: deletedEmailFor(user.email, userId),
    });
    if (!removed) throw new AppError('UNAUTHORIZED');
    await authRepo.revokeUserSessions(tx, userId, 'account_deleted');

    return { transferredWorkspaces, deletedWorkspaces };
  });

  logger.warn({ userId, ...result }, '使用者刪除了自己的帳號');
  return result;
}
