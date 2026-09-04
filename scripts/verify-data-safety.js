const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const ipc = read('electron/ipc-handlers.js');
const normalizedIpc = ipc.replace(/\r\n/g, '\n');
const main = read('electron/main.js');
const preload = read('electron/preload.js');
const offlineQueue = read('electron/offline-queue.js');
const ecommerce = read('src/pages/EcommerceExport.tsx');
const stockBalance = read('src/pages/StockBalance.tsx');
const returnsPage = read('src/pages/Returns.tsx');
const refundsPage = read('src/pages/Refunds.tsx');
const handlingUnitsPage = read('src/pages/HandlingUnits.tsx');
const purchasePage = read('src/pages/Purchase.tsx');
const stockCheckPage = read('src/pages/StockCheck.tsx');
const posPage = read('src/pages/POS.tsx');
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
  requireText(allowedChannelsMatch[1], '"returns:bulkCreate",', 'Atomic return imports must remain available');
  requireText(allowedChannelsMatch[1], '"refunds:bulkCreate",', 'Atomic refund imports must remain available');
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
  requireText(allowedChannelsMatch[1], '"handlingUnits:updateUnit",', 'Guarded stock-check unit updates must remain available');
  requireText(allowedChannelsMatch[1], '"handlingUnits:finalizePick",', 'Guarded pending-unit finalization must remain available');
  for (const channel of [
    'handlingUnits:createUnits',
    'handlingUnits:issueQrLabels',
    'handlingUnits:markQrLabelsPrinted',
    'handlingUnits:markQrLabelsReceived',
    'handlingUnits:exportLabelsPdf',
    'purchases:create',
    'purchases:update',
    'purchases:repairMissingPrices',
    'purchases:uploadVATInvoice',
    'purchases:uploadImportReceipt',
    'purchases:uploadCompanyVATInvoice',
    'purchases:setCompanyVatStatus',
    'purchases:createVatGroup',
    'purchases:uploadVatGroupInvoice',
    'purchases:removeVatGroup',
    'purchases:markAsThht',
    'handlingUnits:quickReceive',
    'handlingUnits:sealUnit',
    'handlingUnits:pickUnit',
    'handlingUnits:requestFinalCheck',
    'handlingUnits:finalizeShiftCheck',
    'posOrder:create',
    'exportOrders:saveWithStock',
    'refunds:completeAndRestore',
    'returns:update',
    'refunds:update',
    'goodsCompanies:create',
    'goodsCompanies:update',
    'goodsCompanies:setProductCompany',
    'users:updateProfile',
    'dailyTasks:create',
    'ecommerceExports:update',
    'ecommerceExports:saveTelegramSettings',
    'ecommerceExports:nextTelegramOrderCounter',
    'offlineQueue:sync',
  ]) {
    requireText(allowedChannelsMatch[1], `"${channel}",`, `${channel} must remain available`);
  }
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
requireText(loginHandler, 'previousPasswordHash: consumedTemporaryPasswordHash', 'The temporary-password grant must remember the consumed hash');

const changePasswordStart = normalizedIpc.indexOf('ipcMain.handle(\n  "users:changePassword"');
const changePasswordEnd = normalizedIpc.indexOf('// Reset password', changePasswordStart);
const changePasswordHandler = changePasswordStart >= 0 && changePasswordEnd > changePasswordStart
  ? normalizedIpc.slice(changePasswordStart, changePasswordEnd)
  : '';
requireText(changePasswordHandler, 'hasValidTemporaryPasswordGrant(freshUser)', 'Password change must validate the one-time session grant');
requireText(changePasswordHandler, 'temporaryPasswordGrant.previousPasswordHash', 'Password change must reject reuse of the consumed temporary password');
requireText(changePasswordHandler, 'delete currentSession.temporaryPasswordGrant;', 'Password change must clear the one-time session grant');
requireText(ipc, 'canChangePasswordWithoutCurrent: hasValidTemporaryPasswordGrant(user)', 'Renderer must know when the current-password field may be skipped');

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

requireText(ipc, '\nstartTelegramWmsPolling();', 'Transactional Telegram WMS polling must remain enabled');
rejectText(ipc, 'Telegram WMS mutation polling is disabled', 'Telegram WMS polling is still disabled');
requireText(ipc, 'handling-unit-code:${normalizedCode}', 'Telegram handling-unit mutations must serialize by unit code');
requireText(ipc, 'lockHandlingConfigKeys(tx, [HANDLING_QR_LABELS_KEY])', 'QR registry updates must hold the shared registry lock');
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
requireText(ipc, 'runAtomicImportTransaction("returns:bulkCreate"', 'Return imports must use the atomic import transaction');
requireText(ipc, 'runAtomicImportTransaction("refunds:bulkCreate"', 'Refund imports must use the atomic import transaction');
requireText(ipc, 'pg_advisory_xact_lock(hashtext(${lockKey}))', 'Bulk imports must serialize across application instances');
requireText(ipc, 'Prisma.TransactionIsolationLevel.Serializable', 'Bulk imports must use serializable transactions');
requireText(ipc, 'const knownKeys = new Set(existing.map(returnImportKey));', 'Return imports must deduplicate against database records');
requireText(ipc, 'const knownKeys = new Set(existing.map(refundImportKey));', 'Refund imports must deduplicate against database records');
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
requireText(ipc, 'findCompletedPurchaseCreate(tx, idempotencyKey)', 'Purchase retries must recover the already-created receipt');
requireText(ipc, "pg_advisory_xact_lock(hashtext('handling-units-create'))", 'Handling-unit batch creation must be serialized');
requireText(handlingUnitsPage, 'handlingUnits?.quickReceive?.({', 'Quick QR receiving must use its atomic backend command');
rejectText(handlingUnitsPage.slice(handlingUnitsPage.indexOf('const confirmQuickReceiving = async'), handlingUnitsPage.indexOf('if (isWorkspaceLoading)')), 'purchases?.create({', 'Quick QR receiving must not create purchases in separate renderer requests');
requireText(ipc, 'handlingQuickReceiveOperation:', 'Quick QR receiving idempotency claim is missing');
requireText(ipc, 'ipcMain.handle("handlingUnits:quickReceive"', 'Atomic quick QR receiving handler is missing');
requireText(ipc, 'Công ty hàng hóa của SKU ${line.sku} đã thay đổi.', 'Quick receiving must validate company assignment against the database');
requireText(ipc, 'SKU ${line.sku} có giá, công ty hoặc đơn vị không đồng nhất', 'Quick receiving must reject inconsistent duplicate SKU lines');
requireText(ipc, 'line.location = normalizeHandlingLocation(label.location || {});', 'Quick receiving must use authoritative QR location data');
requireText(ipc, 'buildRendererHandlingOperationKey(', 'Handling-unit renderer idempotency keys are missing');
requireText(ipc, 'posOrderOperation:', 'POS durable idempotency claim is missing');
requireText(posPage, 'idempotencyKey: paymentOperationKeyRef.current', 'POS renderer must send a stable idempotency key');
requireText(handlingUnitsPage, 'if (!isPendingCheck && withdrawals.length === 0) return null;', 'End-of-shift count must include pending packages carried over from earlier days');
requireText(ipc, 'DATA_SAFETY_MUTABLE_CONFIG_KEYS', 'Narrow mutable AppConfig allowlist is missing');
requireText(preload, 'const appConfigWriteTails = new Map();', 'AppConfig writes must be serialized per key in preload');
requireText(preload, 'hasRevision ? appConfigRevisions.get(key) : undefined', 'AppConfig writes must include the last read revision');
requireText(preload, 'if (pendingWrite) await pendingWrite.catch(() => undefined);', 'AppConfig reads must not race a queued write');
rejectText(preload, 'write.finally(() => {', 'AppConfig cleanup must not create an unhandled rejected promise');
requireText(ipc, 'current.updatedAt.getTime() !== expectedRevision.getTime()', 'AppConfig writes must reject stale revisions');
requireText(ipc, 'ipcMain.handle("ecommerceExports:saveTelegramSettings"', 'Telegram settings must use a dedicated atomic handler');
requireText(ipc, 'ipcMain.handle("ecommerceExports:nextTelegramOrderCounter"', 'Telegram order numbering must use a dedicated atomic handler');
rejectText(ecommerce, "appConfig.set('activePacker'", 'Per-shift packer selection must not fail through shared AppConfig');
rejectText(ecommerce, "appConfig.set('telegramChatId'", 'Telegram credentials must not be saved through split AppConfig writes');
rejectText(ecommerce, "appConfig.set('telegramOrderCounter'", 'Telegram numbering must not use split AppConfig writes');
requireText(purchasePage, 'const importReceiptFiles = pendingImportFiles.length > 0', 'Purchase edits must include replacement receipts in the guarded update request');
requireText(ipc, 'updatedAt: true,\n          vatInvoiceStatus: true,', 'Purchase list must expose the revision required by guarded edits and uploads');
requireText(ipc, 'importReceiptDriveUrl: uploadedReceiptReferences.join("\\n")', 'Purchase update must commit replacement receipt references with the edited receipt');
requireText(purchasePage, 'expectedUpdatedAt: documentRevision', 'VAT upload after a purchase edit must send the latest row revision');
requireText(purchasePage, 'expectedUpdatedAt: existingPurchase?.updatedAt', 'Manual VAT upload must reject stale purchase rows');
requireText(ipc, 'Vui lòng tải lại phiếu nhập trước khi thay Phiếu Nhập Kho.', 'Receipt replacement must require an expected purchase revision');
requireText(ipc, 'Vui lòng tải lại phiếu nhập trước khi upload Hóa đơn VAT.', 'VAT replacement must require an expected purchase revision');
requireText(ipc, 'Vui lòng tải lại phiếu nhập trước khi upload HĐ VAT theo công ty.', 'Company VAT upload must require an expected purchase revision');
requireText(ipc, 'companyGroups, status, expectedUpdatedAt', 'Company VAT status changes must support one guarded bulk update');
requireText(purchasePage, 'companyGroups: companyNames', 'Bulk no-VAT actions must use one atomic backend request');
requireText(ipc, 'pg_advisory_xact_lock(hashtext(${PURCHASE_VAT_GROUPS_KEY}))', 'VAT group mutations must hold the shared configuration lock');
requireText(ipc, 'expectedGroupUpdatedAt', 'VAT group uploads must reject stale group state');
requireText(ipc, 'Không thể tách một nhóm đã có HĐ VAT', 'Uploaded VAT groups must not be detached destructively');
requireText(purchasePage, 'purchaseRevisions: Object.fromEntries(', 'VAT group creation must send purchase revisions');
requireText(purchasePage, 'expectedGroupUpdatedAt: effectiveGroupUpdatedAt', 'VAT group upload must send the current group revision');
requireText(purchasePage, 'purchase.updatedAt,', 'THHT and VAT group actions must send the current purchase revision');
rejectText(refundsPage, 'refunds.adjustStock(', 'Refund UI must not use the legacy split stock/status workflow');
requireText(handlingUnitsPage, 'note: "Rút hàng từ cửa sổ Telegram trong ứng dụng"', 'Telegram command simulation must persist picks through the guarded backend');
requireText(handlingUnitsPage, 'message: "Chọn nhà cung cấp trước khi tạo mã QR"', 'QR creation must require a supplier in the form');
requireText(ipc, 'SELECT id FROM "EcommerceExport" WHERE id = ${exportId} FOR UPDATE', 'Ecommerce updates must lock the row before applying stock changes');
requireText(ipc, 'Phiếu xuất TMĐT vừa được thay đổi ở máy khác.', 'Ecommerce updates must reject stale queued or renderer writes');
requireText(ipc, 'stockBalanceOperation:', 'Stock balance idempotency claim is missing');
const balanceItemStart = ipc.indexOf('ipcMain.handle("stockCheck:balanceItem"');
const balanceItemEnd = ipc.indexOf('ipcMain.handle("stockCheck:submitSession"', balanceItemStart);
const balanceItemHandler = balanceItemStart >= 0 && balanceItemEnd > balanceItemStart
  ? ipc.slice(balanceItemStart, balanceItemEnd)
  : '';
requireText(balanceItemHandler, 'normalizeStockCheckUnitAdjustments(', 'Package stock check must validate all unit adjustments');
requireText(balanceItemHandler, 'reconcileStockCheckHandlingUnits(', 'Package stock check must reconcile units inside balanceItem');
requireText(balanceItemHandler, 'getPrismaDirectTx().$transaction(', 'Package and SKU stock must share one database transaction');
requireText(balanceItemHandler, 'if (item.balanced) {', 'A completed SKU must be idempotently rejected before another balance');
requireText(ipc, 'FOR UPDATE`', 'Handling-unit reconciliation must lock package rows before validating stale counts');
requireText(ipc, 'SKU đã hoàn tất, không thể ghi đè số kiểm.', 'Late count saves must not reopen a balanced SKU');
const packageBalanceStart = stockCheckPage.indexOf('const handleCompletePackageSku = async');
const packageBalanceEnd = stockCheckPage.indexOf('const confirmCompletePackageSku', packageBalanceStart);
const packageBalanceHandler = packageBalanceStart >= 0 && packageBalanceEnd > packageBalanceStart
  ? stockCheckPage.slice(packageBalanceStart, packageBalanceEnd)
  : '';
requireText(packageBalanceHandler, 'stockCheck.balanceItem({', 'Package confirmation must use the atomic stock-check endpoint');
requireText(packageBalanceHandler, 'unitAdjustments:', 'Package confirmation must submit expected and actual unit counts together');
rejectText(packageBalanceHandler, 'handlingUnits.finalizePick(', 'Package confirmation must not finalize units in separate requests');
rejectText(packageBalanceHandler, 'handlingUnits.updateUnit(', 'Package confirmation must not update units in separate requests');
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
