const { contextBridge, ipcRenderer } = require('electron');

const appConfigRevisions = new Map();
const appConfigWriteTails = new Map();

async function getAppConfig(key) {
    const pendingWrite = appConfigWriteTails.get(key);
    if (pendingWrite) await pendingWrite.catch(() => undefined);
    const result = await ipcRenderer.invoke('appConfig:get', key);
    if (result?.success) appConfigRevisions.set(key, result.updatedAt || null);
    return result;
}

function setAppConfig(key, value) {
    const previous = appConfigWriteTails.get(key) || Promise.resolve();
    const write = previous.catch(() => undefined).then(async () => {
        const hasRevision = appConfigRevisions.has(key);
        const result = await ipcRenderer.invoke(
            'appConfig:set',
            key,
            value,
            hasRevision ? appConfigRevisions.get(key) : undefined,
        );
        if (result?.success) appConfigRevisions.set(key, result.updatedAt || null);
        return result;
    });
    appConfigWriteTails.set(key, write);
    void write.then(() => {
        if (appConfigWriteTails.get(key) === write) appConfigWriteTails.delete(key);
    }, () => {
        if (appConfigWriteTails.get(key) === write) appConfigWriteTails.delete(key);
    });
    return write;
}

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
        markAsThht: (purchaseId, revert, expectedUpdatedAt) => ipcRenderer.invoke('purchases:markAsThht', { purchaseId, revert, expectedUpdatedAt }),
        getVATFileData: (purchaseId) => ipcRenderer.invoke('purchases:getVATFileData', { purchaseId }),
        getImportReceiptFileData: (purchaseId) => ipcRenderer.invoke('purchases:getImportReceiptFileData', { purchaseId }),
        getImportReceiptPreviewData: (purchaseId) => ipcRenderer.invoke('purchases:getImportReceiptPreviewData', { purchaseId }),
    },
    handlingUnits: {
        getWorkspace: () => ipcRenderer.invoke('handlingUnits:getWorkspace'),
        createUnits: (records) => ipcRenderer.invoke('handlingUnits:createUnits', records),
        issueQrLabels: (data) => ipcRenderer.invoke('handlingUnits:issueQrLabels', data),
        resolveQrLabel: (code) => ipcRenderer.invoke('handlingUnits:resolveQrLabel', code),
        exportLabelsPdf: (data) => ipcRenderer.invoke('handlingUnits:exportLabelsPdf', data),
        markQrLabelsPrinted: (codes) => ipcRenderer.invoke('handlingUnits:markQrLabelsPrinted', codes),
        markQrLabelsReceived: (codes) => ipcRenderer.invoke('handlingUnits:markQrLabelsReceived', codes),
        quickReceive: (data) => ipcRenderer.invoke('handlingUnits:quickReceive', data),
        splitUnit: (data) => ipcRenderer.invoke('handlingUnits:splitUnit', data),
        saveRegister: (records) => ipcRenderer.invoke('handlingUnits:saveRegister', records),
        unsealUnit: (data) => ipcRenderer.invoke('handlingUnits:unsealUnit', data),
        sealUnit: (data) => ipcRenderer.invoke('handlingUnits:sealUnit', data),
        pickUnit: (data) => ipcRenderer.invoke('handlingUnits:pickUnit', data),
        mergeReturnUnit: (data) => ipcRenderer.invoke('handlingUnits:mergeReturnUnit', data),
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
        getPackingComponents: () => ipcRenderer.invoke('combos:getPackingComponents'),
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
        archive: (id, reason) => ipcRenderer.invoke('dailyTasks:archive', { id, reason }),
        deleteAssignment: (id) => ipcRenderer.invoke('dailyTasks:deleteAssignment', { id }),
        uploadEvidenceImage: (payload) => ipcRenderer.invoke('dailyTasks:uploadEvidenceImage', payload),
        validateEvidenceSource: (payload) => ipcRenderer.invoke('dailyTasks:validateEvidenceSource', payload),
        submitEvidence: (payload) => ipcRenderer.invoke('dailyTasks:submitEvidence', payload),
        reviewEvidence: (taskId, approved, reviewContext) => ipcRenderer.invoke('dailyTasks:reviewEvidence', taskId, approved, reviewContext),
        requestAssignmentCompletion: (taskId) => ipcRenderer.invoke('dailyTasks:requestAssignmentCompletion', taskId),
        completeRegularTask: (taskId, payload) => ipcRenderer.invoke('dailyTasks:completeRegularTask', taskId, payload),
        addNote: (taskId, note) => ipcRenderer.invoke('dailyTasks:addNote', { taskId, note }),
        reopen: (taskId) => ipcRenderer.invoke('dailyTasks:reopen', { taskId }),
        completeAssignment: (taskId) => ipcRenderer.invoke('dailyTasks:completeAssignment', { taskId }),
        saveCategories: (categories, expectedCategories) => ipcRenderer.invoke('dailyTasks:saveCategories', { categories, expectedCategories }),
        getEvidenceImageUrl: (taskId, storagePath) => ipcRenderer.invoke('dailyTasks:getEvidenceImageUrl', taskId, storagePath),
        getR2EvidenceImageUrl: (taskId, r2Key, mimeType) => ipcRenderer.invoke('dailyTasks:getR2EvidenceImageUrl', taskId, r2Key, mimeType),
        getR2EvidenceImageUrls: (taskId, images, requestId) => ipcRenderer.invoke('dailyTasks:getR2EvidenceImageUrls', taskId, images, requestId),
        onR2EvidenceImageLoaded: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('dailyTasks:r2EvidenceImageLoaded', handler);
            return () => ipcRenderer.removeListener('dailyTasks:r2EvidenceImageLoaded', handler);
        },
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
        saveTelegramSettings: (data) => ipcRenderer.invoke('ecommerceExports:saveTelegramSettings', data),
        nextTelegramOrderCounter: () => ipcRenderer.invoke('ecommerceExports:nextTelegramOrderCounter'),
        delete: (id) => ipcRenderer.invoke('ecommerceExports:delete', id),
        bulkDelete: (ids) => ipcRenderer.invoke('ecommerceExports:bulkDelete', ids),
        deleteAll: () => ipcRenderer.invoke('ecommerceExports:deleteAll'),
        deleteCancelled: () => ipcRenderer.invoke('ecommerceExports:deleteCancelled'),
        getCompletedKeys: () => ipcRenderer.invoke('ecommerceExports:getCompletedKeys'),
        checkExistingKeys: (data) => ipcRenderer.invoke('ecommerceExports:checkExistingKeys', data),
        syncOrderPlacedAt: (records) => ipcRenderer.invoke('ecommerceExports:syncOrderPlacedAt', records),
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
        saveWithStock: (data) => ipcRenderer.invoke('exportOrders:saveWithStock', data),
        create: (data) => ipcRenderer.invoke('exportOrders:create', data),
        update: (id, data) => ipcRenderer.invoke('exportOrders:update', id, data),
        delete: (id, options) => ipcRenderer.invoke('exportOrders:delete', id, options),
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
        updateWorkflow: (id, field, value, expectedUpdatedAt) => ipcRenderer.invoke('returns:updateWorkflow', { id, field, value, expectedUpdatedAt }),
        updateWorkflowBulk: (updates) => ipcRenderer.invoke('returns:updateWorkflowBulk', { updates }),
        saveStatusList: (statuses, expectedStatuses) => ipcRenderer.invoke('returns:saveStatusList', { statuses, expectedStatuses }),
        addProcessNote: (id, note) => ipcRenderer.invoke('returns:addProcessNote', { id, note }),
        delete: (id) => ipcRenderer.invoke('returns:delete', id),
        bulkCreate: (records) => ipcRenderer.invoke('returns:bulkCreate', records),
    },

    // Refunds (HÀNG HOÀN)
    refunds: {
        getAll: (args) => ipcRenderer.invoke('refunds:getAll', args),
        create: (data) => ipcRenderer.invoke('refunds:create', data),
        update: (id, data) => ipcRenderer.invoke('refunds:update', id, data),
        updateStatus: (id, status, expectedUpdatedAt) => ipcRenderer.invoke('refunds:updateStatus', { id, status, expectedUpdatedAt }),
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
        apply: (data) => ipcRenderer.invoke('stockBalance:apply', data),
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
        get: getAppConfig,
        set: setAppConfig,
    },
    policies: {
        getCurrent: () => ipcRenderer.invoke('policies:getCurrent'),
    },
    r2Test: {
        getBootstrap: () => ipcRenderer.invoke('r2Test:getBootstrap'),
    },
    stockCheck: {
        getSessions: (options) => ipcRenderer.invoke('stockCheck:getSessions', options),
        ensureDailySession: (data) => ipcRenderer.invoke('stockCheck:ensureDailySession', data),
        createFullSession: (data) => ipcRenderer.invoke('stockCheck:createFullSession', data),
        cancelSession: (data) => ipcRenderer.invoke('stockCheck:cancelSession', data),
        createInspectionSession: (data) => ipcRenderer.invoke('stockCheck:createInspectionSession', data),
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

    notifications: {
        list: () => ipcRenderer.invoke('notifications:list'),
        getRecipients: (announcementId) => ipcRenderer.invoke('notifications:recipients', announcementId),
        publish: (announcementId, userIds) => ipcRenderer.invoke('notifications:publish', announcementId, userIds),
        markRead: (announcementId) => ipcRenderer.invoke('notifications:markRead', announcementId),
        acknowledge: (announcementId) => ipcRenderer.invoke('notifications:acknowledge', announcementId),
        snooze: (announcementId) => ipcRenderer.invoke('notifications:snooze', announcementId),
        onChanged: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('notifications:changed', handler);
            return () => ipcRenderer.removeListener('notifications:changed', handler);
        },
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
        updateLeaveStatus: (data) => ipcRenderer.invoke('attendance:updateLeaveStatus', data),
        updatePayrollOverride: (data) => ipcRenderer.invoke('attendance:updatePayrollOverride', data),
        updatePayrollLock: (data) => ipcRenderer.invoke('attendance:updatePayrollLock', data),
        updatePackingCommission: (data) => ipcRenderer.invoke('attendance:updatePackingCommission', data),
        deleteFine: (data) => ipcRenderer.invoke('attendance:deleteFine', data),
        reconcileLateFines: () => ipcRenderer.invoke('attendance:reconcileLateFines'),
        getProfiles: () => ipcRenderer.invoke('attendance:getProfiles'),
        deleteProfile: (face_id) => ipcRenderer.invoke('attendance:deleteProfile', { face_id }),
        verifyAll: () => ipcRenderer.invoke('attendance:verifyAll'),
        getPayslipQrImage: (data) => ipcRenderer.invoke('attendance:getPayslipQrImage', data),
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
