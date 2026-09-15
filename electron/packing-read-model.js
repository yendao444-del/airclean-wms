function normalizePackingSku(value) {
  return String(value || "").trim().toUpperCase();
}

function parsePackingComboItems(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        sku: normalizePackingSku(item?.sku || item?.variantSku),
        quantity: Math.max(0, Number(item?.quantity ?? item?.qty ?? 0)),
      }))
      .filter((item) => item.sku && item.quantity > 0);
  } catch {
    return [];
  }
}

function getPackingPlatform(customerName) {
  const normalized = String(customerName || "").toLowerCase();
  if (normalized.includes("shopee")) return "Shopee";
  if (normalized.includes("tiktok")) return "TikTok";
  return "Web";
}

function buildPackingReadModel(ecommerceRows, combos) {
  const comboBySku = new Map();
  for (const combo of Array.isArray(combos) ? combos : []) {
    if (combo?.status === "inactive") continue;
    const sku = normalizePackingSku(combo?.sku);
    const components = parsePackingComboItems(combo?.items);
    if (sku && components.length > 0) comboBySku.set(sku, components);
  }

  const rows = [];
  for (const order of Array.isArray(ecommerceRows) ? ecommerceRows : []) {
    const items = typeof order.items === "string"
      ? JSON.parse(order.items || "[]")
      : (order.items || []);

    const validItems = items.filter((item) => {
      const sku = item.variantSku || item.sku || item.variant_sku ||
        item.product_sku || item.SKU || item.Sku || "";
      return sku && sku.trim() !== "";
    });
    if (validItems.length === 0) continue;

    const mappedItems = validItems.map((item) => {
      const sku = normalizePackingSku(
        item.variantSku || item.sku || item.variant_sku ||
        item.product_sku || item.SKU || item.Sku || "",
      );
      const quantity = Math.max(0, Number(item.quantity ?? item.qty ?? 1));
      const comboComponents = comboBySku.get(sku);
      const unitsPerSoldItem = comboComponents?.reduce(
        (sum, component) => sum + component.quantity,
        0,
      ) || 1;
      return {
        sku,
        productName: item.productName || item.name || "-",
        variant: item.variant || "",
        quantity,
        packingSourceSku: comboComponents?.[0]?.sku,
        packingUnits: quantity * unitsPerSoldItem,
      };
    });

    const totalSKU = mappedItems.reduce(
      (total, item) => total + (item.quantity || 1),
      0,
    );
    if (totalSKU === 0) continue;

    const customerName = order.customer?.name || order.customerName ||
      order.customer || "Khách";
    rows.push({
      id: `tmdt-${order.id}`,
      timestamp: String(
        order.ecommerceExportDate || order.exportDate || order.date ||
        order.createdAt || order.updatedAt || "",
      ),
      orderNumber: order.orderNumber || order.ecommerceExportCode ||
        `#TMDT-${order.id}`,
      platform: getPackingPlatform(customerName),
      customerName,
      packer: typeof order.pickedBy === "string" && order.pickedBy
        ? order.pickedBy
        : typeof order.createdBy === "string" && order.createdBy
          ? order.createdBy
          : "Không ghi nhận",
      items: mappedItems,
      totalSKU,
      status: order.status === "completed" ? "completed" : "issue",
    });
  }

  const sortTimes = new Map(
    rows.map((order) => [order.id, Date.parse(order.timestamp) || 0]),
  );
  return rows.sort(
    (left, right) => (sortTimes.get(right.id) || 0) - (sortTimes.get(left.id) || 0),
  );
}

module.exports = {
  buildPackingReadModel,
  normalizePackingSku,
  parsePackingComboItems,
};
