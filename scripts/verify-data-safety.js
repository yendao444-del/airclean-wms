const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const ipc = read('electron/ipc-handlers.js');
const normalizedIpc = ipc.replace(/\r\n/g, '\n');
const main = read('electron/main.js');
const offlineQueue = read('electron/offline-queue.js');
const ecommerce = read('src/pages/EcommerceExport.tsx');
const stockBalance = read('src/pages/StockBalance.tsx');
const returnsPage = read('src/pages/Returns.tsx');
const r2Lab = read('src/pages/R2StorageLab.tsx');
const r2TestWorker = read('cloudflare/r2-test-worker/src/index.ts');
const evidenceWorker = read('cloudflare/r2-daily-evidence-worker/src/index.ts');
const devLauncher = read('scripts/start-electron-dev.js');
const r2BootstrapScript = read('scripts/prepare-r2-daily-evidence-config.js');

const failures = [];
const requireText = (source, text, label) => {
  if (!source.includes(text)) failures.push(label);
};
const rejectText = (source, text, label) => {
  if (source.includes(text)) failures.push(label);
};

requireText(ipc, 'const DATA_SAFETY_MODE = true;', 'DATA_SAFETY_MODE must default to true');
requireText(ipc, 'path.join(__dirname, "r2-daily-evidence-bootstrap.json")', 'Daily evidence R2 must support bundled production bootstrap configuration');
requireText(r2BootstrapScript, 'DAILY_EVIDENCE_KEY', 'R2 bootstrap preparation must read the worker key');
requireText(r2BootstrapScript, 'legacyBootstrap.testKey', 'R2 bootstrap preparation must reuse the existing production-compatible device key');
requireText(r2BootstrapScript, 'development-only$/i.test(key)', 'R2 bootstrap preparation must reject the development-only key');
const allowedChannelsMatch = ipc.match(/const DATA_SAFETY_ALLOWED_CHANNELS = new Set\(\[([\s\S]*?)\n\]\);/);
if (!allowedChannelsMatch) {
  failures.push('Data-safety allowed-channel set is missing');
} else {
  requireText(allowedChannelsMatch[1], '"dailyTasks:createAssignments",', 'Atomic assignment creation must remain available');
  requireText(allowedChannelsMatch[1], '"dailyTasks:submitEvidence",', 'Compensated evidence submission must remain available');
  requireText(allowedChannelsMatch[1], '"dailyTasks:requestAssignmentCompletion",', 'Assignment completion requests must remain available');
  requireText(allowedChannelsMatch[1], '"dailyTasks:completeRegularTask",', 'Regular task completion must remain available');
  requireText(allowedChannelsMatch[1], '"dailyTasks:reviewEvidence",', 'Evidence review must remain available');
  requireText(allowedChannelsMatch[1], '"returns:updateWorkflow",', 'Narrow return workflow updates must remain available');
  requireText(allowedChannelsMatch[1], '"refunds:updateStatus",', 'Narrow refund status updates must remain available');
  for (const channel of [
    'dailyTasks:addNote',
    'dailyTasks:reopen',
    'dailyTasks:completeAssignment',
    'dailyTasks:saveCategories',
    'returns:updateWorkflowBulk',
    'returns:saveStatusList',
  ]) {
    requireText(allowedChannelsMatch[1], `"${channel}",`, `${channel} must remain available`);
  }
  requireText(allowedChannelsMatch[1], '"attendance:recognize",', 'Face attendance recognition must remain available');
  requireText(allowedChannelsMatch[1], '"update:check",', 'Official update checks must remain available');
  requireText(allowedChannelsMatch[1], '"update:download",', 'Verified official updates must remain installable');
  requireText(allowedChannelsMatch[1], '"update:restart",', 'The app must be able to restart after a verified update');
  requireText(allowedChannelsMatch[1], '"stockCheck:createFullSession",', 'Transactional full stock-check creation must remain available');
  requireText(allowedChannelsMatch[1], '"stockCheck:cancelSession",', 'Admin stock-check cancellation must remain available');
  for (const channel of [
    'stockCheck:ensureDailySession',
    'stockCheck:createRecheckSession',
    'stockCheck:updateCount',
    'stockCheck:retryCount',
    'stockCheck:updateNote',
    'stockCheck:balanceItems',
    'stockCheck:balanceItem',
    'stockCheck:submitSession',
  ]) {
    requireText(allowedChannelsMatch[1], `"${channel}",`, `${channel} must remain available`);
  }
}
const createFullSessionStart = ipc.indexOf('ipcMain.handle("stockCheck:createFullSession"');
const createFullSessionEnd = ipc.indexOf('"stockCheck:cancelSession"', createFullSessionStart);
const createFullSessionHandler = createFullSessionStart >= 0 && createFullSessionEnd > createFullSessionStart
  ? ipc.slice(createFullSessionStart, createFullSessionEnd)
  : '';
requireText(createFullSessionHandler, 'await lockStockCheckSessions(tx);', 'Full stock-check creation must hold the shared session lock');
requireText(createFullSessionHandler, 'await writeStockCheckSessions(nextSessions, tx);', 'Full stock-check creation must save inside its transaction');
rejectText(createFullSessionHandler, 'adminSaveSessions', 'Full stock-check creation must not use bulk session replacement');
rejectText(createFullSessionHandler, 'Chỉ quản trị viên được tạo phiên kiểm toàn bộ.', 'Full stock-check creation must remain available to every authenticated stock-check user');
const ensureDailySessionStart = ipc.indexOf('ipcMain.handle("stockCheck:ensureDailySession"');
const ensureDailySessionEnd = ipc.indexOf('ipcMain.handle("stockCheck:createFullSession"', ensureDailySessionStart);
const ensureDailySessionHandler = ensureDailySessionStart >= 0 && ensureDailySessionEnd > ensureDailySessionStart
  ? ipc.slice(ensureDailySessionStart, ensureDailySessionEnd)
  : '';
requireText(ensureDailySessionHandler, 'session?.type === "full"', 'Daily stock-check creation must stop when a full session exists');
requireText(ensureDailySessionHandler, 'Phiên kiểm hàng ngày đã được tạm dừng.', 'Daily stock-check creation must explain the full-session lock');
const cancelSessionStart = normalizedIpc.indexOf('ipcMain.handle(\n  "stockCheck:cancelSession"');
const cancelSessionEnd = normalizedIpc.indexOf('ipcMain.handle(\n  "stockCheck:createRecheckSession"', cancelSessionStart);
const cancelSessionHandler = cancelSessionStart >= 0 && cancelSessionEnd > cancelSessionStart
  ? normalizedIpc.slice(cancelSessionStart, cancelSessionEnd)
  : '';
requireText(cancelSessionHandler, 'requireRole("admin");', 'Stock-check cancellation must remain admin-only');
requireText(cancelSessionHandler, 'await lockStockCheckSessions(tx);', 'Stock-check cancellation must hold the shared session lock');
const submitEvidenceStart = ipc.indexOf('ipcMain.handle("dailyTasks:submitEvidence"');
const submitEvidenceEnd = ipc.indexOf('"dailyTasks:reviewEvidence"', submitEvidenceStart);
const submitEvidenceHandler = submitEvidenceStart >= 0 && submitEvidenceEnd > submitEvidenceStart
  ? ipc.slice(submitEvidenceStart, submitEvidenceEnd)
  : '';
requireText(submitEvidenceHandler, 'await prisma.$transaction(async (tx) => {', 'Evidence database writes must remain transactional');
requireText(submitEvidenceHandler, 'rollbackFreshDailyEvidenceUpload(objectKey)', 'Fresh evidence uploads must be rolled back on failure');
requireText(submitEvidenceHandler, 'updatedAt: task.updatedAt,', 'Evidence submission must reject stale task updates');

const loginStart = normalizedIpc.lastIndexOf('ipcMain.handle(\n  "users:login"');
const loginEnd = normalizedIpc.indexOf('ipcMain.handle("users:logout"', loginStart);
const loginHandler = loginStart >= 0 && loginEnd > loginStart
  ? normalizedIpc.slice(loginStart, loginEnd)
  : '';
requireText(loginHandler, 'if (isTemporaryPassword(user)) {', 'Temporary passwords must be consumed on successful login');
requireText(loginHandler, 'crypto.randomBytes(32)', 'Consumed temporary passwords must be replaced with an unknown value');
requireText(loginHandler, 'user-password:${user.id}', 'Temporary-password consumption must use the per-user transaction lock');
requireText(loginHandler, 'temporaryPasswordGrant', 'A consumed temporary password needs a session-bound change grant');

const changePasswordStart = normalizedIpc.indexOf('ipcMain.handle(\n  "users:changePassword"');
const changePasswordEnd = normalizedIpc.indexOf('// Reset password', changePasswordStart);
const changePasswordHandler = changePasswordStart >= 0 && changePasswordEnd > changePasswordStart
  ? normalizedIpc.slice(changePasswordStart, changePasswordEnd)
  : '';
requireText(changePasswordHandler, 'hasValidTemporaryPasswordGrant(freshUser)', 'Password change must validate the one-time session grant');
requireText(changePasswordHandler, 'delete currentSession.temporaryPasswordGrant;', 'Password change must clear the one-time session grant');

const mapMatch = ipc.match(/const DATA_SAFETY_BLOCKED_CHANNELS = new Map\(\[([\s\S]*?)\n\]\);/);
if (!mapMatch) {
  failures.push('Blocked IPC map is missing');
} else {
  const blockedMap = mapMatch[1];
  const requiredBlockedChannels = [
    'appConfig:set',
    'products:delete',
    'products:update',
    'products:updateStock',
    'categories:delete',
    'categories:update',
    'pickup:scan',
    'pickup:exportPickup',
    'posOrder:create',
    'posOrder:update',
    'posOrder:delete',
    'handlingUnits:saveRegister',
    'handlingUnits:deleteUnit',
    'handlingUnits:createUnits',
    'handlingUnits:createLocation',
    'handlingUnits:createPackagingSpec',
    'handlingUnits:issueQrLabels',
    'handlingUnits:markQrLabelsPrinted',
    'handlingUnits:markQrLabelsReceived',
    'handlingUnits:allocate',
    'handlingUnits:move',
    'handlingUnits:updateUnit',
    'handlingUnits:unsealUnit',
    'handlingUnits:sealUnit',
    'handlingUnits:pickUnit',
    'handlingUnits:requestFinalCheck',
    'handlingUnits:finalizePick',
    'handlingUnits:finalizeShiftCheck',
    'handlingUnits:exportLabelsPdf',
    'purchases:deleteCompanyVATInvoice',
    'purchases:update',
    'purchases:create',
    'purchases:delete',
    'purchases:repairMissingPrices',
    'purchases:createVatGroup',
    'purchases:uploadVatGroupInvoice',
    'purchases:uploadCompanyVATInvoice',
    'purchases:setCompanyVatStatus',
    'purchases:uploadVATInvoice',
    'purchases:uploadImportReceipt',
    'purchases:markAsThht',
    'purchases:deleteImportReceipt',
    'purchases:deleteVatInvoice',
    'purchases:removeVatGroup',
    'goodsCompanies:delete',
    'goodsCompanies:create',
    'goodsCompanies:update',
    'goodsCompanies:setProductCompany',
    'suppliers:delete',
    'suppliers:update',
    'suppliers:deactivate',
    'suppliers:reactivate',
    'supplierDebt:updateImportAmount',
    'supplierDebt:addLegacyImport',
    'supplierDebt:saveBankDetails',
    'supplierDebt:confirmPayment',
    'database:importAll',
    'database:exportAll',
    'system:restore',
    'system:browseAndRestore',
    'system:deleteBackup',
    'dailyTasks:uploadEvidenceImage',
    'dailyTasks:submitEvidence',
    'dailyTasks:reviewEvidence',
    'dailyTasks:completeRegularTask',
    'dailyTasks:create',
    'dailyTasks:createAssignments',
    'dailyTasks:requestAssignmentCompletion',
    'dailyTasks:update',
    'dailyTasks:updateStatus',
    'dailyTasks:delete',
    'dailyTasks:resetDaily',
    'combos:update',
    'carrierComplaints:saveConfig',
    'carrierComplaints:reconcile',
    'carrierComplaints:send',
    'ecommerceExports:create',
    'ecommerceExports:update',
    'ecommerceExports:bulkCancel',
    'ecommerceExports:delete',
    'ecommerceExports:bulkDelete',
    'ecommerceExports:deleteAll',
    'ecommerceExports:deleteCancelled',
    'ecommerceExports:bulkCreate',
    'marketplaceOrders:delete',
    'exportOrders:delete',
    'exportOrders:saveWithStock',
    'exportOrders:create',
    'exportOrders:update',
    'returns:delete',
    'returns:update',
    'returns:bulkCreate',
    'refunds:delete',
    'refunds:update',
    'refunds:bulkCreate',
    'refunds:completeAndRestore',
    'refunds:bulkDelete',
    'users:delete',
    'users:update',
    'users:updateProfile',
    'users:resetPassword',
    'users:forcePasswordChange',
    'users:ensureAdmin',
    'dailyExpenses:delete',
    'dailyExpenses:upsert',
    'einvoice:delete',
    'einvoice:bulkDelete',
    'einvoice:deleteAll',
    'einvoice:issueInvoices',
    'einvoice:bulkImport',
    'einvoice:adjustInvoice',
    'einvoice:exportExcel',
    'attendance:deleteProfile',
    'attendance:register',
    'attendance:recognize',
    'attendance:saveEmployeeProfile',
    'attendance:savePayslipPDF',
    'attendance:reconcileLateFines',
    'offlineQueue:sync',
    'stockBalance:adjustStock',
    'stockBalance:create',
    'stockCheck:balanceItems',
    'stockCheck:ensureDailySession',
    'stockCheck:createRecheckSession',
    'stockCheck:adminSaveSessions',
    'stockCheck:updateCount',
    'stockCheck:retryCount',
    'stockCheck:updateNote',
    'stockCheck:balanceItem',
    'stockCheck:submitSession',
    'inventory:manualAdjust',
    'inventoryLogs:create',
    'exportOrders:adjustStock',
    'refunds:adjustStock',
    'misa:saveConfig',
    'misa:downloadPDF',
    'update:check',
    'update:download',
    'update:restoreVersion',
    'update:restart',
  ];
  for (const channel of requiredBlockedChannels) {
    if (!blockedMap.includes(`["${channel}"`)) {
      failures.push(`Missing blocked channel: ${channel}`);
    }
  }
}

requireText(ipc, 'if (!DATA_SAFETY_MODE) {\n  startTelegramWmsPolling();', 'Telegram mutation polling must be disabled');
requireText(ipc, 'Skipped automatic log/export cleanup', 'Automatic log cleanup guard is missing');
requireText(ipc, 'Skipped automatic evidence deletion', 'Automatic evidence cleanup guard is missing');
requireText(ipc, 'Skipped automatic runtime index migration', 'Automatic runtime index migration guard is missing');
requireText(ipc, 'companyVatAliasesChanged && !DATA_SAFETY_MODE', 'Purchase read path still persists VAT aliases');
requireText(ipc, 'Displayed recoverable VAT status', 'Purchase read path safety-only VAT recovery is missing');
requireText(ipc, 'Copied legacy Google token to safeStorage and preserved the source file', 'Legacy token source preservation is missing');
requireText(ipc, 'missingWithdrawalCodes.length > 0 && !DATA_SAFETY_MODE', 'Handling-unit read path still backfills shared markers');
requireText(ipc, 'ipcMain.handle("stockBalance:apply"', 'Atomic stock balance handler is missing');
requireText(ipc, 'ipcMain.handle("returns:updateWorkflow"', 'Narrow return workflow handler is missing');
requireText(ipc, 'ipcMain.handle("refunds:updateStatus"', 'Narrow refund status handler is missing');
requireText(ipc, 'async function writeDailyTaskHistory(tx, entry)', 'Serialized daily-task history writer is missing');
requireText(ipc, "pg_advisory_xact_lock(hashtext('dailyTasksHistory'))", 'Daily-task history writes must be serialized');
requireText(ipc, 'ipcMain.handle("dailyTasks:addNote"', 'Append-only daily-task note handler is missing');
requireText(ipc, 'ipcMain.handle("dailyTasks:reopen"', 'Transactional daily-task reopen handler is missing');
requireText(ipc, 'ipcMain.handle("dailyTasks:completeAssignment"', 'Transactional assignment completion handler is missing');
requireText(ipc, 'ipcMain.handle("returns:updateWorkflowBulk"', 'Atomic bulk return workflow handler is missing');
requireText(ipc, "pg_advisory_xact_lock(hashtext('attendanceData'))", 'Return fine reconciliation must hold the attendance lock');
requireText(ipc, 'Number.isSafeInteger(linkedReturnId)', 'Return fines must prefer an exact returnId link');
rejectText(returnsPage, "appConfig.set('attendanceData'", 'Returns renderer must not overwrite the attendance ledger');
requireText(ipc, 'Assignment đã được thay đổi trên máy khác.', 'Assignment completion must reject stale writes');
requireText(ipc, 'Công việc đã được thay đổi trên máy khác. Vui lòng tải lại và thử lại.', 'Task completion/review must reject stale writes');
requireText(ipc, 'purchaseCreateOperation:', 'Purchase create idempotency claim is missing');
requireText(ipc, 'stockBalanceOperation:', 'Stock balance idempotency claim is missing');
requireText(ipc, 'getMisaIntegrationBaseUrl(config)', 'MISA environment routing is missing');
requireText(main, 'app.requestSingleInstanceLock()', 'Single-instance lock is missing');
requireText(offlineQueue, 'Recovered complete temp item', 'Offline temp recovery is missing');
rejectText(
  offlineQueue.slice(0, offlineQueue.indexOf('function enqueue')),
  'unlinkSync',
  'Offline queue startup still deletes temp files',
);
rejectText(ecommerce, "console.log('Purged ' + cancelledIds.length", 'Ecommerce load still auto-deletes cancelled records');
rejectText(stockBalance, 'stockBalance.adjustStock(', 'Stock balance renderer still uses split stock mutation');
rejectText(stockBalance, 'stockBalance.create(', 'Stock balance renderer still writes history separately');
requireText(r2Lab, 'const DATA_SAFETY_MODE = true;', 'R2 lab safety mode is not enabled');
requireText(r2Lab, 'disabled={DATA_SAFETY_MODE || Boolean(deletingKeys[item.key])}', 'R2 lab delete button is not disabled');
requireText(r2TestWorker, 'Deletion is disabled by data-safety mode', 'R2 test worker still permits deletion');
requireText(evidenceWorker, 'Deletion is disabled by data-safety mode', 'Evidence worker still permits deletion');
requireText(devLauncher, 'acquireLauncherLock', 'Development launcher duplicate lock is missing');
requireText(devLauncher, 'Skipped Electron cache quarantine', 'Development launcher must not move app cache in safety mode');
rejectText(devLauncher, 'fs.rm(', 'Development launcher still deletes quarantined Electron cache');

if (failures.length > 0) {
  console.error('Data-safety verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Data-safety static verification passed.');
