/**
 * 目前作用中的工作區。
 *
 * `stores/auth.ts` 的 `useCurrentWorkspace()` 固定取第一個（M1 的簡化版）；
 * 這一支讓使用者可以切換，並把選擇記在 localStorage。
 * auth store 仍然是工作區清單的真值來源，這裡只存「選了哪一個 id」。
 */
import { createStore, useStore } from '@kennote/ui';
import type { WorkspaceSummary } from '@kennote/shared-types';
import { useAuth } from './auth';

const KEY = 'kennote:workspace';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const activeWorkspaceStore = createStore<string | null>(read());

export function setActiveWorkspace(id: string | null): void {
  activeWorkspaceStore.setState(id);
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* 無痕模式 */
  }
}

/** 目前工作區；記住的 id 已經不存在時退回第一個 */
export function useWorkspace(): WorkspaceSummary | null {
  const { workspaces } = useAuth();
  const activeId = useStore(activeWorkspaceStore);
  if (workspaces.length === 0) return null;
  return workspaces.find((w) => w.id === activeId) ?? workspaces[0] ?? null;
}
