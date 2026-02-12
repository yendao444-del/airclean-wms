// Script để xóa các categories không cần thiết, chỉ giữ "Khẩu Trang"
const { PrismaClient } = require('@prisma/client');
const path = require('path');

// Load .env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

async function cleanupCategories() {
    console.log('🧹 Cleaning up categories...');

    try {
        // Lấy tất cả categories
        const allCategories = await prisma.category.findMany();
        console.log(`📋 Found ${allCategories.length} categories`);

        // Xóa tất cả categories KHÔNG phải "Khẩu Trang"
        const toDelete = allCategories.filter(c => !c.name.includes('Khẩu'));

        for (const category of toDelete) {
            // Kiểm tra xem có sản phẩm nào đang dùng không
            const productsCount = await prisma.product.count({
                where: { categoryId: category.id }
            });

            if (productsCount > 0) {
                console.log(`  ⚠️  Cannot delete "${category.name}" - ${productsCount} products using it`);
            } else {
                await prisma.category.delete({
                    where: { id: category.id }
                });
                console.log(`  ✅ Deleted category: "${category.name}"`);
            }
        }

        // Đảm bảo có "Khẩu Trang"
        const khauTrang = await prisma.category.findFirst({
            where: { name: { contains: 'Khẩu' } }
        });

        if (!khauTrang) {
            const created = await prisma.category.create({
                data: { name: 'Khẩu Trang' }
            });
            console.log(`  ✅ Created "Khẩu Trang" category: ${created.id}`);
        } else {
            console.log(`  ✓ "Khẩu Trang" exists (ID: ${khauTrang.id})`);
        }

        console.log('✅ Cleanup completed!');
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
        throw error;
    }
}

cleanupCategories()
    .catch((error) => {
        console.error('❌ Cleanup failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
