const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Products
    products: {
        getAll: () => ipcRenderer.invoke('products:getAll'),
        getById: (id) => ipcRenderer.invoke('products:getById', id),
        create: (data) => ipcRenderer.invoke('products:create', data),
        update: (id, data) => ipcRenderer.invoke('products:update', id, data),
        delete: (id) => ipcRenderer.invoke('products:delete', id),
        updateStock: (data) => ipcRenderer.invoke('products:updateStock', data),
    },

    // Categories
    categories: {
        getAll: () => ipcRenderer.invoke('categories:getAll'),
        create: (data) => ipcRenderer.invoke('categories:create', data),
        update: (id, data) => ipcRenderer.invoke('categories:update', id, data),
        delete: (id) => ipcRenderer.invoke('categories:delete', id),
    },

    // Pickup - Quét mã vận đơn
    pickup: {
        selectFolder: () => ipcRenderer.invoke('pickup:selectFolder'),
        loadData: (folderPath) => ipcRenderer.invoke('pickup:loadData', folderPath),
        scan: (trackingNumber) => ipcRenderer.invoke('pickup:scan', trackingNumber),
        getHistory: (limit) => ipcRenderer.invoke('pickup:getHistory', limit),
        getStats: () => ipcRenderer.invoke('pickup:getStats'),
        sendTelegram: (data) => ipcRenderer.invoke('pickup:sendTelegram', data),
        exportPickup: () => ipcRenderer.invoke('pickup:exportPickup'),
    },

    // Activity Log
    activityLog: {
        getAll: (filters) => ipcRenderer.invoke('activityLog:getAll', filters),
        create: (data) => ipcRenderer.invoke('activityLog:create', data),
        getByRecord: (params) => ipcRenderer.invoke('activityLog:getByRecord', params),
        getStats: () => ipcRenderer.invoke('activityLog:getStats'),
    },
    purchases: {
        getAll: () => ipcRenderer.invoke('purchases:getAll'),
        create: (data) => ipcRenderer.invoke('purchases:create', data),
        update: (id, data) => ipcRenderer.invoke('purchases:update', { id, data }),
        delete: (id) => ipcRenderer.invoke('purchases:delete', id),
    },
    suppliers: {
        getAll: () => ipcRenderer.invoke('suppliers:getAll'),
        create: (data) => ipcRenderer.invoke('suppliers:create', data),
        update: (id, data) => ipcRenderer.invoke('suppliers:update', id, data),
        delete: (id) => ipcRenderer.invoke('suppliers:delete', id),
    },

    // Database Export/Import
    database: {
        exportAll: () => ipcRenderer.invoke('database:exportAll'),
        importAll: () => ipcRenderer.invoke('database:importAll'),
    },

    // System Backup/Restore
    system: {
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
        update: (id, updates) => ipcRenderer.invoke('dailyTasks:update', id, updates),
        updateStatus: (id, status) => ipcRenderer.invoke('dailyTasks:updateStatus', id, status),
        delete: (id) => ipcRenderer.invoke('dailyTasks:delete', id),
        getStats: (filters) => ipcRenderer.invoke('dailyTasks:stats', filters),
    },

    // Ecommerce Export
    ecommerceExport: {
        selectFolder: () => ipcRenderer.invoke('ecommerceExport:selectFolder'),
        loadExcelFiles: (folderPath) => ipcRenderer.invoke('ecommerceExport:loadExcelFiles', folderPath),
    },

    // Shell - Open external links in browser
    shell: {
        openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    },
});
