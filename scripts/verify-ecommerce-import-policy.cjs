const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  detectTikTokSnapshotKind,
  detectMarketplaceSnapshotKind,
  hasTikTokBusinessRows,
  isAuthoritativePendingSnapshot,
  isPickupEligibleStatus,
} = require("../electron/ecommerce-import-policy");

assert.equal(
  isAuthoritativePendingSnapshot("shopee", ["Order.toship.20260817_20260916 (1).xlsx"]),
  true,
);
assert.equal(
  isAuthoritativePendingSnapshot("shopee", ["Order.shipping.20260915_20260916 (1).xlsx"]),
  false,
);
assert.equal(isAuthoritativePendingSnapshot("shopee", []), false);
assert.equal(
  isAuthoritativePendingSnapshot(
    "tiktok",
    ["Đang giao đơn hàng-2026-09-17-11_53.xlsx"],
    "pending",
  ),
  true,
);
assert.equal(
  isAuthoritativePendingSnapshot(
    "tiktok",
    ["Đang giao đơn hàng-2026-09-17-11_53.xlsx"],
    "shipping",
  ),
  false,
);
assert.equal(isAuthoritativePendingSnapshot("tiktok", ["OrderSKUList.xlsx"]), false);
assert.equal(
  detectMarketplaceSnapshotKind("shopee", ["Order.shipping.20260915_20260916.xlsx"]),
  "shipping",
);
assert.equal(detectMarketplaceSnapshotKind("tiktok", ["OrderSKUList.xlsx"], "invalid"), "unknown");

const tiktokDescriptionRow = { "Order ID": "Platform unique order ID." };
const tiktokPendingRow = {
  "Order ID": "PENDING-1",
  "Order Status": "Cần vận chuyển",
  "Order Substatus": "Đang chờ lấy hàng",
  "Shipped Time": "",
};
const tiktokShippingRow = {
  "Order ID": "SHIPPING-1",
  "Order Status": "Đang vận chuyển",
  "Order Substatus": "Đang giao",
  "Shipped Time": "17/09/2026 10:30:00",
};
assert.equal(hasTikTokBusinessRows([tiktokDescriptionRow]), false);
assert.equal(hasTikTokBusinessRows([tiktokDescriptionRow, tiktokPendingRow]), true);
assert.equal(detectTikTokSnapshotKind([tiktokDescriptionRow]), "unknown");
assert.equal(detectTikTokSnapshotKind([tiktokDescriptionRow, tiktokPendingRow]), "pending");
assert.equal(detectTikTokSnapshotKind([tiktokShippingRow]), "shipping");
assert.equal(detectTikTokSnapshotKind([tiktokPendingRow, tiktokShippingRow]), "unknown");

assert.equal(isPickupEligibleStatus("pending"), true);
assert.equal(isPickupEligibleStatus("processing"), true);
assert.equal(isPickupEligibleStatus("mismatch"), false);
assert.equal(isPickupEligibleStatus("cancelled"), false);
assert.equal(isPickupEligibleStatus("completed"), false);
assert.equal(isPickupEligibleStatus("unknown"), false);

const root = path.join(__dirname, "..");
const ipc = fs.readFileSync(path.join(root, "electron", "ipc-handlers.js"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src", "pages", "EcommerceExport.tsx"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron", "preload.js"), "utf8");

assert.match(ipc, /oldRecord\.status === "mismatch" && !allowMismatchPickup/);
assert.match(ipc, /current\.status !== "mismatch"/);
assert.match(ipc, /current\.updatedAt\?\.getTime\(\) !== expectedUpdatedAt\.getTime\(\)/);
assert.match(ipc, /existing\.status === "cancelled"/);
assert.match(ipc, /snapshotKind === "shipping"/);
assert.match(ipc, /TMDT_SHIPPING_RECONCILE/);
assert.match(ipc, /reconcileExisting: true/);
assert.match(ipc, /allowMissingSkus: allowMismatchPickup/);
assert.match(ipc, /existing\.status === "cancelled"/);
assert.match(ipc, /status: \{ in: \["pending", "processing"\] \}/);
assert.match(preload, /ecommerceExports:resolveMismatch/);
assert.match(renderer, /row\?\.\['Order Substatus'\]/);
assert.match(renderer, /row\?\.\['Shipped Time'\]/);
assert.match(renderer, /isEmptyTikTokSnapshot \? 'pending' : detectedSnapshotKind/);
assert.match(renderer, /snapshotKind,/);
assert.match(renderer, /Cần kiểm tra: \{operationalCounts\.mismatch\}/);
assert.match(renderer, /handleResolveMismatch\(record, 'pickup'\)/);
assert.match(renderer, /handleResolveMismatch\(record, 'cancel'\)/);
assert.match(renderer, /foundEcommerceExport\.status !== 'mismatch' && !isPickupEligibleStatus/);
assert.match(renderer, /action: 'pickup'/);
assert.match(renderer, /className="ecommerce-review-button"/);
assert.match(renderer, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
assert.match(renderer, /const optimisticCompleted = \{/);
assert.match(renderer, /setEcommerceExports\(optimisticRecords\)/);
assert.match(renderer, /void loadEcommerceExports\(true\)/);

console.log("Đã kiểm tra chính sách snapshot TMĐT.");
