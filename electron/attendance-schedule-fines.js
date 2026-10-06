const { addDays, isRestDay } = require('./attendance-rewards');
const { loadResignedEmployeeCutoffs, isEmployeeResignedOn } = require('./employment-status');

const MISSING_SCHEDULE_FINE = 100000;
const PARTIAL_ATTENDANCE_FINE = 50000;
const OFFICIAL_ABSENCE_FINE = 200000;
const POLICY_EFFECTIVE_DATE = '2026-09-19';
const CUTOFF_HOUR = 19;
const ATTENDANCE_RECONCILE_BUSY = 'ATTENDANCE_RECONCILE_BUSY';

function isRetryableReconcileError(error) {
    const message = String(error?.message || error || '');
    return error?.code === 'P2034'
        || error?.code === 'P2028'
        || ['55P03', '40P01', '40001'].includes(String(error?.meta?.code || error?.code || ''))
        || /write conflict|deadlock|could not serialize|serialization failure|lock timeout|statement timeout|could not obtain lock|nowait|transaction.*timed out/i.test(message);
}

function retryDelayMs(attempt) {
    return [150, 350, 750, 1500][attempt] || 1500;
}

function normalizeIdentity(value) {
    return String(value || '')
        .trim()
        .toLocaleLowerCase('vi-VN')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]/g, '');
}

function dateKeyFromTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

function dateAtBangkok(dateKey, hour = 0) {
    return new Date(`${dateKey}T${String(hour).padStart(2, '0')}:00:00+07:00`);
}

function deadlineFor(dateKey) {
    return dateAtBangkok(addDays(dateKey, -1), CUTOFF_HOUR);
}

function employeeForLog(employees, log) {
    const faceId = normalizeIdentity(log?.faceId);
    const userName = normalizeIdentity(log?.userName);
    return (employees || []).find((employee) => {
        const username = normalizeIdentity(employee?.username);
        const name = normalizeIdentity(employee?.name);
        return (username && faceId && (username === faceId || username.endsWith(faceId) || faceId.endsWith(username)))
            || (name && userName && name === userName);
    }) || null;
}

function validScheduleForDate(schedules, employeeId, dateKey) {
    return (schedules || []).some((schedule) => (
        Number(schedule?.empId) === Number(employeeId)
        && schedule?.date === dateKey
        && ['morning', 'afternoon', 'off'].includes(schedule?.session)
    ));
}

function validScheduleForSession(schedules, employeeId, dateKey, session) {
    return (schedules || []).some((schedule) => (
        Number(schedule?.empId) === Number(employeeId)
        && schedule?.date === dateKey
        && schedule?.session === session
    ));
}

function fineId(employeeId, dateKey) {
    return `fine-attendance-schedule-${employeeId}-${dateKey}`;
}

function absenceFineId(employeeId, dateKey, session) {
    return `fine-attendance-absence-${employeeId}-${dateKey}-${session}`;
}

function deletedFineIds(fineAuditLog) {
    return new Set((fineAuditLog || [])
        .filter((entry) => entry?.action === 'delete' && entry?.before?.id)
        .map((entry) => String(entry.before.id)));
}

function logsByEmployeeAndDate(logs, employeeId, employees, dateKey) {
    return (logs || []).filter((log) => {
        const employee = employeeForLog(employees, log);
        return employee
            && Number(employee.id) === Number(employeeId)
            && (log?.date || dateKeyFromTimestamp(log?.timestamp)) === dateKey
            && ['morning_in', 'morning_out', 'afternoon_in', 'evening_out'].includes(log?.checkType);
    });
}

function dateRangeThroughToday(now) {
    const today = dateKeyFromTimestamp(now);
    const rows = [];
    let cursor = POLICY_EFFECTIVE_DATE;
    const lastTarget = today;
    while (cursor && cursor <= lastTarget && rows.length < 366) {
        const nowMs = new Date(now).getTime();
        if (nowMs >= deadlineFor(cursor).getTime()) rows.push(cursor);
        cursor = addDays(cursor, 1);
    }
    return rows;
}

function completedWorkDatesThroughToday(now) {
    const today = dateKeyFromTimestamp(now);
    const rows = [];
    let cursor = POLICY_EFFECTIVE_DATE;
    while (cursor && cursor <= today && rows.length < 366) {
        if (new Date(now).getTime() >= dateAtBangkok(cursor, CUTOFF_HOUR).getTime()) rows.push(cursor);
        cursor = addDays(cursor, 1);
    }
    return rows;
}

function isPrematureMissingScheduleFine(fine, now = new Date()) {
    if (fine?.type !== 'Không đăng ký lịch') return false;
    const idMatch = String(fine?.id || '').match(/^fine-attendance-schedule-\d+-(\d{4}-\d{2}-\d{2})$/);
    const dateKey = String(fine?.attendanceDate || idMatch?.[1] || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
    return new Date(now).getTime() < dateAtBangkok(dateKey, CUTOFF_HOUR).getTime();
}

async function reconcileMissingSeasonalScheduleFinesLegacy(prisma, options = {}) {
    const evaluationNow = options.now || new Date();
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const transactionStartedAt = Date.now();
      try {
        const result = await prisma.$transaction(async (tx) => {
        // Never let an advisory-lock wait consume the whole interactive
        // transaction lifetime. A fresh retry can acquire the lock safely.
        await tx.$executeRaw`SET LOCAL lock_timeout = '7000ms'`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('attendanceData'))`;
        // Keep large payroll snapshots in PostgreSQL. Reconciliation needs
        // only these fields and must not rewrite unrelated attendance data.
        const configRows = await tx.$queryRaw`
            WITH source AS MATERIALIZED (
                SELECT "value"::json AS data FROM "AppConfig" WHERE "key" = 'attendanceData'
            )
            SELECT json_build_object(
                'employees', data->'employees',
                'workSchedules', data->'workSchedules',
                'leaveRecords', data->'leaveRecords',
                'extraFines', data->'extraFines',
                'fineAuditLog', data->'fineAuditLog',
                'config', data->'config'
            )::text AS "value"
            FROM source
        `;
        const configRow = configRows[0];
        if (!configRow) return { created: [], removed: [], checked: 0 };

        let attendanceData = {};
        try { attendanceData = JSON.parse(configRow.value || '{}'); } catch { throw new Error('Dữ liệu cấu hình chấm công không hợp lệ'); }
        const employees = Array.isArray(attendanceData.employees) ? attendanceData.employees : [];
        const resignedCutoffs = await loadResignedEmployeeCutoffs(tx);
        const schedules = Array.isArray(attendanceData.workSchedules) ? attendanceData.workSchedules : [];
        const leaveRecords = Array.isArray(attendanceData.leaveRecords) ? attendanceData.leaveRecords : [];
        const existingFines = Array.isArray(attendanceData.extraFines) ? attendanceData.extraFines : [];
        const fineAuditLog = Array.isArray(attendanceData.fineAuditLog) ? attendanceData.fineAuditLog : [];
        const deletedIds = deletedFineIds(fineAuditLog);
        const targetDates = options.dateKey ? [String(options.dateKey)] : dateRangeThroughToday(evaluationNow);
        const latestLogDate = options.dateKey ? String(options.dateKey) : dateKeyFromTimestamp(evaluationNow);
        const logs = await tx.attendanceLog.findMany({
            where: {
                date: options.dateKey
                    ? String(options.dateKey)
                    : { gte: POLICY_EFFECTIVE_DATE, lte: latestLogDate },
                checkType: { in: ['morning_in', 'morning_out', 'afternoon_in', 'evening_out'] },
            },
            select: { faceId: true, userName: true, date: true, timestamp: true, checkType: true },
            orderBy: { timestamp: 'asc' },
        });
        const created = [];
        const removed = [];
        const updated = [];

        for (const employee of employees.filter((item) => item?.type === 'Seasonal')) {
            for (const dateKey of targetDates) {
                if (dateKey < POLICY_EFFECTIVE_DATE || isRestDay(dateKey)) continue;
                if (isEmployeeResignedOn(employee, dateKey, resignedCutoffs)) continue;
                if (new Date(evaluationNow).getTime() < deadlineFor(dateKey).getTime()) continue;
                const id = fineId(employee.id, dateKey);
                const declaredSchedules = schedules.filter((schedule) => (
                    Number(schedule?.empId) === Number(employee.id) && schedule?.date === dateKey
                ));
                const scheduled = declaredSchedules.length > 0;
                const existing = existingFines.find((fine) => String(fine?.id) === id);
                if (scheduled) {
                    if (existing && existing.source === 'attendance-schedule') removed.push(existing);
                    if (new Date(evaluationNow).getTime() < dateAtBangkok(dateKey, CUTOFF_HOUR).getTime()) continue;
                    const logsForDate = logsByEmployeeAndDate(logs, employee.id, employees, dateKey);
                    for (const declaration of declaredSchedules.filter((schedule) => ['morning', 'afternoon'].includes(schedule?.session))) {
                        const attendedDeclaredSession = declaration.session === 'morning'
                            ? logsForDate.some((log) => ['morning_in', 'morning_out'].includes(log.checkType))
                            : logsForDate.some((log) => ['afternoon_in', 'evening_out'].includes(log.checkType));
                        const absenceId = absenceFineId(employee.id, dateKey, declaration.session);
                        if (attendedDeclaredSession
                            || existingFines.some((fine) => String(fine?.id) === absenceId)
                            || created.some((fine) => fine.id === absenceId)
                            || deletedIds.has(absenceId)) continue;
                        const [year, month, day] = dateKey.split('-');
                        created.push({
                            id: absenceId,
                            empId: Number(employee.id),
                            type: 'Bỏ ca đã đăng ký',
                            detail: `Đã đăng ký ca ${declaration.session === 'morning' ? 'sáng' : 'chiều'} ngày ${Number(day)}/${Number(month)}/${year} nhưng không đi làm`,
                            amount: MISSING_SCHEDULE_FINE,
                            date: dateAtBangkok(dateKey, CUTOFF_HOUR).toISOString(),
                            source: 'attendance-schedule',
                            schedulePenalty: true,
                            attendanceDate: dateKey,
                            scheduledSession: declaration.session,
                        });
                    }
                    continue;
                }

                // A missed registration deadline does not prove a no-show.
                // Wait for the workday to end before classifying the fine.
                if (new Date(evaluationNow).getTime() < dateAtBangkok(dateKey, CUTOFF_HOUR).getTime()) {
                    if (existing && existing.source === 'attendance-schedule') removed.push(existing);
                    continue;
                }

                const logsForDate = logsByEmployeeAndDate(logs, employee.id, employees, dateKey);
                const attended = logsForDate.length > 0;
                const amount = attended ? PARTIAL_ATTENDANCE_FINE : MISSING_SCHEDULE_FINE;
                const [year, month, day] = dateKey.split('-');
                if (existing && existing.amount !== amount) {
                    existing.amount = amount;
                    existing.detail = attended
                        ? `Không đăng ký lịch làm ngày ${Number(day)}/${Number(month)}/${year}, nhưng vẫn đi làm — phạt thiếu khai báo (1 ca)`
                        : `Không đăng ký lịch làm ngày ${Number(day)}/${Number(month)}/${year} — không đi làm`;
                    updated.push(existing);
                }
                if (existing || created.some((fine) => fine.id === id) || deletedIds.has(id)) continue;

                const nextFine = {
                    id,
                    empId: Number(employee.id),
                    type: 'Không đăng ký lịch',
                    detail: attended
                        ? `Không đăng ký lịch làm ngày ${Number(day)}/${Number(month)}/${year}, nhưng vẫn đi làm — phạt thiếu khai báo (1 ca)`
                        : `Không đăng ký lịch làm ngày ${Number(day)}/${Number(month)}/${year} — không đi làm`,
                    amount,
                    date: dateAtBangkok(dateKey, CUTOFF_HOUR).toISOString(),
                    source: 'attendance-schedule',
                    schedulePenalty: true,
                    attendanceDate: dateKey,
                };
                created.push(nextFine);
            }
        }

        const officialAbsenceFine = Number(attendanceData.config?.officialAbsentFine ?? OFFICIAL_ABSENCE_FINE);
        const officialDates = options.dateKey ? [String(options.dateKey)] : completedWorkDatesThroughToday(evaluationNow);
        for (const employee of employees.filter((item) => item?.type === 'Official')) {
            for (const dateKey of officialDates) {
                if (dateKey < POLICY_EFFECTIVE_DATE || isRestDay(dateKey)) continue;
                if (isEmployeeResignedOn(employee, dateKey, resignedCutoffs)) continue;
                if (new Date(evaluationNow).getTime() < dateAtBangkok(dateKey, CUTOFF_HOUR).getTime()) continue;
                const logsForDate = logsByEmployeeAndDate(logs, employee.id, employees, dateKey);
                const [year, month, day] = dateKey.split('-');
                for (const session of ['morning', 'afternoon']) {
                    const worked = session === 'morning'
                        ? logsForDate.some((log) => ['morning_in', 'morning_out'].includes(log.checkType))
                        : logsForDate.some((log) => ['afternoon_in', 'evening_out'].includes(log.checkType));
                    const leave = leaveRecords.find((item) => (
                        Number(item?.empId) === Number(employee.id)
                        && item?.date === dateKey
                        && item?.session === session
                    ));
                    const excused = Boolean(leave && !leave.unpaid);
                    const id = `fine-attendance-official-absence-${employee.id}-${dateKey}-${session}`;
                    const existing = existingFines.find((fine) => String(fine?.id) === id);
                    if (worked || excused) {
                        if (existing && existing.source === 'attendance-official-absence') removed.push(existing);
                        continue;
                    }
                    if (existing || created.some((fine) => fine.id === id) || deletedIds.has(id)) continue;
                    created.push({
                        id,
                        empId: Number(employee.id),
                        type: 'Nghỉ không phép',
                        detail: `Không đi làm ca ${session === 'morning' ? 'sáng' : 'chiều'} ngày ${Number(day)}/${Number(month)}/${year}`,
                        amount: officialAbsenceFine,
                        date: dateAtBangkok(dateKey, CUTOFF_HOUR).toISOString(),
                        source: 'attendance-official-absence',
                        attendanceDate: dateKey,
                        scheduledSession: session,
                    });
                }
            }
        }

        const removedIds = new Set(removed.map((fine) => String(fine.id)));
        const nextFines = [
            ...existingFines.filter((fine) => !removedIds.has(String(fine?.id))),
            ...created,
        ];
        if (created.length || removed.length || updated.length) {
            const patch = JSON.stringify({ extraFines: nextFines });
            await tx.$executeRaw`
                UPDATE "AppConfig"
                SET "value" = (SELECT json_object_agg(key, value) FROM (
                    SELECT key, value FROM json_each("AppConfig"."value"::json) WHERE key <> 'extraFines'
                    UNION ALL SELECT key, value FROM json_each(${patch}::json)
                ) AS fine_fields)::text,
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE "key" = 'attendanceData'
            `;
        }
        return { created, removed, updated, checked: targetDates.length };
        }, { isolationLevel: 'Serializable', timeout: 15000, maxWait: 5000 });
        console.info(`[Attendance Schedule] attempt=${attempt + 1} transaction=${Date.now() - transactionStartedAt}ms created=${result.created?.length || 0} removed=${result.removed?.length || 0} updated=${result.updated?.length || 0}`);
        return result;
      } catch (error) {
        if (!isRetryableReconcileError(error) || attempt === 4) {
          if (isRetryableReconcileError(error)) {
            const busyError = new Error('Bảng công đang bận đối soát phạt. Vui lòng thử lại sau.');
            busyError.code = ATTENDANCE_RECONCILE_BUSY;
            busyError.cause = error;
            throw busyError;
          }
          throw error;
        }
        lastError = error;
        console.warn(`[Attendance Schedule] retry=${attempt + 1} error=${error?.code || 'transaction_conflict'} message=${String(error?.message || error)}`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
      }
    }
    throw lastError || new Error('Không thể đối soát phạt chấm công.');
}

async function readScheduleReconcileSnapshot(client, options, evaluationNow) {
    const latestLogDate = options.dateKey ? String(options.dateKey) : dateKeyFromTimestamp(evaluationNow);
    const [configRows, resignedCutoffs, logs] = await Promise.all([
        client.$queryRaw`
            WITH source AS MATERIALIZED (
                SELECT "value"::json AS data FROM "AppConfig" WHERE "key" = 'attendanceData'
            )
            SELECT json_build_object(
                'employees', data->'employees',
                'workSchedules', data->'workSchedules',
                'leaveRecords', data->'leaveRecords',
                'extraFines', data->'extraFines',
                'fineAuditLog', data->'fineAuditLog',
                'config', data->'config'
            )::text AS "value"
            FROM source
        `,
        loadResignedEmployeeCutoffs(client),
        client.attendanceLog.findMany({
            where: {
                date: options.dateKey
                    ? String(options.dateKey)
                    : { gte: POLICY_EFFECTIVE_DATE, lte: latestLogDate },
                checkType: { in: ['morning_in', 'morning_out', 'afternoon_in', 'evening_out'] },
            },
            select: { faceId: true, userName: true, date: true, timestamp: true, checkType: true },
            orderBy: { timestamp: 'asc' },
        }),
    ]);
    const configRow = configRows?.[0];
    let attendanceData = {};
    try { attendanceData = JSON.parse(configRow?.value || '{}'); } catch { throw new Error('Dữ liệu cấu hình chấm công không hợp lệ'); }
    return { attendanceData, resignedCutoffs, logs: logs || [] };
}

function calculateScheduleReconcileResult(attendanceData, resignedCutoffs, logs, options, evaluationNow) {
    const employees = Array.isArray(attendanceData.employees) ? attendanceData.employees : [];
    const schedules = Array.isArray(attendanceData.workSchedules) ? attendanceData.workSchedules : [];
    const leaveRecords = Array.isArray(attendanceData.leaveRecords) ? attendanceData.leaveRecords : [];
    const existingFines = Array.isArray(attendanceData.extraFines) ? attendanceData.extraFines : [];
    const fineAuditLog = Array.isArray(attendanceData.fineAuditLog) ? attendanceData.fineAuditLog : [];
    const deletedIds = deletedFineIds(fineAuditLog);
    const targetDates = options.dateKey ? [String(options.dateKey)] : dateRangeThroughToday(evaluationNow);
    const created = [];
    const removed = [];
    const updated = [];
    const nowMs = new Date(evaluationNow).getTime();

    for (const employee of employees.filter((item) => item?.type === 'Seasonal')) {
        for (const dateKey of targetDates) {
            if (dateKey < POLICY_EFFECTIVE_DATE || isRestDay(dateKey)) continue;
            if (isEmployeeResignedOn(employee, dateKey, resignedCutoffs)) continue;
            if (nowMs < deadlineFor(dateKey).getTime()) continue;
            const id = fineId(employee.id, dateKey);
            const declaredSchedules = schedules.filter((schedule) => Number(schedule?.empId) === Number(employee.id) && schedule?.date === dateKey);
            const scheduled = declaredSchedules.length > 0;
            const existing = existingFines.find((fine) => String(fine?.id) === id);
            if (scheduled) {
                if (existing && existing.source === 'attendance-schedule') removed.push(existing);
                if (nowMs < dateAtBangkok(dateKey, CUTOFF_HOUR).getTime()) continue;
                const logsForDate = logsByEmployeeAndDate(logs, employee.id, employees, dateKey);
                for (const declaration of declaredSchedules.filter((schedule) => ['morning', 'afternoon'].includes(schedule?.session))) {
                    const attendedDeclaredSession = declaration.session === 'morning'
                        ? logsForDate.some((log) => ['morning_in', 'morning_out'].includes(log.checkType))
                        : logsForDate.some((log) => ['afternoon_in', 'evening_out'].includes(log.checkType));
                    const absenceId = absenceFineId(employee.id, dateKey, declaration.session);
                    if (attendedDeclaredSession || existingFines.some((fine) => String(fine?.id) === absenceId) || created.some((fine) => fine.id === absenceId) || deletedIds.has(absenceId)) continue;
                    const [year, month, day] = dateKey.split('-');
                    created.push({
                        id: absenceId,
                        empId: Number(employee.id),
                        type: 'Bỏ ca đã đăng ký',
                        detail: `Đã đăng ký ca ${declaration.session === 'morning' ? 'sáng' : 'chiều'} ngày ${Number(day)}/${Number(month)}/${year} nhưng không đi làm`,
                        amount: MISSING_SCHEDULE_FINE,
                        date: dateAtBangkok(dateKey, CUTOFF_HOUR).toISOString(),
                        source: 'attendance-schedule',
                        schedulePenalty: true,
                        attendanceDate: dateKey,
                        scheduledSession: declaration.session,
                    });
                }
                continue;
            }
            if (nowMs < dateAtBangkok(dateKey, CUTOFF_HOUR).getTime()) {
                if (existing && existing.source === 'attendance-schedule') removed.push(existing);
                continue;
            }
            const logsForDate = logsByEmployeeAndDate(logs, employee.id, employees, dateKey);
            const attended = logsForDate.length > 0;
            const amount = attended ? PARTIAL_ATTENDANCE_FINE : MISSING_SCHEDULE_FINE;
            const [year, month, day] = dateKey.split('-');
            if (existing && existing.amount !== amount) {
                existing.amount = amount;
                existing.detail = attended
                    ? `Không đăng ký lịch làm ngày ${Number(day)}/${Number(month)}/${year}, nhưng vẫn đi làm — phạt thiếu khai báo (1 ca)`
                    : `Không đăng ký lịch làm ngày ${Number(day)}/${Number(month)}/${year} — không đi làm`;
                updated.push(existing);
            }
            if (existing || created.some((fine) => fine.id === id) || deletedIds.has(id)) continue;
            created.push({
                id,
                empId: Number(employee.id),
                type: 'Không đăng ký lịch',
                detail: attended
                    ? `Không đăng ký lịch làm ngày ${Number(day)}/${Number(month)}/${year}, nhưng vẫn đi làm — phạt thiếu khai báo (1 ca)`
                    : `Không đăng ký lịch làm ngày ${Number(day)}/${Number(month)}/${year} — không đi làm`,
                amount,
                date: dateAtBangkok(dateKey, CUTOFF_HOUR).toISOString(),
                source: 'attendance-schedule',
                schedulePenalty: true,
                attendanceDate: dateKey,
            });
        }
    }

    const officialAbsenceFine = Number(attendanceData.config?.officialAbsentFine ?? OFFICIAL_ABSENCE_FINE);
    const officialDates = options.dateKey ? [String(options.dateKey)] : completedWorkDatesThroughToday(evaluationNow);
    for (const employee of employees.filter((item) => item?.type === 'Official')) {
        for (const dateKey of officialDates) {
            if (dateKey < POLICY_EFFECTIVE_DATE || isRestDay(dateKey)) continue;
            if (isEmployeeResignedOn(employee, dateKey, resignedCutoffs)) continue;
            if (nowMs < dateAtBangkok(dateKey, CUTOFF_HOUR).getTime()) continue;
            const logsForDate = logsByEmployeeAndDate(logs, employee.id, employees, dateKey);
            const [year, month, day] = dateKey.split('-');
            for (const session of ['morning', 'afternoon']) {
                const worked = session === 'morning'
                    ? logsForDate.some((log) => ['morning_in', 'morning_out'].includes(log.checkType))
                    : logsForDate.some((log) => ['afternoon_in', 'evening_out'].includes(log.checkType));
                const leave = leaveRecords.find((item) => Number(item?.empId) === Number(employee.id) && item?.date === dateKey && item?.session === session);
                const excused = Boolean(leave && !leave.unpaid);
                const id = `fine-attendance-official-absence-${employee.id}-${dateKey}-${session}`;
                const existing = existingFines.find((fine) => String(fine?.id) === id);
                if (worked || excused) {
                    if (existing && existing.source === 'attendance-official-absence') removed.push(existing);
                    continue;
                }
                if (existing || created.some((fine) => fine.id === id) || deletedIds.has(id)) continue;
                created.push({
                    id,
                    empId: Number(employee.id),
                    type: 'Nghỉ không phép',
                    detail: `Không đi làm ca ${session === 'morning' ? 'sáng' : 'chiều'} ngày ${Number(day)}/${Number(month)}/${year}`,
                    amount: officialAbsenceFine,
                    date: dateAtBangkok(dateKey, CUTOFF_HOUR).toISOString(),
                    source: 'attendance-official-absence',
                    attendanceDate: dateKey,
                    scheduledSession: session,
                });
            }
        }
    }
    return { created, removed, updated, checked: targetDates.length };
}

async function reconcileMissingSeasonalScheduleFinesFast(prisma, options = {}) {
    const evaluationNow = options.now || new Date();
    const snapshot = await readScheduleReconcileSnapshot(prisma, options, evaluationNow);
    const result = calculateScheduleReconcileResult(snapshot.attendanceData, snapshot.resignedCutoffs, snapshot.logs, options, evaluationNow);
    if (!(result.created.length || result.removed.length || result.updated.length)) return result;

    let lastError = null;
    // This is background maintenance. Never keep the UI's shared write path
    // waiting through a long retry storm when another autosave owns the row.
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const transactionStartedAt = Date.now();
        try {
            const saved = await prisma.$transaction(async (tx) => {
                await tx.$executeRaw`SET LOCAL lock_timeout = '700ms'`;
                await tx.$executeRaw`SET LOCAL statement_timeout = '8000ms'`;
                const rows = await tx.$queryRaw`
                    SELECT "value"::json->'extraFines' AS "extraFines",
                           "value"::json->'fineAuditLog' AS "fineAuditLog"
                    FROM "AppConfig" WHERE "key" = 'attendanceData' FOR UPDATE NOWAIT
                `;
                const currentFines = Array.isArray(rows?.[0]?.extraFines) ? rows[0].extraFines : [];
                const currentAudit = Array.isArray(rows?.[0]?.fineAuditLog) ? rows[0].fineAuditLog : [];
                const deletedIds = deletedFineIds(currentAudit);
                const removedIds = new Set(result.removed.map((fine) => String(fine?.id)));
                const updatesById = new Map(result.updated.map((fine) => [String(fine?.id), fine]));
                const nextFines = currentFines
                    .filter((fine) => !removedIds.has(String(fine?.id)))
                    .map((fine) => updatesById.get(String(fine?.id)) || fine);
                const presentIds = new Set(nextFines.map((fine) => String(fine?.id)));
                for (const fine of result.created) {
                    const id = String(fine?.id || '');
                    if (id && !presentIds.has(id) && !deletedIds.has(id)) {
                        nextFines.push(fine);
                        presentIds.add(id);
                    }
                }
                await tx.$executeRaw`
                    UPDATE "AppConfig"
                    SET "value" = (SELECT json_object_agg(key, value) FROM (
                        SELECT key, value FROM json_each("AppConfig"."value"::json) WHERE key <> 'extraFines'
                        UNION ALL SELECT 'extraFines', ${JSON.stringify(nextFines)}::json
                    ) AS fine_fields)::text,
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE "key" = 'attendanceData'
                `;
                return true;
            }, { isolationLevel: 'Serializable', timeout: 20000, maxWait: 5000 });
            console.info(`[Attendance Schedule] attempt=${attempt + 1} transaction=${Date.now() - transactionStartedAt}ms created=${result.created.length} removed=${result.removed.length} updated=${result.updated.length}`);
            return result;
        } catch (error) {
            if (!isRetryableReconcileError(error) || attempt === 2) {
                const busyError = new Error('Bảng công đang bận đối soát phạt. Vui lòng thử lại sau.');
                busyError.code = ATTENDANCE_RECONCILE_BUSY;
                busyError.cause = error;
                throw busyError;
            }
            lastError = error;
            console.warn(`[Attendance Schedule] retry=${attempt + 1} error=${error?.code || 'lock_busy'} elapsed=${Date.now() - transactionStartedAt}ms`);
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
        }
    }
    throw lastError || new Error('Không thể đối soát phạt chấm công.');
}

async function reconcileMissingSeasonalScheduleFines(prisma, options = {}) {
    // The production Prisma client exposes the read delegates needed for a
    // short optimistic write. Tiny test doubles and older runtimes fall back
    // to the legacy all-in-one transaction for compatibility.
    if (prisma?.$queryRaw && prisma?.attendanceLog?.findMany) {
        return reconcileMissingSeasonalScheduleFinesFast(prisma, options);
    }
    return reconcileMissingSeasonalScheduleFinesLegacy(prisma, options);
}

module.exports = {
    CUTOFF_HOUR,
    MISSING_SCHEDULE_FINE,
    PARTIAL_ATTENDANCE_FINE,
    OFFICIAL_ABSENCE_FINE,
    ATTENDANCE_RECONCILE_BUSY,
    POLICY_EFFECTIVE_DATE,
    dateAtBangkok,
    deadlineFor,
    isPrematureMissingScheduleFine,
    normalizeIdentity,
    reconcileMissingSeasonalScheduleFines,
    validScheduleForDate,
    validScheduleForSession,
};
