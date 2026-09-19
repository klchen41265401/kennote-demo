/**
 * 用 esbuild 打包成單檔 ESM。
 * workspace 內的 @kennote/* 直接從 TS 原始碼打包進來（它們沒有 dist），
 * node_modules 的相依一律 external（Docker 映像內會有 node_modules）。
 */
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@kennote/'));

await build({
  entryPoints: ['src/index.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  external,
  banner: {
    // 少數相依（pg / pino）在 ESM bundle 內會用到 require
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
