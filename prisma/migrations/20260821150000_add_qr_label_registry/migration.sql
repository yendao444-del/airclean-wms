CREATE TABLE "PackagingSpec" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "conversionFactor" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "note" TEXT,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    CONSTRAINT "PackagingSpec_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductSupplier" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantSku" TEXT,
    "supplierId" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastPurchasePrice" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductSupplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HandlingUnitLabel" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "packagingSpecId" INTEGER NOT NULL,
    "packagingName" TEXT NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "conversionFactor" INTEGER NOT NULL,
    "supplierId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'printed',
    "batchCode" TEXT NOT NULL,
    "issuedBy" INTEGER,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "handlingUnitCode" TEXT,
    CONSTRAINT "HandlingUnitLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HandlingUnitLabel_code_key" ON "HandlingUnitLabel"("code");
CREATE UNIQUE INDEX "ProductSupplier_productId_variantSku_supplierId_key" ON "ProductSupplier"("productId", "variantSku", "supplierId");
CREATE INDEX "PackagingSpec_sku_status_idx" ON "PackagingSpec"("sku", "status");
CREATE INDEX "PackagingSpec_productId_status_idx" ON "PackagingSpec"("productId", "status");
CREATE INDEX "ProductSupplier_variantSku_status_idx" ON "ProductSupplier"("variantSku", "status");
CREATE INDEX "ProductSupplier_supplierId_status_idx" ON "ProductSupplier"("supplierId", "status");
CREATE INDEX "HandlingUnitLabel_sku_status_idx" ON "HandlingUnitLabel"("sku", "status");
CREATE INDEX "HandlingUnitLabel_batchCode_idx" ON "HandlingUnitLabel"("batchCode");
CREATE INDEX "HandlingUnitLabel_supplierId_status_idx" ON "HandlingUnitLabel"("supplierId", "status");

ALTER TABLE "PackagingSpec" ADD CONSTRAINT "PackagingSpec_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HandlingUnitLabel" ADD CONSTRAINT "HandlingUnitLabel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HandlingUnitLabel" ADD CONSTRAINT "HandlingUnitLabel_packagingSpecId_fkey" FOREIGN KEY ("packagingSpecId") REFERENCES "PackagingSpec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HandlingUnitLabel" ADD CONSTRAINT "HandlingUnitLabel_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
