const config = require('./electron/config');
process.env.DATABASE_URL = config.DATABASE_URL;
process.env.DIRECT_URL = config.DIRECT_URL;

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    // Check before
    const before = await p.ecommerceExport.count();
    const pending = await p.ecommerceExport.count({ where: { status: { not: 'completed' } } });
    const completed = await p.ecommerceExport.count({ where: { status: 'completed' } });
    console.log(`TRƯỚC: ${before} records (${pending} pending, ${completed} completed)`);

    // Xóa chỉ completed
    const deleted = await p.ecommerceExport.deleteMany({
        where: { status: 'completed' }
    });
    console.log(`=> Đã xóa: ${deleted.count} records completed`);

    // Check after
    const after = await p.ecommerceExport.count();
    const afterPending = await p.ecommerceExport.count({ where: { status: { not: 'completed' } } });
    console.log(`SAU: ${after} records (${afterPending} pending)`);

    await p.$disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
