const assert = require("node:assert/strict");
const { calculateMarketplaceSlaDeadline } = require("../electron/ecommerce-sla");

const cases = [
  ["trước 14:00", "2026-09-14T06:59:00.000Z", "2026-09-14T16:59:59.999Z"],
  ["đúng 14:00", "2026-09-14T07:00:00.000Z", "2026-09-15T16:59:59.999Z"],
  ["thứ Bảy sau 14:00", "2026-09-19T08:00:00.000Z", "2026-09-21T16:59:59.999Z"],
  ["Chủ nhật", "2026-09-20T03:00:00.000Z", "2026-09-21T16:59:59.999Z"],
];

for (const [name, input, expected] of cases) {
  assert.equal(calculateMarketplaceSlaDeadline(input)?.toISOString(), expected, name);
}

assert.equal(calculateMarketplaceSlaDeadline("không hợp lệ"), null);
console.log(`Đã kiểm tra ${cases.length + 1} trường hợp SLA TMĐT.`);
