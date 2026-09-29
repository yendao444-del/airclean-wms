const { createHash } = require('node:crypto');
const DAILY_LIMIT = 15;
const POLICY_VERSION = 5;
const FAMILIES = ['5D UNICARE', 'UPF UNICARE', 'AMI ECO'];

function familyOf(item) {
  const name = String(item.productName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const sku = String(item.sku || '').toUpperCase();
  if ((name.includes('UNICARE') && name.includes('5D')) || sku.includes('5DUNI')) return FAMILIES[0];
  if (name.includes('UNICARE') && name.includes('UPF')) return FAMILIES[1];
  if (/\bAMI\b/.test(name) && /\bECO\b/.test(name)) return FAMILIES[2];
  return null;
}

function hash(text) {
  return createHash('sha256').update(text).digest().readUInt32BE(0);
}

// Only a balanced physical count covers a SKU. Assigning it without counting
// it must not hide that SKU from the remainder of the week's rotation.
function selectDailyStockCheck({ items, sessions = [], date, activity = [] }) {
  const day = new Date(`${date}T00:00:00Z`);
  const weekday = day.getUTCDay();
  if (!Number.isFinite(day.getTime())) throw new Error('Invalid stock-check date');
  if (weekday === 0 || weekday === 6) return { items: [], warnings: [], policyVersion: POLICY_VERSION };
  const monday = new Date(day);
  monday.setUTCDate(monday.getUTCDate() - weekday + 1);
  const weekStart = monday.toISOString().slice(0, 10);
  const daysLeft = 6 - weekday;
  const latest = new Map();
  for (const session of sessions) {
    if (session.status === 'cancelled' || session.date >= date || !['daily', 'weekend', 'full', 'inspection', 'recheck'].includes(session.type)) continue;
    for (const item of session.items || []) {
      if (!item.balanced || item.actualStock == null) continue;
      if (!latest.has(item.sku) || latest.get(item.sku).date < session.date) {
        latest.set(item.sku, { date: session.date, difference: Number(item.balanceDifference ?? item.difference ?? 0) });
      }
    }
  }
  const activityBySku = new Map(activity.map(row => [row.sku, row]));
  const unique = [...new Map(items.filter(item => String(item.sku || '').trim()).map(item => [item.sku, item])).values()];
  const candidates = unique.map(item => {
    const previous = latest.get(item.sku);
    const age = previous ? (day - new Date(`${previous.date}T00:00:00Z`)) / 86400000 : 365;
    const signal = activityBySku.get(item.sku) || {};
    return {
      item, family: familyOf(item), age,
      uncovered: !previous || previous.date < weekStart,
      risk: Number(item.systemStock) < 0 || (age <= 14 && Math.abs(previous?.difference || 0) >= 10),
      activity: Math.max(0, Number(signal.sold || 0)) + Math.max(0, Number(signal.movements || 0)),
      tie: hash(`${date}:${item.sku}`),
    };
  });
  const rotationOrder = (a, b) => Number(b.uncovered) - Number(a.uncovered) || b.age - a.age || Number(b.risk) - Number(a.risk) || b.activity - a.activity || a.tie - b.tie || a.item.sku.localeCompare(b.item.sku);
  const priorityOrder = (a, b) => Number(b.risk) - Number(a.risk) || (b.activity / (b.age <= 1 ? 2 : 1)) - (a.activity / (a.age <= 1 ? 2 : 1)) || rotationOrder(a, b);
  const groups = FAMILIES.map(name => {
    const pool = candidates.filter(item => item.family === name);
    const uncovered = pool.filter(item => item.uncovered).length;
    return { name, pool, uncovered, quota: 0, target: Math.min(pool.length, Math.max(Math.ceil(pool.length * 0.4), Math.ceil(uncovered / daysLeft))) };
  });
  // Distribute a constrained budget across all three families before filling
  // spare slots. This prevents a large family from consuming the whole day.
  let remaining = DAILY_LIMIT;
  for (const group of groups.filter(group => group.pool.length)) { group.quota = 1; remaining--; }
  while (remaining > 0) {
    const next = groups.filter(group => group.quota < group.target)
      .sort((a, b) => (b.target - b.quota) / b.target - (a.target - a.quota) / a.target || a.name.localeCompare(b.name))[0];
    if (!next) break;
    next.quota++; remaining--;
  }
  const selected = [];
  for (const group of groups) {
    const pool = [...group.pool].sort(rotationOrder);
    // Reserve enough new colors to finish the week, with at least two thirds
    // of this family's daily quota rotating when unverified colors remain.
    const rotationSlots = Math.min(group.quota, Math.max(Math.ceil(group.quota * 2 / 3), Math.ceil(group.uncovered / daysLeft)));
    const rotation = pool.slice(0, rotationSlots);
    const chosen = new Set(rotation.map(row => row.item.sku));
    selected.push(...rotation, ...pool.filter(row => !chosen.has(row.item.sku)).sort(priorityOrder).slice(0, group.quota - rotation.length));
  }
  const selectedSkus = new Set(selected.map(row => row.item.sku));
  // Keep approximately 40% of each mandatory family; spare capacity goes to
  // other warehouse products, not to more colors of the same three families.
  selected.push(...candidates.filter(row => !row.family && !selectedSkus.has(row.item.sku)).sort(rotationOrder).slice(0, remaining));
  const warnings = groups.filter(group => !group.pool.length).map(group => `Không tìm thấy SKU của ${group.name}. Kiểm tra tên sản phẩm trong danh mục.`);
  const uncoveredCount = groups.reduce((sum, group) => sum + group.uncovered, 0);
  if (uncoveredCount > daysLeft * DAILY_LIMIT) warnings.push(`Còn ${uncoveredCount} SKU bắt buộc chưa kiểm trong tuần, vượt sức chứa ${daysLeft * DAILY_LIMIT} lượt còn lại. Giữ giới hạn 15 SKU/ngày.`);
  else if (groups.reduce((sum, group) => sum + (group.pool.length ? Math.max(1, Math.ceil(group.uncovered / daysLeft)) : 0), 0) > DAILY_LIMIT)
    warnings.push('Không đủ lượt còn lại để phủ tất cả SKU trong tuần và duy trì cả ba dòng mỗi ngày. Giữ giới hạn 15 SKU/ngày.');
  if (groups.reduce((sum, group) => sum + Math.ceil(group.pool.length * 0.4), 0) > DAILY_LIMIT) warnings.push('40% SKU của ba dòng vượt 15; hệ thống chia lượt xoay tua, tối đa 15 SKU/ngày.');
  return {
    items: selected.map(row => ({ ...row.item,
      priorityReason: row.uncovered ? 'Chưa kiểm trong tuần' : row.risk ? 'Cần kiểm lại sau bất thường' : row.activity > 0 ? 'Có xuất bán / biến động kho' : 'Xoay tua màu / SKU',
      priorityLevel: row.risk ? 'high' : undefined,
    })),
    warnings, policyVersion: POLICY_VERSION,
  };
}

module.exports = { selectDailyStockCheck, familyOf, DAILY_LIMIT, POLICY_VERSION };
