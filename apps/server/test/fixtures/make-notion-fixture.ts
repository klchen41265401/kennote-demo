/**
 * 產生一份「小型 Notion 官方匯出檔」當測試素材。
 *
 * 為什麼用程式產生而不是手動壓一個 zip：
 *   (1) 內容要跟測試斷言綁在一起，改測試時不用去記事本裡翻 zip；
 *   (2) 順便驗證我們自己的 ZIP writer 寫出來的東西，reader 讀得回來。
 *
 * 重新產生：
 *   pnpm --filter @kennote/server exec tsx test/fixtures/make-notion-fixture.ts
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip, type ZipEntryInput } from '../../src/modules/export/zip.js';

const ROOT = 'Export-4e9f2b1c-8a7d-4f3e-9c2b-1d5a6e8f0b3c';
const PAGE_ID = '1a2b3c4d5e6f78901234567890abcdef';
const CHILD_ID = '9f8e7d6c5b4a39281706f5e4d3c2b1a0';
const DB_ID = 'aabbccddeeff00112233445566778899';

/** 1×1 的透明 PNG（89 bytes），足以通過 magic number 驗證 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const ROOT_MD = `# 專案筆記

這是一段**粗體**與 \`程式碼\` 的介紹文字。

## 待辦

- [ ]  設定開發環境
- [x]  讀完規格書

## 子項目

[會議紀錄](%E5%B0%88%E6%A1%88%E7%AD%86%E8%A8%98%20${PAGE_ID}/%E6%9C%83%E8%AD%B0%E7%B4%80%E9%8C%84%20${CHILD_ID}.md)

[任務清單](%E5%B0%88%E6%A1%88%E7%AD%86%E8%A8%98%20${PAGE_ID}/%E4%BB%BB%E5%8B%99%E6%B8%85%E5%96%AE%20${DB_ID}.csv)

![截圖](%E5%B0%88%E6%A1%88%E7%AD%86%E8%A8%98%20${PAGE_ID}/screenshot.png)
`;

const CHILD_MD = `# 會議紀錄

> 2026-09-19 第一次同步

1. 確認搜尋要自研
2. 匯出格式先做 Markdown

\`\`\`sql
SELECT 1;
\`\`\`
`;

const DB_CSV = `名稱,狀態,負責人,截止日,完成,連結,預估工時
設計資料模型,進行中,Ken,2026-10-01,No,https://example.com/a,8
寫搜尋斷詞,未開始,Ken,2026-10-05,No,https://example.com/b,13
打包匯出,已完成,Amy,2026-09-20,Yes,https://example.com/c,5
`;

export function buildNotionFixture(): Buffer {
  const pageDir = `${ROOT}/專案筆記 ${PAGE_ID}`;
  const entries: ZipEntryInput[] = [
    { name: `${ROOT}/專案筆記 ${PAGE_ID}.md`, data: ROOT_MD },
    { name: `${pageDir}/會議紀錄 ${CHILD_ID}.md`, data: CHILD_MD },
    { name: `${pageDir}/任務清單 ${DB_ID}.csv`, data: DB_CSV },
    { name: `${pageDir}/任務清單 ${DB_ID}_all.csv`, data: DB_CSV },
    { name: `${pageDir}/screenshot.png`, data: PNG, store: true },
  ];
  return createZip(entries);
}

export const FIXTURE_IDS = { ROOT, PAGE_ID, CHILD_ID, DB_ID };

const isEntry =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntry) {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'notion-export.zip');
  writeFileSync(out, buildNotionFixture());
  console.log(`✅ 已產生 ${out}`);
}
