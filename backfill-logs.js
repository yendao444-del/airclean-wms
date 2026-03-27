const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    console.log('--- KHÔI PHỤC THẺ KHO BỊ THIẾU TRONG NGÀY ---');
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let createdCount = 0;

    // 1. Kiểm tra đơn Xuất POS
    const exportOrders = await prisma.exportOrder.findMany({
        where: { createdAt: { gte: startOfDay } }
    });

    for (const order of exportOrders) {
        let items = [];
        try { items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items; } catch(e) {}
        if (!Array.isArray(items)) items = [items];

        for (const item of items) {
            if (!item || !item.sku) continue;
            
            const referenceCode = `PX${order.id.toString().padStart(4, '0')}`;
            // Kiểm tra xem đã có Thẻ Kho chưa
            const existingLog = await prisma.inventoryLog.findFirst({
                where: { reference: referenceCode, referenceType: 'XUAT', sku: item.sku }
            });

            if (!existingLog) {
                console.log(`[+] Đang tạo thẻ kho cho: PX${order.id.toString().padStart(4, '0')} - SKU: ${item.sku}`);
                
                let reporterId = null;
                if (order.createdBy) {
                    const user = await prisma.user.findUnique({ where: { username: order.createdBy } });
                    if (user) reporterId = user.id;
                }

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

                // BACKFILL
                if (productId > 0) {
                    await prisma.inventoryLog.create({
                        data: {
                            productId: productId,
                            sku: item.sku,
                            productName: productName,
                            variantColor: item.color || null,
                            type: 'export',
                            referenceType: 'XUAT',
                            reference: referenceCode,
                            quantity: -item.quantity,
                            oldStock: currentStock + item.quantity, // Mô phỏng lại quá khứ
                            newStock: currentStock,
                            note: `Xuất kho: ${order.customer} (Backfill)`,
                            createdBy: reporterId,
                            createdAt: order.createdAt // Xếp đúng thứ tự thời gian!
                        }
                    });
                    createdCount++;
                } else {
                    console.log(`[!] Bỏ qua ${item.sku} vì không tìm thấy Product gốc chứa ID trong DB.`);
                }
            }
        }
    }

    // 2. Kiểm tra TMĐT
    const ecomOrders = await prisma.ecommerceExport.findMany({
        where: { createdAt: { gte: startOfDay }, status: 'completed' }
    });

    for (const order of ecomOrders) {
        let items = [];
        try { items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items; } catch(e) {}
        if (!Array.isArray(items)) items = [items];

        for (const item of items) {
            if (!item || !item.variantSku) continue;
            
            const referenceCode = order.orderNumber || order.ecommerceExportCode || `Phiếu ${order.id}`;
            const existingLog = await prisma.inventoryLog.findFirst({
                where: { reference: referenceCode, referenceType: 'TMDT', sku: item.variantSku }
            });

            if (!existingLog) {
                console.log(`[+] Đang tạo thẻ kho cho: TMDT ${referenceCode} - SKU: ${item.variantSku}`);
                
                // TMDT createdBy is usually null in old logs context, but let's just make it null
                let reporterId = null;

                let product = await prisma.product.findUnique({ where: { sku: item.variantSku } });
                let currentStock = 0;
                let productId = 0;
                let productName = item.productName || item.itemName || '';

                if (product) {
                    currentStock = product.stock;
                    productId = product.id;
                    productName = product.name;
                } else {
                    const parent = await prisma.product.findFirst({ where: { variants: { contains: item.variantSku } }});
                    if (parent) {
                        try {
                            const vars = JSON.parse(parent.variants);
                            const v = vars.find(x => x.sku === item.variantSku);
                            if (v) currentStock = v.stock;
                        } catch(e) {}
                        productId = parent.id;
                        productName = parent.name;
                    }
                }

                // BACKFILL
                if (productId > 0) {
                    await prisma.inventoryLog.create({
                        data: {
                            productId: productId,
                            sku: item.variantSku,
                            productName: productName,
                            variantColor: item.color || null,
                            type: 'ecom_sale',
                            referenceType: 'TMDT',
                            reference: referenceCode,
                            quantity: -item.quantity,
                            oldStock: currentStock + item.quantity,
                            newStock: currentStock,
                            note: `Tạo/Sửa đơn TMDT: ${order.customerName} (Backfill)`,
                            createdBy: reporterId,
                            createdAt: order.updatedAt || order.createdAt // Thời điểm scan xong
                        }
                    });
                    createdCount++;
                } else {
                    console.log(`[!] Bỏ qua ${item.variantSku} vì không tìm thấy Product gốc chứa ID trong DB.`);
                }
            }
        }
    }

    console.log(`\n✅ HOÀN TẤT. Đã khôi phục thành công ${createdCount} dòng thẻ kho bị mất.`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
