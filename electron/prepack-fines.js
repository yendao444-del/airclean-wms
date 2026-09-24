const PREPACK_FINE_EFFECTIVE_DATE = "2026-09-23";
const PREPACK_FINE_CUTOFF_HOUR = 24;
const PREPACK_SHORTFALL_RATIO_NUMERATOR = 9;
const PREPACK_SHORTFALL_RATIO_DENOMINATOR = 10;
const PREPACK_OFFICIAL_FINE = 50000;
const PREPACK_SEASONAL_FINE = 30000;

function bangkokDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
}

function bangkokEndOfDay(dateKey) {
  return new Date(`${dateKey}T23:59:59.999+07:00`);
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
}

function completedDates(now, effectiveDate) {
  const today = bangkokDateKey(now);
  const dates = [];
  let cursor = effectiveDate;
  while (cursor && cursor <= today && dates.length < 366) {
    if (new Date(now).getTime() >= bangkokEndOfDay(cursor).getTime()) dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function parseAttachments(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeUsername(value) {
  return String(value || "").trim().toLocaleLowerCase("vi-VN");
}

function fineId(employeeId, dateKey) {
  return `fine-prepack-shortfall-${employeeId}-${dateKey}`;
}

function isShortfall(requestedQty, reportedQty) {
  const requested = Number(requestedQty);
  const reported = Number.isFinite(Number(reportedQty)) ? Number(reportedQty) : 0;
  if (!Number.isInteger(requested) || requested <= 0) return false;
  // 90% is still acceptable: 10/10 and 9/10 pass, 8/10 fails.
  return reported * PREPACK_SHORTFALL_RATIO_DENOMINATOR
    < requested * PREPACK_SHORTFALL_RATIO_NUMERATOR;
}

/**
 * Create one deterministic payroll fine per employee and completed workday
 * when any assigned prepack target is below the 90% threshold.
 */
async function reconcilePrepackShortfallFines(prisma, options = {}) {
  if (!prisma?.appConfig || !prisma?.prepackBatch || !prisma?.dailyTask) {
    return { created: [], checked: 0, skipped: "missing_prisma_models" };
  }

  const effectiveDate = String(options.effectiveDate || PREPACK_FINE_EFFECTIVE_DATE);
  const evaluationNow = options.now || new Date();
  const targetDates = options.dateKey
    ? [String(options.dateKey)]
    : completedDates(evaluationNow, effectiveDate);
  if (!targetDates.length) return { created: [], checked: 0 };

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('attendanceData'))`;
    const configRow = await tx.appConfig.findUnique({ where: { key: "attendanceData" } });
    let attendanceData = {};
    try { attendanceData = JSON.parse(configRow?.value || "{}"); } catch {}
    const employees = Array.isArray(attendanceData.employees) ? attendanceData.employees : [];
    const existingFines = Array.isArray(attendanceData.extraFines) ? [...attendanceData.extraFines] : [];
    const fineAuditLog = Array.isArray(attendanceData.fineAuditLog) ? [...attendanceData.fineAuditLog] : [];
    const deletedIds = new Set(fineAuditLog
      .filter((entry) => entry?.action === "delete" && entry?.before?.id)
      .map((entry) => String(entry.before.id)));

    const latestDate = targetDates[targetDates.length - 1];
    const batches = await tx.prepackBatch.findMany({
      where: { createdAt: { lte: bangkokEndOfDay(latestDate) } },
      select: {
        id: true,
        productName: true,
        productSku: true,
        requestedQty: true,
        reportedQty: true,
        packerUsername: true,
        packerName: true,
        status: true,
        createdAt: true,
      },
    });
    const activeBatches = batches.filter((batch) => String(batch.status || "") !== "cancelled");
    const tasks = await tx.dailyTask.findMany({
      where: { attachments: { contains: "prepackReport" } },
      orderBy: { createdAt: "asc" },
      take: 2000,
      select: { createdAt: true, attachments: true },
    });
    const batchById = new Map(activeBatches.map((batch) => [batch.id, batch]));
    const latestReports = new Map();
    for (const task of tasks) {
      const attachments = parseAttachments(task.attachments);
      const report = attachments?.prepackReport;
      if (!report || !Array.isArray(report.batchIds)) continue;
      const reportedAt = attachments?.evidence?.submittedAt || report.reportedAt || task.createdAt;
      const dateKey = bangkokDateKey(reportedAt);
      if (!dateKey) continue;
      const rawReports = Array.isArray(report.reports)
        ? report.reports
        : report.batchIds.map((batchId) => ({
          batchId,
          reportedQty: batchById.get(Number(batchId))?.reportedQty,
        }));
      for (const item of rawReports) {
        const batchId = Number(item?.batchId);
        if (!batchById.has(batchId)) continue;
        const quantity = Number(item?.reportedQty);
        if (!Number.isInteger(quantity) || quantity < 0) continue;
        const key = `${dateKey}:${batchId}`;
        const previous = latestReports.get(key);
        const timestamp = new Date(reportedAt).getTime();
        if (!previous || timestamp >= previous.timestamp) latestReports.set(key, { quantity, timestamp });
      }
    }

    const groupedViolations = new Map();
    for (const dateKey of targetDates) {
      const endOfDay = bangkokEndOfDay(dateKey);
      for (const batch of activeBatches) {
        if (new Date(batch.createdAt).getTime() > endOfDay.getTime()) continue;
        const employee = employees.find((item) => normalizeUsername(item?.username) === normalizeUsername(batch.packerUsername));
        if (!employee || !batch.packerUsername) continue;
        const report = latestReports.get(`${dateKey}:${batch.id}`);
        const reportedQty = report?.quantity ?? 0;
        if (!isShortfall(batch.requestedQty, reportedQty)) continue;
        const key = `${employee.id}:${dateKey}`;
        const violation = groupedViolations.get(key) || {
          employee,
          dateKey,
          rows: [],
        };
        violation.rows.push({
          productName: batch.productName || batch.productSku,
          requestedQty: Number(batch.requestedQty),
          reportedQty,
        });
        groupedViolations.set(key, violation);
      }
    }

    const created = [];
    for (const violation of groupedViolations.values()) {
      const employeeId = Number(violation.employee.id);
      const id = fineId(employeeId, violation.dateKey);
      if (existingFines.some((fine) => String(fine?.id) === id) || deletedIds.has(id)) continue;
      const amount = violation.employee.type === "Seasonal" ? PREPACK_SEASONAL_FINE : PREPACK_OFFICIAL_FINE;
      const [year, month, day] = violation.dateKey.split("-");
      const detailRows = violation.rows
        .map((row) => `${row.productName}: ${row.reportedQty}/${row.requestedQty}`)
        .join(", ");
      created.push({
        id,
        empId: employeeId,
        type: "Thiếu đóng gói sẵn",
        detail: `Ngày ${Number(day)}/${Number(month)}/${year}, dưới 90% chỉ tiêu (${detailRows})`,
        amount,
        date: bangkokEndOfDay(violation.dateKey).toISOString(),
        source: "prepack-shortfall",
        attendanceDate: violation.dateKey,
        prepackPenalty: true,
        thresholdPercent: 10,
        employeeType: violation.employee.type === "Seasonal" ? "Seasonal" : "Official",
      });
    }

    if (created.length) {
      const nextData = {
        ...attendanceData,
        extraFines: [...existingFines, ...created],
      };
      await tx.appConfig.upsert({
        where: { key: "attendanceData" },
        update: { value: JSON.stringify(nextData) },
        create: { key: "attendanceData", value: JSON.stringify(nextData) },
      });
    }
    return { created, checked: targetDates.length, cutoff: targetDates.map((dateKey) => bangkokEndOfDay(dateKey).toISOString()) };
  }, { isolationLevel: "Serializable", timeout: 15000, maxWait: 10000 });
}

module.exports = {
  PREPACK_FINE_EFFECTIVE_DATE,
  PREPACK_FINE_CUTOFF_HOUR,
  PREPACK_OFFICIAL_FINE,
  PREPACK_SEASONAL_FINE,
  isShortfall,
  reconcilePrepackShortfallFines,
};
