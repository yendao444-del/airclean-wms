const DEFAULT_ATTENDANCE_CONFIG = {
    graceMinutes: 5,
    officialFineLevel1: 30000,
    officialFineLevel2: 70000,
    officialFineLevel3: 120000,
    seasonalFineLevel1: 10000,
    seasonalFineLevel2: 30000,
    seasonalFineLevel3: 60000,
    morningStart: '08:00',
    afternoonStart: '13:30',
};
const { calculateAttendanceRewardSummary, resolveEmployeeId } = require('./attendance-rewards');
const { validScheduleForSession } = require('./attendance-schedule-fines');
const { readLateFineSnapshot } = require('./attendance-fine-snapshot');
const { loadResignedEmployeeCutoffs, isEmployeeResignedOn } = require('./employment-status');

let reconcileQueue = Promise.resolve();
const overviewReadsInFlight = new WeakMap();

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

function getScheduleConfigAt(config, timestamp, employeeType) {
    const current = { ...DEFAULT_ATTENDANCE_CONFIG, ...(config || {}) };
    const at = new Date(timestamp).getTime();
    if (!Number.isFinite(at) || !Array.isArray(current.scheduleHistory) || current.scheduleHistory.length === 0) {
        return current;
    }
    const versions = current.scheduleHistory
        .filter((version) => Number.isFinite(new Date(version?.effectiveAt).getTime()))
        .sort((left, right) => new Date(left.effectiveAt).getTime() - new Date(right.effectiveAt).getTime());
    let selected = current;
    for (const version of versions) {
        if (new Date(version.effectiveAt).getTime() > at) break;
        if (Array.isArray(version.employeeTypes)
            && version.employeeTypes.length > 0
            && !version.employeeTypes.includes(employeeType)) continue;
        selected = { ...current, ...version };
    }
    return selected;
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
    if (options.readOnlyProbe && typeof prisma.$queryRaw === 'function') {
        const snapshot = await readLateFineSnapshot(prisma, options);
        if (snapshot) {
            const resignedCutoffs = await loadResignedEmployeeCutoffs(prisma);
            const plan = calculateLateAttendanceFinePlan(snapshot.data, snapshot.logs, { ...options, resignedCutoffs });
            if (!plan.patch) return plan.result;
            // The overview path already has a consistent MVCC snapshot. Do
            // only the tiny JSON-branch patch in a transaction and guard it
            // with the snapshot revision. This keeps the historical scan out
            // of the advisory-lock transaction, so an interactive fine delete
            // is not forced to wait 10-15 seconds behind 700+ attendance logs.
            if (snapshot.updatedAt && typeof prisma.$transaction === 'function') {
                return await applyLateFinePatchOptimistic(prisma, snapshot.updatedAt, plan.patch, plan.result, resignedCutoffs);
            }
        }
        // If the snapshot has no revision (legacy test/mocked clients), fall
        // back to the locked read/compute path below.
    }
    // Reconciliation used to read and then replace the entire JSON document
    // outside a transaction. That allowed another attendance edit to be lost
    // and caused the safety guard to disable automatic fine creation. Keep the
    // same JSON format, but serialize the read/merge/write under one lock.
    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '7000ms'`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'attendanceData'}))`;

        // Payroll snapshots can make attendanceData several megabytes. Late-fine
        // reconciliation never reads them, so keep them in PostgreSQL instead of
        // transferring every historical snapshot over the Supabase connection.
        const configRow = typeof tx.$queryRaw === 'function'
            ? (await tx.$queryRaw`
                WITH source AS MATERIALIZED (
                    SELECT "value"::jsonb AS data FROM "AppConfig"
                    WHERE "key" = 'attendanceData' LIMIT 1
                )
                SELECT jsonb_build_object(
                    'config', data->'config',
                    'employees', data->'employees',
                    'extraFines', data->'extraFines',
                    'fineAuditLog', data->'fineAuditLog',
                    'fineWaivers', data->'fineWaivers',
                    'workSchedules', data->'workSchedules',
                    'leaveRecords', data->'leaveRecords'
                )::text AS "value"
                FROM source
            `)?.[0]
            : await tx.appConfig.findUnique({ where: { key: 'attendanceData' } });
        if (!configRow) return { created: [], updated: [], waived: [], skippedDeleted: 0, unmatched: [], checked: 0 };

        let attendanceData;
        try {
            attendanceData = JSON.parse(configRow.value);
        } catch {
            throw new Error('Dữ liệu cấu hình chấm công không hợp lệ');
        }

        const logs = await tx.attendanceLog.findMany({
            where: {
                checkType: { in: ['morning_in', 'afternoon_in'] },
                ...(Array.isArray(options.logIds) && options.logIds.length > 0
                    ? { id: { in: options.logIds.map(Number).filter(Number.isInteger) } }
                    : {}),
            },
            orderBy: { timestamp: 'asc' },
        });
        const resignedCutoffs = await loadResignedEmployeeCutoffs(tx);
        const { result, patch } = calculateLateAttendanceFinePlan(attendanceData, logs, {
            ...options,
            resignedCutoffs,
        });
        if (patch) {
            if (typeof tx.$queryRaw === 'function') {
                // Only fine branches change; payroll snapshots stay untouched.
                await tx.$executeRaw`
                    UPDATE "AppConfig"
                    SET "value" = jsonb_set(
                        jsonb_set(
                            jsonb_set("value"::jsonb, '{extraFines}', ${JSON.stringify(patch.extraFines)}::jsonb, true),
                            '{fineWaivers}', ${JSON.stringify(patch.fineWaivers)}::jsonb, true
                        ), '{fineAuditLog}', ${JSON.stringify(patch.fineAuditLog)}::jsonb, true
                    )::text, "updatedAt" = NOW()
                    WHERE "key" = 'attendanceData'
                `;
            } else {
                await tx.appConfig.update({
                    where: { key: 'attendanceData' },
                    data: { value: JSON.stringify({ ...attendanceData, ...patch }) },
                });
            }
        }
        return result;
    }, { isolationLevel: 'Serializable', timeout: 30000, maxWait: 10000 });
}

function cutoffRevision(cutoffs) {
    return JSON.stringify([
        [...cutoffs.byId].sort(([a], [b]) => a - b),
        [...cutoffs.byUsername].sort(([a], [b]) => a.localeCompare(b)),
    ]);
}

async function applyLateFinePatchOptimistic(prisma, snapshotUpdatedAt, patch, result, resignedCutoffs) {
    return prisma.$transaction(async (tx) => {
        // This path already has an MVCC revision guard below.  Do not take the
        // shared attendanceData advisory lock here: the historical scan ran
        // outside the transaction, so holding that lock only makes an
        // interactive fine delete wait behind the reconciliation writer.
        // The row update remains conditional on updatedAt and therefore
        // safely aborts/recomputes when another writer commits first.
        await tx.$executeRaw`SET LOCAL lock_timeout = '800ms'`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
        // Employment data lives outside attendanceData. Validate it too so a
        // resignation during the scan cannot create new fines for that user.
        const currentCutoffs = await loadResignedEmployeeCutoffs(tx);
        if (cutoffRevision(currentCutoffs) !== cutoffRevision(resignedCutoffs)) {
            throw Object.assign(new Error('Trạng thái nhân viên vừa thay đổi.'), { code: 'P2034' });
        }
        const rows = await tx.$queryRaw`
            UPDATE "AppConfig"
            SET "value" = jsonb_set(
                jsonb_set(
                    jsonb_set("value"::jsonb, '{extraFines}', ${JSON.stringify(patch.extraFines)}::jsonb, true),
                    '{fineWaivers}', ${JSON.stringify(patch.fineWaivers)}::jsonb, true
                ), '{fineAuditLog}', ${JSON.stringify(patch.fineAuditLog)}::jsonb, true
            )::text, "updatedAt" = NOW()
            WHERE "key" = 'attendanceData' AND "updatedAt" = ${new Date(snapshotUpdatedAt)}
            RETURNING "updatedAt"
        `;
        if (!rows.length) {
            throw Object.assign(new Error('Dữ liệu Bảng công vừa thay đổi.'), { code: 'P2034' });
        }
        return result;
    }, { isolationLevel: 'Serializable', timeout: 6000, maxWait: 3000 });
}

function calculateLateAttendanceFinePlan(attendanceData, logs, options = {}) {
        const config = { ...DEFAULT_ATTENDANCE_CONFIG, ...(attendanceData.config || {}) };
        const employees = Array.isArray(attendanceData.employees) ? attendanceData.employees : [];
        const employeesById = new Map(employees.map(employee => [Number(employee.id), employee]));
        const existingFines = Array.isArray(attendanceData.extraFines) ? attendanceData.extraFines : [];
        const fineAuditLog = Array.isArray(attendanceData.fineAuditLog) ? attendanceData.fineAuditLog : [];
        const fineWaivers = Array.isArray(attendanceData.fineWaivers) ? attendanceData.fineWaivers : [];
        let ledger = { extraFines: existingFines, fineAuditLog };
        let patch = null;
        const deletedFines = fineAuditLog
            .filter(entry => entry?.action === 'delete' && entry?.before)
            .map(entry => entry.before);

        // Dữ liệu cũ từng cho phép nhiều log cùng ca. Chỉ lần vào đầu tiên mới dùng để tính phạt.
        const firstLogs = new Map();
        const rewardLogsByEmployee = new Map();
        for (const log of logs) {
            const key = `${normalizeIdentity(log.faceId)}|${log.date}|${log.checkType}`;
            if (!firstLogs.has(key)) firstLogs.set(key, log);
            const employeeId = resolveEmployeeId(log, employees);
            if (!rewardLogsByEmployee.has(employeeId)) rewardLogsByEmployee.set(employeeId, []);
            rewardLogsByEmployee.get(employeeId).push(log);
        }

        const created = [];
        const updated = [];
        const waived = [];
        const waivedExistingFineIds = new Set();
        const unmatched = [];
        let skippedDeleted = 0;
        const currentMonth = localDateKey(new Date()).slice(0, 7);

        for (const log of firstLogs.values()) {
            const employee = getEmployeeForLog(employees, log);
            if (!employee) {
                unmatched.push({ logId: log.id, date: log.date, faceId: log.faceId, userName: log.userName });
                continue;
            }
            // The resignation date is the first inactive day. Keep all
            // historical fines before it, but never create a new fine after it.
            if (isEmployeeResignedOn(employee, log.date || localDateKey(log.timestamp), options.resignedCutoffs)) continue;

            // Seasonal staff are fined for lateness only after declaring a shift.
            // Missing declarations are reconciled separately by the schedule policy.
            const declaredSession = log.checkType === 'morning_in' ? 'morning' : 'afternoon';
            if (employee.type === 'Seasonal'
                && !validScheduleForSession(attendanceData.workSchedules || [], employee.id, log.date, declaredSession)) {
                continue;
            }

            const isMorning = log.checkType === 'morning_in';
            const shiftKey = isMorning ? 'sang' : 'chieu';
            const shiftLabel = isMorning ? 'sáng' : 'chiều';
            const scheduleConfig = getScheduleConfigAt(config, log.timestamp, employee.type);
            const [startHour, startMinute] = String(isMorning ? scheduleConfig.morningStart : scheduleConfig.afternoonStart).split(':').map(Number);
            const timestamp = new Date(log.timestamp);
            const lateMinutes = timestamp.getHours() * 60 + timestamp.getMinutes() - (startHour * 60 + startMinute);
            if (lateMinutes <= Number(scheduleConfig.graceMinutes || 0)) continue;

            const level = getFineLevel(lateMinutes);
            const configuredAmount = getConfiguredAmount(config, employee, level.key);
            const amount = options.useHistoricalRates && log.date.slice(0, 7) !== currentMonth
                ? getHistoricalAmount(existingFines, employeesById, employee, level.key, log.date, configuredAmount)
                : configuredAmount;
            const sameFine = fine => isSameAttendanceFine(fine, employee.id, log.date, shiftKey);
            const existingFine = existingFines.find(sameFine);
            const [year, month, day] = log.date.split('-');
            const nextFine = {
                id: `fine-attendance-log-${log.id}`,
                empId: Number(employee.id),
                type: 'Đi muộn',
                detail: `Đi muộn ca ${shiftLabel} ${lateMinutes} phút (Mức ${level.label}) — ${Number(day)}/${Number(month)}/${year}`,
                amount,
                date: timestamp.toISOString(),
                source: 'attendance',
                attendanceLogId: log.id,
            };

            const periodKey = String(log.date || '').slice(0, 7);
            const waiverAlreadyUsed = fineWaivers.some((waiver) => (
                waiver?.autoAttendanceWaiver
                && Number(waiver?.empId) === Number(employee.id)
                && waiver?.periodKey === periodKey
            )) || waived.some((waiver) => (
                Number(waiver.empId) === Number(employee.id) && waiver.periodKey === periodKey
            ));
            const rewardSummary = waiverAlreadyUsed
                ? null
                : calculateAttendanceRewardSummary({
                    employee,
                    employees,
                    // Preserve reward identity rules, but avoid rescanning every
                    // other employee's history for each late check-in.
                    logs: (rewardLogsByEmployee.get(Number(employee.id)) || []).filter((candidate) => (
                        new Date(candidate.timestamp).getTime() <= timestamp.getTime()
                    )),
                    workSchedules: attendanceData.workSchedules || [],
                    leaveRecords: attendanceData.leaveRecords || [],
                    fineWaivers,
                    config,
                    now: log.timestamp,
                    periodKey,
                });
            const waiver = rewardSummary?.waiver;
            const shouldWaive = Boolean(waiver?.eligible && lateMinutes <= waiver.lateMaxMinutes);
            const waiverReason = shouldWaive
                ? `Miễn phạt chuyên cần: đạt chuỗi đúng giờ ${waiver.upgraded ? waiver.upgradeStreakDays : waiver.streakDays} ngày liên tiếp; lần đi muộn ${lateMinutes} phút nằm trong giới hạn ${Number(config.graceMinutes || 0) + 1}–${waiver.lateMaxMinutes} phút. Không khấu trừ ${amount.toLocaleString('vi-VN')}đ.`
                : '';

            // Re-run the waiver decision for an existing automatic fine. This
            // matters when an approved leave is saved after the late-fine
            // reconciliation already ran: the leave can restore a seven-day
            // streak, so the stale fine must be converted to a waiver.
            if (existingFine) {
                if (shouldWaive && String(existingFine.id || '').startsWith('fine-attendance-log-')) {
                    waivedExistingFineIds.add(String(existingFine.id));
                    waived.push({
                        id: `attendance-waiver-${employee.id}-${periodKey}-${log.id}`,
                        empId: Number(employee.id),
                        periodKey,
                        autoAttendanceWaiver: true,
                        fine: existingFine,
                        waivedAt: new Date(log.timestamp).toISOString(),
                        reason: waiverReason,
                    });
                } else if (options.repairReconciledAmounts
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
            // The same monthly credit grows from 15 to 20 minutes after a
            // 15-day streak. It remains a single use even when upgraded.
            if (shouldWaive) {
                waived.push({
                    id: `attendance-waiver-${employee.id}-${periodKey}-${log.id}`,
                    empId: Number(employee.id),
                    periodKey,
                    autoAttendanceWaiver: true,
                    fine: nextFine,
                    waivedAt: new Date(log.timestamp).toISOString(),
                    reason: waiverReason,
                });
                continue;
            }

            created.push(nextFine);
        }

        if (created.length > 0 || updated.length > 0 || waived.length > 0) {
            const now = new Date().toISOString();
            const actor = options.actor || 'system';
            const updatedById = new Map(updated.map(item => [item.before.id, item.after]));
            const nextExtraFines = [
                    ...existingFines
                        .filter(fine => !waivedExistingFineIds.has(String(fine?.id)))
                        .map(fine => updatedById.get(fine.id) || fine),
                    ...created,
                ];
            const nextFineWaivers = [...fineWaivers, ...waived];
            const nextFineAuditLog = [
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
                    ...waived.map(item => ({
                        id: `flog-attendance-waiver-${item.fine.attendanceLogId}`,
                        action: waivedExistingFineIds.has(String(item.fine.id)) ? 'delete' : 'edit',
                        timestamp: now,
                        changedBy: actor,
                        changedByName: actor === 'system' ? 'Hệ thống chấm công' : actor,
                        ...(waivedExistingFineIds.has(String(item.fine.id)) ? { before: item.fine } : {}),
                        after: item.fine,
                        note: `Tự động dùng lượt miễn phạt chuyên cần cho log #${item.fine.attendanceLogId}: ${item.reason}`,
                    })),
                ];
            patch = { extraFines: nextExtraFines, fineWaivers: nextFineWaivers, fineAuditLog: nextFineAuditLog };
            ledger = { extraFines: nextExtraFines, fineAuditLog: nextFineAuditLog };
        }

        return { patch, result: { created, updated, waived, skippedDeleted, unmatched, checked: firstLogs.size,
            ...(options.includeLedger ? { ledger } : {}),
        } };
}

function reconcileLateAttendanceFines(prisma, options = {}) {
    let requests;
    const requestKey = JSON.stringify(options);
    if (options.readOnlyProbe) {
        requests = overviewReadsInFlight.get(prisma);
        if (!requests) overviewReadsInFlight.set(prisma, requests = new Map());
        const existing = requests.get(requestKey);
        if (existing) return existing;
    }
    const run = async () => {
        for (let attempt = 0; ; attempt += 1) {
            try {
                return await reconcileLateAttendanceFinesNow(prisma, options);
            } catch (error) {
                // Retry only rolled-back conflicts/expiry, with a fresh locked read.
                const retryable = error?.code === 'P2034'
                    || (error?.code === 'P2028' && /expired|already closed/i.test(error.message))
                    || ['55P03', '40001', '40P01'].includes(error?.meta?.code);
                if (!retryable || attempt >= 1) throw error;
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
    };
    const result = reconcileQueue.then(run, run);
    reconcileQueue = result.then(() => undefined, () => undefined);
    if (requests) {
        requests.set(requestKey, result);
        const clear = () => { if (requests.get(requestKey) === result) requests.delete(requestKey); };
        void result.then(clear, clear);
    }
    return result;
}

module.exports = { getEmployeeForLog, normalizeIdentity, reconcileLateAttendanceFines, calculateLateAttendanceFinePlan };
