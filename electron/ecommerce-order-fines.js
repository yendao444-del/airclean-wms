const ECOMMERCE_ORDER_FINE_TOTAL = 10000;
const ECOMMERCE_OFFICIAL_RECIPIENTS = 2;
// The policy starts on 23/09/2026; violations dated before that day are
// grandfathered out and must not be recreated by reconciliation.
const ECOMMERCE_FINE_EFFECTIVE_DATE = "2026-09-23";

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
    const auditEntries = [];
    const split = splitFine(ECOMMERCE_ORDER_FINE_TOTAL, officialEmployees);

    const addViolation = (order, kind, date, detail) => {
      const id = `fine-ecommerce-${kind}-${order.id}-${ECOMMERCE_FINE_EFFECTIVE_DATE}`;
      const hasFine = (fineId) => existingIds.has(fineId)
        || deletedIds.has(fineId)
        || Array.from(deletedIds).some((deletedId) => deletedId.startsWith(`${fineId}-`))
        || existingFines.some((fine) => String(fine?.id || "").startsWith(`${fineId}-`))
        || created.some((fine) => String(fine?.id || "").startsWith(`${fineId}-`));
      if (!date || hasFine(id)) return;
      split.forEach(({ employee, amount }) => {
        const fine = {
          id: `${id}-${employee.id}`,
          empId: Number(employee.id),
          type: kind === "overdue" ? "Đơn TMDT trễ hạn" : "Đơn TMDT cần kiểm tra quá ngày",
          detail: `${detail} — chia đều 2 nhân viên chính thức`,
          amount,
          date: date.toISOString(),
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
        addViolation(
          order,
          "overdue",
          order.status === "completed" && completedAt > deadline ? completedAt : bangkokStartOfDay(ECOMMERCE_FINE_EFFECTIVE_DATE),
          `Đơn ${label}${order.customerName ? ` (${order.customerName})` : ""} trễ SLA từ ngày ${ECOMMERCE_FINE_EFFECTIVE_DATE.split("-").reverse().join("/")}`,
        );
      }

      const mismatchAt = order.mismatchAt ? new Date(order.mismatchAt) : null;
      const nextDay = mismatchAt ? dateAtBangkokNextDay(mismatchAt) : null;
      if (order.status === "mismatch" && nextDay && now >= nextDay && bangkokDateKey(nextDay) >= ECOMMERCE_FINE_EFFECTIVE_DATE) {
        addViolation(
          order,
          "mismatch",
          bangkokStartOfDay(ECOMMERCE_FINE_EFFECTIVE_DATE),
          `Đơn ${label}${order.customerName ? ` (${order.customerName})` : ""} ở tab Cần kiểm tra nhưng chưa xử lý trong ngày ${ECOMMERCE_FINE_EFFECTIVE_DATE.split("-").reverse().join("/")}`,
        );
      }
    }

    if (created.length > 0) {
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
    return { created, checked: orders.length };
  }, { isolationLevel: "Serializable", timeout: 30000, maxWait: 10000 });
}

module.exports = {
  ECOMMERCE_ORDER_FINE_TOTAL,
  ECOMMERCE_OFFICIAL_RECIPIENTS,
  reconcileEcommerceOrderFines,
};
