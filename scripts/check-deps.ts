/**
 * ⭐ 把「自研紀律」變成可執行的檢查（04 §7.5 / 00-README 決策 #11）。
 *
 * 半夜趕工時想 `pnpm i @tanstack/react-table` 的那個你，會被 CI 攔下來。
 *
 * 三項檢查：
 *   1. 全專案不得出現黑名單套件
 *   2. packages/editor-core 的 dependencies 必須是 {}（零 runtime 依賴）
 *   3. apps/web 的 runtime dependencies 不得超過 8 個
 *
 * 用法：pnpm deps:check
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 前綴比對；結尾是 '/' 或 '-' 代表整個 scope / 家族 */
const BLOCKLIST = [
  // 編輯器
  'prosemirror-',
  '@tiptap/',
  'slate',
  'slate-react',
  'lexical',
  '@lexical/',
  'quill',
  '@blocknote/',
  'draft-js',
  // 協作 / CRDT
  'yjs',
  'y-',
  'automerge',
  '@automerge/',
  'sharedb',
  '@liveblocks/',
  'socket.io',
  'socket.io-client',
  // 表格 / 虛擬捲動
  '@tanstack/react-table',
  '@tanstack/react-virtual',
  '@tanstack/virtual-core',
  'react-window',
  'react-virtualized',
  'ag-grid',
  'ag-grid-react',
  // 拖放
  '@dnd-kit/',
  'react-beautiful-dnd',
  '@hello-pangea/dnd',
  'sortablejs',
  'react-dnd',
  // UI 元件庫 / 定位
  '@radix-ui/',
  '@mui/',
  'antd',
  '@chakra-ui/',
  '@headlessui/',
  '@floating-ui/',
  'popper.js',
  '@popperjs/',
  'bootstrap',
  'lucide-react',
  'react-icons',
  // 狀態管理 / 資料抓取
  'zustand',
  'redux',
  '@reduxjs/',
  'mobx',
  'recoil',
  'jotai',
  '@tanstack/react-query',
  'swr',
  // 其他自研範圍
  'date-fns',
  'moment',
  'dayjs',
  'lodash',
  'tailwindcss',
  'prisma',
  '@prisma/client',
  'typeorm',
  'sequelize',
  'drizzle-orm',
  'mongoose',
  'passport',
  'lucia',
  'meilisearch',
  '@elastic/elasticsearch',
  'typesense',
];

/** 例外：這些是 devDependency 才允許（工具鏈用，不會進 bundle） */
const DEV_ONLY_ALLOWED = new Set<string>([]);

const WEB_MAX_RUNTIME_DEPS = 8;

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface Problem {
  file: string;
  message: string;
}

const problems: Problem[] = [];
const warnings: string[] = [];

function readPkg(file: string): PackageJson | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PackageJson;
  } catch (err) {
    problems.push({ file, message: `無法解析 package.json：${(err as Error).message}` });
    return null;
  }
}

function isBlocked(name: string): string | null {
  for (const entry of BLOCKLIST) {
    if (entry.endsWith('/') || entry.endsWith('-')) {
      if (name.startsWith(entry)) return entry;
    } else if (name === entry) {
      return entry;
    }
  }
  return null;
}

/** 收集所有 workspace package 的 package.json 路徑 */
function collectPackageFiles(): string[] {
  const files = [path.join(ROOT, 'package.json')];
  for (const dir of ['apps', 'packages']) {
    const base = path.join(ROOT, dir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(base, entry.name, 'package.json');
      if (existsSync(file)) files.push(file);
    }
  }
  const e2e = path.join(ROOT, 'e2e', 'package.json');
  if (existsSync(e2e)) files.push(e2e);
  return files;
}

/* ── 檢查 1：黑名單 ─────────────────────────────────────── */
for (const file of collectPackageFiles()) {
  const pkg = readPkg(file);
  if (!pkg) continue;
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const sections: Array<[string, Record<string, string> | undefined]> = [
    ['dependencies', pkg.dependencies],
    ['devDependencies', pkg.devDependencies],
    ['peerDependencies', pkg.peerDependencies],
  ];
  for (const [section, deps] of sections) {
    for (const name of Object.keys(deps ?? {})) {
      const hit = isBlocked(name);
      if (!hit) continue;
      if (section === 'devDependencies' && DEV_ONLY_ALLOWED.has(name)) continue;
      problems.push({
        file: rel,
        message: `${section} 含黑名單套件「${name}」（規則：${hit}）——這個功能屬於自研範圍，見 04 §1.2`,
      });
    }
  }
}

/* ── 檢查 2：editor-core 必須零 runtime 依賴 ─────────────── */
const editorCorePkgPath = path.join(ROOT, 'packages', 'editor-core', 'package.json');
if (!existsSync(editorCorePkgPath)) {
  warnings.push(
    'packages/editor-core 還不存在，略過「dependencies 必須是 {}」檢查（該套件由編輯器代理建立）',
  );
} else {
  const pkg = readPkg(editorCorePkgPath);
  const deps = Object.keys(pkg?.dependencies ?? {});
  if (deps.length > 0) {
    problems.push({
      file: 'packages/editor-core/package.json',
      message:
        `dependencies 必須是 {}，目前有 ${deps.length} 個：${deps.join(', ')}。\n` +
        '      這行紀律是 editor-core「零依賴、框架無關」的可執行約束（04 §7.1）',
    });
  }
}

/* ── 檢查 3：apps/web 的 runtime 依賴數量上限 ─────────────── */
const webPkg = readPkg(path.join(ROOT, 'apps', 'web', 'package.json'));
if (webPkg) {
  const deps = Object.keys(webPkg.dependencies ?? {});
  if (deps.length > WEB_MAX_RUNTIME_DEPS) {
    problems.push({
      file: 'apps/web/package.json',
      message:
        `runtime dependencies 有 ${deps.length} 個，上限是 ${WEB_MAX_RUNTIME_DEPS}：${deps.join(', ')}。\n` +
        '      依賴數量是「自研程度」的健康指標，數字上升就是警訊（04 §9.6）',
    });
  } else {
    console.log(`  ✔ apps/web runtime 依賴 ${deps.length}/${WEB_MAX_RUNTIME_DEPS}：${deps.join(', ')}`);
  }
}

/* ── 結果 ──────────────────────────────────────────────── */
for (const w of warnings) console.warn(`  ⚠ ${w}`);

if (problems.length > 0) {
  console.error('\n❌ 自研紀律檢查未通過：\n');
  for (const p of problems) console.error(`  • ${p.file}\n      ${p.message}\n`);
  console.error(
    '若這個套件真的該引入，請先在 docs/adr/ 寫一篇決策紀錄，再把它從 scripts/check-deps.ts 的黑名單移除。\n',
  );
  process.exit(1);
}

console.log('✅ 自研紀律檢查通過（黑名單、editor-core 零依賴、web 依賴數量）');
