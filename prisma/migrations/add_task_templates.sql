-- AddTaskTemplates
CREATE TABLE "TaskTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee" TEXT NOT NULL,
    "verifier" TEXT,
    "area" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "category" TEXT NOT NULL DEFAULT 'general',
    "defaultHour" INTEGER NOT NULL DEFAULT 9,
    "defaultMinute" INTEGER NOT NULL DEFAULT 0,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringDays" TEXT,
    "tags" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Add templateId to DailyTask
ALTER TABLE "DailyTask" ADD COLUMN "templateId" INTEGER;

-- Create indexes
CREATE INDEX "TaskTemplate_isActive_idx" ON "TaskTemplate"("isActive");
CREATE INDEX "DailyTask_templateId_idx" ON "DailyTask"("templateId");
