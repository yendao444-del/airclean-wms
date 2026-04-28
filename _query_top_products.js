const { PrismaClient } = require('./node_modules/@prisma/client');

async function main() {
    const prisma = new PrismaClient();
    try {
        // Query top selling products by productName (grouped, excluding cancelled orders)
        const result = await prisma.$queryRaw`
            SELECT
                oi."productName",
                SUM(oi.quantity)::int AS "totalQty",
                SUM(oi.subtotal)     AS "totalRevenue",
                COUNT(DISTINCT oi."orderId")::int AS "orderCount"
            FROM "OrderItem" oi
            JOIN "Order" o ON o.id = oi."orderId"
            WHERE o.status != 'cancelled'
            GROUP BY oi."productName"
            ORDER BY "totalQty" DESC
            LIMIT 10
        `;

        console.log('\n=== TOP 10 SẢN PHẨM BÁN CHẠY NHẤT (theo số lượng) ===\n');
        console.log('Rank | Sản phẩm                              | SL bán | Doanh thu        | Số đơn');
        console.log('-----|---------------------------------------|--------|------------------|--------');
        result.forEach((row, i) => {
            const name = row.productName.padEnd(38);
            const qty = String(row.totalQty).padStart(6);
            const rev = Number(row.totalRevenue).toLocaleString('vi-VN').padStart(16);
            const ord = String(row.orderCount).padStart(6);
            console.log(`  ${i + 1}  | ${name} | ${qty} | ${rev} | ${ord}`);
        });

        // Also check by InventoryLog for pos_sale + ecom_sale
        console.log('\n\n=== KIỂM TRA QUA INVENTORYLOG (pos_sale + ecom_sale) ===\n');
        const invResult = await prisma.$queryRaw`
            SELECT
                il."productName",
                SUM(ABS(il.quantity))::int AS "totalSold",
                COUNT(*)::int AS "txCount"
            FROM "InventoryLog" il
            WHERE il.type IN ('pos_sale', 'ecom_sale')
              AND il."productName" IS NOT NULL
            GROUP BY il."productName"
            ORDER BY "totalSold" DESC
            LIMIT 10
        `;

        console.log('Rank | Sản phẩm                              | SL bán | Số giao dịch');
        console.log('-----|---------------------------------------|--------|-------------');
        invResult.forEach((row, i) => {
            const name = (row.productName || '').padEnd(38);
            const qty = String(row.totalSold).padStart(6);
            const tx = String(row.txCount).padStart(12);
            console.log(`  ${i + 1}  | ${name} | ${qty} | ${tx}`);
        });

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(e => { console.error(e); process.exit(1); });
