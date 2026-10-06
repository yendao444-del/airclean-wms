// Targeted removal for withdrawn policies. Never scan work targets or mutate
// locked payroll snapshots, employees, bonuses or unrelated configuration.
function withdrawFines(data, isWithdrawnFine, note, now = new Date()) {
  for (const field of ['extraFines', 'fineAuditLog']) {
    if (data?.[field] != null && !Array.isArray(data[field])) {
      throw new Error(`Dữ liệu ${field} không hợp lệ. Chưa thực hiện gỡ phạt.`);
    }
  }
  const existing = Array.isArray(data?.extraFines) ? data.extraFines : [];
  const removed = existing.filter(isWithdrawnFine);
  const audit = Array.isArray(data?.fineAuditLog) ? data.fineAuditLog : [];
  return {
    removed,
    extraFines: existing.filter(fine => !isWithdrawnFine(fine)),
    fineAuditLog: [...audit, ...removed.map((fine, index) => ({
      id: `withdraw-policy-${fine.id || index}-${new Date(now).getTime()}`,
      action: 'delete',
      timestamp: new Date(now).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' }),
      changedBy: 'system',
      changedByName: 'Hệ thống',
      before: fine,
      note,
    }))],
  };
}

async function reconcileWithdrawnFines(prisma, isWithdrawnFine, note, options = {}) {
  if (!prisma?.$transaction) return { created: [], removed: [], checked: 0, skipped: 'missing_prisma' };
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '8000ms'`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('attendanceData'))`;
    const rows = await tx.$queryRaw`
      SELECT "value"::json->'extraFines' AS "extraFines",
             "value"::json->'fineAuditLog' AS "fineAuditLog"
      FROM "AppConfig" WHERE "key" = 'attendanceData' FOR UPDATE
    `;
    const patch = withdrawFines(rows[0] || {}, isWithdrawnFine, note, options.now || new Date());
    if (patch.removed.length) {
      await tx.$executeRaw`
        UPDATE "AppConfig" SET "value" = (
          SELECT json_object_agg(key, value) FROM (
            SELECT key, value FROM json_each("AppConfig"."value"::json)
            WHERE key NOT IN ('extraFines', 'fineAuditLog')
            UNION ALL SELECT 'extraFines', ${JSON.stringify(patch.extraFines)}::json
            UNION ALL SELECT 'fineAuditLog', ${JSON.stringify(patch.fineAuditLog)}::json
          ) AS fine_fields
        )::text, "updatedAt" = NOW() WHERE "key" = 'attendanceData'
      `;
    }
    return { created: [], removed: patch.removed.map(fine => fine.id), checked: 0, skipped: 'policy_removed' };
  }, { isolationLevel: 'Serializable', timeout: 20000, maxWait: 5000 });
}

module.exports = { withdrawFines, reconcileWithdrawnFines };
