import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5180,
    open: true,
    fs: {
      // playground 直接吃 apps/web 的 tokens.css，維持單一真實來源。
      allow: [repoRoot],
    },
  },
});
