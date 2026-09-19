import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme } from './lib/theme';
import { bootstrapAuth } from './stores/auth';
import './styles/global.css';

initTheme();
// 不 await：先把殼畫出來，auth store 的 status='loading' 會擋住受保護路由
void bootstrapAuth();

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
