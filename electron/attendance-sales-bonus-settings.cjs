'use strict';
const { createHash } = require('crypto');
const { readAttendanceBranches, updateAttendanceBranches } = require('./attendance-branch-store.cjs');

const FIELDS = ['employees', 'payrollOverrides'];
function validatePeriod(periodKey) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(periodKey || ''))) throw new Error('Tháng áp dụng thưởng không hợp lệ.');
}

function recipientSettings(data, periodKey, kind) {
  const field = kind === 'packing' ? 'packingIncomeEligible' : 'salesBonusEligible';
  validatePeriod(periodKey);
  if (!Array.isArray(data.employees) || (data.payrollOverrides != null
    && (typeof data.payrollOverrides !== 'object' || Array.isArray(data.payrollOverrides)))) {
    throw new Error('Dữ liệu cài đặt người nhận không hợp lệ. Chưa thực hiện thay đổi.');
  }
  const payrollOverrides = data.payrollOverrides || {};
  const employees = data.employees.filter(employee => employee?.type === 'Official' || (kind === 'packing' && employee?.type === 'Seasonal'))
    .map(employee => ({ id: Number(employee.id), name: String(employee.name || ''), username: String(employee.username || '') }))
    .sort((a, b) => a.id - b.id);
  if (employees.some(employee => !Number.isSafeInteger(employee.id) || employee.id <= 0)
    || new Set(employees.map(employee => employee.id)).size !== employees.length) {
    throw new Error('Danh sách nhân viên không hợp lệ. Chưa thực hiện thay đổi.');
  }
  const employeeIds = employees.filter(employee => {
    const override = payrollOverrides[`${employee.id}_${periodKey}`];
    if (override != null && (typeof override !== 'object' || Array.isArray(override)
      || (override[field] != null && typeof override[field] !== 'boolean'))) {
      throw new Error('Cài đặt đối tượng nhận thưởng không hợp lệ. Chưa thực hiện thay đổi.');
    }
    // Preserve the existing policy until an admin explicitly opts out.
    return override?.[field] !== false;
  }).map(employee => employee.id);
  const revision = createHash('sha256').update(JSON.stringify([kind, periodKey, employees.map(employee => employee.id), employeeIds])).digest('hex');
  return { periodKey, employees, employeeIds, revision, payrollOverrides };
}

async function readRecipientSettings(client, periodKey, kind) {
  validatePeriod(periodKey);
  const snapshot = await readAttendanceBranches(client, FIELDS);
  return recipientSettings(snapshot.data, periodKey, kind);
}

async function saveRecipientSettings(client, payload, { actor, isMonthLocked }, kind) {
  const field = kind === 'packing' ? 'packingIncomeEligible' : 'salesBonusEligible';
  const { periodKey, employeeIds, expectedRevision } = payload;
  validatePeriod(periodKey);
  if (!Array.isArray(employeeIds) || employeeIds.some(id => !Number.isSafeInteger(id) || id <= 0)
    || typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision)) {
    throw new Error('Cài đặt nhân viên nhận thưởng không hợp lệ. Hãy mở lại cài đặt.');
  }
  const selected = new Set(employeeIds);
  return updateAttendanceBranches(client, FIELDS, data => {
    if (isMonthLocked(data, periodKey)) throw new Error('Kỳ lương này đã khóa. Admin phải mở khóa trước khi thay đổi người nhận thưởng.');
    const current = recipientSettings(data, periodKey, kind);
    if (current.revision !== expectedRevision) throw new Error('Danh sách nhận thưởng vừa thay đổi ở máy khác. Hãy mở lại cài đặt để kiểm tra.');
    if (employeeIds.some(id => !current.employees.some(employee => employee.id === id))) {
      throw new Error(kind === 'packing' ? 'Chỉ được chọn nhân viên có trong bảng công.' : 'Chỉ được chọn nhân viên chính thức có trong bảng công.');
    }
    const payrollOverrides = { ...current.payrollOverrides };
    let changed = false;
    for (const employee of current.employees) {
      const key = `${employee.id}_${periodKey}`;
      const previous = payrollOverrides[key] || {};
      const eligible = selected.has(employee.id);
      if ((previous[field] !== false) === eligible) continue;
      changed = true;
      payrollOverrides[key] = { ...previous, [field]: eligible,
        updatedAt: new Date().toISOString(), updatedBy: actor.username };
    }
    return { patch: changed ? { payrollOverrides } : {},
      result: { ...recipientSettings({ ...data, payrollOverrides }, periodKey, kind), unchanged: !changed } };
  });
}

const salesBonusSettings = (data, periodKey) => recipientSettings(data, periodKey, 'sales');
const readSalesBonusSettings = (client, periodKey) => readRecipientSettings(client, periodKey, 'sales');
const saveSalesBonusSettings = (client, payload, options) => saveRecipientSettings(client, payload, options, 'sales');
const packingIncomeSettings = (data, periodKey) => recipientSettings(data, periodKey, 'packing');
const readPackingIncomeSettings = (client, periodKey) => readRecipientSettings(client, periodKey, 'packing');
const savePackingIncomeSettings = (client, payload, options) => saveRecipientSettings(client, payload, options, 'packing');

module.exports = { salesBonusSettings, readSalesBonusSettings, saveSalesBonusSettings,
  packingIncomeSettings, readPackingIncomeSettings, savePackingIncomeSettings };
