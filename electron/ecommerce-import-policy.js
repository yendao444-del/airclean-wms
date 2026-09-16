function isAuthoritativePendingSnapshot(platform, fileNames) {
  if (String(platform || "").trim().toLowerCase() === "tiktok") return true;
  const names = Array.isArray(fileNames) ? fileNames : [];
  return names.length > 0 && names.every((name) =>
    /(?:^|[._\-\s])toship(?:[._\-\s]|$)/i.test(String(name || "")),
  );
}

function isPickupEligibleStatus(status) {
  return ["pending", "processing", "mismatch"].includes(
    String(status || "").trim().toLowerCase(),
  );
}

module.exports = { isAuthoritativePendingSnapshot, isPickupEligibleStatus };
