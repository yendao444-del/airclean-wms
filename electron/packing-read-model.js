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

const PACKING_POLICY_START_MS = Date.parse("2026-09-01T00:00:00+07:00");
const LEGACY_PACKING_UNIT_PRICE = 20;
const DEFAULT_PACKING_RATES = { easy: 20, medium: 30, high: 40 };

function legacyPackingUnits(item) {
  const sku = String(item?.sku || "").toUpperCase();
  let packCount = 1;
  if (sku.startsWith("CB-")) {
    let comboTotal = 0;
    const productSuffixes = /^(5D|UNI|DUNI|5DUNI)/i;
    sku.slice(3).split("-").forEach((segment) => {
      const match = segment.match(/^(\d+)(.+)$/);
      if (match && !productSuffixes.test(match[2])) comboTotal += Number(match[1]);
    });
    packCount = comboTotal > 0 ? comboTotal : 1;
  } else {
    const prefixMatch = sku.match(/^(\d+)-/);
    packCount = prefixMatch ? Number(prefixMatch[1]) : 1;
  }
  return Math.max(0, Number(item?.quantity || 1)) * packCount;
}

function normalizeCommissionVersion(value, fallback = {}) {
  const rates = {
    ...DEFAULT_PACKING_RATES,
    ...(fallback.rates || {}),
    ...(value?.rates || {}),
  };
  return {
    rates,
    skuLevels: { ...(fallback.skuLevels || {}), ...(value?.skuLevels || {}) },
    saleDates: Array.isArray(value?.saleDates) ? value.saleDates : (fallback.saleDates || []),
    saleMultiplier: Math.max(1, Number(value?.saleMultiplier ?? fallback.saleMultiplier ?? 1)),
    saleEffectiveAt: value?.saleEffectiveAt || fallback.saleEffectiveAt || null,
  };
}

function commissionForTimestamp(rawCommission, timestamp) {
  const orderTime = Date.parse(timestamp || "");
  if (Number.isFinite(orderTime) && orderTime < PACKING_POLICY_START_MS) {
    return { legacy: true, rates: { easy: LEGACY_PACKING_UNIT_PRICE } };
  }
  const current = normalizeCommissionVersion(rawCommission);
  const history = (Array.isArray(rawCommission?.history) ? rawCommission.history : [])
    .map((version) => ({
      effectiveAt: Date.parse(version?.effectiveAt || ""),
      commission: normalizeCommissionVersion(version, current),
    }))
    .filter((version) => Number.isFinite(version.effectiveAt))
    .sort((left, right) => left.effectiveAt - right.effectiveAt);
  if (Number.isFinite(orderTime)) {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].effectiveAt <= orderTime) return history[index].commission;
    }
  }
  return history.length > 0 && Number.isFinite(orderTime) && orderTime >= PACKING_POLICY_START_MS
    ? normalizeCommissionVersion(undefined, { rates: DEFAULT_PACKING_RATES })
    : current;
}

function saleMultiplierForDate(commission, timestamp) {
  const multiplier = Math.max(1, Number(commission.saleMultiplier || 1));
  if (multiplier <= 1 || !timestamp || !Array.isArray(commission.saleDates)) return 1;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 1;
  const dateKey = date.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
  const monthDay = dateKey.slice(5);
  const effectiveDateKey = commission.saleEffectiveAt ? getBangkokDateKey(commission.saleEffectiveAt) : "";
  if (effectiveDateKey && dateKey < effectiveDateKey) return 1;
  return commission.saleDates.includes(dateKey)
    || commission.saleDates.includes(monthDay)
    || commission.saleDates.includes(`*-${dateKey.slice(8)}`)
    ? multiplier
    : 1;
}

function getBangkokDateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
}

// One compact row per packer/day keeps the payroll path small while preserving
// order counts and weekly ranking semantics used by the renderer.
function buildPackingPayrollSummary(ecommerceRows, combos, rawCommission) {
  const detailedRows = buildPackingReadModel(ecommerceRows, combos);
  const buckets = new Map();
  detailedRows.forEach((order) => {
    const dayKey = getBangkokDateKey(order.timestamp);
    const bucketKey = `${order.packer}\u0000${dayKey}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        id: `packing-summary-${Buffer.from(bucketKey).toString("base64url")}`,
        timestamp: `${dayKey}T12:00:00+07:00`,
        orderNumber: `SUMMARY-${dayKey}`,
        platform: "Web",
        customerName: "Tổng hợp",
        packer: order.packer,
        items: [],
        totalSKU: 0,
        orderCount: 0,
        status: "completed",
      };
      buckets.set(bucketKey, bucket);
    }
    bucket.orderCount += 1;
    bucket.totalSKU += Number(order.totalSKU || 0);
    const commission = commissionForTimestamp(rawCommission, order.timestamp);
    const itemByLevel = new Map(bucket.items.map((item) => [item.packingLevel, item]));
    order.items.forEach((item) => {
      const level = commission.legacy
        ? "easy"
        : commission.skuLevels[String(item.packingSourceSku || item.sku || "").toUpperCase()] || "easy";
      const units = commission.legacy
        ? legacyPackingUnits(item)
        : Math.max(0, Number(item.packingUnits ?? item.quantity ?? 1));
      const unitPrice = commission.legacy
        ? LEGACY_PACKING_UNIT_PRICE
        : Number(commission.rates[level] || 0) * saleMultiplierForDate(commission, order.timestamp);
      const aggregate = itemByLevel.get(level) || {
        sku: `__SUMMARY__${level}`,
        productName: `Tổng hợp ${level}`,
        quantity: 0,
        packingLevel: level,
        packingUnits: 0,
        packingUnitPrice: unitPrice,
        packingIncome: 0,
      };
      aggregate.quantity += Number(item.quantity || 0);
      aggregate.packingUnits += units;
      aggregate.packingUnitPrice = unitPrice;
      aggregate.packingIncome += units * unitPrice;
      if (!itemByLevel.has(level)) bucket.items.push(aggregate);
    });
  });
  return [...buckets.values()].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

module.exports = {
  buildPackingReadModel,
  buildPackingPayrollSummary,
  normalizePackingSku,
  parsePackingComboItems,
};
