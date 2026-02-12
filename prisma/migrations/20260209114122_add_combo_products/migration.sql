-- CreateTable
CREATE TABLE "ComboProduct" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "items" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "cost" REAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Bộ',
    "images" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ComboProduct_sku_key" ON "ComboProduct"("sku");

-- CreateIndex
CREATE INDEX "ComboProduct_status_idx" ON "ComboProduct"("status");

-- CreateIndex
CREATE INDEX "ComboProduct_sku_idx" ON "ComboProduct"("sku");
