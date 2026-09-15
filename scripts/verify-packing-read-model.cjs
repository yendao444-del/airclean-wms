const assert = require("assert");
const { buildPackingReadModel } = require("../electron/packing-read-model");

function referenceTransform(ecommerceRows, combos) {
  const normalizeSku = (value) => String(value || "").trim().toUpperCase();
  const parseComboItems = (value) => {
    try {
      const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => ({
          sku: normalizeSku(item?.sku || item?.variantSku),
          quantity: Math.max(0, Number(item?.quantity ?? item?.qty ?? 0)),
        }))
        .filter((item) => item.sku && item.quantity > 0);
    } catch {
      return [];
    }
  };
  const comboBySku = new Map();
  combos.forEach((combo) => {
    if (combo?.status === "inactive") return;
    const sku = normalizeSku(combo?.sku);
    const components = parseComboItems(combo?.items);
    if (sku && components.length > 0) comboBySku.set(sku, components);
  });
  const unified = [];
  ecommerceRows.forEach((order) => {
    const items = typeof order.items === "string"
      ? JSON.parse(order.items || "[]")
      : (order.items || []);
    const validItems = items.filter((item) => {
      const sku = item.variantSku || item.sku || item.variant_sku ||
        item.product_sku || item.SKU || item.Sku || "";
      return sku && sku.trim() !== "";
    });
    if (validItems.length === 0) return;
    const mappedItems = validItems.map((item) => {
      const sku = normalizeSku(
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
    if (totalSKU === 0) return;
    const customerName = order.customer?.name || order.customerName ||
      order.customer || "Khách";
    const lowerCustomer = customerName.toLowerCase();
    unified.push({
      id: `tmdt-${order.id}`,
      timestamp: String(
        order.ecommerceExportDate || order.exportDate || order.date ||
        order.createdAt || order.updatedAt || "",
      ),
      orderNumber: order.orderNumber || order.ecommerceExportCode || `#TMDT-${order.id}`,
      platform: lowerCustomer.includes("shopee")
        ? "Shopee"
        : lowerCustomer.includes("tiktok") ? "TikTok" : "Web",
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
  });
  const sortTimes = new Map(
    unified.map((order) => [order.id, Date.parse(order.timestamp) || 0]),
  );
  return unified.sort(
    (left, right) => (sortTimes.get(right.id) || 0) - (sortTimes.get(left.id) || 0),
  );
}

const combos = [
  {
    sku: "CB-3",
    status: "active",
    items: JSON.stringify([
      { sku: "SKU-A", quantity: 2 },
      { variantSku: "SKU-B", qty: 1 },
    ]),
  },
  { sku: "CB-INACTIVE", status: "inactive", items: '[{"sku":"SKU-X","quantity":9}]' },
  { sku: "CB-BROKEN", status: "active", items: "not-json" },
];
const ecommerceRows = [
  {
    id: 12,
    customerName: "TikTok Shop",
    ecommerceExportDate: "2026-09-12T08:00:00.000Z",
    orderNumber: "ORDER-12",
    status: "completed",
    pickedBy: "packer-a",
    items: JSON.stringify([
      { variantSku: "cb-3", productName: "Combo", quantity: 2 },
      { SKU: "SINGLE", name: "Single", qty: 3 },
      { sku: "", quantity: 99 },
    ]),
  },
  {
    id: 11,
    customerName: "Shopee Mall",
    ecommerceExportDate: "2026-09-11T08:00:00.000Z",
    ecommerceExportCode: "PX-11",
    status: "completed",
    createdBy: "creator-b",
    items: [{ sku: "CB-INACTIVE", quantity: 1 }],
  },
  {
    id: 10,
    customerName: "Website",
    ecommerceExportDate: "2026-09-10T08:00:00.000Z",
    status: "completed",
    items: "[]",
  },
];

assert.deepStrictEqual(
  buildPackingReadModel(ecommerceRows, combos),
  referenceTransform(ecommerceRows, combos),
);

async function verifyLiveData() {
  require("dotenv").config();
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient({ log: ["error"] });
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    end.setMilliseconds(-1);
    const [liveExports, liveCombos] = await Promise.all([
      prisma.ecommerceExport.findMany({
        where: {
          status: "completed",
          ecommerceExportDate: { gte: start, lte: end },
        },
        select: {
          id: true,
          customerName: true,
          ecommerceExportCode: true,
          orderNumber: true,
          ecommerceExportDate: true,
          items: true,
          status: true,
          createdBy: true,
          pickedBy: true,
          updatedAt: true,
        },
        orderBy: [{ ecommerceExportDate: "desc" }, { id: "desc" }],
      }),
      prisma.comboProduct.findMany({
        select: { sku: true, items: true, status: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const normalizedExports = liveExports.map((row) => ({
      ...row,
      ecommerceExportDate: row.ecommerceExportDate.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
    const actual = buildPackingReadModel(normalizedExports, liveCombos);
    const expected = referenceTransform(normalizedExports, liveCombos);
    assert.deepStrictEqual(actual, expected);
    console.log(
      `Live packing equivalence passed for ${actual.length} completed orders and ${liveCombos.length} combos.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv.includes("--live")) {
  verifyLiveData().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  console.log("Packing read-model equivalence verification passed.");
}
