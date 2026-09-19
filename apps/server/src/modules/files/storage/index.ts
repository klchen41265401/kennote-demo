import { env } from '../../../env.js';
import { LocalStorage } from './local.js';
import type { StorageAdapter } from './types.js';

export * from './types.js';
export { LocalStorage };

let instance: StorageAdapter | null = null;

export function createStorage(): StorageAdapter {
  if (instance) return instance;
  // S3Storage 之後在這裡多一行 if —— 這就是 adapter 存在的全部理由
  if (env.STORAGE_DRIVER === 's3') {
    throw new Error('S3 storage 尚未實作；請將 STORAGE_DRIVER 設為 local');
  }
  instance = new LocalStorage();
  return instance;
}

/** 測試用 */
export function __setStorage(adapter: StorageAdapter | null): void {
  instance = adapter;
}
