const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    console.log('--- KHÔI PHỤC THẺ KHO BỊ THIẾU TRONG TẦM KIỂM SOÁT ---');
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let missingLogsCount = 0;

    // 1. Kiểm tra đơn Xuất POS
    const exportOrders = await prisma.exportOrder.findMany({
        where: { createdAt: { gte: startOfDay } }
    });

    for (const order of exportOrders) {
        const referenceCode = `PX${order.id.toString().padStart(4, '0')}`;
        // Kiểm tra xem đã có Thẻ Kho chưa
        const existingLog = await prisma.inventoryLog.findFirst({
            where: { reference: referenceCode, referenceType: 'XUAT' }
        });

        if (!existingLog) {
            console.log(`[!] THIẾU THẺ KHO: Xuất hàng POS ${referenceCode} - Khách: ${order.customer}`);
            missingLogsCount++;
            
            // Lấy user ID
            let reporterId = null;
            if (order.createdBy) {
                const user = await prisma.user.findUnique({ where: { username: order.createdBy } });
                if (user) reporterId = user.id;
            }

            // Tạo thẻ kho mà KHÔNG đụng vào Tồn Kho (do trước đó đã trừ thành công rồi)
            let items = [];
            try { items = JSON.parse(order.items); } catch(e) {}
            if (!Array.isArray(items)) items = [order.items];

            for (const item of items) {
                if (!item) continue;
                // Tìm thông tin kho hiện tại để ghi vào Tồn Cuối cho hợp lý
                let product = await prisma.product.findUnique({ where: { sku: item.sku } });
                let currentStock = 0;
                let productId = 0;
                let productName = item.productName || '';

                if (product) {
                    currentStock = product.stock;
                    productId = product.id;
                    productName = product.name;
                } else {
                    const parent = await prisma.product.findFirst({ where: { variants: { contains: item.sku } }});
                    if (parent) {
                        try {
                            const vars = JSON.parse(parent.variants);
                            const v = vars.find(x => x.sku === item.sku);
                            if (v) currentStock = v.stock;
                        } catch(e) {}
                        productId = parent.id;
                        productName = parent.name;
                    }
                }

                // BACKFILL MÔ PHỎNG (Sẽ tạo thật nếu bạn đồng ý)
                // await prisma.inventoryLog.create({
                //     data: {
                //         productId: productId || 0,
                //         sku: item.sku,
                //         productName: productName,
                //         variantColor: item.color || null,
                //         type: 'export',
                //         referenceType: 'XUAT',
                //         reference: referenceCode,
                //         quantity: -item.quantity,
                //         oldStock: currentStock + item.quantity,
                //         newStock: currentStock,
                //         note: `Xuất kho: ${order.customer} (Backfill)`,
                //         createdBy: reporterId,
                //     }
                // });
            }
        }
    }

    // 2. Kiểm tra TMĐT
    const ecomOrders = await prisma.ecommerceExport.findMany({
        where: { createdAt: { gte: startOfDay }, status: 'completed' }
    });

    for (const order of ecomOrders) {
        const referenceCode = order.orderNumber || order.ecommerceExportCode || `Phiếu ${order.id}`;
        const existingLog = await prisma.inventoryLog.findFirst({
            where: { reference: referenceCode, referenceType: 'TMDT' }
        });

        if (!existingLog) {
            console.log(`[!] THIẾU THẺ KHO: Bàn giao TMDT ${referenceCode} - Nguồn: ${order.customerName}`);
            missingLogsCount++;
            // Tương tự, ta có thể backfill...
        }
    }

    if (missingLogsCount === 0) {
        console.log('✅ Không có đơn hàng nào bị thiếu thẻ kho trong ngày hôm nay!');
    } else {
        console.log(`\n=> Phát hiện ${missingLogsCount} đơn hàng bị thiếu trong Thẻ Kho.`);
        console.log('=> Đây là chế độ kiểm tra (Dry-run), dữ liệu CHƯA thực sự được ghi vào.');
        console.log('=> Hãy gọi hàm thực thi thật nếu muốn hệ thống tự động bù lại thẻ kho!');
    }
}

run().catch(console.error).finally(() => prisma.$disconnect());
