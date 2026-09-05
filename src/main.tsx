import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { FloatingWindowView } from './components/FloatingWindowView';
import { applyAppearance, readStoredAppearance } from './utils/appearance';
import './index.css';

const isFloating = typeof window !== 'undefined' && window.location.hash === '#floating';

if (isFloating) {
  document.documentElement.classList.add('floating-mode');
  document.body.classList.add('floating-mode');
}

/**
 * 顏色與深淺要在第一次畫之前就掛到 <html>，否則選淺色的人每次開啟都會先閃一下深色。
 * 放在這裡而不是 App 裡面，是因為浮動視窗載的是同一支進入點卻不經過 App。
 * 之後在設定裡改，由 App 的 effect 負責同步。
 */
const bootAppearance = readStoredAppearance();
applyAppearance(bootAppearance.accent, bootAppearance.theme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isFloating ? <FloatingWindowView /> : <App />}
  </StrictMode>,
);
