/**
 * UUID v7（時間有序）。Node 20 沒有內建，自己寫 20 行。
 *
 * 版面配置（RFC 9562）：
 *   0-5   : 48 bit Unix 毫秒時間戳（big endian）
 *   6     : 高 4 bit = version(0111)，低 4 bit = rand_a 高位
 *   7     : rand_a 低位
 *   8     : 高 2 bit = variant(10)，其餘 rand_b
 *   9-15  : rand_b
 *
 * 額外保證：同一毫秒內多次呼叫時，用單調遞增的 12 bit 計數器填 rand_a，
 * 讓同批 INSERT 的 id 也是嚴格遞增（B-tree 不會亂跳，03 §3.2）。
 */
import { randomFillSync } from 'node:crypto';

let lastTimestamp = -1;
let counter = 0;

const HEX: string[] = [];
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'));

export function uuidv7(now: number = Date.now()): string {
  let ts = now;
  if (ts === lastTimestamp) {
    counter = (counter + 1) & 0x0fff;
    // 同一毫秒用完 4096 個 id：借用下一毫秒，維持單調性
    if (counter === 0) ts = lastTimestamp + 1;
  } else if (ts < lastTimestamp) {
    // 時鐘回撥：沿用上一個時間戳，絕不倒退
    ts = lastTimestamp;
    counter = (counter + 1) & 0x0fff;
  } else {
    counter = Math.floor(Math.random() * 0x1000);
  }
  lastTimestamp = ts;

  const bytes = new Uint8Array(16);
  randomFillSync(bytes, 8, 8);

  // 48 bit 時間戳
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;

  // version 7 + 12 bit 計數器
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  // variant 10xxxxxx
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  let out = '';
  for (let i = 0; i < 16; i++) {
    out += HEX[bytes[i]!];
    if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** 由 uuid v7 取回時間戳（除錯 / 排序驗證用） */
export function uuidv7Timestamp(id: string): number {
  const hex = id.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16);
}

/** 測試用：重設單調狀態 */
export function __resetUuidv7State(): void {
  lastTimestamp = -1;
  counter = 0;
}
