'use strict';
const { randomUUID } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { isRetryableAttendanceBranchError } = require('./attendance-branch-store.cjs');

const PATCH_KEY = 'attendanceFinePatchesV1';
const MAX_BATCH = 200;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' });
function dayKey(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return dateFormatter.format(new Date(value));
}
function validDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && dayKey(`${value}T12:00:00+07:00`) === value;
}
function fineDate(fine) {
  return validDateKey(fine?.attendanceDate) ? fine.attendanceDate : dayKey(fine?.date);
}
function normalizeRequest(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.items) || !payload.items.length || payload.items.length > MAX_BATCH) {
    throw new Error(`Chọn từ 1 đến ${MAX_BATCH} khoản phạt mỗi lần xóa.`);
  }
  const { from, to } = payload;
  if (!validDateKey(from) || !validDateKey(to) || from > to) throw new Error('Khoảng ngày xóa phạt không hợp lệ.');
  const seen = new Set();
  const items = payload.items.map(item => {
    if (!isRecord(item) || !['manual', 'system'].includes(item.kind) || !isRecord(item.fine)) throw new Error('Khoản phạt được chọn không hợp lệ.');
    const source = item.fine;
    const fine = {
      ...(source.id ? { id: String(source.id) } : {}), empId: Number(source.empId),
      type: String(source.type || ''), detail: String(source.detail || ''), amount: Number(source.amount),
      ...(source.date ? { date: String(source.date) } : {}),
      ...(source.attendanceDate ? { attendanceDate: String(source.attendanceDate) } : {}),
      ...(source.source ? { source: String(source.source) } : {}),
    };
    if (!Number.isSafeInteger(fine.empId) || fine.empId <= 0 || !fine.type.trim() || fine.type.length > 200
      || !fine.detail.trim() || fine.detail.length > 10000 || !Number.isFinite(fine.amount) || fine.amount < 0
      || (fine.id && fine.id.length > 200) || !fineDate(fine)) throw new Error('Thông tin khoản phạt hoặc ngày phạt không hợp lệ.');
    const fineId = String(item.fineId || fine.id || '');
    const overrideKey = String(item.overrideKey || '');
    if (item.kind === 'manual' ? !fineId || fineId.length > 200 : !overrideKey || overrideKey.length > 2000) {
      throw new Error('Thiếu mã khoản phạt cần xóa.');
    }
    const key = `${item.kind}:${item.kind === 'manual' ? fineId : overrideKey}`;
    if (seen.has(key)) throw new Error('Danh sách xóa chứa khoản phạt trùng lặp.');
    seen.add(key);
    return { kind: item.kind, fineId, overrideKey, fine };
  });
  return { from, to, items };
}

function assertUnlocked(periods, from, to) {
  if (!Array.isArray(periods) || periods.some(period => !isRecord(period) || !dayKey(period.start) || !dayKey(period.end) || dayKey(period.start) > dayKey(period.end))) {
    throw new Error('Dữ liệu kỳ khóa không hợp lệ. Chưa xóa khoản phạt nào.');
  }
  if (periods.some(period => dayKey(period.start) <= to && dayKey(period.end) >= from)) {
    throw new Error('Khoản phạt thuộc kỳ lương đã khóa. Hãy mở khóa trước khi xóa. Chưa xóa khoản nào.');
  }
}
function assertUnchanged(expected, actual) {
  if (!isRecord(actual) || ['empId', 'type', 'detail', 'amount'].some(field => String(expected[field]) !== String(actual[field]))
    || fineDate(expected) !== fineDate(actual) || String(expected.date || '') !== String(actual.date || '')) {
    throw new Error('Một khoản phạt vừa thay đổi. Hãy tải lại và kiểm tra danh sách. Chưa xóa khoản nào.');
  }
}

async function deleteAttendanceFines(client, payload, { actor, parsePatches }) {
  const request = normalizeRequest(payload);
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '500ms'`);
        await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
        // One short row lock serializes this correction with payroll locking
        // and old clients. Never transfer or overwrite frozen statements.
        const rows = await tx.$queryRaw(Prisma.sql`
          SELECT "value"::json->'extraFines' AS "extraFines",
                 "value"::json->'fineOverrides' AS "fineOverrides",
                 (SELECT json_agg(json_build_object('start', period->'start', 'end', period->'end'))
                  FROM json_array_elements(CASE WHEN "value"::json->'lockedPeriods' IS NULL
                    OR json_typeof("value"::json->'lockedPeriods') = 'null' THEN '[]'::json
                    ELSE "value"::json->'lockedPeriods' END) AS period) AS "lockedPeriods"
          FROM "AppConfig" WHERE "key" = 'attendanceData' FOR UPDATE NOWAIT
        `);
        const data = rows?.[0];
        if (!data || (data.extraFines != null && !Array.isArray(data.extraFines))
          || (data.fineOverrides != null && !isRecord(data.fineOverrides))) throw new Error('Dữ liệu bảng công không hợp lệ. Chưa xóa khoản nào.');
        const locks = data.lockedPeriods ?? [];
        assertUnlocked(locks, request.from, request.to);
        const patchRow = await tx.appConfig.findUnique({ where: { key: PATCH_KEY }, select: { value: true } });
        const patches = parsePatches(patchRow);
        const storedById = new Map((data.extraFines || []).map(fine => [String(fine?.id || ''), fine]));
        const batchId = randomUUID();
        const deleted = request.items.map((item, index) => {
          const existing = item.kind === 'manual' ? patches.manual[item.fineId] : patches.system[item.overrideKey];
          if (existing) throw new Error('Một khoản phạt đã được xóa trước đó. Hãy tải lại danh sách. Chưa xóa thêm khoản nào.');
          const stored = storedById.get(item.fineId);
          const override = data.fineOverrides?.[item.overrideKey];
          if (override != null && !isRecord(override)) throw new Error('Dữ liệu điều chỉnh phạt không hợp lệ. Chưa xóa khoản nào.');
          if (item.kind === 'manual' && !stored) throw new Error('Một khoản phạt không còn tồn tại. Hãy tải lại. Chưa xóa khoản nào.');
          const deletedFine = item.kind === 'manual' ? stored : { ...item.fine, ...(override || {}) };
          if (deletedFine.disabled) throw new Error('Một khoản phạt đã bị ẩn. Hãy tải lại danh sách.');
          assertUnchanged(item.fine, deletedFine);
          const date = fineDate(deletedFine);
          if (date < request.from || date > request.to) throw new Error('Khoản phạt nằm ngoài khoảng ngày đã chọn. Chưa xóa khoản nào.');
          assertUnlocked(locks, date, date);
          const audit = {
            id: `flog-bulk-${batchId}-${index}`, action: 'delete',
            timestamp: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' }),
            changedBy: actor.username, changedByName: actor.fullName || actor.username,
            before: deletedFine, batchId,
            note: `Xóa nhiều khoản phạt: ${deletedFine.type} — ${deletedFine.amount}`,
          };
          const disabledFine = item.kind === 'system' ? { ...deletedFine, disabled: true } : null;
          if (item.kind === 'manual') patches.manual[item.fineId] = { fine: deletedFine, audit };
          else patches.system[item.overrideKey] = { fine: disabledFine, audit };
          return { kind: item.kind, fineId: item.fineId, overrideKey: item.overrideKey, deletedFine, disabledFine, audit };
        });
        const value = JSON.stringify(patches);
        await tx.appConfig.upsert({ where: { key: PATCH_KEY }, update: { value }, create: { key: PATCH_KEY, value } });
        return { deleted, batchId };
      }, { isolationLevel: 'Serializable', timeout: 20000, maxWait: 5000 });
    } catch (error) {
      // Never replay uncertain connection/commit outcomes.
      if (!isRetryableAttendanceBranchError(error) || attempt === 2 || Date.now() - startedAt >= 2200) throw error;
      await new Promise(resolve => setTimeout(resolve, 75 * (attempt + 1)));
    }
  }
}

module.exports = { deleteAttendanceFines, normalizeRequest };
