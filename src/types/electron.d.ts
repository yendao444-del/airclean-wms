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

export interface PickupStats {
    totalOrders: number;
    shopeeCount: number;
    tiktokCount: number;
    scannedCount: number;
    remaining: number;
    fileCount?: number;
}

export interface PickupScanResult {
    trackingNumber: string;
    source: string;
    sourceRaw: string;
    file: string;
    scannedAt: string;
    orderNumber: number;
}

export interface PickupHistoryItem {
    trackingNumber: string;
    orderNumber?: string;      // 📦 Order ID từ file
    source: string;            // Nguồn đơn hàng (TikTok/Shopee)
    file: string;
    scannedAt: string;
    items?: string;            // 📦 JSON string của items
    shippingProvider?: string; // 📦 Đơn vị vận chuyển
    totalAmount?: number;      // 📦 Tổng tiền
    status?: string;           // 📦 Trạng thái (scanned/pending)
}

export interface PickupTelegramPayload {
    token: string;
    chatId: string;
    message: string;
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
    pickup: {
        selectFolder: () => Promise<{ success: boolean; data?: string; error?: string }>;
        loadData: (folderPath: string) => Promise<{ success: boolean; data?: PickupStats; error?: string }>;
        scan: (trackingNumber: string) => Promise<{ success: boolean; data?: PickupScanResult; error?: string; errorType?: string }>;
        getHistory: (limit?: number) => Promise<{ success: boolean; data?: PickupHistoryItem[]; error?: string }>;
        getStats: () => Promise<{ success: boolean; data?: PickupStats; error?: string }>;
        sendTelegram: (payload: PickupTelegramPayload) => Promise<{ success: boolean; error?: string }>;
        exportPickup: () => Promise<{ success: boolean; data?: string; error?: string }>;
    };
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
    pickup: {
        selectFolder: () => Promise<{ success: boolean; data?: string; error?: string }>;
        loadData: (folderPath: string) => Promise<{ success: boolean; data?: PickupStats; error?: string }>;
        scan: (trackingNumber: string) => Promise<{ success: boolean; data?: PickupScanResult; error?: string; errorType?: string }>;
        getHistory: (limit?: number) => Promise<{ success: boolean; data?: PickupHistoryItem[]; error?: string }>;
        getStats: () => Promise<{ success: boolean; data?: PickupStats; error?: string }>;
        sendTelegram: (payload: PickupTelegramPayload) => Promise<{ success: boolean; error?: string }>;
        exportPickup: () => Promise<{ success: boolean; data?: string; error?: string }>;
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
    };
    suppliers: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
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
    };
    dailyTasks: {
        list: (filters?: any) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        create: (taskData: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        update: (id: number, updates: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        updateStatus: (id: number, status: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
        getStats: (filters?: any) => Promise<{ success: boolean; data?: any; error?: string }>;
    };
    combos: {
        getAll: () => Promise<{ success: boolean; data?: ComboProduct[]; error?: string }>;
        getById: (id: number) => Promise<{ success: boolean; data?: ComboProduct; error?: string }>;
        create: (data: Partial<ComboProduct>) => Promise<{ success: boolean; data?: ComboProduct; error?: string }>;
        update: (id: number, data: Partial<ComboProduct>) => Promise<{ success: boolean; data?: ComboProduct; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

