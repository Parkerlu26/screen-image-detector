import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { FloatingWindowView } from './components/FloatingWindowView';
import './index.css';

const isFloating = typeof window !== 'undefined' && window.location.hash === '#floating';

if (isFloating) {
  document.documentElement.classList.add('floating-mode');
  document.body.classList.add('floating-mode');
  document.body.classList.remove('bg-slate-950');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isFloating ? <FloatingWindowView /> : <App />}
  </StrictMode>,
);
