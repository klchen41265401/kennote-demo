/**
 * 自寫的最小 ZIP reader / writer。
 * 驗收重點：自己寫的自己讀得回來，而且 store 與 deflate 兩種方式都對。
 */
import { describe, expect, it } from 'vitest';
import { createZip, crc32, ZipArchive, ZipError } from '../src/modules/export/zip.js';

function readAll(buf: Buffer): Map<string, Buffer> {
  const archive = ZipArchive.open(buf);
  const out = new Map<string, Buffer>();
  for (const entry of archive.entries()) {
    if (entry.isDirectory) continue;
    out.set(entry.name, archive.read(entry));
  }
  return out;
}

describe('crc32', () => {
  it('對上已知值', () => {
    expect(crc32(Buffer.from(''))).toBe(0);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.from('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('createZip / ZipArchive 往返', () => {
  it('deflate 的文字檔', () => {
    const text = 'Hello, kennote! '.repeat(200);
    const files = readAll(createZip([{ name: 'a.txt', data: text }]));
    expect(files.get('a.txt')!.toString('utf8')).toBe(text);
  });

  it('store 的二進位檔（不壓縮）', () => {
    const bin = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10, 0x20]);
    const files = readAll(createZip([{ name: 'img.png', data: bin, store: true }]));
    expect(files.get('img.png')!.equals(bin)).toBe(true);
  });

  it('副檔名是已壓縮格式時自動改用 store', () => {
    const zip = createZip([{ name: 'a.png', data: Buffer.alloc(64, 7) }]);
    const entry = ZipArchive.open(zip).entries()[0]!;
    expect(entry.method).toBe(0);
  });

  it('UTF-8 路徑與巢狀目錄', () => {
    const zip = createZip([
      { name: '專案筆記/會議紀錄.md', data: '# 會議紀錄\n' },
      { name: '專案筆記/files/截圖.png', data: Buffer.from([1, 2, 3]), store: true },
    ]);
    const files = readAll(zip);
    expect([...files.keys()]).toEqual(['專案筆記/會議紀錄.md', '專案筆記/files/截圖.png']);
    expect(files.get('專案筆記/會議紀錄.md')!.toString('utf8')).toBe('# 會議紀錄\n');
  });

  it('空檔案與空 zip', () => {
    const files = readAll(createZip([{ name: 'empty.txt', data: '' }]));
    expect(files.get('empty.txt')!.length).toBe(0);
    expect(ZipArchive.open(createZip([])).entries()).toEqual([]);
  });

  it('開頭的斜線會被正規化掉（防止解壓縮時跳出目錄）', () => {
    const entry = ZipArchive.open(createZip([{ name: '/etc/passwd', data: 'x' }])).entries()[0]!;
    expect(entry.name).toBe('etc/passwd');
  });

  it('大量項目', () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({ name: `f${i}.txt`, data: `#${i}` }));
    const files = readAll(createZip(entries));
    expect(files.size).toBe(300);
    expect(files.get('f299.txt')!.toString('utf8')).toBe('#299');
  });

  it('不是 zip 就丟 ZipError（而不是回垃圾）', () => {
    expect(() => ZipArchive.open(Buffer.from('not a zip at all'))).toThrow(ZipError);
  });

  it('readText 會吃掉 UTF-8 BOM（Notion 的 CSV 一定有）', () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('名稱,狀態\n')]);
    const archive = ZipArchive.open(createZip([{ name: 'a.csv', data: withBom }]));
    expect(archive.readText(archive.entries()[0]!)).toBe('名稱,狀態\n');
  });
});
