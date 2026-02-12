-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "recordId" INTEGER,
    "recordName" TEXT,
    "changes" TEXT,
    "description" TEXT NOT NULL,
    "userName" TEXT NOT NULL DEFAULT 'Admin',
    "userId" INTEGER,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "ipAddress" TEXT,
    "deviceInfo" TEXT
);

-- CreateIndex
CREATE INDEX "ActivityLog_module_timestamp_idx" ON "ActivityLog"("module", "timestamp");

-- CreateIndex
CREATE INDEX "ActivityLog_module_recordId_idx" ON "ActivityLog"("module", "recordId");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_timestamp_idx" ON "ActivityLog"("userId", "timestamp");
