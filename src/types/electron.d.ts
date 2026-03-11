export interface Product {
    id: number;
    sku: string;
    barcode?: string;
    name: string;
    description?: string;
    categoryId?: number;
    category?: Category;
    price: number;
    cost: number;
    stock: number;
    minStock: number;
    maxStock?: number;
    unit: string;
    weight?: number;
    images?: string;
    variants?: string;
    isCombo?: boolean;
    comboItems?: string; // JSON: [{sku: string, quantity: number}]
    status: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface ComboProduct {
    id: number;
    sku: string;
    name: string;
    price: number;
    cost: number;
    stock: number;
    items: string; // JSON: [{productId, variantIndex, quantity, sku, productName, variantName}]
    status: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface Category {
    id: number;
    name: string;
    description?: string;
    parentId?: number;
    createdAt: Date;
    updatedAt: Date;
}





export interface ActivityLog {
    id: number;
    module: string;
    action: string;
    recordId?: number;
    recordName?: string;
    changes?: any; // Can be object (will be stringified) or string
    description: string;
    userName: string;
    userId?: number;
    timestamp: Date;
    severity: string;
    ipAddress?: string;
    deviceInfo?: string;
}

export interface ActivityLogFilters {
    module?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
}

export interface ActivityLogStats {
    total: number;
    byModule: { module: string; _count: number }[];
    byAction: { action: string; _count: number }[];
    recent: ActivityLog[];
}

export interface DatabaseImportStats {
    categories: number;
    products: number;
    suppliers: number;
    purchases: number;
    customers: number;
    orders: number;
    expenses: number;
}

export interface ElectronAPI {
    products: {
        getAll: () => Promise<{ success: boolean; data?: Product[]; error?: string }>;
        getById: (id: number) => Promise<{ success: boolean; data?: Product; error?: string }>;
        create: (data: Partial<Product>) => Promise<{ success: boolean; data?: Product; error?: string }>;
        update: (id: number, data: Partial<Product>) => Promise<{ success: boolean; data?: Product; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
        updateStock: (data: { sku: string; quantity: number; isAdd?: boolean }) => Promise<{ success: boolean; data?: Product; error?: string }>;
    };
    categories: {
        getAll: () => Promise<{ success: boolean; data?: Category[]; error?: string }>;
        create: (data: Partial<Category>) => Promise<{ success: boolean; data?: Category; error?: string }>;
        update: (id: number, data: Partial<Category>) => Promise<{ success: boolean; data?: Category; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    };

    activityLog: {
        getAll: (filters?: ActivityLogFilters) => Promise<{ success: boolean; data?: ActivityLog[]; error?: string }>;
        create: (data: Partial<ActivityLog>) => Promise<{ success: boolean; data?: ActivityLog; error?: string }>;
        getByRecord: (params: { module: string; recordId: number }) => Promise<{ success: boolean; data?: ActivityLog[]; error?: string }>;
        getStats: () => Promise<{ success: boolean; data?: ActivityLogStats; error?: string }>;
    };
    purchases: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        update: (id: number, data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
        uploadVATInvoice: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        markAsThht: (purchaseId: number, revert?: boolean) => Promise<{ success: boolean; error?: string }>;
    };
    suppliers: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        update: (id: number, data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
    database: {
        exportAll: () => Promise<{ success: boolean; data?: string; error?: string }>;
        importAll: () => Promise<{ success: boolean; data?: DatabaseImportStats; error?: string }>;
    };
    system: {
        backup: () => Promise<{ success: boolean; data?: { path: string; size: number; filename: string }; error?: string }>;
        listBackups: () => Promise<{ success: boolean; data?: Array<{ filename: string; path: string; size: number; createdAt: Date; modifiedAt: Date }>; error?: string }>;
        restore: (backupPath: string) => Promise<{ success: boolean; data?: { restoreDir: string; filesRestored: number; safetyBackup: string; message: string }; error?: string }>;
        browseAndRestore: () => Promise<{ success: boolean; data?: { filePath: string; message: string }; error?: string }>;
        inspectBackup: (backupPath: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        deleteBackup: (backupPath: string) => Promise<{ success: boolean; error?: string }>;
        getInfo: () => Promise<{ success: boolean; data?: { dbStatus: string; machineName: string; environment: string; platform: string; appVersion: string; nodeVersion: string; electronVersion: string }; error?: string }>;
    };
    dailyTasks: {
        list: (filters?: any) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        create: (taskData: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        update: (id: number, updates: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        updateStatus: (id: number, status: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
        getStats: (filters?: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        resetDaily: () => Promise<{ success: boolean; data?: { reset: boolean; resetCount: number; message: string }; error?: string }>;
    };
    ecommerceExports: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        update: (id: number, data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
        bulkDelete: (ids: number[]) => Promise<{ success: boolean; data?: number; error?: string }>;
        bulkCreate: (records: any[]) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        selectFolder: () => Promise<{ success: boolean; data?: string; error?: string }>;
        loadExcelFiles: (folderPath: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    };
    exportOrders: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        update: (id: number, data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
    posOrder: {
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        getAll: (filters?: any) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getById: (id: number) => Promise<{ success: boolean; data?: any; error?: string }>;
    };
    returns: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        update: (id: number, data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
        bulkCreate: (records: any[]) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    };
    refunds: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        update: (id: number, data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
        bulkDelete: (ids: number[]) => Promise<{ success: boolean; data?: number; error?: string }>;
        bulkCreate: (records: any[]) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        importFromFolder: () => Promise<{ success: boolean; data?: any[]; error?: string; folderPath?: string; fileResults?: any[]; totalFiles?: number; totalRows?: number }>;
    };
    stockBalance: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
    };
    pickup: {
        sendTelegram: (data: { token: string; chatId: string; message: string }) => Promise<{ success: boolean; error?: string }>;
        selectAndWatch: () => Promise<{ success: boolean; data?: { folderPath: string; existingFiles: number }; error?: string }>;
        startWatch: (folderPath: string) => Promise<{ success: boolean; data?: { folderPath: string; existingFiles: number }; error?: string }>;
        readFolderFiles: (folderPath: string) => Promise<{ success: boolean; data?: { name: string; base64: string }[]; error?: string }>;
        stopWatch: () => Promise<{ success: boolean; error?: string }>;
        onNewFile: (callback: (data: { name: string; base64: string; path: string }) => void) => () => void;
    };
    appConfig: {
        get: (key: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        set: (key: string, value: any) => Promise<{ success: boolean; data?: any; error?: string }>;
    };
    dailyExpenses: {
        getAll: (filters?: { startDate?: string; endDate?: string }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        upsert: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
    users: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        update: (id: number, data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
        login: (username: string, password: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        logout: () => Promise<{ success: boolean }>;
        restoreSession: (userId: number) => Promise<{ success: boolean }>;
        ensureAdmin: () => Promise<{ success: boolean; error?: string }>;
    };
    combos: {
        getAll: () => Promise<{ success: boolean; data?: ComboProduct[]; error?: string }>;
        getById: (id: number) => Promise<{ success: boolean; data?: ComboProduct; error?: string }>;
        create: (data: Partial<ComboProduct>) => Promise<{ success: boolean; data?: ComboProduct; error?: string }>;
        update: (id: number, data: Partial<ComboProduct>) => Promise<{ success: boolean; data?: ComboProduct; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
    update: {
        getCurrentVersion: () => Promise<{ success: boolean; data?: string; error?: string }>;
        check: () => Promise<{ success: boolean; data?: { currentVersion: string; latestVersion: string; hasUpdate: boolean; releaseNotes: string; publishedAt: string; downloadUrl: string | null; downloadSize: number }; error?: string }>;
        download: (downloadUrl: string) => Promise<{ success: boolean; data?: { version: string }; error?: string }>;
        restart: () => Promise<void>;
        getHistory: () => Promise<{ success: boolean; data?: Array<{ id: number; fromVersion: string; toVersion: string; updatedAt: string; machine?: string; notes?: string }>; error?: string }>;
    };
    shell: {
        openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
    };
    einvoice: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        bulkImport: (orders: any[]) => Promise<{ success: boolean; data?: { imported: number; duplicated: number; duplicateIds: string[] }; error?: string }>;
        issueInvoices: (orderIds: string[]) => Promise<{ success: boolean; data?: { issued: any[]; issuedCount: number; skippedCount: number; batchId: string; errorLog?: any[]; errorCount?: number }; error?: string }>;
        exportExcel: (filters?: any) => Promise<{ success: boolean; data?: { filePath: string; count: number }; error?: string }>;
        getStats: () => Promise<{ success: boolean; data?: { total: number; issued: number; pending: number; totalIssuedAmount: number }; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
        bulkDelete: (orderIds: string[]) => Promise<{ success: boolean; data?: { deleted: number }; error?: string }>;
        getOriginalInvoice: (orderId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        adjustInvoice: (data: { orderId: string; adjustmentType: string; reason?: string; partialItems?: any[] }) => Promise<{ success: boolean; data?: { originalInvoice: string; newInvoice: string; adjustmentType: string; reason: string; chainNumber?: number; totalAdjusted?: number; remaining?: number }; error?: string }>;
        getInvoiceChain: (orderId: string) => Promise<{ success: boolean; data?: { original: any; adjustments: any[]; totalAdjusted: number; remaining: number; chainLength: number }; error?: string }>;
    };
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

