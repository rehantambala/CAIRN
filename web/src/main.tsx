import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/pages.css';

/** Hold the first paint briefly for the typefaces, so text never swaps after it is visible. */
const fontsReady = typeof document !== 'undefined' && document.fonts
  ? Promise.race([
      Promise.all(['400 1em Inter', '500 1em Inter', '1em Bayon'].map((f) => document.fonts.load(f).catch(() => []))),
      new Promise((r) => setTimeout(r, 1200)),
    ])
  : Promise.resolve();

void fontsReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
  );
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
