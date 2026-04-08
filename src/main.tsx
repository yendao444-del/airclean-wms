import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Debug: in version ra console ngay khi app load
const _pkg = (window as any).electronAPI?.getAppVersion?.() ?? 'unknown';
(window as any).__DBYPOS_BUILD = '2026-04-08-v3';
console.log('[DBY] App loaded. Build=2026-04-08-v3 | electronAPI=', !!(window as any).electronAPI);

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
