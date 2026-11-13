'use strict';

// Best-seller suggestions for "Mục tiêu đóng gói". An order is one basket:
// every sale line is expanded through ComboProduct.items into handling-unit
// SKUs, and identical baskets are counted together. Pure and read-only.

const ALLOWED_DAYS = [7, 14, 30];
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeDays(value) {
  const days = Number(value);
  return ALLOWED_DAYS.includes(days) ? days : 30;
}

function parseComboItems(value) {
  try {
    const items = Array.isArray(value) ? value : JSON.parse(value || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

// Map<saleSku, Array<{ sku, quantity }>> from ComboProduct rows.
function buildComboMap(comboRows = []) {
  const map = new Map();
  for (const row of comboRows) {
    const saleSku = String(row?.sku || '').trim().toUpperCase();
    if (!saleSku) continue;
    const items = parseComboItems(row.items)
      .map(item => ({ sku: String(item?.sku || '').trim().toUpperCase(), quantity: Number(item?.quantity) }))
      .filter(item => item.sku && Number.isSafeInteger(item.quantity) && item.quantity > 0);
    if (items.length) map.set(saleSku, items);
  }
  return map;
}

function canonicalKey(components) {
  return components.map(item => `${item.sku}:${item.quantity}`).join('|');
}

function saleLabel(lines) {
  if (lines.length === 1 && lines[0].quantity === 1) return lines[0].sku;
  return lines.map(line => (line.quantity === 1 ? line.sku : `${line.quantity} x ${line.sku}`)).join(' + ');
}

// "single": one product/color (e.g. 2 hộp AMI Đen). "mix": several products
// or colors in one order (e.g. 2 Trắng + 1 Đen + 2 Xám).
function basketKind(components) {
  return components.length > 1 ? 'mix' : 'single';
}

function basketForOrder(order, comboMap) {
  const lineTotals = new Map();
  const componentTotals = new Map();
  for (const item of order?.items || []) {
    const sku = String(item?.sku || '').trim().toUpperCase();
    const quantity = Number(item?.quantity);
    if (!sku || !Number.isSafeInteger(quantity) || quantity <= 0) continue;
    lineTotals.set(sku, (lineTotals.get(sku) || 0) + quantity);
    const parts = comboMap.get(sku) || [{ sku, quantity: 1 }];
    for (const part of parts) componentTotals.set(part.sku, (componentTotals.get(part.sku) || 0) + part.quantity * quantity);
  }
  if (!componentTotals.size) return null;
  const components = [...componentTotals]
    .map(([sku, quantity]) => ({ sku, quantity }))
    .sort((left, right) => left.sku.localeCompare(right.sku));
  const lines = [...lineTotals]
    .map(([sku, quantity]) => ({ sku, quantity }))
    .sort((left, right) => left.sku.localeCompare(right.sku));
  return { key: canonicalKey(components), components, lines };
}

/**
 * @param {{ orders: Array<{ items: Array<{ sku: string, quantity: number }> }>, comboRows: Array<{ sku: string, items: unknown }>, days?: number, limit?: number }} input
 */
function buildPackingSuggestions({ orders = [], comboRows = [], days = 30, limit = 20, minPerDay = 0 } = {}) {
  const windowDays = normalizeDays(days);
  const comboMap = buildComboMap(comboRows);
  const baskets = new Map();
  let orderCount = 0;
  for (const order of orders) {
    const basket = basketForOrder(order, comboMap);
    if (!basket) continue;
    orderCount += 1;
    const entry = baskets.get(basket.key);
    if (entry) {
      entry.orderCount += 1;
      const label = saleLabel(basket.lines);
      entry.labels.set(label, (entry.labels.get(label) || 0) + 1);
    } else {
      baskets.set(basket.key, { ...basket, orderCount: 1, labels: new Map([[saleLabel(basket.lines), 1]]) });
    }
  }
  // limit: null lists every order pattern, even one seen in a single order.
  const top = limit === null ? Infinity : Math.max(1, Math.min(50, Number(limit) || 20));
  // minPerDay 1 keeps only patterns ordered at least once a day on average.
  const minOrders = Math.max(0, Number(minPerDay) || 0) * windowDays;
  const sorted = [...baskets.values()]
    .filter(entry => entry.orderCount >= minOrders)
    .sort((left, right) => right.orderCount - left.orderCount || left.key.localeCompare(right.key));
  // One list: each order is one package exactly as the customer bought it
  // (1 hộp, 4 hộp, 5 Trắng + 5 Đen ...), ranked by how many orders had it.
  const items = sorted
    .slice(0, top)
    .map((entry, index) => {
      // Most common way this basket was sold, used as the default combo code.
      const [label] = [...entry.labels].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
      return {
        rank: index + 1,
        key: entry.key,
        components: entry.components,
        saleLabel: label,
        kind: basketKind(entry.components),
        // Export matches the whole order against intact bags, so every
        // basket shape is deducted from pre-packed stock automatically.
        autoIssue: true,
        orderCount: entry.orderCount,
        perDay: Math.round((entry.orderCount / windowDays) * 10) / 10,
      };
    });
  return { days: windowDays, orderCount, basketCount: baskets.size, items };
}

function suggestionWindowStart(days, now = Date.now()) {
  return new Date(now - normalizeDays(days) * DAY_MS);
}

module.exports = { ALLOWED_DAYS, normalizeDays, buildComboMap, basketForOrder, buildPackingSuggestions, suggestionWindowStart };
