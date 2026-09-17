const SNAPSHOT_KINDS = new Set(["pending", "shipping", "unknown"]);

function normalizeSnapshotKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return SNAPSHOT_KINDS.has(kind) ? kind : "unknown";
}

function normalizeMarketplaceText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .trim();
}

function getTikTokBusinessRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const orderId = String(row?.["Order ID"] || "").trim();
    return orderId && !orderId.includes("Platform unique");
  });
}

function hasTikTokBusinessRows(rows) {
  return getTikTokBusinessRows(rows).length > 0;
}

function detectTikTokSnapshotKind(rows) {
  const businessRows = getTikTokBusinessRows(rows);
  if (businessRows.length === 0) return "unknown";
  let pending = 0;
  let shipping = 0;
  for (const row of businessRows) {
    const status = normalizeMarketplaceText(row?.["Order Status"]);
    const substatus = normalizeMarketplaceText(row?.["Order Substatus"]);
    const shippedAt = String(row?.["Shipped Time"] || "").trim();
    const combined = `${status} ${substatus}`;
    const shippingState =
      /in transit|shipped|delivered|dang van chuyen|da van chuyen|dang giao|da giao/.test(combined) ||
      Boolean(shippedAt);
    const pendingState =
      /cho lay hang|cho van chuyen|can van chuyen|awaiting pickup|awaiting collection|to ship/.test(combined) &&
      !shippingState;
    if (shippingState) shipping += 1;
    else if (pendingState) pending += 1;
  }
  if (pending === businessRows.length) return "pending";
  if (shipping === businessRows.length) return "shipping";
  return "unknown";
}

function detectMarketplaceSnapshotKind(platform, fileNames, reportedKind) {
  const platformKey = String(platform || "").trim().toLowerCase();
  const names = Array.isArray(fileNames) ? fileNames : [];
  if (platformKey === "shopee") {
    if (
      names.length > 0 &&
      names.every((name) =>
        /(?:^|[._\-\s])toship(?:[._\-\s]|$)/i.test(String(name || "")),
      )
    ) {
      return "pending";
    }
    if (
      names.some((name) =>
        /(?:^|[._\-\s])shipping(?:[._\-\s]|$)/i.test(String(name || "")),
      )
    ) {
      return "shipping";
    }
    return "unknown";
  }
  if (platformKey === "tiktok") return normalizeSnapshotKind(reportedKind);
  return "unknown";
}

function isAuthoritativePendingSnapshot(platform, fileNames, reportedKind) {
  return detectMarketplaceSnapshotKind(platform, fileNames, reportedKind) === "pending";
}

function isPickupEligibleStatus(status) {
  return ["pending", "processing"].includes(
    String(status || "").trim().toLowerCase(),
  );
}

module.exports = {
  detectTikTokSnapshotKind,
  detectMarketplaceSnapshotKind,
  hasTikTokBusinessRows,
  isAuthoritativePendingSnapshot,
  isPickupEligibleStatus,
};
