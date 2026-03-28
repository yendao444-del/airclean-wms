const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Đang kết nối database để sửa Ghi chú Thẻ kho...');
    
    try {
        const fix1 = await prisma.$executeRaw`UPDATE "InventoryLog" SET note = REPLACE(note, 'Tạo/Sửa đơn TMDT', 'Xuất hàng TMDT') WHERE note LIKE '%Tạo/Sửa đơn TMDT%';`;
        console.log("✅ Đã cập nhật " + fix1 + " bản ghi chứa chữ Tạo/Sửa đơn TMDT");

        const fix2 = await prisma.$executeRaw`UPDATE "InventoryLog" SET note = REPLACE(note, 'Tạo đơn TMDT', 'Xuất hàng TMDT') WHERE note LIKE '%Tạo đơn TMDT%';`;
        console.log("✅ Đã cập nhật " + fix2 + " bản ghi chứa chữ Tạo đơn TMDT");
        
        console.log('🎉 Hoàn tất sửa đổi!');
    } catch (e) {
        console.error('❌ Lỗi:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
