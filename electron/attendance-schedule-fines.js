const { addDays, isRestDay } = require('./attendance-rewards');

const MISSING_SCHEDULE_FINE = 100000;
const PARTIAL_ATTENDANCE_FINE = 50000;
const POLICY_EFFECTIVE_DATE = '2026-09-19';
const CUTOFF_HOUR = 19;

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
    const lastTarget = addDays(today, 1);
    while (cursor && cursor <= lastTarget && rows.length < 366) {
        const nowMs = new Date(now).getTime();
        if (nowMs >= deadlineFor(cursor).getTime()) rows.push(cursor);
        cursor = addDays(cursor, 1);
    }
    return rows;
}

async function reconcileMissingSeasonalScheduleFines(prisma, options = {}) {
    const evaluationNow = options.now || new Date();
    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('attendanceData'))`;
        const configRow = await tx.appConfig.findUnique({ where: { key: 'attendanceData' } });
        if (!configRow) return { created: [], removed: [], checked: 0 };

        let attendanceData = {};
        try { attendanceData = JSON.parse(configRow.value || '{}'); } catch { throw new Error('Dữ liệu cấu hình chấm công không hợp lệ'); }
        const employees = Array.isArray(attendanceData.employees) ? attendanceData.employees : [];
        const schedules = Array.isArray(attendanceData.workSchedules) ? attendanceData.workSchedules : [];
        const existingFines = Array.isArray(attendanceData.extraFines) ? attendanceData.extraFines : [];
        const fineAuditLog = Array.isArray(attendanceData.fineAuditLog) ? attendanceData.fineAuditLog : [];
        const deletedIds = deletedFineIds(fineAuditLog);
        const logs = await tx.attendanceLog.findMany({
            where: { date: { gte: POLICY_EFFECTIVE_DATE }, checkType: { in: ['morning_in', 'morning_out', 'afternoon_in', 'evening_out'] } },
            orderBy: { timestamp: 'asc' },
        });
        const targetDates = options.dateKey ? [String(options.dateKey)] : dateRangeThroughToday(evaluationNow);
        const created = [];
        const removed = [];
        const updated = [];

        for (const employee of employees.filter((item) => item?.type === 'Seasonal')) {
            for (const dateKey of targetDates) {
                if (dateKey < POLICY_EFFECTIVE_DATE || isRestDay(dateKey)) continue;
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

        const removedIds = new Set(removed.map((fine) => String(fine.id)));
        const nextFines = [
            ...existingFines.filter((fine) => !removedIds.has(String(fine?.id))),
            ...created,
        ];
        if (created.length || removed.length || updated.length) {
            attendanceData = { ...attendanceData, extraFines: nextFines };
            await tx.appConfig.update({ where: { key: 'attendanceData' }, data: { value: JSON.stringify(attendanceData) } });
        }
        return { created, removed, updated, checked: targetDates.length };
    }, { isolationLevel: 'Serializable', timeout: 15000, maxWait: 10000 });
}

module.exports = {
    CUTOFF_HOUR,
    MISSING_SCHEDULE_FINE,
    PARTIAL_ATTENDANCE_FINE,
    POLICY_EFFECTIVE_DATE,
    dateAtBangkok,
    deadlineFor,
    normalizeIdentity,
    reconcileMissingSeasonalScheduleFines,
    validScheduleForDate,
    validScheduleForSession,
};
