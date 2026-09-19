import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 單一真實來源：直接引用 apps/web 的設計 token（只讀，不改）。
import '../../../apps/web/src/styles/tokens.css';
import '../src/styles/ui.css';
import './playground.css';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
