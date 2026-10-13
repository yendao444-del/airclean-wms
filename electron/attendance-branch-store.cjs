'use strict';
const { Prisma } = require('@prisma/client');

function attendanceConflict(message) {
  return Object.assign(new Error(message), { code: 'P2034' });
}

function isRetryableAttendanceBranchError(error) {
  const codes = [String(error?.code || ''), String(error?.meta?.code || '')];
  const detail = `${error?.message || ''} ${error?.meta?.error || ''}`;
  return codes.some(code => ['P2034', '55P03', '40001', '40P01'].includes(code))
    || (error?.code === 'P2028' && /expired|timeout|timed out|already closed/i.test(detail));
  // A dropped connection can have an uncertain commit outcome. Never retry it.
}

async function readAttendanceBranches(client, fields) {
  const keys = [...new Set(fields)].filter(key => key !== 'lockedPeriods');
  if (!keys.length || keys.some(key => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(key))) {
    throw new Error('Nhánh dữ liệu bảng công không hợp lệ.');
  }
  const rows = await client.$queryRaw(Prisma.sql`
    WITH source AS MATERIALIZED (
      SELECT "value"::json AS data, md5("value") AS revision, "updatedAt"
      FROM "AppConfig" WHERE "key" = 'attendanceData'
    )
    SELECT json_build_object(
      'branches', (SELECT json_object_agg(key, value) FROM json_each(data)
        WHERE key IN (${Prisma.join(keys)})),
      'lockedPeriods', (SELECT json_agg(json_build_object('start', period->'start', 'end', period->'end'))
        FROM json_array_elements(CASE
          WHEN data->'lockedPeriods' IS NULL OR json_typeof(data->'lockedPeriods') = 'null' THEN '[]'::json
          ELSE data->'lockedPeriods' END) AS period)
    )::text AS "value", revision, "updatedAt" FROM source
  `);
  if (!rows?.length) throw new Error('Không tìm thấy dữ liệu bảng công. Chưa thực hiện thay đổi.');
  const row = rows[0];
  let projection;
  try { projection = JSON.parse(row.value); }
  catch { throw new Error('Dữ liệu bảng công không đọc được an toàn. Chưa thực hiện thay đổi.'); }
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    throw new Error('Dữ liệu bảng công không hợp lệ. Chưa thực hiện thay đổi.');
  }
  const branches = projection.branches ?? {};
  if (!branches || typeof branches !== 'object' || Array.isArray(branches)
    || !/^[a-f0-9]{32}$/.test(String(row.revision || ''))) {
    throw new Error('Dữ liệu bảng công không hợp lệ. Chưa thực hiện thay đổi.');
  }
  const lockedPeriods = projection.lockedPeriods ?? [];
  if (!Array.isArray(lockedPeriods) || lockedPeriods.some(period => !period
    || !period.start || !period.end || !Number.isFinite(Date.parse(period.start))
    || !Number.isFinite(Date.parse(period.end)) || Date.parse(period.start) > Date.parse(period.end))) {
    throw new Error('Dữ liệu kỳ khóa không hợp lệ. Chưa thực hiện thay đổi.');
  }
  return { data: { ...branches, lockedPeriods }, revision: row.revision, updatedAt: row.updatedAt };
}

async function updateAttendanceBranches(client, fields, plan, { attempts = 3, onTiming = () => {} } = {}) {
  let lastConflict;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const started = Date.now();
    try {
      // Read, transfer and calculate BEFORE opening a transaction. Even a
      // multi-MB legacy ledger never holds a row lock during these operations.
      const snapshot = await readAttendanceBranches(client, fields);
      const { patch, result } = await plan(snapshot.data);
      const keys = Object.keys(patch || {});
      if (!keys.length) return { ...result, updatedAt: snapshot.updatedAt };
      if (keys.some(key => !fields.includes(key) || key === 'lockedPeriods')) {
        throw new Error('Thao tác không được phép thay đổi nhánh dữ liệu này.');
      }
      const patchJson = JSON.stringify(patch);
      const readMs = Date.now() - started;
      const transactionStarted = Date.now();
      const saved = await client.$transaction(async tx => {
        const locks = await tx.$queryRaw(Prisma.sql`
          SELECT set_config('lock_timeout', '1000ms', true),
                 set_config('statement_timeout', '6000ms', true),
                 pg_try_advisory_xact_lock(hashtext('attendanceData')) AS locked
        `);
        if (locks?.[0]?.locked !== true) throw attendanceConflict('Bảng công đang được cập nhật ở máy khác.');
        // CAS protects against every existing writer (including older clients
        // that only take a row lock). md5 of the raw value avoids timestamp
        // precision loss through Prisma/JS Date and catches same-ms updates.
        const rows = await tx.$queryRaw(Prisma.sql`
          UPDATE "AppConfig"
          SET "value" = (SELECT json_object_agg(key, value) FROM (
            SELECT key, value FROM json_each("AppConfig"."value"::json)
              WHERE key NOT IN (${Prisma.join(keys)})
            UNION ALL SELECT key, value FROM json_each(${patchJson}::json)
          ) AS attendance_fields)::text, "updatedAt" = clock_timestamp()
          WHERE "key" = 'attendanceData' AND md5("value") = ${snapshot.revision}
          RETURNING "updatedAt"
        `);
        if (rows?.length !== 1) throw attendanceConflict('Dữ liệu bảng công vừa thay đổi.');
        return rows[0];
      }, { isolationLevel: 'Serializable', timeout: 10000, maxWait: 3000 });
      // Observability must never turn a confirmed commit into a failed save.
      try { onTiming({ attempt: attempt + 1, readMs, transactionMs: Date.now() - transactionStarted }); } catch {}
      return { ...result, updatedAt: saved.updatedAt };
    } catch (error) {
      if (!isRetryableAttendanceBranchError(error)) throw error;
      lastConflict = error;
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 75 * (attempt + 1)));
    }
  }
  throw new Error('Bảng công đang bận cập nhật. Chưa hoàn tất thao tác; vui lòng tải lại và thử lại.', { cause: lastConflict });
}

module.exports = { readAttendanceBranches, updateAttendanceBranches, isRetryableAttendanceBranchError };
