/**
 * StorageAdapter（04 §5.6 / §10.4 的擴充點）：local ↔ S3 ↔ MinIO ↔ R2。
 * M1 只實作 local；S3 之後加一個檔案 + createStorage 多一行 if。
 */
import type { Readable } from 'node:stream';

export interface StorageAdapter {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** local 驅動回自家的 /api/files/:id；S3 回簽章網址 */
  getSignedUrl(key: string, expiresInSec: number): Promise<string>;
}

/**
 * 以 magic number 判斷真實 MIME，**不信任 client 的 Content-Type 與副檔名**
 * （04 §5.6 安全檢查清單）。
 */
const SIGNATURES: Array<{ mime: string; ext: string; bytes: number[]; offset?: number }> = [
  { mime: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', ext: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', ext: 'webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { mime: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'application/zip', ext: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'video/mp4', ext: 'mp4', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { mime: 'audio/mpeg', ext: 'mp3', bytes: [0x49, 0x44, 0x33] },
];

export interface DetectedType {
  mime: string;
  ext: string;
}

export function detectFileType(buffer: Buffer): DetectedType | null {
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[offset + i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) return { mime: sig.mime, ext: sig.ext };
  }
  // 純文字（UTF-8 可解碼且沒有控制字元）當成 text/plain
  const head = buffer.subarray(0, Math.min(buffer.length, 512));
  const hasBinary = head.some((b) => b === 0);
  if (!hasBinary && buffer.length > 0) return { mime: 'text/plain', ext: 'txt' };
  return null;
}

/**
 * 儲存 key：{workspaceId}/{yyyy}/{mm}/{uuid}.{ext}
 * 絕不用使用者檔名當路徑（防 path traversal）。
 */
export function buildStorageKey(workspaceId: string, fileId: string, ext: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
  return `${workspaceId}/${yyyy}/${mm}/${fileId}.${safeExt}`;
}
