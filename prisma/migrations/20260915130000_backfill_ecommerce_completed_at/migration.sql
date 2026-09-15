-- Preserve the recorded handover timestamp for completed rows created before
-- completedAt was introduced.
UPDATE "EcommerceExport"
SET "completedAt" = "ecommerceExportDate"
WHERE "status" = 'completed'
  AND "completedAt" IS NULL
  AND "ecommerceExportDate" IS NOT NULL;
