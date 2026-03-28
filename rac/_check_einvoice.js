const config = require('./electron/config');
process.env.DATABASE_URL = config.DATABASE_URL;
process.env.DIRECT_URL = config.DIRECT_URL;
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const fs = require('fs');

(async () => {
    try {
        let output = "";

        // === eInvoice (HĐĐT - đơn BÁN HÀNG) ===
        output += "========================================\n";
        output += "  eInvoice (HĐĐT - OUTGOING SALES)\n";
        output += "========================================\n";
        const eiStats = await p.eInvoice.groupBy({ by: ['status'], _count: { status: true } });
        for (const row of eiStats) {
            output += `  ${row.status}: ${row._count.status}\n`;
        }

        // === Purchase (Nhập hàng) ===
        output += "\n========================================\n";
        output += "  Purchase (NHẬP HÀNG - INCOMING)\n";
        output += "========================================\n";
        const purAll = await p.purchase.count();
        output += `  Total purchases: ${purAll}\n`;

        const purByVat = await p.purchase.groupBy({
            by: ['vatInvoiceStatus'],
            _count: { vatInvoiceStatus: true },
        });
        output += "  By VAT status:\n";
        for (const row of purByVat) {
            output += `    ${row.vatInvoiceStatus || 'NULL'}: ${row._count.vatInvoiceStatus}\n`;
        }

        // What the ticker actually shows for purchases
        const now = new Date();
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        const missingVat = await p.purchase.count({
            where: {
                vatInvoiceStatus: { notIn: ['uploaded', 'thht', 'no_vat'] },
                purchaseDate: { lte: threeDaysAgo },
            }
        });
        output += `\n  Ticker would show (missing VAT >= 3 days): ${missingVat}\n`;

        // === So the question is: WHICH notification is wrong? ===
        output += "\n========================================\n";
        output += "  WHAT THE TICKER SHOWS:\n";
        output += "========================================\n";
        const eiPending = await p.eInvoice.count({ where: { status: 'pending' } });
        output += `  eInvoice pending (>= 20 to show): ${eiPending}\n`;
        output += `  Purchase missing VAT: ${missingVat}\n`;

        fs.writeFileSync('_einvoice_report.txt', output);
        console.log("Done! Check _einvoice_report.txt");
    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        await p.$disconnect();
    }
})();
