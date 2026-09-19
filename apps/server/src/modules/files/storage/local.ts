import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { env } from '../../../env.js';
import { AppError } from '../../../lib/errors.js';
import type { StorageAdapter } from './types.js';

export class LocalStorage implements StorageAdapter {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(root: string = env.STORAGE_LOCAL_PATH) {
    this.root = path.resolve(root);
  }

  /** key 已經是我們自己產生的安全字串，但仍然再確認一次沒有跳出 root */
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep) && full !== this.root) {
      throw new AppError('UPLOAD_FAILED', '不合法的儲存路徑');
    }
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(key: string): Promise<Readable> {
    return createReadStream(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => {});
  }

  async getSignedUrl(key: string): Promise<string> {
    // local 驅動不簽章：檔案一律經過 /api/files/:id 的權限檢查才拿得到
    return `/api/files/${encodeURIComponent(key)}`;
  }
}
