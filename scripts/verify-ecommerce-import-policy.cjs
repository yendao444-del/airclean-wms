const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
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
assert.equal(isAuthoritativePendingSnapshot("tiktok", ["OrderSKUList.xlsx"]), true);

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
assert.match(preload, /ecommerceExports:resolveMismatch/);
assert.match(renderer, /Cần kiểm tra: \{operationalCounts\.mismatch\}/);
assert.match(renderer, /handleResolveMismatch\(record, 'pickup'\)/);
assert.match(renderer, /handleResolveMismatch\(record, 'cancel'\)/);
assert.match(renderer, /FAIL - CẦN KIỂM TRA/);
assert.match(renderer, /className="ecommerce-review-button"/);
assert.match(renderer, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
assert.match(renderer, /const optimisticCompleted = \{/);
assert.match(renderer, /setEcommerceExports\(optimisticRecords\)/);
assert.match(renderer, /void loadEcommerceExports\(true\)/);

console.log("Đã kiểm tra chính sách snapshot TMĐT.");
