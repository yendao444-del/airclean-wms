-- Optimize Xuat hang TMDT list/search queries.
CREATE INDEX IF NOT EXISTS "EcommerceExport_orderNumber_idx" ON "EcommerceExport"("orderNumber");
CREATE INDEX IF NOT EXISTS "EcommerceExport_ecommerceExportCode_idx" ON "EcommerceExport"("ecommerceExportCode");
CREATE INDEX IF NOT EXISTS "EcommerceExport_status_ecommerceExportDate_idx" ON "EcommerceExport"("status", "ecommerceExportDate");
CREATE INDEX IF NOT EXISTS "EcommerceExport_status_createdAt_idx" ON "EcommerceExport"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "EcommerceExport_status_updatedAt_idx" ON "EcommerceExport"("status", "updatedAt");
