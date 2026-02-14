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

    // Ecommerce Export (XUẤT HÀNG TMDT)
    ecommerceExports: {
        getAll: () => ipcRenderer.invoke('ecommerceExports:getAll'),
        create: (data) => ipcRenderer.invoke('ecommerceExports:create', data),
        update: (id, data) => ipcRenderer.invoke('ecommerceExports:update', id, data),
        delete: (id) => ipcRenderer.invoke('ecommerceExports:delete', id),
        bulkDelete: (ids) => ipcRenderer.invoke('ecommerceExports:bulkDelete', ids),
        bulkCreate: (records) => ipcRenderer.invoke('ecommerceExports:bulkCreate', records),
        selectFolder: () => ipcRenderer.invoke('ecommerceExport:selectFolder'),
        loadExcelFiles: (folderPath) => ipcRenderer.invoke('ecommerceExport:loadExcelFiles', folderPath),
    },

    // Export Orders (XUẤT HÀNG POS)
    exportOrders: {
        getAll: () => ipcRenderer.invoke('exportOrders:getAll'),
        create: (data) => ipcRenderer.invoke('exportOrders:create', data),
        update: (id, data) => ipcRenderer.invoke('exportOrders:update', id, data),
        delete: (id) => ipcRenderer.invoke('exportOrders:delete', id),
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
        getAll: () => ipcRenderer.invoke('refunds:getAll'),
        create: (data) => ipcRenderer.invoke('refunds:create', data),
        update: (id, data) => ipcRenderer.invoke('refunds:update', id, data),
        delete: (id) => ipcRenderer.invoke('refunds:delete', id),
        bulkDelete: (ids) => ipcRenderer.invoke('refunds:bulkDelete', ids),
        bulkCreate: (records) => ipcRenderer.invoke('refunds:bulkCreate', records),
    },

    // Stock Balance (CÂN BẰNG KHO)
    stockBalance: {
        getAll: () => ipcRenderer.invoke('stockBalance:getAll'),
        create: (data) => ipcRenderer.invoke('stockBalance:create', data),
    },

    // App Config (CẤU HÌNH)
    appConfig: {
        get: (key) => ipcRenderer.invoke('appConfig:get', key),
        set: (key, value) => ipcRenderer.invoke('appConfig:set', key, value),
    },

    // Users (NGƯỜI DÙNG / PHÂN QUYỀN)
    users: {
        getAll: () => ipcRenderer.invoke('users:getAll'),
        create: (data) => ipcRenderer.invoke('users:create', data),
        update: (id, data) => ipcRenderer.invoke('users:update', id, data),
        delete: (id) => ipcRenderer.invoke('users:delete', id),
        login: (username, password) => ipcRenderer.invoke('users:login', username, password),
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
        restart: () => ipcRenderer.invoke('update:restart'),
        getHistory: () => ipcRenderer.invoke('update:getHistory'),
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
            if (rect.left > -100 && rect.top > -100 &&
                rect.left < winW + 100 && rect.top < winH + 100) return;

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
