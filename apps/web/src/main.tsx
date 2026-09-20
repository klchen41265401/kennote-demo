import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DndProvider, OverlayRoot, ToastRegion } from '@kennote/ui';
import { App } from './App';
import { initTheme } from './lib/theme';
import { bootstrapAuth } from './stores/auth';
import './styles/global.css';
// ⚠️ 一定要在 global.css（＝tokens.css）之後，元件層 token 才有東西可以衍生
import '@kennote/ui/styles.css';

initTheme();

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');

function render(): void {
  createRoot(root!).render(
    <StrictMode>
      <OverlayRoot>
        <DndProvider>
          <App />
          <ToastRegion />
        </DndProvider>
      </OverlayRoot>
    </StrictMode>,
  );
}

/**
 * Demo 模式（`VITE_DEMO=1`，GitHub Pages 用）：在**任何 fetch 之前**
 * 安裝純瀏覽器後端（攔 `/api/**` 與 `/ws`），之後整個 app 完全不需要伺服器。
 * 動態 import 讓正式建置不會把 demo 程式碼打進主 chunk。
 */
async function boot(): Promise<void> {
  if (import.meta.env.VITE_DEMO === '1') {
    const { installDemoBackend } = await import('./demo');
    installDemoBackend();
  }
  // 不 await：先把殼畫出來，auth store 的 status='loading' 會擋住受保護路由
  void bootstrapAuth();
  render();
}

void boot();
