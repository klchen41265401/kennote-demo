/**
 * 極簡 PNG 解碼 / 編碼 + 並排拼接 + 差異量測。
 *
 * **刻意不裝任何套件**（pngjs / sharp 都沒有）：只用 node 內建的 `zlib`。
 * 支援的子集剛好涵蓋兩邊的來源：
 *   - bit depth 8、非交錯（interlace = 0）
 *   - color type 2（RGB）/ 6（RGBA）/ 0（灰階）/ 4（灰階+alpha）
 * Notion 那邊是 CDP `Page.captureScreenshot`（colorType 2），
 * kennote 這邊是 Playwright `page.screenshot()`（colorType 2/6），兩者都在範圍內。
 */
import { deflateSync, inflateSync } from 'node:zlib';

export interface Raster {
  width: number;
  height: number;
  /** RGBA，長度 = width * height * 4 */
  data: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* ── 解碼 ────────────────────────────────────────────────── */

export function decodePng(buffer: Buffer): Raster {
  for (let i = 0; i < 8; i += 1) {
    if (buffer[i] !== PNG_SIGNATURE[i]) throw new Error('不是 PNG（signature 不符）');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(start);
      height = buffer.readUInt32BE(start + 4);
      bitDepth = buffer[start + 8]!;
      colorType = buffer[start + 9]!;
      interlace = buffer[start + 12]!;
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(start, start + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = start + length + 4; // + CRC
  }

  if (bitDepth !== 8) throw new Error(`只支援 8-bit PNG（拿到 ${bitDepth}）`);
  if (interlace !== 0) throw new Error('不支援 interlaced PNG');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels || colorType === 3) throw new Error(`不支援的 colorType ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);

  let p = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p]!;
    p += 1;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[p + i]!;
      const a = i >= channels ? line[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      let value: number;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a);
          const pb = Math.abs(pp - b);
          const pc = Math.abs(pp - c);
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知的 PNG filter ${filter}`);
      }
      line[i] = value & 0xff;
    }
    p += stride;

    for (let x = 0; x < width; x += 1) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      if (channels >= 3) {
        out[d] = line[s]!;
        out[d + 1] = line[s + 1]!;
        out[d + 2] = line[s + 2]!;
        out[d + 3] = channels === 4 ? line[s + 3]! : 255;
      } else {
        out[d] = out[d + 1] = out[d + 2] = line[s]!;
        out[d + 3] = channels === 2 ? line[s + 1]! : 255;
      }
    }
    prev.set(line);
  }

  return { width, height, data: out };
}

/* ── 編碼 ────────────────────────────────────────────────── */

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crcBuf]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePng(img: Raster): Buffer {
  const { width, height, data } = img;
  // filter 0（None）：檔案大一點，但省掉一輪 filter 選擇，拼接圖不在乎體積
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let i = 0; i < width * 4; i += 1) raw[rowStart + 1 + i] = data[y * width * 4 + i]!;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type = RGBA
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── 畫布小工具 ──────────────────────────────────────────── */

export function blank(width: number, height: number, rgb: [number, number, number]): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

export function blit(dst: Raster, src: Raster, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y += 1) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x += 1) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const d = (ty * dst.width + tx) * 4;
      dst.data[d] = src.data[s]!;
      dst.data[d + 1] = src.data[s + 1]!;
      dst.data[d + 2] = src.data[s + 2]!;
      dst.data[d + 3] = 255;
    }
  }
}

/* ── 5×7 點陣字（只有 ASCII，用來在拼接圖上寫標籤）────────── */

const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '11111', '10001', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '11100', '10010', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '01110', '00001', '00001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00010', '00100', '01000', '10000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00110', '00001', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
};

export function drawText(
  dst: Raster,
  text: string,
  x: number,
  y: number,
  rgb: [number, number, number],
  scale = 2,
): void {
  let cursor = x;
  for (const rawChar of text.toUpperCase()) {
    const glyph = FONT[rawChar] ?? FONT[' ']!;
    for (let gy = 0; gy < 7; gy += 1) {
      for (let gx = 0; gx < 5; gx += 1) {
        if (glyph[gy]![gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            const px = cursor + gx * scale + sx;
            const py = y + gy * scale + sy;
            if (px < 0 || py < 0 || px >= dst.width || py >= dst.height) continue;
            const d = (py * dst.width + px) * 4;
            dst.data[d] = rgb[0];
            dst.data[d + 1] = rgb[1];
            dst.data[d + 2] = rgb[2];
            dst.data[d + 3] = 255;
          }
        }
      }
    }
    cursor += 6 * scale;
  }
}

/* ── 差異量測 ────────────────────────────────────────────── */

export interface DiffStats {
  /** 兩邊重疊區域的平均通道絕對差（0–255） */
  meanAbs: number;
  /** 差異 > 24 的像素佔比（0–1） */
  diffRatio: number;
  /** 在 ±search 範圍內，讓 meanAbs 最小的位移（正值＝kennote 比 Notion 偏右/偏下） */
  bestShift: { dx: number; dy: number; meanAbs: number };
  /** 尺寸差 */
  sizeDelta: { dw: number; dh: number };
}

function meanAbsAt(a: Raster, b: Raster, dx: number, dy: number): number {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  let sum = 0;
  let count = 0;
  // 取樣步長：大圖不必逐像素比，2px 取樣對「肉眼一致」的判斷已經夠準
  const step = w * h > 400_000 ? 2 : 1;
  for (let y = 0; y < h; y += step) {
    const by = y + dy;
    if (by < 0 || by >= b.height) continue;
    for (let x = 0; x < w; x += step) {
      const bx = x + dx;
      if (bx < 0 || bx >= b.width) continue;
      const ai = (y * a.width + x) * 4;
      const bi = (by * b.width + bx) * 4;
      sum += Math.abs(a.data[ai]! - b.data[bi]!)
        + Math.abs(a.data[ai + 1]! - b.data[bi + 1]!)
        + Math.abs(a.data[ai + 2]! - b.data[bi + 2]!);
      count += 3;
    }
  }
  return count ? sum / count : 0;
}

export function diffStats(notion: Raster, kennote: Raster, search = 6): DiffStats {
  const meanAbs = meanAbsAt(notion, kennote, 0, 0);
  let best = { dx: 0, dy: 0, meanAbs };
  for (let dy = -search; dy <= search; dy += 1) {
    for (let dx = -search; dx <= search; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const m = meanAbsAt(notion, kennote, dx, dy);
      if (m < best.meanAbs) best = { dx, dy, meanAbs: m };
    }
  }

  const w = Math.min(notion.width, kennote.width);
  const h = Math.min(notion.height, kennote.height);
  let bad = 0;
  let total = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const ai = (y * notion.width + x) * 4;
      const bi = (y * kennote.width + x) * 4;
      const d = Math.max(
        Math.abs(notion.data[ai]! - kennote.data[bi]!),
        Math.abs(notion.data[ai + 1]! - kennote.data[bi + 1]!),
        Math.abs(notion.data[ai + 2]! - kennote.data[bi + 2]!),
      );
      if (d > 24) bad += 1;
      total += 1;
    }
  }

  return {
    meanAbs,
    diffRatio: total ? bad / total : 0,
    bestShift: best,
    sizeDelta: { dw: kennote.width - notion.width, dh: kennote.height - notion.height },
  };
}

/** 差異熱度圖：白＝一致，愈紅＝差異愈大 */
export function diffMap(notion: Raster, kennote: Raster): Raster {
  const width = Math.min(notion.width, kennote.width);
  const height = Math.min(notion.height, kennote.height);
  const out = blank(width, height, [255, 255, 255]);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ai = (y * notion.width + x) * 4;
      const bi = (y * kennote.width + x) * 4;
      const d = Math.max(
        Math.abs(notion.data[ai]! - kennote.data[bi]!),
        Math.abs(notion.data[ai + 1]! - kennote.data[bi + 1]!),
        Math.abs(notion.data[ai + 2]! - kennote.data[bi + 2]!),
      );
      const o = (y * width + x) * 4;
      out.data[o] = 255;
      out.data[o + 1] = 255 - d;
      out.data[o + 2] = 255 - d;
    }
  }
  return out;
}

/**
 * 三格拼接：左 Notion、中 kennote、右差異圖，上方有標籤帶。
 * 深色主題用深色底，才不會被白邊淹沒。
 */
export function composeCompare(
  notion: Raster,
  kennote: Raster,
  label: string,
  dark: boolean,
): Raster {
  const gap = 12;
  const band = 26;
  const pad = 12;
  const map = diffMap(notion, kennote);
  const panels = [notion, kennote, map];
  const width = pad * 2 + panels.reduce((s, p) => s + p.width, 0) + gap * 2;
  const height = pad * 2 + band + Math.max(...panels.map((p) => p.height));
  const bg: [number, number, number] = dark ? [24, 24, 24] : [238, 238, 236];
  const fg: [number, number, number] = dark ? [230, 230, 230] : [40, 40, 40];
  const canvas = blank(width, height, bg);

  drawText(canvas, label, pad, 6, fg, 2);

  let x = pad;
  const names = ['NOTION', 'KENNOTE', 'DIFF'];
  for (let i = 0; i < panels.length; i += 1) {
    drawText(canvas, names[i]!, x, band - 12, fg, 1);
    blit(canvas, panels[i]!, x, pad + band);
    x += panels[i]!.width + gap;
  }
  return canvas;
}
