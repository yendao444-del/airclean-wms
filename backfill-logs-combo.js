const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function processItem(itemSku, qty, itemColor, itemName, isEcom, referenceCode, order, reporterId, createdCountObj, visited = new Set()) {
    if (!itemSku) return;
    process.stdout.write(`.`);
    
    // Prevent infinite recursion if a combo includes itself
    if (visited.has(itemSku)) {
        console.log(`[!] Vòng lặp đệ quy Combo phát hiện tại SKU: ${itemSku}. Đã bỏ qua!`);
        return;
    }
    const currentVisited = new Set(visited);
    currentVisited.add(itemSku);

    // Check if it's a combo
    const combo = await prisma.comboProduct.findUnique({ where: { sku: itemSku } });
    if (combo) {
        let comboItems = [];
        try { comboItems = JSON.parse(combo.items || '[]'); } catch(e) {}
        
        for (const sub of comboItems) {
            // Recursive backfill with component multiplier
            await processItem(
                sub.sku, 
                qty * sub.quantity, 
                sub.color, 
                sub.name, 
                isEcom, 
                referenceCode, 
                order, 
                reporterId, 
                createdCountObj,
                currentVisited
            );
        }
        return; // Combo itself is virtual, components are physical!
    }

    // Normal Product / Variant
    const existingLog = await prisma.inventoryLog.findFirst({
        where: { reference: referenceCode, referenceType: isEcom ? 'TMDT' : 'XUAT', sku: itemSku }
    });

    if (!existingLog) {
        let product = await prisma.product.findUnique({ where: { sku: itemSku } });
        let currentStock = 0;
        let productId = 0;
        let productName = itemName || '';

        if (product) {
            currentStock = product.stock;
            productId = product.id;
            productName = product.name;
        } else {
            const productsWithVariant = await prisma.product.findMany({ where: { variants: { contains: itemSku } }});
            for (const parent of productsWithVariant) {
                try {
                    const vars = JSON.parse(parent.variants);
                    const v = vars.find(x => x.sku === itemSku);
                    if (v) {
                        currentStock = v.stock;
                        productId = parent.id;
                        productName = parent.name;
                        break;
                    }
                } catch(e) {}
            }
        }

        if (productId > 0) {
            console.log(`[+] Đang tạo thẻ kho cho: ${isEcom ? 'TMDT' : 'PX'} ${referenceCode} - SKU: ${itemSku} (Qty: ${qty})`);
            await prisma.inventoryLog.create({
                data: {
                    productId: productId,
                    sku: itemSku,
                    productName: productName,
                    variantColor: itemColor || null,
                    type: isEcom ? 'ecom_sale' : 'export',
                    referenceType: isEcom ? 'TMDT' : 'XUAT',
                    reference: referenceCode,
                    quantity: -qty,
                    oldStock: currentStock + qty, // Mô phỏng lại quá khứ
                    newStock: currentStock,
                    note: isEcom ? `Tạo/Sửa đơn TMDT: ${order.customerName} (Backfill Combo)` : `Xuất kho: ${order.customer} (Backfill Combo)`,
                    createdBy: reporterId,
                    createdAt: order.updatedAt || order.createdAt
                }
            });
            createdCountObj.count++;
        } else {
            // Không phải Combo, cũng không phải Product, cũng không phải Variant!
            console.log(`[!] Bỏ qua ${itemSku} vì không tìm thấy Product gốc hay Combo nào.`);
        }
    }
}


async function run() {
    console.log('--- KHÔI PHỤC THẺ KHO CHO COMBOS BỊ THIẾU ---');
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let createdCountObj = { count: 0 };

    // 1. Xuất POS (hầu như không xài combo ở đây nhưng cứ giữ an toàn)
    const exportOrders = await prisma.exportOrder.findMany({
        where: { createdAt: { gte: startOfDay } },
        orderBy: { id: 'asc' }
    });

    for (const order of exportOrders) {
        let items = [];
        try { items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items; } catch(e) {}
        if (!Array.isArray(items)) items = [items];

        let reporterId = null;
        if (order.createdBy) {
            const user = await prisma.user.findUnique({ where: { username: order.createdBy } });
            if (user) reporterId = user.id;
        }

        for (const item of items) {
            if (!item || !item.sku) continue;
            const referenceCode = `PX${order.id.toString().padStart(4, '0')}`;
            await processItem(item.sku, item.quantity, item.color, item.productName, false, referenceCode, order, reporterId, createdCountObj);
        }
    }

    // 2. TMDT (Ecom) - Mỏ vàng combo bị bỏ sót!
    const ecomOrders = await prisma.ecommerceExport.findMany({
        where: { createdAt: { gte: startOfDay }, status: 'completed' },
        orderBy: { id: 'asc' }
    });

    for (const order of ecomOrders) {
        let items = [];
        try { items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items; } catch(e) {}
        if (!Array.isArray(items)) items = [items];

        for (const item of items) {
            if (!item || !item.variantSku) continue;
            const referenceCode = order.orderNumber || order.ecommerceExportCode || `Phiếu ${order.id}`;
            await processItem(item.variantSku, item.quantity, item.color, item.productName || item.itemName, true, referenceCode, order, null, createdCountObj);
        }
    }

    console.log(`\n✅ HOÀN TẤT. Đã khôi phục thành công ${createdCountObj.count} dòng thẻ kho Combo bị mất.`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
