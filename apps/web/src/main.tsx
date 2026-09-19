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
// 不 await：先把殼畫出來，auth store 的 status='loading' 會擋住受保護路由
void bootstrapAuth();

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');

createRoot(root).render(
  <StrictMode>
    <OverlayRoot>
      <DndProvider>
        <App />
        <ToastRegion />
      </DndProvider>
    </OverlayRoot>
  </StrictMode>,
);
