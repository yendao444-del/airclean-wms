-- Device discovery is observe-only at first. Attendance remains available
-- until an explicit enforcement migration/configuration is introduced.
ALTER TABLE "AttendanceLog"
  ADD COLUMN IF NOT EXISTS "deviceId" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceName" TEXT,
  ADD COLUMN IF NOT EXISTS "devicePublicIp" TEXT;

CREATE TABLE IF NOT EXISTS "AttendanceDevice" (
  "id" SERIAL NOT NULL,
  "deviceId" TEXT NOT NULL,
  "deviceCode" TEXT NOT NULL,
  "machineName" TEXT NOT NULL,
  "requesterUserId" INTEGER,
  "requesterName" TEXT,
  "publicKey" TEXT,
  "keyFingerprint" TEXT,
  "keyProvider" TEXT NOT NULL DEFAULT 'windows-dpapi',
  "tpmAvailable" BOOLEAN NOT NULL DEFAULT false,
  "macAddress" TEXT,
  "publicIp" TEXT,
  "networkName" TEXT,
  "networkVerified" BOOLEAN NOT NULL DEFAULT false,
  "appVersion" TEXT,
  "platform" TEXT,
  "status" TEXT NOT NULL DEFAULT 'unregistered',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "approvedById" INTEGER,
  "approvedByName" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectedById" INTEGER,
  "rejectedByName" TEXT,
  "revokedAt" TIMESTAMP(3),
  "revokedById" INTEGER,
  "revokedByName" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AttendanceDevice_pkey" PRIMARY KEY ("id")
);

-- The desktop backend connects with the dedicated app_user role, matching the
-- existing operational tables. Authorization remains enforced by IPC roles.
ALTER TABLE "AttendanceDevice" DISABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceDevice_deviceId_key" ON "AttendanceDevice"("deviceId");
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceDevice_deviceCode_key" ON "AttendanceDevice"("deviceCode");
CREATE INDEX IF NOT EXISTS "AttendanceDevice_status_lastSeenAt_idx" ON "AttendanceDevice"("status", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "AttendanceDevice_requesterUserId_idx" ON "AttendanceDevice"("requesterUserId");
CREATE INDEX IF NOT EXISTS "AttendanceLog_deviceId_timestamp_idx" ON "AttendanceLog"("deviceId", "timestamp");
