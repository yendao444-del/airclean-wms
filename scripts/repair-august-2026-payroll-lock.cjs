const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config();

const prisma = new PrismaClient();
const shouldApply = process.argv.includes('--apply');
const periodStart = '2026-08-01';
const periodEnd = '2026-08-31';
const newPolicyEffectiveAt = '2026-08-31T17:00:00.000Z'; // 01/09/2026 00:00 Asia/Bangkok
const legacyUnitPrice = 20;

const normalizePerson = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const matchesEmployee = (packer, employee) => {
    const person = normalizePerson(packer);
    const username = normalizePerson(employee.username);
    const name = normalizePerson(employee.name);
    const fullName = normalizePerson(employee.fullName);
    return Boolean(
        (username && (person === username || person.includes(username)))
        || (name && (person === name || person.includes(name)))
        || (fullName && (person === fullName || fullName.includes(person) || person.includes(fullName)))
    );
};

const getLegacyItemUnits = (item) => {
    const sku = String(item?.sku || '').toUpperCase();
    let packCount = 1;

    if (sku.startsWith('CB-')) {
        let comboTotal = 0;
        const productSuffixes = /^(5D|UNI|DUNI|5DUNI)/i;
        for (const segment of sku.substring(3).split('-')) {
            const match = segment.match(/^(\d+)(.+)$/);
            if (match && !productSuffixes.test(match[2])) comboTotal += Number(match[1]);
        }
        packCount = comboTotal > 0 ? comboTotal : 1;
    } else {
        const prefixMatch = sku.match(/^(\d+)-/);
        packCount = prefixMatch ? Number(prefixMatch[1]) : 1;
    }

    return Math.max(0, Number(item?.quantity || 1)) * packCount;
};

const getBangkokDateKey = (value) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
}).format(new Date(value));

const buildRepair = (attendanceData) => {
    const lockedPeriods = Array.isArray(attendanceData.lockedPeriods) ? attendanceData.lockedPeriods : [];
    const lockIndex = lockedPeriods.findIndex((lock) => (
        getBangkokDateKey(lock.start) === periodStart && getBangkokDateKey(lock.end) === periodEnd
    ));
    if (lockIndex < 0) throw new Error('Không tìm thấy kỳ lương tháng 08/2026 đã khóa.');

    const lock = lockedPeriods[lockIndex];
    const snapshot = lock.payrollSnapshot;
    if (!snapshot || !Array.isArray(snapshot.rows) || !Array.isArray(snapshot.packingLogs)) {
        throw new Error('Snapshot tháng 08/2026 không đủ dữ liệu để phục hồi.');
    }

    const packingLogs = snapshot.packingLogs.map((order) => ({
        ...order,
        items: (order.items || []).map((item) => {
            const packingUnits = getLegacyItemUnits(item);
            return {
                ...item,
                packingLevel: 'easy',
                packingUnit: 'SP',
                packingUnits,
                packingUnitPrice: legacyUnitPrice,
                packingIncome: packingUnits * legacyUnitPrice,
            };
        }),
    }));
    const totalPackingUnits = packingLogs.reduce(
        (sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.packingUnits, 0),
        0,
    );
    const totalPackValue = totalPackingUnits * legacyUnitPrice;

    const changes = [];
    const rows = snapshot.rows.map((row) => {
        const employeeOrders = packingLogs.filter((order) => matchesEmployee(order.packer, row));
        const packTotalUnits = employeeOrders.reduce(
            (sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.packingUnits, 0),
            0,
        );
        const packIncome = packTotalUnits * legacyUnitPrice;
        const finalSalary = Number(row.salaryBase || 0)
            + packIncome
            + Number(row.totalBonus || 0)
            - Number(row.myFines || 0)
            - Number(row.leaveDeduction || 0)
            + Number(row.extraAdjust || 0);

        changes.push({
            id: row.id,
            name: row.name,
            orders: employeeOrders.length,
            units: `${Number(row.packTotalUnits || 0)} -> ${packTotalUnits}`,
            packingIncome: `${Number(row.packIncome || 0)} -> ${packIncome}`,
            finalSalary: `${Number(row.finalSalary || 0)} -> ${finalSalary}`,
        });

        return {
            ...row,
            packOrderCount: employeeOrders.length,
            packTotalUnits,
            packIncome,
            autoPackIncome: packIncome,
            totalPackValue_100: totalPackValue,
            packBreakdown: { easy: { units: packTotalUnits, income: packIncome } },
            finalSalary,
        };
    });

    const packingCommission = attendanceData.config?.packingCommission;
    const history = Array.isArray(packingCommission?.history) ? packingCommission.history : [];
    let repairedHistoryCount = 0;
    const repairedHistory = history.map((version) => {
        if (
            version?.updatedBy === 'admin-data-repair'
            && new Date(version.effectiveAt).getTime() < new Date(newPolicyEffectiveAt).getTime()
        ) {
            repairedHistoryCount += 1;
            return { ...version, effectiveAt: newPolicyEffectiveAt };
        }
        return version;
    });

    const repairedAt = new Date().toISOString();
    const repairedLock = {
        ...lock,
        repairedAt,
        repairedBy: 'codex-payroll-lock-repair',
        repairReason: 'Restore August 2026 to legacy flat 20 VND/SKU policy',
        payrollSnapshot: {
            ...snapshot,
            rows,
            packingLogs,
            sourceSummary: {
                ...(snapshot.sourceSummary || {}),
                packingOrderCount: packingLogs.length,
                packingTotalUnits: totalPackingUnits,
                packingIncome: totalPackValue,
            },
            calculationPolicy: {
                packingPolicy: 'legacy-flat-20-vnd-per-sku',
                appliesThrough: periodEnd,
                repairedAt,
            },
        },
    };

    const nextLockedPeriods = [...lockedPeriods];
    nextLockedPeriods[lockIndex] = repairedLock;
    return {
        data: {
            ...attendanceData,
            config: packingCommission ? {
                ...(attendanceData.config || {}),
                packingCommission: { ...packingCommission, history: repairedHistory },
            } : attendanceData.config,
            lockedPeriods: nextLockedPeriods,
        },
        changes,
        repairedHistoryCount,
        totalPackingUnits,
        totalPackValue,
    };
};

async function main() {
    const originalRow = await prisma.appConfig.findUnique({ where: { key: 'attendanceData' } });
    if (!originalRow?.value) throw new Error('Không tìm thấy attendanceData.');

    const originalData = JSON.parse(originalRow.value);
    const repair = buildRepair(originalData);
    console.table(repair.changes);
    console.log({
        mode: shouldApply ? 'apply' : 'dry-run',
        repairedHistoryCount: repair.repairedHistoryCount,
        totalPackingUnits: repair.totalPackingUnits,
        totalPackValue: repair.totalPackValue,
    });
    if (!shouldApply) return;

    const backupDir = path.resolve('tmp', 'attendance-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `attendanceData-before-august-2026-payroll-repair-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(originalData, null, 2), 'utf8');

    await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('attendanceData'))`;
        const currentRow = await tx.appConfig.findUnique({ where: { key: 'attendanceData' } });
        if (currentRow?.value !== originalRow.value) {
            throw new Error('attendanceData vừa thay đổi ở máy khác. Không áp dụng repair; hãy chạy lại.');
        }
        await tx.appConfig.update({
            where: { key: 'attendanceData' },
            data: { value: JSON.stringify(repair.data) },
        });
        await tx.activityLog.create({
            data: {
                module: 'attendance',
                action: 'REPAIR_LOCKED_PAYROLL_SNAPSHOT',
                recordName: '2026-08-01_2026-08-31',
                description: 'Phục hồi snapshot lương tháng 08/2026 theo chính sách cũ 20đ/SP; hoa hồng mới áp dụng từ 01/09/2026',
                userName: 'admin',
                severity: 'WARNING',
            },
        });
    }, { isolationLevel: 'Serializable', timeout: 30000, maxWait: 10000 });

    console.log(`Backup: ${backupPath}`);
    console.log('Đã phục hồi snapshot tháng 08/2026 và sửa mốc hiệu lực hoa hồng.');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
