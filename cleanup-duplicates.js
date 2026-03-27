const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    console.log('--- DỌN DẸP THẺ KHO TRÙNG LẶP ---');
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const logs = await prisma.inventoryLog.findMany({
        where: { 
            createdAt: { gte: startOfDay }, 
            note: { contains: '(Backfill)' } 
        },
        orderBy: { id: 'asc' } // Keep the first one
    });

    const seen = new Set();
    const deleteIds = [];

    for (const log of logs) {
        const key = `${log.reference}_${log.sku}`;
        if (seen.has(key)) {
            // Duplicate!
            deleteIds.push(log.id);
        } else {
            seen.add(key);
        }
    }

    if (deleteIds.length > 0) {
        await prisma.inventoryLog.deleteMany({
            where: { id: { in: deleteIds } }
        });
        console.log(`✅ Đã xóa ${deleteIds.length} thẻ kho bị trùng lặp (do chạy lệnh song song).`);
    } else {
        console.log(`✅ Không tìm thấy thẻ kho trùng lặp.`);
    }
}

run().catch(console.error).finally(() => prisma.$disconnect());
