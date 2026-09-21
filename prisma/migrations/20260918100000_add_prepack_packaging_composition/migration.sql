ALTER TABLE "PrepackBatch"
  ADD COLUMN "packagingType" TEXT NOT NULL DEFAULT 'single',
  ADD COLUMN "packagingKey" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "packagingLabel" TEXT,
  ADD COLUMN "packSize" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "componentsJson" TEXT;

UPDATE "PrepackBatch"
SET
  "packagingKey" = CASE WHEN "packagingKey" = '' THEN "productSku" ELSE "packagingKey" END,
  "packagingLabel" = COALESCE("packagingLabel", "productName");

CREATE INDEX "PrepackBatch_packagingKey_status_idx" ON "PrepackBatch"("packagingKey", "status");
