/**
 * 手測頁的開發伺服器。
 *
 * 只用 Node 內建模組（http / fs / path / child_process）+ tsc，
 * 不引入 vite / esbuild —— editor-core 的紀律是「連 playground 都不需要打包器」。
 *
 *   pnpm --filter @kennote/editor-core playground
 *   → 編譯 src → dist（tsc，輸出原生 ESM），然後開 http://localhost:5174/playground/
 */
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT ?? 5174);
const watch = !process.argv.includes('--no-watch');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function tsc(args) {
  const isWin = process.platform === 'win32';
  return spawnSync(isWin ? 'npx.cmd' : 'npx', ['tsc', ...args], { cwd: root, stdio: 'inherit', shell: isWin });
}

console.log('[playground] 編譯 src → dist ...');
const built = tsc(['-p', 'tsconfig.build.json']);
if (built.status !== 0) {
  console.error('[playground] 編譯失敗，請先修好型別錯誤。');
  process.exit(built.status ?? 1);
}

if (watch) {
  const isWin = process.platform === 'win32';
  const child = spawn(isWin ? 'npx.cmd' : 'npx', ['tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
  });
  process.on('exit', () => child.kill());
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/playground/index.html';
  if (pathname.endsWith('/')) pathname += 'index.html';

  // 路徑穿越防護：一律夾在 package 目錄內
  const filePath = join(root, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`[playground] http://localhost:${port}/playground/`);
  console.log('[playground] 在這裡實測注音／拼音輸入法、貼上、undo。Ctrl+C 結束。');
});
