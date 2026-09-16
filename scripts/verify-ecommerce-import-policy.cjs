const assert = require("node:assert/strict");
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
assert.equal(isPickupEligibleStatus("mismatch"), true);
assert.equal(isPickupEligibleStatus("cancelled"), false);
assert.equal(isPickupEligibleStatus("completed"), false);
assert.equal(isPickupEligibleStatus("unknown"), false);

console.log("Đã kiểm tra chính sách snapshot TMĐT.");
