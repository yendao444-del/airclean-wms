/**
 * _backup_db.js — Xuất toàn bộ database ra file JSON
 * Dùng độc lập: node _backup_db.js
 * Hoặc require từ script khác: const { backupDatabase } = require('./_backup_db')
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Thứ tự: cha trước con (để restore theo đúng FK)
const TABLE_ORDER = [
    { key: 'User',            model: () => prisma.user },
    { key: 'Category',        model: () => prisma.category },
    { key: 'Supplier',        model: () => prisma.supplier },
    { key: 'Customer',        model: () => prisma.customer },
    { key: 'AppConfig',       model: () => prisma.appConfig },
    { key: 'ComboProduct',    model: () => prisma.comboProduct },
    { key: 'DailyTask',       model: () => prisma.dailyTask },
    { key: 'ActivityLog',     model: () => prisma.activityLog },
    { key: 'UpdateHistory',   model: () => prisma.updateHistory },
    { key: 'DailyExpense',    model: () => prisma.dailyExpense },
    { key: 'EcommerceExport', model: () => prisma.ecommerceExport },
    { key: 'ExportOrder',     model: () => prisma.exportOrder },
    { key: 'Return',          model: () => prisma['return'] },
    { key: 'Refund',          model: () => prisma.refund },
    { key: 'StockBalance',    model: () => prisma.stockBalance },
    { key: 'EInvoice',        model: () => prisma.eInvoice },
    { key: 'Product',         model: () => prisma.product },
    { key: 'PurchaseOrder',   model: () => prisma.purchaseOrder },
    { key: 'PurchaseItem',    model: () => prisma.purchaseItem },
    { key: 'Order',           model: () => prisma.order },
    { key: 'OrderItem',       model: () => prisma.orderItem },
    { key: 'Payment',         model: () => prisma.payment },
    { key: 'InventoryLog',    model: () => prisma.inventoryLog },
    { key: 'Expense',         model: () => prisma.expense },
];

async function backupDatabase(outputDir = __dirname) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const filename = `DB-BACKUP-${dateStr}.json`;
    const filepath = path.join(outputDir, filename);

    console.log('=========================================');
    console.log('    AIRCLEAN WMS - DATABASE BACKUP       ');
    console.log('=========================================');
    console.log(`Output: ${filename}\n`);

    const backup = {
        version: '1.0',
        createdAt: now.toISOString(),
        tables: {},
    };

    let totalRecords = 0;
    for (const { key, model } of TABLE_ORDER) {
        process.stdout.write(`  → ${key.padEnd(18)}`);
        const data = await model().findMany({ orderBy: { id: 'asc' } });
        backup.tables[key] = data;
        totalRecords += data.length;
        console.log(`${data.length} records`);
    }

    fs.writeFileSync(filepath, JSON.stringify(backup, null, 2), 'utf-8');
    const sizeMB = (fs.statSync(filepath).size / 1024 / 1024).toFixed(2);

    console.log(`\n✅ Backup xong! Tổng: ${totalRecords} records — ${sizeMB} MB`);
    console.log(`   File: ${filepath}\n`);

    await prisma.$disconnect();
    return filepath;
}

// Chạy standalone
if (require.main === module) {
    backupDatabase()
        .catch(e => { console.error('❌ LỖI:', e.message); process.exit(1); });
}

module.exports = { backupDatabase };
