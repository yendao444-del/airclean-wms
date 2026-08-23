const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Products
    products: {
        getAll: () => ipcRenderer.invoke('products:getAll'),
        getForAdmin: () => ipcRenderer.invoke('products:getForAdmin'),
        getCatalogForPurchase: () => ipcRenderer.invoke('products:getCatalogForPurchase'),
        getCatalogForSale: () => ipcRenderer.invoke('products:getCatalogForSale'),
        getForStockAlerts: () => ipcRenderer.invoke('products:getForStockAlerts'),
        getInventoryCatalog: () => ipcRenderer.invoke('products:getInventoryCatalog'),
        getById: (id) => ipcRenderer.invoke('products:getById', id),
        getBySkus: (skus) => ipcRenderer.invoke('products:getBySkus', skus),
        create: (data) => ipcRenderer.invoke('products:create', data),
        update: (id, data) => ipcRenderer.invoke('products:update', id, data),
        delete: (id) => ipcRenderer.invoke('products:delete', id),
        getTopSelling: (args) => ipcRenderer.invoke('products:getTopSelling', args),
        getStockCheckActivity: () => ipcRenderer.invoke('products:getStockCheckActivity'),
        onStockChanged: (callback) => {
            const handler = (event, data) => callback(data);
            ipcRenderer.on('products:stockChanged', handler);
            return () => ipcRenderer.removeListener('products:stockChanged', handler);
        },
    },

    // Categories
    categories: {
        getAll: () => ipcRenderer.invoke('categories:getAll'),
        create: (data) => ipcRenderer.invoke('categories:create', data),
        update: (id, data) => ipcRenderer.invoke('categories:update', id, data),
        delete: (id) => ipcRenderer.invoke('categories:delete', id),
    },


    // Activity Log
    activityLog: {
        getAll: (filters) => ipcRenderer.invoke('activityLog:getAll', filters),
        create: (data) => ipcRenderer.invoke('activityLog:create', data),
        getByRecord: (params) => ipcRenderer.invoke('activityLog:getByRecord', params),
        getStats: () => ipcRenderer.invoke('activityLog:getStats'),
    },
    dashboard: {
        getSummary: (filters) => ipcRenderer.invoke('dashboard:getSummary', filters),
    },
    purchases: {
        getAll: (filters) => ipcRenderer.invoke('purchases:getAll', filters),
        getVatAlertSummary: () => ipcRenderer.invoke('purchases:getVatAlertSummary'),
        getMyVatPenaltyAlerts: () => ipcRenderer.invoke('purchases:getMyVatPenaltyAlerts'),
        create: (data) => ipcRenderer.invoke('purchases:create', data),
        update: (id, data) => ipcRenderer.invoke('purchases:update', { id, data }),
        repairMissingPrices: (purchaseId) => ipcRenderer.invoke('purchases:repairMissingPrices', purchaseId),
        delete: (id) => ipcRenderer.invoke('purchases:delete', id),
        uploadVATInvoice: (data) => ipcRenderer.invoke('purchases:uploadVATInvoice', data),
        uploadCompanyVATInvoice: (data) => ipcRenderer.invoke('purchases:uploadCompanyVATInvoice', data),
        setCompanyVatStatus: (data) => ipcRenderer.invoke('purchases:setCompanyVatStatus', data),
        deleteCompanyVATInvoice: (data) => ipcRenderer.invoke('purchases:deleteCompanyVATInvoice', data),
        uploadVatGroupInvoice: (data) => ipcRenderer.invoke('purchases:uploadVatGroupInvoice', data),
        uploadImportReceipt: (data) => ipcRenderer.invoke('purchases:uploadImportReceipt', data),
        deleteImportReceipt: (id) => ipcRenderer.invoke('purchases:deleteImportReceipt', id),
        deleteVatInvoice: (id) => ipcRenderer.invoke('purchases:deleteVatInvoice', id),
        createVatGroup: (data) => ipcRenderer.invoke('purchases:createVatGroup', data),
        removeVatGroup: (data) => ipcRenderer.invoke('purchases:removeVatGroup', data),
        markAsThht: (purchaseId, revert) => ipcRenderer.invoke('purchases:markAsThht', { purchaseId, revert }),
        getVATFileData: (purchaseId) => ipcRenderer.invoke('purchases:getVATFileData', { purchaseId }),
        getImportReceiptFileData: (purchaseId) => ipcRenderer.invoke('purchases:getImportReceiptFileData', { purchaseId }),
        getImportReceiptPreviewData: (purchaseId) => ipcRenderer.invoke('purchases:getImportReceiptPreviewData', { purchaseId }),
    },
    handlingUnits: {
        getWorkspace: () => ipcRenderer.invoke('handlingUnits:getWorkspace'),
        createUnits: (records) => ipcRenderer.invoke('handlingUnits:createUnits', records),
        issueQrLabels: (data) => ipcRenderer.invoke('handlingUnits:issueQrLabels', data),
        resolveQrLabel: (code) => ipcRenderer.invoke('handlingUnits:resolveQrLabel', code),
        markQrLabelsPrinted: (codes) => ipcRenderer.invoke('handlingUnits:markQrLabelsPrinted', codes),
        markQrLabelsReceived: (codes) => ipcRenderer.invoke('handlingUnits:markQrLabelsReceived', codes),
        saveRegister: (records) => ipcRenderer.invoke('handlingUnits:saveRegister', records),
        unsealUnit: (data) => ipcRenderer.invoke('handlingUnits:unsealUnit', data),
        sealUnit: (data) => ipcRenderer.invoke('handlingUnits:sealUnit', data),
        pickUnit: (data) => ipcRenderer.invoke('handlingUnits:pickUnit', data),
        requestFinalCheck: (data) => ipcRenderer.invoke('handlingUnits:requestFinalCheck', data),
        finalizePick: (data) => ipcRenderer.invoke('handlingUnits:finalizePick', data),
        finalizeShiftCheck: (data) => ipcRenderer.invoke('handlingUnits:finalizeShiftCheck', data),
        moveUnit: (data) => ipcRenderer.invoke('handlingUnits:move', data),
        updateUnit: (data) => ipcRenderer.invoke('handlingUnits:updateUnit', data),
        deleteUnit: (data) => ipcRenderer.invoke('handlingUnits:deleteUnit', data),
        getTelegramStatus: () => ipcRenderer.invoke('handlingUnits:getTelegramStatus'),
        sendTelegramTest: (data) => ipcRenderer.invoke('handlingUnits:sendTelegramTest', data),
        onChanged: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('handlingUnits:changed', handler);
            return () => ipcRenderer.removeListener('handlingUnits:changed', handler);
        },
    },
    suppliers: {
        getAll: () => ipcRenderer.invoke('suppliers:getAll'),
        create: (data) => ipcRenderer.invoke('suppliers:create', data),
        update: (id, data) => ipcRenderer.invoke('suppliers:update', id, data),
        delete: (id) => ipcRenderer.invoke('suppliers:delete', id),
        deactivate: (id) => ipcRenderer.invoke('suppliers:deactivate', id),
        reactivate: (id) => ipcRenderer.invoke('suppliers:reactivate', id),
    },
    goodsCompanies: {
        getAll: () => ipcRenderer.invoke('goodsCompanies:getAll'),
        create: (data) => ipcRenderer.invoke('goodsCompanies:create', data),
        update: (id, data) => ipcRenderer.invoke('goodsCompanies:update', id, data),
        delete: (id) => ipcRenderer.invoke('goodsCompanies:delete', id),
        setProductCompany: (data) => ipcRenderer.invoke('goodsCompanies:setProductCompany', data),
    },
    supplierDebt: {
        getWorkbench: (supplierId) => ipcRenderer.invoke('supplierDebt:getWorkbench', { supplierId }),
        getLegacyQrs: () => ipcRenderer.invoke('supplierDebt:getLegacyQrs'),
        saveBankDetails: (data) => ipcRenderer.invoke('supplierDebt:saveBankDetails', data),
        confirmPayment: (data) => ipcRenderer.invoke('supplierDebt:confirmPayment', data),
        updateImportAmount: (data) => ipcRenderer.invoke('supplierDebt:updateImportAmount', data),
        addLegacyImport: (data) => ipcRenderer.invoke('supplierDebt:addLegacyImport', data),
    },

    // Database Export/Import
    database: {
        exportAll: () => ipcRenderer.invoke('database:exportAll'),
        importAll: () => ipcRenderer.invoke('database:importAll'),
    },

    // System Backup/Restore
    system: {
        getInfo: () => ipcRenderer.invoke('system:getInfo'),
        backup: () => ipcRenderer.invoke('system:backup'),
        listBackups: () => ipcRenderer.invoke('system:listBackups'),
        restore: (backupPath) => ipcRenderer.invoke('system:restore', backupPath),
        browseAndRestore: () => ipcRenderer.invoke('system:browseAndRestore'),
        inspectBackup: (backupPath) => ipcRenderer.invoke('system:inspectBackup', backupPath),
        deleteBackup: (backupPath) => ipcRenderer.invoke('system:deleteBackup', backupPath),
    },

    // Combo Products
    combos: {
        getAll: () => ipcRenderer.invoke('combos:getAll'),
        create: (data) => ipcRenderer.invoke('combos:create', data),
        update: (id, data) => ipcRenderer.invoke('combos:update', id, data),
        delete: (id) => ipcRenderer.invoke('combos:delete', id),
    },

    // Daily Tasks
    dailyTasks: {
        list: (filters) => ipcRenderer.invoke('dailyTasks:list', filters),
        create: (taskData) => ipcRenderer.invoke('dailyTasks:create', taskData),
        createAssignments: (taskData, assignees) => ipcRenderer.invoke('dailyTasks:createAssignments', taskData, assignees),
        update: (id, updates) => ipcRenderer.invoke('dailyTasks:update', id, updates),
        updateStatus: (id, status) => ipcRenderer.invoke('dailyTasks:updateStatus', id, status),
        uploadEvidenceImage: (payload) => ipcRenderer.invoke('dailyTasks:uploadEvidenceImage', payload),
        submitEvidence: (payload) => ipcRenderer.invoke('dailyTasks:submitEvidence', payload),
        reviewEvidence: (taskId, approved) => ipcRenderer.invoke('dailyTasks:reviewEvidence', taskId, approved),
        requestAssignmentCompletion: (taskId) => ipcRenderer.invoke('dailyTasks:requestAssignmentCompletion', taskId),
        completeRegularTask: (taskId, payload) => ipcRenderer.invoke('dailyTasks:completeRegularTask', taskId, payload),
        getEvidenceImageUrl: (taskId, storagePath) => ipcRenderer.invoke('dailyTasks:getEvidenceImageUrl', taskId, storagePath),
        getDriveEvidenceImageUrl: (taskId, driveUrl, mimeType) => ipcRenderer.invoke('dailyTasks:getDriveEvidenceImageUrl', taskId, driveUrl, mimeType),
        getDriveEvidenceImageUrls: (taskId, images, requestId) => ipcRenderer.invoke('dailyTasks:getDriveEvidenceImageUrls', taskId, images, requestId),
        onDriveEvidenceImageLoaded: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('dailyTasks:driveEvidenceImageLoaded', handler);
            return () => ipcRenderer.removeListener('dailyTasks:driveEvidenceImageLoaded', handler);
        },
        listEvidencePenalties: (options) => ipcRenderer.invoke('dailyTasks:listEvidencePenalties', options),
        delete: (id) => ipcRenderer.invoke('dailyTasks:delete', id),
        getStats: (filters) => ipcRenderer.invoke('dailyTasks:stats', filters),
        resetDaily: () => ipcRenderer.invoke('dailyTasks:resetDaily'),
    },

    // Ecommerce Export (XUẤT HÀNG TMDT)
    ecommerceExports: {
        getAll: (args) => ipcRenderer.invoke('ecommerceExports:getAll', args),
        create: (data) => ipcRenderer.invoke('ecommerceExports:create', data),
        update: (id, data) => ipcRenderer.invoke('ecommerceExports:update', id, data),
        delete: (id) => ipcRenderer.invoke('ecommerceExports:delete', id),
        bulkDelete: (ids) => ipcRenderer.invoke('ecommerceExports:bulkDelete', ids),
        deleteAll: () => ipcRenderer.invoke('ecommerceExports:deleteAll'),
        deleteCancelled: () => ipcRenderer.invoke('ecommerceExports:deleteCancelled'),
        getCompletedKeys: () => ipcRenderer.invoke('ecommerceExports:getCompletedKeys'),
        checkExistingKeys: (data) => ipcRenderer.invoke('ecommerceExports:checkExistingKeys', data),
        getPackersByOrderNumbers: (orderNumbers) => ipcRenderer.invoke('ecommerceExports:getPackersByOrderNumbers', orderNumbers),
        bulkCreate: (records) => ipcRenderer.invoke('ecommerceExports:bulkCreate', records),
        bulkCancel: (ids) => ipcRenderer.invoke('ecommerceExports:bulkCancel', ids),
        selectFolder: () => ipcRenderer.invoke('ecommerceExport:selectFolder'),
        loadExcelFiles: (folderPath) => ipcRenderer.invoke('ecommerceExport:loadExcelFiles', folderPath),
        selectAndWatch: () => ipcRenderer.invoke('ecommerceExport:selectAndWatch'),
        startWatch: (folderPath) => ipcRenderer.invoke('ecommerceExport:startWatch', folderPath),
        stopWatch: () => ipcRenderer.invoke('ecommerceExport:stopWatch'),
        onNewFile: (callback) => {
            ipcRenderer.on('ecommerceExport:newFile', (event, data) => callback(data));
            return () => ipcRenderer.removeAllListeners('ecommerceExport:newFile');
        },
    },
    carrierComplaints: {
        getConfig: () => ipcRenderer.invoke('carrierComplaints:getConfig'),
        saveConfig: (config) => ipcRenderer.invoke('carrierComplaints:saveConfig', config),
        reconcile: (data) => ipcRenderer.invoke('carrierComplaints:reconcile', data),
        getHistory: () => ipcRenderer.invoke('carrierComplaints:getHistory'),
        send: (data) => ipcRenderer.invoke('carrierComplaints:send', data),
    },
    marketplaceOrders: {
        getAll: (args) => ipcRenderer.invoke('marketplaceOrders:getAll', args),
        delete: (data) => ipcRenderer.invoke('marketplaceOrders:delete', data),
    },
    orders: {
        getUnified: (args) => ipcRenderer.invoke('orders:getUnified', args),
        getSummary: (args) => ipcRenderer.invoke('orders:getSummary', args),
        getDailyStats: (args) => ipcRenderer.invoke('orders:getDailyStats', args),
        getProductDetails: (args) => ipcRenderer.invoke('orders:getProductDetails', args),
    },

    // Export Orders (XUẤT HÀNG POS)
    exportOrders: {
        getAll: (args) => ipcRenderer.invoke('exportOrders:getAll', args),
        create: (data) => ipcRenderer.invoke('exportOrders:create', data),
        update: (id, data) => ipcRenderer.invoke('exportOrders:update', id, data),
        delete: (id) => ipcRenderer.invoke('exportOrders:delete', id),
        adjustStock: (data) => ipcRenderer.invoke('exportOrders:adjustStock', data),
    },

    // POS Order (BÁN HÀNG TẠI QUẦY)
    posOrder: {
        create: (data) => ipcRenderer.invoke('posOrder:create', data),
        getAll: (filters) => ipcRenderer.invoke('posOrder:getAll', filters),
        getById: (id) => ipcRenderer.invoke('posOrder:getById', id),
        update: (data) => ipcRenderer.invoke('posOrder:update', data),
        delete: (data) => ipcRenderer.invoke('posOrder:delete', data),
    },

    // Returns (TRẢ HÀNG)
    returns: {
        getAll: () => ipcRenderer.invoke('returns:getAll'),
        create: (data) => ipcRenderer.invoke('returns:create', data),
        update: (id, data) => ipcRenderer.invoke('returns:update', id, data),
        delete: (id) => ipcRenderer.invoke('returns:delete', id),
        bulkCreate: (records) => ipcRenderer.invoke('returns:bulkCreate', records),
    },

    // Refunds (HÀNG HOÀN)
    refunds: {
        getAll: (args) => ipcRenderer.invoke('refunds:getAll', args),
        create: (data) => ipcRenderer.invoke('refunds:create', data),
        update: (id, data) => ipcRenderer.invoke('refunds:update', id, data),
        delete: (id) => ipcRenderer.invoke('refunds:delete', id),
        bulkDelete: (ids) => ipcRenderer.invoke('refunds:bulkDelete', ids),
        bulkCreate: (records) => ipcRenderer.invoke('refunds:bulkCreate', records),
        importFromFolder: () => ipcRenderer.invoke('refunds:importFromFolder'),
        adjustStock: (data) => ipcRenderer.invoke('refunds:adjustStock', data),
        completeAndRestore: (data) => ipcRenderer.invoke('refunds:completeAndRestore', data),
    },

    // Stock Balance (CÂN BẰNG KHO)
    stockBalance: {
        getAll: (args) => ipcRenderer.invoke('stockBalance:getAll', args),
        create: (data) => ipcRenderer.invoke('stockBalance:create', data),
        adjustStock: (data) => ipcRenderer.invoke('stockBalance:adjustStock', data),
    },

    inventory: {
        manualAdjust: (data) => ipcRenderer.invoke('inventory:manualAdjust', data),
    },

    // Inventory Logs (THẺ KHO)
    inventoryLogs: {
        getAll: (filters) => ipcRenderer.invoke('inventoryLogs:getAll', filters),
        getBySku: (params) => ipcRenderer.invoke('inventoryLogs:getBySku', params),
        getBySkus: (params) => ipcRenderer.invoke('inventoryLogs:getBySkus', params),
        getStats: (filters) => ipcRenderer.invoke('inventoryLogs:getStats', filters),
        getRefDetail: (params) => ipcRenderer.invoke('inventoryLogs:getRefDetail', params),
    },

    // Pickup (NHẶT HÀNG)
    pickup: {
        sendTelegram: (data) => ipcRenderer.invoke('pickup:sendTelegram', data),
        selectAndWatch: () => ipcRenderer.invoke('pickup:selectAndWatch'),
        startWatch: (folderPath) => ipcRenderer.invoke('pickup:startWatch', folderPath),
        readFolderFiles: (folderPath) => ipcRenderer.invoke('pickup:readFolderFiles', folderPath),
        stopWatch: () => ipcRenderer.invoke('pickup:stopWatch'),
        onNewFile: (callback) => {
            ipcRenderer.on('pickup:newFile', (event, data) => callback(data));
            // Return cleanup function
            return () => ipcRenderer.removeAllListeners('pickup:newFile');
        },
    },

    // App Config (CẤU HÌNH)
    appConfig: {
        get: (key) => ipcRenderer.invoke('appConfig:get', key),
        set: (key, value) => ipcRenderer.invoke('appConfig:set', key, value),
    },
    stockCheck: {
        getSessions: (options) => ipcRenderer.invoke('stockCheck:getSessions', options),
        ensureDailySession: (data) => ipcRenderer.invoke('stockCheck:ensureDailySession', data),
        createRecheckSession: (data) => ipcRenderer.invoke('stockCheck:createRecheckSession', data),
        adminSaveSessions: (sessions) => ipcRenderer.invoke('stockCheck:adminSaveSessions', sessions),
        updateCount: (data) => ipcRenderer.invoke('stockCheck:updateCount', data),
        retryCount: (data) => ipcRenderer.invoke('stockCheck:retryCount', data),
        updateNote: (data) => ipcRenderer.invoke('stockCheck:updateNote', data),
        getReconciliationLogs: (data) => ipcRenderer.invoke('stockCheck:getReconciliationLogs', data),
        balanceItems: (data) => ipcRenderer.invoke('stockCheck:balanceItems', data),
        balanceItem: (data) => ipcRenderer.invoke('stockCheck:balanceItem', data),
        submitSession: (data) => ipcRenderer.invoke('stockCheck:submitSession', data),
    },

    // Daily Expenses (CHI PHÍ HÀNG NGÀY - P&L)
    dailyExpenses: {
        getAll: (filters) => ipcRenderer.invoke('dailyExpenses:getAll', filters),
        upsert: (data) => ipcRenderer.invoke('dailyExpenses:upsert', data),
        delete: (id) => ipcRenderer.invoke('dailyExpenses:delete', id),
    },

    // Users (NGƯỜI DÙNG / PHÂN QUYỀN)
    users: {
        getAll: () => ipcRenderer.invoke('users:getAll'),
        create: (data) => ipcRenderer.invoke('users:create', data),
        update: (id, data) => ipcRenderer.invoke('users:update', id, data),
        updateProfile: (data) => ipcRenderer.invoke('users:updateProfile', data),
        changePassword: (data) => ipcRenderer.invoke('users:changePassword', data),
        resetPassword: (data) => ipcRenderer.invoke('users:resetPassword', data),
        forcePasswordChange: (userId) => ipcRenderer.invoke('users:forcePasswordChange', userId),
        delete: (id) => ipcRenderer.invoke('users:delete', id),
        login: (username, password, rememberMe) => ipcRenderer.invoke('users:login', username, password, rememberMe),
        logout: (rememberToken) => ipcRenderer.invoke('users:logout', rememberToken),
        restoreSession: (rememberToken) => ipcRenderer.invoke('users:restoreSession', rememberToken),
        getCurrentSession: () => ipcRenderer.invoke('users:getCurrentSession'),
        heartbeat: () => ipcRenderer.invoke('users:heartbeat'),
        ensureAdmin: () => ipcRenderer.invoke('users:ensureAdmin'),
    },

    // Shell - Open external links in browser
    shell: {
        openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    },

    // Auto Update
    update: {
        getCurrentVersion: () => ipcRenderer.invoke('update:getCurrentVersion'),
        check: () => ipcRenderer.invoke('update:check'),
        download: (downloadUrl) => ipcRenderer.invoke('update:download', downloadUrl),
        restoreVersion: (version) => ipcRenderer.invoke('update:restoreVersion', version),
        restart: () => ipcRenderer.invoke('update:restart'),
        getHistory: () => ipcRenderer.invoke('update:getHistory'),
        onProgress: (callback) => {
            ipcRenderer.on('update:progress', (event, data) => callback(data));
            return () => ipcRenderer.removeAllListeners('update:progress');
        },
        onStep: (callback) => {
            ipcRenderer.on('update:step', (event, data) => callback(data));
            return () => ipcRenderer.removeAllListeners('update:step');
        },
    },

    // E-Invoice (HÓA ĐƠN ĐIỆN TỬ)
    einvoice: {
        getAll: (args) => ipcRenderer.invoke('einvoice:getAll', args),
        bulkImport: (orders) => ipcRenderer.invoke('einvoice:bulkImport', orders),
        issueInvoices: (orderIds) => ipcRenderer.invoke('einvoice:issueInvoices', orderIds),
        exportExcel: (filters) => ipcRenderer.invoke('einvoice:exportExcel', filters),
        getStats: () => ipcRenderer.invoke('einvoice:getStats'),
        delete: (id) => ipcRenderer.invoke('einvoice:delete', id),
        bulkDelete: (orderIds) => ipcRenderer.invoke('einvoice:bulkDelete', orderIds),
        deleteAll: () => ipcRenderer.invoke('einvoice:deleteAll'),
        getOriginalInvoice: (orderId) => ipcRenderer.invoke('einvoice:getOriginalInvoice', orderId),
        adjustInvoice: (data) => ipcRenderer.invoke('einvoice:adjustInvoice', data),
        getInvoiceChain: (orderId) => ipcRenderer.invoke('einvoice:getInvoiceChain', orderId),
        previewDraft: (orderId) => ipcRenderer.invoke('einvoice:previewDraft', orderId),
    },

    // MISA meInvoice API
    misa: {
        getConfig: () => ipcRenderer.invoke('misa:getConfig'),
        saveConfig: (config) => ipcRenderer.invoke('misa:saveConfig', config),
        testConnection: () => ipcRenderer.invoke('misa:testConnection'),
        getTemplates: () => ipcRenderer.invoke('misa:getTemplates'),
        previewInvoice: (invoiceData) => ipcRenderer.invoke('misa:previewInvoice', invoiceData),
        downloadPDF: (transactionId) => ipcRenderer.invoke('misa:downloadPDF', transactionId),
    },

    // Face Attendance — Chấm công khuôn mặt
    attendance: {
        status: () => ipcRenderer.invoke('attendance:status'),
        recognize: (image) => ipcRenderer.invoke('attendance:recognize', { image }),
        detect: (image) => ipcRenderer.invoke('attendance:detect', { image }),
        register: (data) => ipcRenderer.invoke('attendance:register', data),
        getLogs: (filters) => ipcRenderer.invoke('attendance:getLogs', filters),
        reconcileLateFines: () => ipcRenderer.invoke('attendance:reconcileLateFines'),
        getProfiles: () => ipcRenderer.invoke('attendance:getProfiles'),
        deleteProfile: (face_id) => ipcRenderer.invoke('attendance:deleteProfile', { face_id }),
        verifyAll: () => ipcRenderer.invoke('attendance:verifyAll'),
        sendPayslipEmail: (data) => ipcRenderer.invoke('attendance:sendPayslipEmail', data),
        savePayslipPDF: (data) => ipcRenderer.invoke('attendance:savePayslipPDF', data),
        saveEmployeeProfile: (data) => ipcRenderer.invoke('attendance:saveEmployeeProfile', data),
    },

    offlineQueue: {
        status: () => ipcRenderer.invoke('offlineQueue:status'),
        sync: () => ipcRenderer.invoke('offlineQueue:sync'),
    },

    // Native menu popup (Edit / View) — hiện từ React header thay thế menu bar OS
    menu: {
        popup: (menuName) => ipcRenderer.invoke('menu:popup', menuName),
    },
});

// ============================================
// FIX v6: Dropdown positioning bug in Electron
// Root cause: @rc-component/trigger's useAlign re-renders popup via React
//   inline styles, overwriting any element.style.setProperty() fixes.
// Fix: Use dynamic <style> tag with CSS !important rules.
//   CSS !important in <style> ALWAYS wins over React inline styles.
// ============================================
window.addEventListener('DOMContentLoaded', () => {
    console.log('[preload-fix] Installing dropdown fix v6...');

    // 1. Base styles: chặn scroll feedback loop
    const baseStyle = document.createElement('style');
    baseStyle.textContent = 'html, body { overflow: hidden !important; }';
    document.head.appendChild(baseStyle);

    // Ant Design v6 aligns portals correctly by itself. The old global
    // position override below intermittently moved a newly opened dropdown to
    // the top-left before rc-trigger completed its own alignment.
    // Keep the legacy implementation in place for rollback, but do not run it.
    const useLegacyDropdownPositionFix = true;
    if (!useLegacyDropdownPositionFix) return;

    // 2. Dynamic style tag — CSS rules sẽ override React inline styles
    const dynamicStyle = document.createElement('style');
    dynamicStyle.id = 'electron-dropdown-fix';
    document.head.appendChild(dynamicStyle);

    // 3. State
    let triggerSnapshot = null;
    let fixIdCounter = 0;
    const POPUP_SEL = '.ant-select-dropdown, .ant-picker-dropdown, .ant-cascader-dropdown, .ant-dropdown';

    // Xóa tất cả fix cũ
    function clearAllFixes() {
        dynamicStyle.textContent = '';
        document.querySelectorAll('[data-electron-pos]').forEach(el => {
            el.removeAttribute('data-electron-pos');
        });
    }

    // rc-trigger may briefly paint a new portal at (0, 0) before its first
    // alignment pass. Prime the expected position on mousedown so that frame
    // is never visible, then let the normal alignment/fallback refine it.
    function primePopupPosition() {
        if (!triggerSnapshot) return;

        dynamicStyle.textContent = `${POPUP_SEL} {
  top: ${Math.round(triggerSnapshot.bottom + 4)}px !important;
  left: ${Math.round(triggerSnapshot.left)}px !important;
  right: auto !important;
  bottom: auto !important;
  z-index: 99999 !important;
}`;
    }

    // Fix popup bị off-screen bằng CSS rule
    function fixPopup(popup) {
        if (!triggerSnapshot) return;

        const winW = window.innerWidth;
        const winH = window.innerHeight;

        const tr = triggerSnapshot;

        // Compute height — dùng scrollHeight nếu offsetHeight = 0
        const pH = popup.offsetHeight || popup.scrollHeight || 200;
        let targetTop = tr.bottom + 4;
        if (targetTop + pH > winH) {
            targetTop = Math.max(4, tr.top - pH - 4);
        }

        let targetLeft = tr.left;
        const pW = popup.offsetWidth || popup.scrollWidth || tr.width;
        if (targetLeft + pW > winW) {
            targetLeft = Math.max(4, winW - pW - 4);
        }

        // Assign unique ID qua attribute
        const fixId = 'efix-' + (++fixIdCounter);
        popup.setAttribute('data-electron-pos', fixId);

        // Append CSS rule — !important trong <style> tag sẽ WIN over React inline style
        const rule = `
[data-electron-pos="${fixId}"] {
  top: ${Math.round(targetTop)}px !important;
  left: ${Math.round(targetLeft)}px !important;
  right: auto !important;
  bottom: auto !important;
  z-index: 99999 !important;
}`;
        dynamicStyle.textContent += rule;

        console.log('[preload-fix] Fixed popup', fixId,
            'at:', Math.round(targetLeft), Math.round(targetTop),
            'size:', Math.round(pW) + 'x' + Math.round(pH));
    }

    function checkAndFixPopups() {
        if (!triggerSnapshot) return;

        const popups = document.querySelectorAll(POPUP_SEL);
        const winW = window.innerWidth;
        const winH = window.innerHeight;

        popups.forEach(popup => {
            const cs = window.getComputedStyle(popup);
            if (cs.display === 'none') return;

            // Đã fix rồi → kiểm tra xem vẫn OK không
            if (popup.hasAttribute('data-electron-pos')) return;

            const rect = popup.getBoundingClientRect();

            // On-screen → OK, skip
            const isOnScreen = rect.left > -100 && rect.top > -100 &&
                rect.right < winW + 100 && rect.bottom < winH + 100;
            const isDetachedFromTrigger =
                (Math.abs(rect.left - triggerSnapshot.left) > Math.max(120, triggerSnapshot.width + 40)) ||
                (Math.abs(rect.top - triggerSnapshot.bottom) > Math.max(180, triggerSnapshot.height + 120));
            if (isOnScreen && !isDetachedFromTrigger) return;

            // Off-screen → fix nó
            console.log('[preload-fix] Off-screen popup detected at:',
                Math.round(rect.left), Math.round(rect.top));
            fixPopup(popup);
        });
    }

    setTimeout(() => {
        console.log('[preload-fix] Listeners active');

        // Capture trigger element từ mousedown
        document.addEventListener('mousedown', (e) => {
            // ⚠️ QUAN TRỌNG: Nếu click vào BÊN TRONG popup (chọn option) → KHÔNG can thiệp
            // Để Ant Design tự xử lý selection
            const clickedInsidePopup = e.target.closest &&
                e.target.closest('.ant-select-dropdown, .ant-picker-dropdown, .ant-cascader-dropdown, .ant-picker-panel, .ant-dropdown, .ant-dropdown-menu');
            if (clickedInsidePopup) {
                console.log('[preload-fix] Click inside popup — letting Ant Design handle it');
                return; // Không làm gì cả
            }

            const el = e.target.closest && (
                e.target.closest('.ant-select') ||
                e.target.closest('.ant-picker') ||
                e.target.closest('.ant-cascader') ||
                e.target.closest('.ant-dropdown-trigger')
            );

            if (el) {
                // Click vào trigger element (Select box)
                // Kiểm tra: có popup đang hiển thị không?
                const visiblePopups = document.querySelectorAll(POPUP_SEL);
                let hasVisibleFixedPopup = false;
                visiblePopups.forEach(p => {
                    if (p.hasAttribute('data-electron-pos') &&
                        window.getComputedStyle(p).display !== 'none') {
                        hasVisibleFixedPopup = true;
                    }
                });

                if (hasVisibleFixedPopup) {
                    // ĐÓNG dropdown: click vào trigger khi đã mở → đóng lại
                    console.log('[preload-fix] Closing dropdown — hiding popups immediately');
                    dynamicStyle.textContent = `${POPUP_SEL} { display: none !important; }`;
                    setTimeout(() => {
                        clearAllFixes();
                        triggerSnapshot = null;
                    }, 300);
                    return;
                }

                // MỞ dropdown mới
                clearAllFixes();

                const r = el.getBoundingClientRect();
                triggerSnapshot = {
                    left: r.left, top: r.top,
                    right: r.right, bottom: r.bottom,
                    width: r.width, height: r.height
                };
                console.log('[preload-fix] Trigger at:', Math.round(r.left), Math.round(r.top),
                    Math.round(r.width) + 'x' + Math.round(r.height));

                // Prevent the first portal frame from flashing at the top-left.
                // Schedule initial fix attempts
                [0, 16, 50, 100, 200].forEach(d =>
                    setTimeout(() => requestAnimationFrame(checkAndFixPopups), d)
                );
            } else {
                // Click bên ngoài → ẩn popup ngay, xóa fix sau
                const hasFixedPopup = document.querySelector('[data-electron-pos]');
                if (hasFixedPopup) {
                    dynamicStyle.textContent = `${POPUP_SEL} { display: none !important; }`;
                    setTimeout(() => {
                        clearAllFixes();
                        triggerSnapshot = null;
                    }, 300);
                } else {
                    setTimeout(() => {
                        clearAllFixes();
                        triggerSnapshot = null;
                    }, 300);
                }
            }
        }, true);

        // MutationObserver — liên tục detect popup off-screen
        // Key: KHÔNG dừng sau timeout — chạy liên tục để bắt React re-render
        new MutationObserver((mutations) => {
            if (!triggerSnapshot) return;

            // Chỉ react khi có style/class change hoặc child thêm mới
            const hasRelevantChange = mutations.some(m =>
                m.type === 'childList' ||
                (m.type === 'attributes' && m.attributeName === 'style')
            );
            if (hasRelevantChange) {
                requestAnimationFrame(checkAndFixPopups);
            }
        }).observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    }, 2000);
});
