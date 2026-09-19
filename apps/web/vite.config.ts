import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * 前端一律走**同源** /api 與 /ws：
 * - 開發：由下面的 proxy 轉到 localhost:4000
 * - 正式：由 nginx 反向代理（apps/web/nginx.conf）
 * 因此 VITE_API_BASE_URL 預設是空字串，不必為了 cookie 去設定跨網域。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
