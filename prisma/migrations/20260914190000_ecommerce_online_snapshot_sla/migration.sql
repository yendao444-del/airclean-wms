ALTER TABLE "EcommerceExport"
  ADD COLUMN IF NOT EXISTS "trackingNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "orderPlacedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "slaDeadlineAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mismatchAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mismatchReason" TEXT,
  ADD COLUMN IF NOT EXISTS "lastSeenImportBatchId" INTEGER;

CREATE TABLE IF NOT EXISTS "EcommerceImportBatch" (
  "id" SERIAL NOT NULL,
  "platform" TEXT NOT NULL,
  "fileNames" TEXT,
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "mismatchCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EcommerceImportBatch_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'EcommerceExport_lastSeenImportBatchId_fkey'
  ) THEN
    ALTER TABLE "EcommerceExport"
      ADD CONSTRAINT "EcommerceExport_lastSeenImportBatchId_fkey"
      FOREIGN KEY ("lastSeenImportBatchId") REFERENCES "EcommerceImportBatch"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "EcommerceExport_trackingNumber_idx" ON "EcommerceExport"("trackingNumber");
CREATE INDEX IF NOT EXISTS "EcommerceExport_status_slaDeadlineAt_idx" ON "EcommerceExport"("status", "slaDeadlineAt");
CREATE INDEX IF NOT EXISTS "EcommerceExport_lastSeenImportBatchId_idx" ON "EcommerceExport"("lastSeenImportBatchId");
CREATE INDEX IF NOT EXISTS "EcommerceImportBatch_platform_createdAt_idx" ON "EcommerceImportBatch"("platform", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "EcommerceExport_customerName_orderNumber_key"
  ON "EcommerceExport"("customerName", "orderNumber");

UPDATE "EcommerceExport"
SET "trackingNumber" = NULLIF(BTRIM(SUBSTRING("notes" FROM 'Tracking:\\s*([^|]+)')), '')
WHERE "trackingNumber" IS NULL
  AND "notes" ~ 'Tracking:\\s*[^|]+';

UPDATE "EcommerceExport"
SET "orderPlacedAt" = (
  SUBSTRING("notes" FROM 'OrderPlacedAt:\\s*([^|]+)')::TIMESTAMPTZ AT TIME ZONE 'UTC'
)
WHERE "orderPlacedAt" IS NULL
  AND SUBSTRING("notes" FROM 'OrderPlacedAt:\\s*([^|]+)')
      ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}';

UPDATE "EcommerceExport"
SET "completedAt" = "ecommerceExportDate"
WHERE "status" = 'completed' AND "completedAt" IS NULL;
