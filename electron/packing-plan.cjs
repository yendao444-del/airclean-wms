// Pre-packing plan per order pattern: who owns the pattern (one packer each,
// so two people never pack the same bag) and an optional admin target that
// overrides the default "orders per day". Stored in AppConfig; read-only for
// everyone except admin. Every change keeps who/when for audit.
const PLAN_KEY = 'packingPlanV1';
const MAX_TARGET = 100000;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function parsePlan(row) {
  let data;
  try { data = JSON.parse(row?.value || '{}'); } catch { data = {}; }
  return {
    patterns: isRecord(data?.patterns) ? data.patterns : {},
    history: Array.isArray(data?.history) ? data.history : [],
  };
}
async function readPlan(tx) {
  return parsePlan(await tx.appConfig.findUnique({ where: { key: PLAN_KEY } }));
}

function normalizeKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 2000) throw new Error('Mẫu đóng gói không hợp lệ.');
  return key;
}
function normalizeComponents(value) {
  const items = (Array.isArray(value) ? value : []).map(item => ({ sku: String(item?.sku || '').trim().toUpperCase(), quantity: Number(item?.quantity) }));
  if (!items.length || items.length > 40 || items.some(item => !item.sku || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) {
    throw new Error('Thành phần mẫu đóng gói không hợp lệ.');
  }
  return items;
}
async function resolveOwner(tx, username) {
  if (username === null || username === '') return { owner: null, ownerName: null };
  const user = await tx.user.findUnique({ where: { username: String(username).trim() } });
  if (!user || user.status !== 'active' || user.role === 'admin') throw new Error('Nhân viên phụ trách không còn hoạt động.');
  return { owner: user.username, ownerName: user.fullName || user.username };
}

// One SKU belongs to one packer: a pattern may go to X only when none of its
// SKUs is already in a pattern owned by someone else.
function skuConflict(plan, key, components, owner) {
  if (!owner) return null;
  const skus = new Set(components.map(item => item.sku));
  for (const [otherKey, entry] of Object.entries(plan.patterns)) {
    if (otherKey === key || !isRecord(entry) || !entry.owner || entry.owner === owner) continue;
    const shared = (Array.isArray(entry.components) ? entry.components : []).find(item => skus.has(String(item?.sku || '').toUpperCase()));
    if (shared) return { sku: String(shared.sku).toUpperCase(), owner: entry.owner, ownerName: entry.ownerName || entry.owner, label: entry.label || otherKey };
  }
  return null;
}
function assertNoConflict(plan, key, components, owner) {
  const conflict = skuConflict(plan, key, components, owner);
  if (conflict) throw new Error(`SKU ${conflict.sku} đã phân công cho ${conflict.ownerName}. Mỗi SKU chỉ một người phụ trách; hãy đổi người ở các mẫu của ${conflict.ownerName} trước.`);
}

async function writePlan(tx, plan) {
  const value = JSON.stringify({ patterns: plan.patterns, history: plan.history.slice(-1000) });
  await tx.appConfig.upsert({ where: { key: PLAN_KEY }, create: { key: PLAN_KEY, value }, update: { value } });
}

// payload: { key, components, label?, target?: number|null, owner?: string|null }
// undefined leaves a field unchanged; target null returns to the default.
async function updatePattern(tx, payload = {}, actor, now = new Date()) {
  const key = normalizeKey(payload.key);
  const components = normalizeComponents(payload.components);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PLAN_KEY}))`;
  const plan = await readPlan(tx);
  const current = isRecord(plan.patterns[key]) ? plan.patterns[key] : {};
  const next = { ...current, components, label: String(payload.label || current.label || '').slice(0, 300) };
  if (payload.target !== undefined) {
    if (payload.target !== null && (!Number.isSafeInteger(payload.target) || payload.target < 0 || payload.target > MAX_TARGET)) {
      throw new Error(`Chỉ tiêu phải là số nguyên từ 0 đến ${MAX_TARGET.toLocaleString('vi-VN')}.`);
    }
    next.target = payload.target;
  }
  if (payload.owner !== undefined) Object.assign(next, await resolveOwner(tx, payload.owner));
  assertNoConflict(plan, key, components, next.owner);
  next.updatedBy = String(actor || '');
  next.updatedAt = new Date(now).toISOString();
  plan.patterns[key] = next;
  plan.history.push({ at: next.updatedAt, by: next.updatedBy, key, target: next.target ?? null, owner: next.owner ?? null });
  await writePlan(tx, plan);
  return next;
}

// assignments: [{ key, components, label?, owner: string|null, target?: number|null }]
// Managers may assign owners, but only admins may create or change targets.
async function assignOwners(tx, assignments = [], actor, now = new Date(), options = {}) {
  if (!Array.isArray(assignments) || !assignments.length || assignments.length > 2000) throw new Error('Danh sách chia mẫu không hợp lệ.');
  const allowTarget = options?.allowTarget === true;
  if (!allowTarget && assignments.some(item => Object.prototype.hasOwnProperty.call(item || {}, 'target'))) {
    throw new Error('Chỉ Admin được phép sửa chỉ tiêu đóng gói.');
  }
  const prepared = assignments.map(item => {
    const target = item?.target;
    if (target !== undefined && target !== null && (!Number.isSafeInteger(target) || target < 0 || target > MAX_TARGET)) {
      throw new Error(`Chỉ tiêu phải là số nguyên từ 0 đến ${MAX_TARGET.toLocaleString('vi-VN')}.`);
    }
    return { key: normalizeKey(item?.key), components: normalizeComponents(item?.components), label: String(item?.label || '').slice(0, 300), owner: item?.owner ?? null, target };
  });
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PLAN_KEY}))`;
  const plan = await readPlan(tx);
  const owners = new Map();
  const at = new Date(now).toISOString();
  for (const item of prepared) {
    const ownerKey = item.owner === null ? '' : String(item.owner);
    if (!owners.has(ownerKey)) owners.set(ownerKey, await resolveOwner(tx, item.owner));
    const current = isRecord(plan.patterns[item.key]) ? plan.patterns[item.key] : {};
    assertNoConflict(plan, item.key, item.components, owners.get(ownerKey).owner);
    plan.patterns[item.key] = { ...current, components: item.components, label: item.label || current.label || '', ...owners.get(ownerKey), ...(item.target !== undefined ? { target: item.target } : {}), updatedBy: String(actor || ''), updatedAt: at };
  }
  plan.history.push({ at, by: String(actor || ''), action: 'assign', count: prepared.length });
  await writePlan(tx, plan);
  return { assigned: prepared.length };
}

module.exports = { PLAN_KEY, MAX_TARGET, parsePlan, readPlan, updatePattern, assignOwners, skuConflict };
