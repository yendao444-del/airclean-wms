import handlingUnitsDemo from '../../Tai lieu/index.html?raw';
import './HandlingUnits.css';

// This module hosts the warehouse-unit workspace. Inventory and package
// mutations are performed through the dedicated Electron IPC bridge.
const appThemeOverrides = `
<style id="electron-app-theme">
  :root { --app-green: #00b96b; --app-green-dark: #009b5a; --app-blue: #1677ff; }
  html, body { background: #f6f8fb !important; }
  header.bg-\\[\\#1e283d\\], .bg-\\[\\#1e283d\\] { background-color: #ffffff !important; color: #182230 !important; border-color: #e4eaf0 !important; }
  header.bg-\\[\\#1e283d\\] h1, header.bg-\\[\\#1e283d\\] .text-white, .bg-\\[\\#1e283d\\] .text-white { color: #182230 !important; }
  .bg-\\[\\#1890ff\\], .hover\\:bg-\\[\\#0077ee\\]:hover { background-color: var(--app-green) !important; }
  .text-\\[\\#1890ff\\], .text-\\[\\#0059b3\\] { color: var(--app-green-dark) !important; }
  .border-l-\\[\\#1890ff\\], .border-\\[\\#1890ff\\] { border-color: var(--app-green) !important; }
  .bg-\\[\\#e6f7ff\\] { background-color: #ecfaf3 !important; }
  .border-\\[\\#bae7ff\\] { border-color: #bfe8d2 !important; }
  #btnCommitShift, #itemForm button[type=submit] { background-color: var(--app-green) !important; }
  /* These screens still depend on temporary in-page state. Keep them out of
     production until their transactions are connected to the warehouse DB. */
  #tabBtnReconciliation, #tabContentReconciliation,
  #tabBtnAudit, #tabContentAudit,
  .telegram-button { display: none !important; }
</style>`;

const demoDocument = handlingUnitsDemo.replace('</head>', `${appThemeOverrides}</head>`);

export default function HandlingUnits() {
  return <iframe className="handling-units-demo" title="Quản lý kiện hàng" srcDoc={demoDocument} />;
}
