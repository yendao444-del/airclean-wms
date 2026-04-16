-- Add index on createdAt for EcommerceExport to optimize 30-day filter queries
CREATE INDEX IF NOT EXISTS "EcommerceExport_createdAt_idx" ON "EcommerceExport"("createdAt");
