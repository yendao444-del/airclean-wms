-- Add faultParty column to Return table if not exists
-- "warehouse" = lỗi kho → ghi phạt, "customer" = lỗi khách hàng → bỏ qua
ALTER TABLE "Return" ADD COLUMN IF NOT EXISTS "faultParty" TEXT DEFAULT 'warehouse';
