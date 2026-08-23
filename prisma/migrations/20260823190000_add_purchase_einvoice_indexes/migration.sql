CREATE INDEX CONCURRENTLY IF NOT EXISTS "PurchaseOrder_status_createdAt_idx"
ON "PurchaseOrder"("status", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "PurchaseOrder_supplierId_createdAt_idx"
ON "PurchaseOrder"("supplierId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "PurchaseOrder_createdAt_idx"
ON "PurchaseOrder"("createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "PurchaseItem_purchaseOrderId_idx"
ON "PurchaseItem"("purchaseOrderId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "PurchaseItem_productId_idx"
ON "PurchaseItem"("productId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "PurchaseItem_variantSku_idx"
ON "PurchaseItem"("variantSku");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "EInvoice_createdAt_idx"
ON "EInvoice"("createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "EInvoice_status_createdAt_idx"
ON "EInvoice"("status", "createdAt");
