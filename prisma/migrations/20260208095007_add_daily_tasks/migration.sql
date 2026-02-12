-- CreateTable
CREATE TABLE "DailyTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee" TEXT NOT NULL,
    "verifier" TEXT,
    "area" TEXT,
    "dueDate" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "category" TEXT NOT NULL DEFAULT 'general',
    "tags" TEXT,
    "attachments" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'System'
);

-- CreateIndex
CREATE INDEX "DailyTask_status_dueDate_idx" ON "DailyTask"("status", "dueDate");

-- CreateIndex
CREATE INDEX "DailyTask_assignee_status_idx" ON "DailyTask"("assignee", "status");

-- CreateIndex
CREATE INDEX "DailyTask_dueDate_idx" ON "DailyTask"("dueDate");
