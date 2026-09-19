import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * 前端一律走**同源** /api 與 /ws：
 * - 開發：由下面的 proxy 轉到後端
 * - 正式：由 nginx 反向代理（apps/web/nginx.conf）
 * 因此 VITE_API_BASE_URL 預設是空字串，不必為了 cookie 去設定跨網域。
 *
 * `VITE_PROXY_TARGET` 可以把 dev server 的 /api 與 /ws 指到**遠端**後端，
 * 方便拿本機前端（含 HMR）跑 e2e 截圖比對：
 *   VITE_PROXY_TARGET=http://100.74.148.92:8090 pnpm --filter @kennote/web dev
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env['VITE_PROXY_TARGET'] || 'http://localhost:4000';
  const wsTarget = target.replace(/^http/, 'ws');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/ws': { target: wsTarget, ws: true },
      },
    },
    // `vite preview` 也要能代理 —— e2e 打「正式 build + 遠端 API」時用得到，
    // 而且那條路徑不會被其他代理進行中的原始碼編輯影響。
    preview: {
      port: 4173,
      host: true,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/ws': { target: wsTarget, ws: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
