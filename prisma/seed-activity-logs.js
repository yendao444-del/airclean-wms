const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seedActivityLogs() {
    console.log('🌱 Seeding activity logs...');

    const logs = [
        {
            module: 'products',
            action: 'CREATE',
            recordId: 1,
            recordName: 'Khẩu trang 5D UNICARE',
            description: 'Tạo sản phẩm mới: Khẩu trang 5D UNICARE',
            userName: 'Admin',
            severity: 'INFO'
        },
        {
            module: 'products',
            action: 'UPDATE',
            recordId: 1,
            recordName: 'Khẩu trang 5D UNICARE',
            changes: JSON.stringify({ price: { old: 25000, new: 50000 }, stock: { old: 100, new: 250 } }),
            description: 'Cập nhật giá từ 25,000đ → 50,000đ và tồn kho từ 100 → 250',
            userName: 'Admin',
            severity: 'INFO'
        },
        {
            module: 'products',
            action: 'UPDATE',
            recordId: 1,
            recordName: 'Khẩu trang 5D UNICARE',
            changes: JSON.stringify({ stock: { old: 250, new: 245 } }),
            description: 'Xuất hàng: Giảm tồn kho từ 250 → 245',
            userName: 'System',
            severity: 'INFO'
        },
        {
            module: 'returns',
            action: 'CREATE',
            recordId: 1,
            recordName: 'RT001',
            description: 'Tạo phiếu trả hàng mới RT001',
            userName: 'Admin',
            severity: 'INFO'
        },
        {
            module: 'returns',
            action: 'UPDATE',
            recordId: 1,
            recordName: 'RT001',
            changes: JSON.stringify({ status: { old: 'pending', new: 'completed' } }),
            description: 'Cập nhật trạng thái từ "Đang xử lý" → "Hoàn thành"',
            userName: 'Admin',
            severity: 'INFO'
        },
        {
            module: 'products',
            action: 'UPDATE',
            recordId: 2,
            recordName: 'Áo thun nam basic đen',
            changes: JSON.stringify({ stock: { old: 45, new: 38 } }),
            description: 'Xuất hàng: Giảm tồn kho từ 45 → 38',
            userName: 'System',
            severity: 'INFO'
        },
        {
            module: 'products',
            action: 'DELETE',
            recordId: 99,
            recordName: 'Sản phẩm test',
            description: 'Xóa sản phẩm test',
            userName: 'Admin',
            severity: 'WARNING'
        },
        {
            module: 'sales',
            action: 'CREATE',
            recordId: 1,
            recordName: 'Đơn #ORD001',
            changes: JSON.stringify({ total: 500000, items: 5 }),
            description: 'Tạo đơn hàng mới #ORD001 - Tổng: 500,000đ',
            userName: 'Admin',
            severity: 'INFO'
        },
        {
            module: 'purchases',
            action: 'CREATE',
            recordId: 1,
            recordName: 'Phiếu nhập #PO001',
            changes: JSON.stringify({ total: 5000000, items: 10 }),
            description: 'Nhập hàng mới #PO001 - Tổng: 5,000,000đ',
            userName: 'Admin',
            severity: 'INFO'
        },
        {
            module: 'products',
            action: 'UPDATE',
            recordId: 1,
            recordName: 'Khẩu trang 5D UNICARE',
            changes: JSON.stringify({ minStock: { old: 50, new: 30 } }),
            description: 'Cập nhật tồn kho tối thiểu từ 50 → 30',
            userName: 'Admin',
            severity: 'INFO'
        },
        {
            module: 'returns',
            action: 'UPDATE',
            recordId: 2,
            recordName: 'RT002',
            changes: JSON.stringify({ notes: 'Sản phẩm bị lỗi' }),
            description: 'Thêm ghi chú: Sản phẩm bị lỗi',
            userName: 'Admin',
            severity: 'WARNING'
        },
        {
            module: 'products',
            action: 'UPDATE',
            recordId: 3,
            recordName: 'Quần jean nữ skinny',
            changes: JSON.stringify({ price: { old: 120000, new: 150000 } }),
            description: 'Tăng giá từ 120,000đ → 150,000đ',
            userName: 'Admin',
            severity: 'INFO'
        }
    ];

    for (const log of logs) {
        await prisma.activityLog.create({ data: log });
    }

    console.log(`✅ Created ${logs.length} activity logs!`);
}

seedActivityLogs()
    .catch((e) => {
        console.error('❌ Seed error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
