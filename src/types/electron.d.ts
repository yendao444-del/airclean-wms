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

export interface StockMutationPayload {
  sku: string;
  quantity: number;
  isAdd?: boolean;
  allowMissing?: boolean;
  logContext: {
    type: string;
    referenceType: "XUAT" | "HOAN" | "CAN_BANG" | "MANUAL_ADJUST";
    reference: string;
    note: string;
    createdBy?: string;
  };
}

export interface StockMutationResult {
  success: boolean;
  skipped?: boolean;
  data?: Product;
  error?: string;
}

export interface ElectronAPI {
  products: {
    getAll: () => Promise<{
      success: boolean;
      data?: Product[];
      error?: string;
    }>;
    getForAdmin?: () => Promise<{
      success: boolean;
      data?: Product[];
      error?: string;
    }>;
    getCatalogForPurchase?: () => Promise<{
      success: boolean;
      data?: Product[];
      error?: string;
    }>;
    getCatalogForSale?: () => Promise<{
      success: boolean;
      data?: Product[];
      error?: string;
    }>;
    getForStockAlerts?: () => Promise<{
      success: boolean;
      data?: Product[];
      error?: string;
    }>;
    getInventoryCatalog?: () => Promise<{
      success: boolean;
      data?: Product[];
      error?: string;
    }>;
    getById: (
      id: number,
    ) => Promise<{ success: boolean; data?: Product; error?: string }>;
    create: (
      data: Partial<Product>,
    ) => Promise<{ success: boolean; data?: Product; error?: string }>;
    update: (
      id: number,
      data: Partial<Product>,
    ) => Promise<{ success: boolean; data?: Product; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    getTopSelling?: (args?: {
      limit?: number;
    }) => Promise<{
      success: boolean;
      data?: Array<{
        productId: number | string;
        productName: string;
        soldQty: number;
      }>;
      error?: string;
    }>;
    getStockCheckActivity?: () => Promise<{
      success: boolean;
      data?: Array<{ productId: number | string; lastSaleAt: string }>;
      error?: string;
    }>;
    onStockChanged?: (callback: (data: any) => void) => () => void;
  };
  categories: {
    getAll: () => Promise<{
      success: boolean;
      data?: Category[];
      error?: string;
    }>;
    create: (
      data: Partial<Category>,
    ) => Promise<{ success: boolean; data?: Category; error?: string }>;
    update: (
      id: number,
      data: Partial<Category>,
    ) => Promise<{ success: boolean; data?: Category; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };

  activityLog: {
    getAll: (
      filters?: ActivityLogFilters,
    ) => Promise<{ success: boolean; data?: ActivityLog[]; error?: string }>;
    create: (
      data: Partial<ActivityLog>,
    ) => Promise<{ success: boolean; data?: ActivityLog; error?: string }>;
    getByRecord: (params: {
      module: string;
      recordId: number;
    }) => Promise<{ success: boolean; data?: ActivityLog[]; error?: string }>;
    getStats: () => Promise<{
      success: boolean;
      data?: ActivityLogStats;
      error?: string;
    }>;
  };
  dashboard: {
    getSummary: (filters: {
      from: string;
      to: string;
      prevFrom: string;
      prevTo: string;
      chartFrom: string;
      chartTo: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
  };
  orders: {
    getUnified: (args: any) => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    getSummary: (args: any) => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    getDailyStats: (args: any) => Promise<{
      success: boolean;
      data?: Array<{ date: string; revenue: number; orders: number }>;
      error?: string;
    }>;
    getProductDetails: (args: any) => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
  };
  purchases: {
    getAll: (filters?: {
      since?: string;
      limit?: number;
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    getVatAlertSummary: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    getMyVatPenaltyAlerts: () => Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        poNumber: string;
        supplierName: string;
        purchaseDate: string;
        fineDate: string;
        fineAmount: number;
      }>;
      error?: string;
    }>;
    create: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      id: number,
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    updateStatus: (
      id: number,
      status: 'processing' | 'received' | 'lost',
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    updateWorkflow: (
      id: number,
      field: 'packer' | 'status' | 'faultParty',
      value: string | null,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    repairMissingPrices: (
      purchaseId: number,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    uploadVATInvoice: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    uploadCompanyVATInvoice: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    setCompanyVatStatus: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    deleteCompanyVATInvoice: (data: {
      purchaseId: number;
      companyGroup: string;
    }) => Promise<{ success: boolean; error?: string }>;
    uploadVatGroupInvoice: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    uploadImportReceipt: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    deleteImportReceipt: (
      id: number,
    ) => Promise<{ success: boolean; error?: string }>;
    deleteVatInvoice: (
      id: number,
    ) => Promise<{ success: boolean; error?: string }>;
    createVatGroup: (data: {
      purchaseIds: number[];
      note?: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    removeVatGroup: (data: {
      purchaseId: number;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    markAsThht: (
      purchaseId: number,
      revert?: boolean,
    ) => Promise<{ success: boolean; error?: string }>;
    getImportReceiptFileData: (
      purchaseId: number,
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    getImportReceiptPreviewData: (
      purchaseId: number,
    ) => Promise<{
      success: boolean;
      data?: { driveUrls: string[]; localFiles: any[] };
      error?: string;
    }>;
  };
  handlingUnits: {
    getWorkspace: () => Promise<{
      success: boolean;
      data?: {
        catalog: any[];
        register: any[];
        packagingSpecs?: any[];
        qrLabels?: any[];
        suppliers?: any[];
        recentTransactions?: any[];
      };
      error?: string;
    }>;
    createUnits: (
      records: any[],
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    issueQrLabels: (data: {
      sku: string;
      packagingName: string;
      baseUnit: string;
      conversionFactor: number;
      quantity: number;
      supplierId?: number;
      location: { zone: string; rack?: string };
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    resolveQrLabel: (
      code: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    exportLabelsPdf: (data?: { fileName?: string; labelSize?: "A6" | "A7" }) => Promise<{
      success: boolean;
      data?: { path: string };
      error?: string;
    }>;
    markQrLabelsPrinted: (
      codes: string[],
    ) => Promise<{ success: boolean; data?: { count: number }; error?: string }>;
    markQrLabelsReceived: (
      codes: string[],
    ) => Promise<{ success: boolean; data?: { count: number; codes: string[] }; error?: string }>;
    saveRegister: (
      records: any[],
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    unsealUnit: (data: {
      code: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    sealUnit: (data: {
      code: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    pickUnit: (data: {
      code: string;
      quantity: number;
      destination?: "PACKING" | "LOOSE" | "OUTBOUND" | "QUARANTINE";
      note?: string;
      idempotencyKey?: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    requestFinalCheck: (data: {
      code: string;
      idempotencyKey?: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    finalizePick: (data: {
      code: string;
      actualQuantity: number;
      destination?: "PACKING" | "LOOSE" | "OUTBOUND" | "QUARANTINE";
      note?: string;
      idempotencyKey?: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    finalizeShiftCheck: (data: {
      items: Array<{
        code: string;
        expectedQuantity: number;
        actualQuantity: number;
        reason?: string;
        note?: string;
      }>;
      idempotencyKey?: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    moveUnit: (data: {
      code: string;
      location: any;
      note?: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    updateUnit: (data: {
      code: string;
      packagingName: string;
      initialQuantity: number;
      remainingQuantity: number;
      location: { zone?: string; rack?: string };
      note?: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    deleteUnit: (data: {
      code: string;
      reason?: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    getTelegramStatus: () => Promise<{
      success: boolean;
      data?: {
        isRunning: boolean;
        isPollingOwner: boolean;
        pollingOwner: string;
        nodeLabel: string;
        nodeRole: "production" | "development";
        nodePriority: number;
        tokenConfigured: boolean;
        takeoverTimeoutSeconds: number;
        botUsername: string;
        defaultChatId: string;
        groupChatId: string | null;
        groupTitle: string;
        isGroupConnected: boolean;
        lastPollAt: string | null;
        lastError: string | null;
      };
      error?: string;
    }>;
    sendTelegramTest: (data: {
      text: string;
      chatId?: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    onChanged: (callback: (data: any) => void) => () => void;
  };
  suppliers: {
    getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
    create: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      id: number,
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    deactivate: (
      id: number,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    reactivate: (
      id: number,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
  };
  goodsCompanies: {
    getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
    create: (data: {
      name: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      id: string,
      data: { name: string },
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    setProductCompany: (data: {
      productId: number;
      companyId?: string | null;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
  };
  database: {
    exportAll: () => Promise<{
      success: boolean;
      data?: string;
      error?: string;
    }>;
    importAll: () => Promise<{
      success: boolean;
      data?: DatabaseImportStats;
      error?: string;
    }>;
  };
  system: {
    backup: () => Promise<{
      success: boolean;
      data?: { path: string; size: number; filename: string };
      error?: string;
    }>;
    listBackups: () => Promise<{
      success: boolean;
      data?: Array<{
        filename: string;
        path: string;
        size: number;
        createdAt: Date;
        modifiedAt: Date;
      }>;
      error?: string;
    }>;
    restore: (
      backupPath: string,
    ) => Promise<{
      success: boolean;
      data?: {
        restoreDir: string;
        filesRestored: number;
        safetyBackup: string;
        message: string;
      };
      error?: string;
    }>;
    browseAndRestore: () => Promise<{
      success: boolean;
      data?: { filePath: string; message: string };
      error?: string;
    }>;
    inspectBackup: (
      backupPath: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    deleteBackup: (
      backupPath: string,
    ) => Promise<{ success: boolean; error?: string }>;
    getInfo: () => Promise<{
      success: boolean;
      data?: {
        dbStatus: string;
        machineName: string;
        environment: string;
        platform: string;
        appVersion: string;
        nodeVersion: string;
        electronVersion: string;
      };
      error?: string;
    }>;
  };
  dailyTasks: {
    list: (
      filters?: any,
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    create: (
      taskData: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    createAssignments: (
      taskData: any,
      assignees: string[],
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      id: number,
      updates: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    updateStatus: (
      id: number,
      status: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    archive: (
      id: number,
      reason?: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    deleteAssignment: (
      id: number,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    uploadEvidenceImage: (payload: {
      taskId: number;
      mimeType: string;
      data: string;
      hash: string;
    }) => Promise<{
      success: boolean;
      data?: { storagePath: string };
      error?: string;
    }>;
    submitEvidence: (
      payload: any,
    ) => Promise<{
      success: boolean;
      data?: any;
      error?: string;
      reauthRequired?: boolean;
    }>;
    reviewEvidence: (
      taskId: number,
      approved: boolean,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    requestAssignmentCompletion: (
      taskId: number,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    completeRegularTask: (
      taskId: number,
      payload: { verifier: string; assignee?: string },
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    getEvidenceImageUrl: (
      taskId: number,
      storagePath?: string,
    ) => Promise<{ success: boolean; data?: { url: string }; error?: string }>;
    getR2EvidenceImageUrl: (
      taskId: number,
      r2Key: string,
      mimeType?: string,
    ) => Promise<{ success: boolean; data?: { url: string }; error?: string }>;
    getR2EvidenceImageUrls: (
      taskId: number,
      images: Array<{ r2Key: string; mimeType?: string }>,
    ) => Promise<{
      success: boolean;
      data?: {
        results: Array<{
          r2Key: string;
          success: boolean;
          data?: { url: string };
          error?: string;
        }>;
      };
      error?: string;
    }>;
    getDriveEvidenceImageUrl: (
      taskId: number,
      driveUrl: string,
      mimeType?: string,
    ) => Promise<{ success: boolean; data?: { url: string }; error?: string }>;
    getDriveEvidenceImageUrls: (
      taskId: number,
      images: Array<{ driveUrl: string; mimeType?: string }>,
      requestId?: string,
    ) => Promise<{
      success: boolean;
      data?: {
        results: Array<{
          driveUrl: string;
          success: boolean;
          data?: { url: string };
          error?: string;
        }>;
      };
      error?: string;
    }>;
    onDriveEvidenceImageLoaded: (
      callback: (data: {
        requestId: string;
        result: {
          driveUrl: string;
          success: boolean;
          data?: { url: string };
          error?: string;
        };
      }) => void,
    ) => () => void;
    listEvidencePenalties: (options?: {
      startDate?: string;
      endDate?: string;
    }) => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    getStats: (
      filters?: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    resetDaily: () => Promise<{
      success: boolean;
      data?: {
        reset: boolean;
        dayChanged?: boolean;
        resetCount?: number;
        recurringAssignmentsCreated?: number;
        deadlineNormalized?: number;
        message: string;
      };
      error?: string;
    }>;
  };
  ecommerceExports: {
    getAll: (filters?: {
      since?: string;
      until?: string;
      sinceField?: string;
      limit?: number;
      search?: string;
      statusIn?: string[];
      statusNotIn?: string[];
      skip?: number;
    }) => Promise<{
      success: boolean;
      data?: any[];
      hasMore?: boolean;
      error?: string;
    }>;
    create: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      id: number,
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    bulkDelete: (
      ids: number[],
    ) => Promise<{ success: boolean; data?: number; error?: string }>;
    deleteAll: () => Promise<{
      success: boolean;
      data?: number;
      error?: string;
    }>;
    getCompletedKeys: () => Promise<{
      success: boolean;
      data?: string[];
      error?: string;
    }>;
    checkExistingKeys: (data: {
      orderNumbers?: string[];
      ecommerceExportCodes?: string[];
    }) => Promise<{
      success: boolean;
      data?: { orderNumbers: string[]; ecommerceExportCodes: string[] };
      error?: string;
    }>;
    getPackersByOrderNumbers: (
      orderNumbers: string[],
    ) => Promise<{
      success: boolean;
      data?: Record<string, string>;
      error?: string;
    }>;
    bulkCreate: (
      records: any[],
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    selectFolder: () => Promise<{
      success: boolean;
      data?: string;
      error?: string;
    }>;
    loadExcelFiles: (
      folderPath: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    selectAndWatch: () => Promise<{
      success: boolean;
      data?: any;
      error?: string;
    }>;
    startWatch: (
      folderPath: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    stopWatch: () => Promise<{ success: boolean; error?: string }>;
    onNewFile: (
      callback: (data: { name: string; base64: string; path: string }) => void,
    ) => () => void;
  };
  carrierComplaints: {
    getConfig: () => Promise<{ success: boolean; data?: any; error?: string }>;
    saveConfig: (config: any) => Promise<{ success: boolean; data?: any; error?: string }>;
    reconcile: (data: { orders: any[] }) => Promise<{ success: boolean; data?: any; error?: string }>;
    getHistory: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
    send: (data: any) => Promise<{ success: boolean; data?: any; message?: string; error?: string; reauthRequired?: boolean }>;
  };
  marketplaceOrders: {
    getAll: (filters?: {
      since?: string;
      search?: string;
      limit?: number;
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    delete: (data: {
      id: number;
      userName?: string;
    }) => Promise<{ success: boolean; error?: string }>;
  };
  exportOrders: {
    getAll: (filters?: {
      since?: string;
      search?: string;
      limit?: number;
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    saveWithStock: (data: {
      id?: number;
      idempotencyKey: string;
      customer: string;
      exportDate: string;
      status: string;
      notes?: string;
      items: Array<{
        sku: string;
        productName: string;
        color?: string;
        quantity: number;
        unitPrice: number;
      }>;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    create: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      id: number,
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    delete: (
      id: number,
      options?: { idempotencyKey?: string },
    ) => Promise<{ success: boolean; error?: string }>;
    adjustStock: (data: StockMutationPayload) => Promise<StockMutationResult>;
  };
  posOrder: {
    create: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    getAll: (
      filters?: any,
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    getById: (
      id: number,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    getBySkus: (
      skus: string[],
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
  };
  returns: {
    getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
    create: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      id: number,
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    addProcessNote: (
      id: number,
      note: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    bulkCreate: (
      records: any[],
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
  };
  refunds: {
    getAll: (filters?: {
      since?: string;
      limit?: number;
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    create: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      id: number,
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    bulkDelete: (
      ids: number[],
    ) => Promise<{ success: boolean; data?: number; error?: string }>;
    bulkCreate: (
      records: any[],
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    importFromFolder: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
      folderPath?: string;
      fileResults?: any[];
      totalFiles?: number;
      totalRows?: number;
    }>;
    adjustStock: (data: StockMutationPayload) => Promise<StockMutationResult>;
    completeAndRestore: (data: {
      refundId: number;
      items?: Array<{
        sku?: string;
        variantSku?: string;
        quantity?: number;
        qty?: number;
        name?: string;
        productName?: string;
      }>;
      notes?: string;
      isCustom?: boolean;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
  };
  stockBalance: {
    getAll: (filters?: {
      limit?: number;
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    apply: (data: {
      idempotencyKey: string;
      adjustments: StockMutationPayload[];
      record: any;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    create: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    adjustStock: (data: StockMutationPayload) => Promise<StockMutationResult>;
  };
  inventory: {
    manualAdjust: (data: StockMutationPayload) => Promise<StockMutationResult>;
  };
  offlineQueue: {
    status: () => Promise<{ success: boolean; pendingCount: number }>;
    sync: () => Promise<{
      success: boolean;
      synced: number;
      failed: number;
      remaining?: number;
      errors?: Array<{ file: string; error: string }>;
    }>;
  };
  inventoryLogs: {
    getAll: (filters?: {
      sku?: string;
      type?: string;
      referenceType?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    getBySku: (params: {
      sku: string;
      limit?: number;
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    getBySkus: (params: {
      skus: string[];
      limit?: number;
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
  };
  pickup: {
    sendTelegram: (data: {
      message: string;
    }) => Promise<{ success: boolean; error?: string }>;
    selectAndWatch: () => Promise<{
      success: boolean;
      data?: { folderPath: string; existingFiles: number };
      error?: string;
    }>;
    startWatch: (
      folderPath: string,
    ) => Promise<{
      success: boolean;
      data?: { folderPath: string; existingFiles: number };
      error?: string;
    }>;
    readFolderFiles: (
      folderPath: string,
    ) => Promise<{
      success: boolean;
      data?: { name: string; base64: string }[];
      error?: string;
    }>;
    stopWatch: () => Promise<{ success: boolean; error?: string }>;
    onNewFile: (
      callback: (data: { name: string; base64: string; path: string }) => void,
    ) => () => void;
  };
  appConfig: {
    get: (
      key: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    set: (
      key: string,
      value: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
  };
  attendance: {
    updateLeaveStatus: (data: {
      empId: number;
      date: string;
      sessions: Array<"morning" | "afternoon">;
      status: "paid" | "unpaid" | "exempt" | "clear";
      note?: string;
    }) => Promise<{
      success: boolean;
      data?: { leaveRecords?: any[] };
      error?: string;
    }>;
    updatePayrollOverride: (data: {
      empId: number;
      periodKey: string;
      patch?: {
        extraShifts?: number;
        extraAdjust?: number;
        adjustNote?: string;
      };
      clear?: boolean;
    }) => Promise<{
      success: boolean;
      data?: {
        overrideKey: string;
        override: {
          extraShifts?: number;
          extraAdjust?: number;
          adjustNote?: string;
          updatedAt?: string;
          updatedBy?: string;
        } | null;
      };
      error?: string;
    }>;
    updatePayrollLock: (data: {
      action: "lock" | "unlock";
      lock?: any;
      start?: string;
      end?: string;
    }) => Promise<{
      success: boolean;
      data?: { lockedPeriods: any[] };
      error?: string;
    }>;
    getPayslipQrImage: (data: { url: string }) => Promise<{
      success: boolean;
      data?: { dataUrl: string };
      error?: string;
    }>;
    sendPayslipEmail: (data: {
      to: string;
      employeeName: string;
      period: string;
      fileName: string;
      pdfBytes?: Uint8Array;
      pdfBase64?: string;
    }) => Promise<{
      success: boolean;
      reauthRequired?: boolean;
      data?: { id?: string };
      error?: string;
    }>;
  };
  stockCheck: {
    getSessions: (options?: { maintenance?: boolean }) => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    ensureDailySession: (data: {
      items: any[];
    }) => Promise<{
      success: boolean;
      session?: any;
      data?: any[];
      error?: string;
    }>;
    createFullSession: (data: {
      items: any[];
      assignedTo: string;
    }) => Promise<{
      success: boolean;
      session?: any;
      created?: boolean;
      error?: string;
    }>;
    cancelSession: (data: {
      sessionId: string;
      reason?: string;
    }) => Promise<{
      success: boolean;
      session?: any;
      error?: string;
    }>;
    createRecheckSession: (data: {
      sourceSessionId: string;
      scope: "mismatch" | "all";
      skus: string[];
      assignedTo: string;
      reason: string;
    }) => Promise<{
      success: boolean;
      session?: any;
      data?: any[];
      error?: string;
    }>;
    adminSaveSessions: (
      sessions: any[],
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    updateCount: (data: {
      sessionId: string;
      sku: string;
      actualStock: number;
    }) => Promise<{
      success: boolean;
      status?: string;
      item?: any;
      error?: string;
    }>;
    retryCount: (data: {
      sessionId: string;
      sku: string;
    }) => Promise<{
      success: boolean;
      status?: string;
      item?: any;
      code?: string;
      error?: string;
    }>;
    updateNote: (data: {
      sessionId: string;
      sku: string;
      note: string;
    }) => Promise<{ success: boolean; item?: any; error?: string }>;
    getReconciliationLogs: (data: {
      sessionId: string;
      sku: string;
      page?: number;
    }) => Promise<{
      success: boolean;
      data?: {
        logs: Array<{
          id: number;
          sku: string;
          type: string;
          referenceType?: string | null;
          reference?: string | null;
          quantity: number;
          createdAt: string;
        }>;
        total: number;
        page: number;
        pageSize: number;
      };
      error?: string;
    }>;
    balanceItems: (data: {
      sessionId: string;
      reference: string;
      date?: string;
      items: Array<{ sku: string }>;
      historyNotes?: string;
      logPrefix?: string;
    }) => Promise<{
      success: boolean;
      duplicate?: boolean;
      adjustedCount?: number;
      matchedCount?: number;
      data?: { sessions?: any[]; stockBalance?: any };
      error?: string;
    }>;
    balanceItem: (data: {
      sessionId: string;
      sku: string;
      note?: string;
      reference?: string;
    }) => Promise<{
      success: boolean;
      status?: string;
      item?: any;
      session?: any;
      error?: string;
    }>;
    submitSession: (data: {
      sessionId: string;
    }) => Promise<{
      success: boolean;
      status?: "completed" | "already_completed";
      session?: any;
      code?: string;
      error?: string;
    }>;
  };
  dailyExpenses: {
    getAll: (filters?: {
      startDate?: string;
      endDate?: string;
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    upsert: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };
  users: {
    getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
    create: (
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      id: number,
      data: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    updateProfile: (data: {
      fullName: string;
      avatar?: string | null;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    changePassword: (data: {
      userId: number;
      oldPassword: string;
      newPassword: string;
    }) => Promise<{ success: boolean; error?: string }>;
    resetPassword: (data: {
      userId: number;
      newPassword: string;
    }) => Promise<{ success: boolean; error?: string }>;
    forcePasswordChange: (
      userId: number,
    ) => Promise<{ success: boolean; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    login: (
      username: string,
      password: string,
      rememberMe?: boolean,
    ) => Promise<{
      success: boolean;
      data?: any;
      rememberToken?: string | null;
      error?: string;
    }>;
    logout: (rememberToken?: string) => Promise<{ success: boolean }>;
    restoreSession: (
      rememberToken?: string,
    ) => Promise<{ success: boolean; data?: any }>;
    getCurrentSession: () => Promise<{ success: boolean; data?: any }>;
    ensureAdmin: () => Promise<{ success: boolean; error?: string }>;
    heartbeat: () => Promise<{ success: boolean }>;
  };
  combos: {
    getAll: () => Promise<{
      success: boolean;
      data?: ComboProduct[];
      error?: string;
    }>;
    getById: (
      id: number,
    ) => Promise<{ success: boolean; data?: ComboProduct; error?: string }>;
    create: (
      data: Partial<ComboProduct>,
    ) => Promise<{ success: boolean; data?: ComboProduct; error?: string }>;
    update: (
      id: number,
      data: Partial<ComboProduct>,
    ) => Promise<{ success: boolean; data?: ComboProduct; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };
  update: {
    getCurrentVersion: () => Promise<{
      success: boolean;
      data?: string;
      error?: string;
    }>;
    check: () => Promise<{
      success: boolean;
      data?: {
        currentVersion: string;
        latestVersion: string;
        hasUpdate: boolean;
        releaseNotes: string;
        publishedAt: string;
        downloadUrl: string | null;
        downloadSize: number;
      };
      error?: string;
    }>;
    download: (
      downloadUrl: string,
    ) => Promise<{
      success: boolean;
      data?: { version: string };
      error?: string;
    }>;
    restoreVersion: (
      version: string,
    ) => Promise<{
      success: boolean;
      data?: { version: string };
      error?: string;
    }>;
    restart: () => Promise<void>;
    getHistory: () => Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        fromVersion: string;
        toVersion: string;
        updatedAt: string;
        machine?: string;
        notes?: string;
      }>;
      error?: string;
    }>;
  };
  shell: {
    openExternal: (
      url: string,
    ) => Promise<{ success: boolean; error?: string }>;
  };
  einvoice: {
    getAll: (filters?: {
      limit?: number;
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    bulkImport: (
      orders: any[],
    ) => Promise<{
      success: boolean;
      data?: { imported: number; duplicated: number; duplicateIds: string[] };
      error?: string;
    }>;
    issueInvoices: (
      orderIds: string[],
    ) => Promise<{
      success: boolean;
      data?: {
        issued: any[];
        issuedCount: number;
        skippedCount: number;
        batchId: string;
        errorLog?: any[];
        errorCount?: number;
      };
      error?: string;
    }>;
    exportExcel: (
      filters?: any,
    ) => Promise<{
      success: boolean;
      data?: { filePath: string; count: number };
      error?: string;
    }>;
    getStats: () => Promise<{
      success: boolean;
      data?: {
        total: number;
        issued: number;
        pending: number;
        totalIssuedAmount: number;
      };
      error?: string;
    }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    bulkDelete: (
      orderIds: string[],
    ) => Promise<{
      success: boolean;
      data?: { deleted: number };
      error?: string;
    }>;
    getOriginalInvoice: (
      orderId: string,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    adjustInvoice: (data: {
      orderId: string;
      adjustmentType: string;
      reason?: string;
      partialItems?: any[];
    }) => Promise<{
      success: boolean;
      data?: {
        originalInvoice: string;
        newInvoice: string;
        adjustmentType: string;
        reason: string;
        chainNumber?: number;
        totalAdjusted?: number;
        remaining?: number;
      };
      error?: string;
    }>;
    getInvoiceChain: (
      orderId: string,
    ) => Promise<{
      success: boolean;
      data?: {
        original: any;
        adjustments: any[];
        totalAdjusted: number;
        remaining: number;
        chainLength: number;
      };
      error?: string;
    }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
