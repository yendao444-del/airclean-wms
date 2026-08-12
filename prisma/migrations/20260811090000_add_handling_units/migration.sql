CREATE TABLE "HandlingUnit" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "purchaseOrderId" INTEGER,
    "purchaseItemId" INTEGER,
    "productId" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "color" TEXT,
    "packagingName" TEXT NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "conversionFactor" INTEGER NOT NULL,
    "initialQuantity" INTEGER NOT NULL,
    "remainingQuantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sealed',
    "zone" TEXT NOT NULL DEFAULT 'Chưa phân khu',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HandlingUnit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HandlingUnit_code_key" ON "HandlingUnit"("code");
CREATE INDEX "HandlingUnit_sku_status_idx" ON "HandlingUnit"("sku", "status");
CREATE INDEX "HandlingUnit_purchaseOrderId_idx" ON "HandlingUnit"("purchaseOrderId");
