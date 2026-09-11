const DEFAULT_ATTENDANCE_CONFIG = {
    graceMinutes: 5,
    officialFineLevel1: 30000,
    officialFineLevel2: 70000,
    officialFineLevel3: 150000,
    seasonalFineLevel1: 10000,
    seasonalFineLevel2: 30000,
    seasonalFineLevel3: 60000,
    morningStart: '08:00',
    afternoonStart: '13:30',
};

let reconcileQueue = Promise.resolve();

function normalizeIdentity(value) {
    return String(value || '')
        .trim()
        .toLocaleLowerCase('vi-VN')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]/g, '');
}

function localDateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
}

function getFineLevel(lateMinutes) {
    if (lateMinutes <= 15) return { key: 'Level1', label: 'Nhẹ' };
    if (lateMinutes <= 30) return { key: 'Level2', label: 'TB' };
    return { key: 'Level3', label: 'Nặng' };
}

function getEmployeeForLog(employees, log) {
    const faceId = normalizeIdentity(log.faceId);
    const userName = normalizeIdentity(log.userName);
    return employees.find(employee => {
        const username = normalizeIdentity(employee.username);
        const name = normalizeIdentity(employee.name);
        return Boolean(
            (username && faceId && (username === faceId || username.endsWith(faceId) || faceId.endsWith(username)))
            || (name && userName && name === userName)
        );
    });
}

function isSameAttendanceFine(fine, employeeId, dateKey, shiftKey) {
    return Number(fine?.empId) === Number(employeeId)
        && fine?.source === 'attendance'
        && localDateKey(fine?.date) === dateKey
        && normalizeIdentity(fine?.detail).includes(`dimuonca${shiftKey}`);
}

function getConfiguredAmount(config, employee, levelKey) {
    const prefix = employee?.type === 'Official' ? 'officialFine' : 'seasonalFine';
    return Number(config[`${prefix}${levelKey}`] || 0);
}

function getHistoricalAmount(fines, employeesById, employee, levelKey, logDate, fallback) {
    const candidates = fines
        .filter(fine => {
            if (fine?.source !== 'attendance') return false;
            // Reconciled records must not become the source of historical rate truth.
            if (String(fine?.id || '').startsWith('fine-attendance-log-')) return false;
            const fineEmployee = employeesById.get(Number(fine.empId));
            if (!fineEmployee || fineEmployee.type !== employee.type) return false;
            const detail = normalizeIdentity(fine.detail);
            const expected = levelKey === 'Level1' ? 'mucnhe' : levelKey === 'Level2' ? 'muctb' : 'mucnang';
            return detail.includes(expected);
        })
        .sort((a, b) => localDateKey(a.date).localeCompare(localDateKey(b.date)));
    const previous = candidates.filter(fine => localDateKey(fine.date) <= logDate).at(-1);
    // If the missing log predates the first saved fine, the earliest later fine
    // is the best evidence of the rate that was active then.
    const reference = previous || candidates.find(fine => localDateKey(fine.date) > logDate);
    return reference ? Number(reference.amount || fallback) : fallback;
}

async function reconcileLateAttendanceFinesNow(prisma, options = {}) {
    const configRow = await prisma.appConfig.findUnique({ where: { key: 'attendanceData' } });
    if (!configRow) return { created: [], skippedDeleted: 0, unmatched: [], checked: 0 };

    let attendanceData;
    try {
        attendanceData = JSON.parse(configRow.value);
    } catch {
        throw new Error('Dữ liệu cấu hình chấm công không hợp lệ');
    }

    const config = { ...DEFAULT_ATTENDANCE_CONFIG, ...(attendanceData.config || {}) };
    const employees = Array.isArray(attendanceData.employees) ? attendanceData.employees : [];
    const employeesById = new Map(employees.map(employee => [Number(employee.id), employee]));
    const existingFines = Array.isArray(attendanceData.extraFines) ? attendanceData.extraFines : [];
    const fineAuditLog = Array.isArray(attendanceData.fineAuditLog) ? attendanceData.fineAuditLog : [];
    const deletedFines = fineAuditLog
        .filter(entry => entry?.action === 'delete' && entry?.before)
        .map(entry => entry.before);

    const logs = await prisma.attendanceLog.findMany({
        where: {
            checkType: { in: ['morning_in', 'afternoon_in'] },
            ...(Array.isArray(options.logIds) && options.logIds.length > 0
                ? { id: { in: options.logIds.map(Number).filter(Number.isInteger) } }
                : {}),
        },
        orderBy: { timestamp: 'asc' },
    });

    // Dữ liệu cũ từng cho phép nhiều log cùng ca. Chỉ lần vào đầu tiên mới dùng để tính phạt.
    const firstLogs = new Map();
    for (const log of logs) {
        const key = `${normalizeIdentity(log.faceId)}|${log.date}|${log.checkType}`;
        if (!firstLogs.has(key)) firstLogs.set(key, log);
    }

    const created = [];
    const updated = [];
    const unmatched = [];
    let skippedDeleted = 0;
    const currentMonth = localDateKey(new Date()).slice(0, 7);

    for (const log of firstLogs.values()) {
        const employee = getEmployeeForLog(employees, log);
        if (!employee) {
            unmatched.push({ logId: log.id, date: log.date, faceId: log.faceId, userName: log.userName });
            continue;
        }

        const isMorning = log.checkType === 'morning_in';
        const shiftKey = isMorning ? 'sang' : 'chieu';
        const shiftLabel = isMorning ? 'sáng' : 'chiều';
        const [startHour, startMinute] = String(isMorning ? config.morningStart : config.afternoonStart).split(':').map(Number);
        const timestamp = new Date(log.timestamp);
        const lateMinutes = timestamp.getHours() * 60 + timestamp.getMinutes() - (startHour * 60 + startMinute);
        if (lateMinutes <= Number(config.graceMinutes || 0)) continue;

        const level = getFineLevel(lateMinutes);
        const configuredAmount = getConfiguredAmount(config, employee, level.key);
        const amount = options.useHistoricalRates && log.date.slice(0, 7) !== currentMonth
            ? getHistoricalAmount(existingFines, employeesById, employee, level.key, log.date, configuredAmount)
            : configuredAmount;
        const sameFine = fine => isSameAttendanceFine(fine, employee.id, log.date, shiftKey);
        const existingFine = existingFines.find(sameFine);
        if (existingFine) {
            if (options.repairReconciledAmounts
                && String(existingFine.id || '') === `fine-attendance-log-${log.id}`
                && Number(existingFine.amount) !== amount) {
                updated.push({ before: existingFine, after: { ...existingFine, amount } });
            }
            continue;
        }
        if (created.some(sameFine)) continue;
        if (deletedFines.some(sameFine)) {
            skippedDeleted += 1;
            continue;
        }
        const [year, month, day] = log.date.split('-');
        created.push({
            id: `fine-attendance-log-${log.id}`,
            empId: Number(employee.id),
            type: 'Đi muộn',
            detail: `Đi muộn ca ${shiftLabel} ${lateMinutes} phút (Mức ${level.label}) — ${Number(day)}/${Number(month)}/${year}`,
            amount,
            date: timestamp.toISOString(),
            source: 'attendance',
            attendanceLogId: log.id,
        });
    }

    if (created.length > 0 || updated.length > 0) {
        const now = new Date().toISOString();
        const actor = options.actor || 'system';
        const nextData = {
            ...attendanceData,
            extraFines: [
                ...existingFines.map(fine => updated.find(item => item.before.id === fine.id)?.after || fine),
                ...created,
            ],
            fineAuditLog: [
                ...fineAuditLog,
                ...created.map(fine => ({
                    id: `flog-reconcile-${fine.attendanceLogId}`,
                    action: 'create',
                    timestamp: now,
                    changedBy: actor,
                    changedByName: actor === 'system' ? 'Hệ thống chấm công' : actor,
                    after: fine,
                    note: `Tự động đối soát phạt đi muộn từ log chấm công #${fine.attendanceLogId}`,
                })),
                ...updated.map(item => ({
                    id: `flog-reconcile-rate-${item.after.attendanceLogId}-${Date.now()}`,
                    action: 'edit',
                    timestamp: now,
                    changedBy: actor,
                    changedByName: actor === 'system' ? 'Hệ thống chấm công' : actor,
                    before: item.before,
                    after: item.after,
                    note: `Hiệu chỉnh mức phạt đối soát theo biểu phí lịch sử từ log #${item.after.attendanceLogId}`,
                })),
            ],
        };
        await prisma.appConfig.update({
            where: { key: 'attendanceData' },
            data: { value: JSON.stringify(nextData) },
        });
    }

    return { created, updated, skippedDeleted, unmatched, checked: firstLogs.size };
}

function reconcileLateAttendanceFines(prisma, options = {}) {
    const run = () => reconcileLateAttendanceFinesNow(prisma, options);
    const result = reconcileQueue.then(run, run);
    reconcileQueue = result.then(() => undefined, () => undefined);
    return result;
}

module.exports = { reconcileLateAttendanceFines };
