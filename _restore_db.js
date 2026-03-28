/**
 * _restore_db.js — Phục hồi database từ file JSON backup
 * Dùng: node _restore_db.js [đường-dẫn-file.json]
 * Nếu không truyền tham số → tự tìm file mới nhất trong thư mục hiện tại
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const prisma = new PrismaClient();

// Thứ tự XÓA: con → cha (ngược lại với insert)
const DELETE_ORDER = [
    () => prisma.inventoryLog.deleteMany(),
    () => prisma.expense.deleteMany(),
    () => prisma.payment.deleteMany(),
    () => prisma.orderItem.deleteMany(),
    () => prisma.order.deleteMany(),
    () => prisma.purchaseItem.deleteMany(),
    () => prisma.purchaseOrder.deleteMany(),
    () => prisma.product.deleteMany(),
    () => prisma.ecommerceExport.deleteMany(),
    () => prisma.exportOrder.deleteMany(),
    () => prisma['return'].deleteMany(),
    () => prisma.refund.deleteMany(),
    () => prisma.stockBalance.deleteMany(),
    () => prisma.eInvoice.deleteMany(),
    () => prisma.dailyExpense.deleteMany(),
    () => prisma.activityLog.deleteMany(),
    () => prisma.updateHistory.deleteMany(),
    () => prisma.dailyTask.deleteMany(),
    () => prisma.appConfig.deleteMany(),
    () => prisma.comboProduct.deleteMany(),
    () => prisma.customer.deleteMany(),
    () => prisma.supplier.deleteMany(),
    () => prisma.category.deleteMany({ where: { parentId: { not: null } } }), // con trước
    () => prisma.category.deleteMany(),
    () => prisma.user.deleteMany(),
];

// Tên bảng PostgreSQL để reset sequence (đúng với tên Prisma tạo ra)
const TABLE_NAMES = [
    'User', 'Category', 'Supplier', 'Customer', 'AppConfig', 'ComboProduct',
    'DailyTask', 'ActivityLog', 'UpdateHistory', 'DailyExpense', 'EcommerceExport',
    'ExportOrder', 'Return', 'Refund', 'StockBalance', 'EInvoice', 'Product',
    'PurchaseOrder', 'PurchaseItem', 'Order', 'OrderItem', 'Payment',
    'InventoryLog', 'Expense',
];

function findLatestBackup() {
    const files = fs.readdirSync(__dirname)
        .filter(f => f.startsWith('DB-BACKUP-') && f.endsWith('.json'))
        .sort()
        .reverse();
    if (files.length === 0) throw new Error('Không tìm thấy file DB-BACKUP-*.json nào trong thư mục!');
    return path.join(__dirname, files[0]);
}

async function insertBatch(model, records, batchSize = 500) {
    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        await model.createMany({ data: batch, skipDuplicates: false });
        const done = Math.min(i + batchSize, records.length);
        process.stdout.write(`\r      ${done}/${records.length}`);
    }
    process.stdout.write('\n');
}

async function resetSequences() {
    for (const tableName of TABLE_NAMES) {
        try {
            await prisma.$executeRawUnsafe(
                `SELECT setval(pg_get_serial_sequence('"${tableName}"', 'id'), COALESCE((SELECT MAX(id) FROM "${tableName}"), 0) + 1, false)`
            );
        } catch (e) {
            // Bỏ qua nếu bảng rỗng hoặc sequence không tồn tại
        }
    }
}

function confirm(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (ans) => { rl.close(); resolve(ans.trim().toLowerCase()); });
    });
}

async function main() {
    const backupFile = process.argv[2] || findLatestBackup();

    if (!fs.existsSync(backupFile)) {
        throw new Error(`File không tồn tại: ${backupFile}`);
    }

    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
    const t = backup.tables;

    // Tính tổng records
    const totalRecords = Object.values(t).reduce((s, arr) => s + (arr?.length || 0), 0);

    console.log('=========================================');
    console.log('    AIRCLEAN WMS - DATABASE RESTORE      ');
    console.log('=========================================');
    console.log(`File:    ${path.basename(backupFile)}`);
    console.log(`Ngày tạo: ${new Date(backup.createdAt).toLocaleString('vi-VN')}`);
    console.log(`Tổng:    ${totalRecords} records\n`);

    // Hiển thị summary từng bảng
    for (const [key, arr] of Object.entries(t)) {
        if (arr?.length > 0) console.log(`  ${key.padEnd(18)} ${arr.length} records`);
    }

    console.log('\n⚠️  CẢNH BÁO: Thao tác này sẽ XÓA TOÀN BỘ dữ liệu hiện tại');
    console.log('    và thay bằng dữ liệu từ file backup.\n');

    const ans = await confirm('Bạn có chắc chắn muốn tiếp tục? (gõ YES để xác nhận): ');
    if (ans !== 'yes') {
        console.log('\n❌ Đã hủy. Không có gì thay đổi.');
        return;
    }

    console.log('\n🔄 Bắt đầu restore...\n');

    // ========== BƯỚC 1: XÓA ==========
    console.log('[1/3] Xóa dữ liệu cũ (con → cha)...');
    for (const fn of DELETE_ORDER) {
        await fn();
    }
    console.log('      ✅ Xóa xong!\n');

    // ========== BƯỚC 2: INSERT ==========
    console.log('[2/3] Bơm dữ liệu mới (cha → con)...');

    const insert = async (key, model, data) => {
        if (!data || data.length === 0) {
            console.log(`  → ${key.padEnd(18)} (trống — bỏ qua)`);
            return;
        }
        process.stdout.write(`  → ${key.padEnd(18)} ${data.length} records`);
        if (data.length <= 500) {
            await model.createMany({ data, skipDuplicates: false });
            process.stdout.write('\n');
        } else {
            process.stdout.write('\n');
            await insertBatch(model, data);
        }
    };

    await insert('User',            prisma.user,             t.User);

    // Category: insert cha (parentId=null) trước, rồi con
    if (t.Category?.length) {
        const parents  = t.Category.filter(c => !c.parentId);
        const children = t.Category.filter(c => c.parentId);
        process.stdout.write(`  → ${'Category'.padEnd(18)} ${t.Category.length} records\n`);
        if (parents.length)  await insertBatch(prisma.category, parents);
        if (children.length) await insertBatch(prisma.category, children);
    }

    await insert('Supplier',        prisma.supplier,         t.Supplier);
    await insert('Customer',        prisma.customer,         t.Customer);
    await insert('AppConfig',       prisma.appConfig,        t.AppConfig);
    await insert('ComboProduct',    prisma.comboProduct,     t.ComboProduct);
    await insert('DailyTask',       prisma.dailyTask,        t.DailyTask);
    await insert('ActivityLog',     prisma.activityLog,      t.ActivityLog);
    await insert('UpdateHistory',   prisma.updateHistory,    t.UpdateHistory);
    await insert('DailyExpense',    prisma.dailyExpense,     t.DailyExpense);
    await insert('EcommerceExport', prisma.ecommerceExport,  t.EcommerceExport);
    await insert('ExportOrder',     prisma.exportOrder,      t.ExportOrder);
    await insert('Return',          prisma['return'],        t.Return);
    await insert('Refund',          prisma.refund,           t.Refund);
    await insert('StockBalance',    prisma.stockBalance,     t.StockBalance);
    await insert('EInvoice',        prisma.eInvoice,         t.EInvoice);
    await insert('Product',         prisma.product,          t.Product);
    await insert('PurchaseOrder',   prisma.purchaseOrder,    t.PurchaseOrder);
    await insert('PurchaseItem',    prisma.purchaseItem,     t.PurchaseItem);
    await insert('Order',           prisma.order,            t.Order);
    await insert('OrderItem',       prisma.orderItem,        t.OrderItem);
    await insert('Payment',         prisma.payment,          t.Payment);
    await insert('InventoryLog',    prisma.inventoryLog,     t.InventoryLog);
    await insert('Expense',         prisma.expense,          t.Expense);

    console.log('\n      ✅ Insert xong!\n');

    // ========== BƯỚC 3: RESET SEQUENCES ==========
    console.log('[3/3] Reset PostgreSQL autoincrement sequences...');
    await resetSequences();
    console.log('      ✅ Sequences reset xong!\n');

    console.log('=========================================');
    console.log('   🎉 RESTORE HOÀN TẤT! Database OK.    ');
    console.log('=========================================\n');
}

main()
    .catch(e => {
        console.error('\n❌ LỖI NGHIÊM TRỌNG:', e.message);
        console.error('   Database có thể ở trạng thái không nhất quán!');
        console.error('   Hãy chạy lại restore từ đầu.');
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
