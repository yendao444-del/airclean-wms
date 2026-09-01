import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installChunkRecovery } from './lib/chunkRecovery';

installChunkRecovery(import.meta.url);

// Web fonts are cosmetic; never let a slow/offline Google request delay the
// first Electron paint. Pages using Inter switch to it once the app is idle.
const loadOptionalWebFonts = () => {
    if (document.querySelector('link[data-dby-web-fonts]')) return;
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = 'https://fonts.gstatic.com';
    preconnect.crossOrigin = 'anonymous';
    preconnect.dataset.dbyWebFonts = 'true';

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap';
    stylesheet.dataset.dbyWebFonts = 'true';
    document.head.append(preconnect, stylesheet);
};

const requestIdle = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
}).requestIdleCallback;
if (requestIdle) {
    requestIdle(loadOptionalWebFonts, { timeout: 3000 });
} else {
    globalThis.setTimeout(loadOptionalWebFonts, 1000);
}

// Debug: in version ra console ngay khi app load
const _pkg = (window as any).electronAPI?.getAppVersion?.() ?? 'unknown';
(window as any).__DBYPOS_BUILD = '2026-04-08-v3';
console.log('[DBY] App loaded. Build=2026-04-08-v3 | electronAPI=', !!(window as any).electronAPI);

const app = <App />;
ReactDOM.createRoot(document.getElementById('root')!).render(
    import.meta.env.VITE_REACT_STRICT_MODE === 'true'
        ? <React.StrictMode>{app}</React.StrictMode>
        : app,
);
