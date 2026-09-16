CREATE TABLE "PrepackBatch" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "productId" INTEGER,
    "productSku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'gói',
    "requestedQty" INTEGER NOT NULL,
    "reportedQty" INTEGER NOT NULL DEFAULT 0,
    "acceptedQty" INTEGER NOT NULL DEFAULT 0,
    "issuedQty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "packerId" INTEGER,
    "packerUsername" TEXT NOT NULL,
    "packerName" TEXT NOT NULL,
    "acceptorId" INTEGER,
    "acceptorUsername" TEXT,
    "acceptorName" TEXT,
    "createdById" INTEGER,
    "createdByName" TEXT NOT NULL,
    "note" TEXT,
    "discrepancyReason" TEXT,
    "reportedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrepackBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrepackEvidence" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" INTEGER,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrepackEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrepackMovement" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" INTEGER,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrepackMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrepackBatch_code_key" ON "PrepackBatch"("code");
CREATE INDEX "PrepackBatch_status_createdAt_idx" ON "PrepackBatch"("status", "createdAt");
CREATE INDEX "PrepackBatch_packerUsername_status_idx" ON "PrepackBatch"("packerUsername", "status");
CREATE INDEX "PrepackBatch_productSku_status_idx" ON "PrepackBatch"("productSku", "status");
CREATE UNIQUE INDEX "PrepackEvidence_objectKey_key" ON "PrepackEvidence"("objectKey");
CREATE UNIQUE INDEX "PrepackEvidence_sha256_key" ON "PrepackEvidence"("sha256");
CREATE INDEX "PrepackEvidence_batchId_createdAt_idx" ON "PrepackEvidence"("batchId", "createdAt");
CREATE INDEX "PrepackMovement_batchId_createdAt_idx" ON "PrepackMovement"("batchId", "createdAt");

ALTER TABLE "PrepackEvidence" ADD CONSTRAINT "PrepackEvidence_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "PrepackBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PrepackMovement" ADD CONSTRAINT "PrepackMovement_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "PrepackBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
