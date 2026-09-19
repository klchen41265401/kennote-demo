/**
 * 啟動時依 .env 有無憑證自動註冊 provider。
 * 新增一個 provider = 建一個檔案 + 這裡 import 並 register 一行。
 */
import type { AuthProviderInfo } from '@kennote/shared-types';
import { AppError } from '../../../lib/errors.js';
import { GoogleProvider } from './google.js';
import { LineProvider } from './line.js';
import type { AuthProvider } from './types.js';

const providers = new Map<string, AuthProvider>();

export function registerAuthProvider(provider: AuthProvider): void {
  if (providers.has(provider.id)) {
    throw new Error(`AuthProvider 重複註冊：${provider.id}`);
  }
  providers.set(provider.id, provider);
}

export function getAuthProvider(id: string): AuthProvider {
  const p = providers.get(id);
  if (!p || !p.enabled) throw new AppError('PROVIDER_NOT_ENABLED');
  return p;
}

/** 前端登入頁用來決定顯示哪些按鈕；local 永遠可用，不在這個清單裡 */
export function listAuthProviders(): AuthProviderInfo[] {
  return [...providers.values()].map((p) => ({
    id: p.id,
    displayName: p.displayName,
    enabled: p.enabled,
  }));
}

let initialized = false;

export function initAuthProviders(): void {
  if (initialized) return;
  initialized = true;
  registerAuthProvider(new GoogleProvider());
  registerAuthProvider(new LineProvider());
}

/** 測試用 */
export function __resetAuthProviders(): void {
  providers.clear();
  initialized = false;
}
