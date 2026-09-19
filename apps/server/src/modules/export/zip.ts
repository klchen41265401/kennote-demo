/**
 * 最小 ZIP 讀寫器（store + deflate），只用 Node 內建的 `node:zlib`。
 *
 * 為什麼自己寫：匯出要打包、匯入要解 Notion 的 zip，這是**兩個很小的需求**
 * （ZIP 的 local header / central directory / EOCD 三個結構加起來不到 100 bytes 的欄位），
 * 而 jszip / archiver 會帶進整個串流框架與一堆用不到的表面積。
 * 與 00-README 決策 #11 的黑名單精神一致：功能型套件自研，基礎設施（zlib）才外購。
 *
 * 支援範圍（誠實記錄，寫在 ADR 0005）：
 *   ✅ method 0（store）、method 8（deflate）
 *   ✅ UTF-8 檔名（general purpose bit 11）
 *   ✅ data descriptor（bit 3）—— 大小一律以 central directory 為準
 *   ❌ ZIP64（單檔 > 4GB 或 > 65535 個項目）→ 偵測到就丟錯，不做半套
 *   ❌ 加密、split archive
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';

/* ── CRC32 ─────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

/* ── DOS 時間 ─────────────────────────────────────────── */

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/* ── 寫 ───────────────────────────────────────────────── */

export interface ZipEntryInput {
  /** zip 內的路徑，一律用 `/`，不得以 `/` 開頭 */
  name: string;
  data: Buffer | string;
  /** true = 不壓縮（已壓縮過的圖片/影片壓了也是白壓，還更慢） */
  store?: boolean;
  date?: Date;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
/** 已經壓縮過的格式，再 deflate 一次只是浪費 CPU */
const PRECOMPRESSED = /\.(png|jpe?g|gif|webp|mp4|mp3|zip|pdf|woff2?)$/i;

export function createZip(entries: ZipEntryInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = normalizeEntryName(entry.name);
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const store = entry.store ?? PRECOMPRESSED.test(name);
    const body = store ? raw : deflateRawSync(raw, { level: 6 });
    const method = store ? 0 : 8;
    const { time, date } = dosDateTime(entry.date ?? new Date());
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // bit 11：檔名是 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

function normalizeEntryName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '');
}

/* ── 讀 ───────────────────────────────────────────────── */

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** local header 的位移 */
  headerOffset: number;
  isDirectory: boolean;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export class ZipArchive {
  private constructor(
    private readonly buf: Buffer,
    private readonly list: ZipEntry[],
  ) {}

  static open(buf: Buffer): ZipArchive {
    const eocd = findEocd(buf);
    if (eocd === -1) throw new ZipError('不是合法的 zip 檔（找不到中央目錄結尾）');

    const total = buf.readUInt16LE(eocd + 10);
    const centralSize = buf.readUInt32LE(eocd + 12);
    const centralOffset = buf.readUInt32LE(eocd + 16);
    if (centralOffset === 0xffffffff || total === 0xffff) {
      throw new ZipError('不支援 ZIP64 格式的壓縮檔');
    }
    if (centralOffset + centralSize > buf.length) throw new ZipError('zip 中央目錄位移超出檔案範圍');

    const entries: ZipEntry[] = [];
    let p = centralOffset;
    for (let i = 0; i < total; i++) {
      if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) {
        throw new ZipError(`zip 中央目錄第 ${i + 1} 筆損毀`);
      }
      const method = buf.readUInt16LE(p + 10);
      const compressedSize = buf.readUInt32LE(p + 20);
      const size = buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28);
      const extraLen = buf.readUInt16LE(p + 30);
      const commentLen = buf.readUInt16LE(p + 32);
      const headerOffset = buf.readUInt32LE(p + 42);
      const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      entries.push({
        name: normalizeEntryName(name),
        method,
        compressedSize,
        size,
        headerOffset,
        isDirectory: name.endsWith('/') || name.endsWith('\\'),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return new ZipArchive(buf, entries);
  }

  entries(): ZipEntry[] {
    return this.list;
  }

  /** 逐項解壓縮：整包 zip 在記憶體裡，但**一次只解一個檔案**，峰值 = 最大單檔 */
  read(entry: ZipEntry): Buffer {
    const p = entry.headerOffset;
    if (p + 30 > this.buf.length || this.buf.readUInt32LE(p) !== SIG_LOCAL) {
      throw new ZipError(`zip 項目的區域檔頭損毀：${entry.name}`);
    }
    const nameLen = this.buf.readUInt16LE(p + 26);
    const extraLen = this.buf.readUInt16LE(p + 28);
    const start = p + 30 + nameLen + extraLen;
    const end = start + entry.compressedSize;
    if (end > this.buf.length) throw new ZipError(`zip 項目內容超出檔案範圍：${entry.name}`);
    const body = this.buf.subarray(start, end);

    if (entry.method === 0) return Buffer.from(body);
    if (entry.method === 8) return inflateRawSync(body);
    throw new ZipError(`不支援的壓縮方式 ${entry.method}：${entry.name}`);
  }

  readText(entry: ZipEntry): string {
    const buf = this.read(entry);
    // Notion 匯出的 CSV 會帶 UTF-8 BOM
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      return buf.subarray(3).toString('utf8');
    }
    return buf.toString('utf8');
  }
}

function findEocd(buf: Buffer): number {
  const minFrom = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minFrom; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}
