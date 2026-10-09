const ECOMMERCE_ORDER_FINE_TOTAL = 20000;
const ECOMMERCE_OFFICIAL_RECIPIENTS = 2;
// The policy starts on 23/09/2026; violations dated before that day are
// grandfathered out and must not be recreated by reconciliation.
const ECOMMERCE_FINE_EFFECTIVE_DATE = "2026-09-23";
// The amount changes from 24/09/2026. Existing fine amounts are never rewritten.
const ECOMMERCE_FINE_RATE_EFFECTIVE_DATE = "2026-09-24";
const { loadResignedEmployeeCutoffs, isEmployeeResignedOn } = require('./employment-status');

function bangkokDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
}

function bangkokStartOfDay(dateKey) {
  return new Date(`${dateKey}T00:00:00+07:00`);
}

function dateAtBangkokNextDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const key = date.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
  const next = new Date(`${key}T00:00:00+07:00`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function deletedFineIds(fineAuditLog) {
  return new Set(
    (fineAuditLog || [])
      .filter((entry) => entry?.action === "delete" && entry?.before?.id)
      .map((entry) => String(entry.before.id)),
  );
}

function splitFine(total, employees) {
  const base = Math.floor(total / employees.length);
  const remainder = total % employees.length;
  return employees.map((employee, index) => ({
    employee,
    amount: base + (index < remainder ? 1 : 0),
  }));
}

function orderLabel(order) {
  return order.orderNumber || order.ecommerceExportCode || `#TMDT-${order.id}`;
}

/**
 * Create idempotent TMDT fines in the same attendance ledger used by payroll.
 * One order violation is split equally between the two official employees.
 */
async function reconcileEcommerceOrderFines(prisma, options = {}) {
  const now = options.now || new Date();
  return prisma.$transaction(async (tx) => {
    // Fail fast when another attendance ledger writer owns the advisory lock;
    // the maintenance queue retries with a fresh transaction.
    await tx.$executeRaw`SET LOCAL lock_timeout = '7000ms'`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('attendanceData'))`;
    const configRow = await tx.appConfig.findUnique({ where: { key: "attendanceData" } });
    if (!configRow) return { created: [], checked: 0, skipped: "attendanceData_missing" };

    let attendanceData = {};
    try {
      attendanceData = JSON.parse(configRow.value || "{}");
    } catch {
      throw new Error("Dữ liệu cấu hình chấm công không hợp lệ");
    }

    const officialEmployees = (Array.isArray(attendanceData.employees) ? attendanceData.employees : [])
      .filter((employee) => employee?.type === "Official" && employee?.active !== false)
      .sort((left, right) => Number(left.id) - Number(right.id))
      .slice(0, ECOMMERCE_OFFICIAL_RECIPIENTS);
    if (officialEmployees.length !== ECOMMERCE_OFFICIAL_RECIPIENTS) {
      return { created: [], checked: 0, skipped: "two_official_employees_required" };
    }
    const resignedCutoffs = await loadResignedEmployeeCutoffs(tx);

    const orders = await tx.ecommerceExport.findMany({
      where: {
        status: { in: ["pending", "processing", "mismatch", "completed"] },
        OR: [
          { slaDeadlineAt: { lt: now } },
          { mismatchAt: { not: null } },
        ],
      },
      select: {
        id: true,
        customerName: true,
        orderNumber: true,
        ecommerceExportCode: true,
        status: true,
        slaDeadlineAt: true,
        completedAt: true,
        mismatchAt: true,
      },
    });

    const existingFines = Array.isArray(attendanceData.extraFines) ? attendanceData.extraFines : [];
    const existingIds = new Set(existingFines.map((fine) => String(fine?.id || "")));
    const deletedIds = deletedFineIds(attendanceData.fineAuditLog);
    const created = [];
    const repaired = [];
    const auditEntries = [];
    const lockedPeriods = Array.isArray(attendanceData.lockedPeriods) ? attendanceData.lockedPeriods : [];
    const periodDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
      ? String(value) : bangkokDateKey(value);
    const dateIsInPeriod = (value, period) => {
      const dateKey = bangkokDateKey(value);
      const start = periodDateKey(period?.start);
      const end = periodDateKey(period?.end);
      return Boolean(dateKey && start && end && dateKey >= start && dateKey <= end);
    };
    const isLockedDate = (value) => {
      return lockedPeriods.some((period) => dateIsInPeriod(value, period));
    };
    const fineAuditLog = Array.isArray(attendanceData.fineAuditLog) ? attendanceData.fineAuditLog : [];
    const legacyCreatedAtById = new Map(
      fineAuditLog
        .filter((entry) => entry?.action === "create" && entry?.after?.id && entry?.timestamp
          && entry?.changedBy === "system"
          && entry.after.date === bangkokStartOfDay(ECOMMERCE_FINE_EFFECTIVE_DATE).toISOString())
        .map((entry) => [String(entry.after.id), entry.timestamp]),
    );
    const editedIds = new Set(fineAuditLog
      .filter((entry) => entry?.action !== "create"
        && !(entry?.action === "update" && entry?.changedBy === "system"
          && entry?.note === "Sửa ngày ghi nhận phạt TMDT cũ bị gán nhầm về ngày bắt đầu chính sách"))
      .flatMap((entry) => [entry?.before?.id, entry?.after?.id].filter(Boolean).map(String)));
    const fineTotal = bangkokDateKey(now) >= ECOMMERCE_FINE_RATE_EFFECTIVE_DATE
      ? ECOMMERCE_ORDER_FINE_TOTAL
      : ECOMMERCE_ORDER_FINE_TOTAL / 2;
    const addViolation = (order, kind, date, detail, eligibilityDate = date, attendanceDate = null) => {
      const id = `fine-ecommerce-${kind}-${order.id}-${ECOMMERCE_FINE_EFFECTIVE_DATE}`;
      const hasFine = (fineId) => existingIds.has(fineId)
        || deletedIds.has(fineId)
        || Array.from(deletedIds).some((deletedId) => deletedId.startsWith(`${fineId}-`))
        || existingFines.some((fine) => String(fine?.id || "").startsWith(`${fineId}-`))
        || created.some((fine) => String(fine?.id || "").startsWith(`${fineId}-`));
      if (!date) return;
      const existingForOrder = existingFines.filter((fine) => {
        const fineId = String(fine?.id || "");
        return fineId === id || fineId.startsWith(`${id}-`);
      });
      // Older builds stored every active overdue fine at the policy start
      // (23/09). Restore the original creation timestamp for audit/history
      // and the actual SLA day for payroll filtering. Only deterministic
      // system rows with sufficient evidence can be repaired.
      const legacyDate = bangkokStartOfDay(ECOMMERCE_FINE_EFFECTIVE_DATE).toISOString();
      existingForOrder.forEach((fine) => {
        if (fine?.source !== `ecommerce_${kind}` || editedIds.has(String(fine.id))
          || deletedIds.has(String(fine.id)) || deletedIds.has(id)) return;
        const hasLegacyDate = fine.date === legacyDate && !fine.attendanceDate;
        const hasStalePolicyDetail = Boolean(fine.attendanceDate)
          && /(?:trễ SLA từ ngày|trong ngày)\s+23\/09\/2026/i.test(String(fine.detail || ''));
        if (!hasLegacyDate && !hasStalePolicyDetail) return;
        if (hasStalePolicyDetail && (isLockedDate(fine.attendanceDate)
          || lockedPeriods.some(period => Array.isArray(period?.payrollSnapshot?.fines)
            && period.payrollSnapshot.fines.some(row => String(row?.id || '') === String(fine.id))))) return;
        let repairedDate = fine.date;
        if (hasLegacyDate) {
          const createdAt = legacyCreatedAtById.get(String(fine.id));
          // Never guess a payroll month from today's time if audit evidence is
          // missing. Never move a charge out of a frozen statement (which would
          // double-charge it in another month), or into a closed payroll period.
          if (!createdAt || Number.isNaN(new Date(createdAt).getTime())
            || bangkokDateKey(createdAt) < ECOMMERCE_FINE_EFFECTIVE_DATE) return;
          repairedDate = new Date(createdAt).toISOString();
          // The legacy date can fall inside an already-locked month simply
          // because the old build hard-coded 23/09. What matters is whether
          // this exact fine was included in that period's frozen snapshot; a
          // late-created row absent from the snapshot must still be repaired.
          if (isLockedDate(repairedDate) || (attendanceDate && isLockedDate(attendanceDate)) || lockedPeriods.some((period) => {
            const snapshotFines = period?.payrollSnapshot?.fines;
            if (Array.isArray(snapshotFines) && snapshotFines.some((row) => String(row?.id || '') === String(fine.id))) return true;
            if (!dateIsInPeriod(fine.date, period)) return false;
            const lockedAt = new Date(period?.lockedAt || '').getTime();
            // Missing snapshots/lock timestamps cannot prove it wasn't paid.
            return !Array.isArray(snapshotFines) || !Number.isFinite(lockedAt)
              || new Date(createdAt).getTime() <= lockedAt;
          })) return;
        }
        const before = { ...fine };
        fine.date = repairedDate;
        if (hasLegacyDate && attendanceDate) fine.attendanceDate = bangkokDateKey(attendanceDate);
        const violationLabel = String(fine.attendanceDate || '').split('-').reverse().join('/');
        if (kind === "overdue" && attendanceDate && /trễ SLA từ ngày 23\/09\/2026/i.test(String(fine.detail || ''))) {
          fine.detail = fine.detail.replace(/(trễ SLA từ ngày\s+)23\/09\/2026/i, `$1${violationLabel}`);
        }
        if (kind === "mismatch" && attendanceDate && /trong ngày 23\/09\/2026/i.test(String(fine.detail || ''))) {
          fine.detail = fine.detail.replace(/(trong ngày\s+)23\/09\/2026/i, `$1${violationLabel}`);
        }
        if (JSON.stringify(before) === JSON.stringify(fine)) return;
        repaired.push({ before, after: { ...fine } });
      });
      // Filtering/payroll use the violation day, not the discovery timestamp.
      // A backlog discovered this month must not add a charge to a closed month.
      if (hasFine(id) || isLockedDate(date) || (attendanceDate && isLockedDate(attendanceDate))) return;
      const dateKey = bangkokDateKey(eligibilityDate);
      const eligibleEmployees = officialEmployees.filter((employee) => !isEmployeeResignedOn(employee, dateKey, resignedCutoffs));
      if (!eligibleEmployees.length) return;
      splitFine(fineTotal, eligibleEmployees).forEach(({ employee, amount }) => {
        const fine = {
          id: `${id}-${employee.id}`,
          empId: Number(employee.id),
          type: kind === "overdue" ? "Đơn TMDT trễ hạn" : "Đơn TMDT cần kiểm tra quá ngày",
          detail: `${detail} — chia đều 2 nhân viên chính thức`,
          amount,
          date: date.toISOString(),
          attendanceDate: attendanceDate ? bangkokDateKey(attendanceDate) : undefined,
          source: `ecommerce_${kind}`,
          ecommerceExportId: order.id,
          orderNumber: orderLabel(order),
        };
        created.push(fine);
        auditEntries.push({
          id: `flog-${fine.id}`,
          action: "create",
          timestamp: now.toISOString(),
          changedBy: "system",
          changedByName: "Hệ thống",
          after: fine,
          note: `Tự động ghi nhận phạt ${fine.type}: ${fine.detail}`,
        });
      });
    };

    for (const order of orders) {
      const label = orderLabel(order);
      const deadline = order.slaDeadlineAt ? new Date(order.slaDeadlineAt) : null;
      const completedAt = order.completedAt ? new Date(order.completedAt) : null;
      const isLate = Boolean(
        deadline && deadline < now &&
        (order.status !== "completed" || !completedAt || completedAt > deadline),
      );
      if (isLate) {
        const completedAfterPolicyStart = completedAt
          && deadline
          && bangkokDateKey(deadline) >= ECOMMERCE_FINE_EFFECTIVE_DATE
          && bangkokDateKey(completedAt) >= ECOMMERCE_FINE_EFFECTIVE_DATE;
        // Do not grandfather an order whose marketplace SLA deadline was
        // already missed before this policy became effective.
        const deadlineAfterPolicyStart = deadline && bangkokDateKey(deadline) >= ECOMMERCE_FINE_EFFECTIVE_DATE;
        const activeOverdueAfterPolicyStart = order.status !== "completed"
          && deadlineAfterPolicyStart
          && bangkokDateKey(now) >= ECOMMERCE_FINE_EFFECTIVE_DATE;
        if (!completedAfterPolicyStart && !activeOverdueAfterPolicyStart) continue;
        const lateDateKey = bangkokDateKey(deadline || now);
        // Keep discovery time for audit; payroll/filtering use attendanceDate
        // (the SLA day), so September backlog cannot enter October totals.
        const fineDate = order.status === "completed" && completedAt > deadline ? completedAt : now;
        addViolation(
          order,
          "overdue",
          fineDate,
          `Đơn ${label}${order.customerName ? ` (${order.customerName})` : ""} trễ SLA từ ngày ${lateDateKey.split("-").reverse().join("/")}`,
          fineDate,
          deadline,
        );
      }

      const mismatchAt = order.mismatchAt ? new Date(order.mismatchAt) : null;
      const nextDay = mismatchAt ? dateAtBangkokNextDay(mismatchAt) : null;
      if (order.status === "mismatch" && nextDay && now >= nextDay && bangkokDateKey(nextDay) >= ECOMMERCE_FINE_EFFECTIVE_DATE) {
        const mismatchDateKey = bangkokDateKey(mismatchAt);
        addViolation(
          order,
          "mismatch",
          now,
          `Đơn ${label}${order.customerName ? ` (${order.customerName})` : ""} ở tab Cần kiểm tra nhưng chưa xử lý trong ngày ${mismatchDateKey.split("-").reverse().join("/")}`,
          now,
          mismatchAt,
        );
      }
    }

    if (repaired.length > 0) {
      repaired.forEach(({ before, after }) => {
        auditEntries.push({
          id: `flog-repair-${after.id}-${now.getTime()}`,
          action: "update",
          timestamp: now.toISOString(),
          changedBy: "system",
          changedByName: "Hệ thống",
          before,
          after,
          note: "Sửa ngày ghi nhận phạt TMDT cũ bị gán nhầm về ngày bắt đầu chính sách",
        });
      });
    }
    if (created.length > 0 || repaired.length > 0) {
      const nextData = {
        ...attendanceData,
        extraFines: [...existingFines, ...created],
        fineAuditLog: [
          ...(Array.isArray(attendanceData.fineAuditLog) ? attendanceData.fineAuditLog : []),
          ...auditEntries,
        ],
      };
      await tx.appConfig.update({
        where: { key: "attendanceData" },
        data: { value: JSON.stringify(nextData) },
      });
    }
    return { created, repaired: repaired.map(({ after }) => after), checked: orders.length };
  }, { isolationLevel: "Serializable", timeout: 30000, maxWait: 10000 });
}

module.exports = {
  ECOMMERCE_ORDER_FINE_TOTAL,
  ECOMMERCE_OFFICIAL_RECIPIENTS,
  ECOMMERCE_FINE_RATE_EFFECTIVE_DATE,
  reconcileEcommerceOrderFines,
};
